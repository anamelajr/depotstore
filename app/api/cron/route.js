import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "../../lib/supabase.js";
import { getActiveStores, fetchStoreProducts } from "../../lib/stores.js";
import { chunkArray } from "../../lib/chunk.js";
import { checkCdgAliasDrift } from "../../lib/searchAliases.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const syncStartMs = Date.now();
  const syncStart = new Date(syncStartMs).toISOString();
  const summary = { stores: {}, errors: [], totalUpserted: 0 };

  const STORES = await getActiveStores();
  if (STORES.length === 0) {
    return Response.json(
      { error: "No active stores returned — aborting sync to protect existing data" },
      { status: 500 }
    );
  }

  const results = await Promise.allSettled(
    STORES.map(async (store) => {
      const products = await fetchStoreProducts(store);

      // Sync-only rows — editorial fields (brand, title, category) are
      // handled separately so the cron never overwrites backfilled data.
      const syncRows = products.map((p) => ({
        shopify_id: p.shopifyId,
        handle: p.handle,
        store_domain: p.storeDomain,
        name: p.name,
        store_name: p.storeName,
        price: p.price,
        image_url: p.imageUrl,
        product_url: p.productUrl,
        available: p.available,
        synced_at: syncStart,
        description: p.rawDescription ?? null,
        // Mechanical projection from Shopify — overwrites every run
        // (unlike brand/title/category/subcategory, which are editorial
        // and COALESCE-protected in Step 2). supabase-js converts the JS
        // array to a Postgres `text[]` literal natively; do NOT
        // JSON.stringify or join — that would stash literal '["S","M"]'
        // text as the first array element instead.
        size: p.sizes && p.sizes.length > 0 ? p.sizes : null,
      }));

      if (syncRows.length === 0) {
        return { store: store.domain, count: 0 };
      }

      // Build a lookup from handle → original product for editorial data
      const productMap = Object.fromEntries(
        products.map((p) => [p.handle, p])
      );

      const BATCH_SIZE = 500;
      // Cap for `.in("handle", chunk)` SELECTs. PostgREST's URL limit is
      // ~16 KB; lobscur handles can be 126 chars, so 100 × 126 ≈ 12.6 KB
      // leaves enough headroom for the rest of the URL.
      const HANDLE_CHUNK = 100;
      let upserted = 0;
      let storeResetsByName = 0;
      let storeResetsByDesc = 0;
      for (let i = 0; i < syncRows.length; i += BATCH_SIZE) {
        const batch = syncRows.slice(i, i + BATCH_SIZE);
        const handles = batch.map((r) => r.handle);

        // Pre-upsert state for sync-reset detection. Captures name/description
        // before the upsert overwrites them, so we can spot rows whose Shopify
        // listing changed since the last sync and reset their enrich budget.
        // Chunked so the URL stays under PostgREST's length limit on stores
        // with long handles (lobscur averages 76 chars/handle).
        const preUpsert = [];
        for (const handleChunk of chunkArray(handles, HANDLE_CHUNK)) {
          const { data, error: preError } = await supabaseAdmin
            .from("products")
            .select("handle, name, description")
            .eq("store_domain", store.domain)
            .in("handle", handleChunk);

          if (preError) {
            throw new Error(
              `Pre-upsert state fetch failed for ${store.domain}: ${preError.message}`
            );
          }
          if (data) preUpsert.push(...data);
        }

        const preMap = Object.fromEntries(
          preUpsert.map((r) => [r.handle, r])
        );

        // Step 1: Always upsert sync fields
        const { error } = await supabaseAdmin
          .from("products")
          .upsert(batch, { onConflict: "handle,store_domain" });

        if (error) {
          throw new Error(
            `Supabase upsert failed for ${store.domain}: ${error.message}`
          );
        }

        // Reset enrich_attempts for rows whose name or description changed.
        // These rows may have been capped at MAX_ENRICH_ATTEMPTS under the old
        // content — the new content deserves a fresh budget.
        // Split by reason so enrich_runs logging can tell us whether
        // description churn (Shopify-side edits) or title churn is driving
        // daily token spend. `else if` prevents double-counting a row that
        // changed both.
        const resetHandlesByName = [];
        const resetHandlesByDesc = [];
        for (const row of batch) {
          const prev = preMap[row.handle];
          if (!prev) continue; // new row — counter starts at 0 anyway
          const nameChanged = prev.name !== row.name;
          const descChanged = prev.description !== row.description;
          if (nameChanged) resetHandlesByName.push(row.handle);
          else if (descChanged) resetHandlesByDesc.push(row.handle);
        }
        const resetHandles = [...resetHandlesByName, ...resetHandlesByDesc];
        storeResetsByName += resetHandlesByName.length;
        storeResetsByDesc += resetHandlesByDesc.length;

        if (resetHandles.length > 0) {
          for (const handleChunk of chunkArray(resetHandles, HANDLE_CHUNK)) {
            const { error: resetError } = await supabaseAdmin
              .from("products")
              .update({ enrich_attempts: 0 })
              .eq("store_domain", store.domain)
              .in("handle", handleChunk);

            if (resetError) {
              throw new Error(
                `Enrich-attempts reset failed for ${store.domain}: ${resetError.message}`
              );
            }
          }
        }

        // Step 2: Editorial fields — only write where currently NULL in DB.
        // Chunked for the same URL-length reason as the pre-upsert SELECT.
        // The original block destructured only `data` and silently swallowed
        // any error; we now surface it so a future regression can't quietly
        // produce an empty editMap and re-classify curated rows as NULL.
        const existing = [];
        for (const handleChunk of chunkArray(handles, HANDLE_CHUNK)) {
          const { data, error: existError } = await supabaseAdmin
            .from("products")
            .select("handle, brand, title, category")
            .eq("store_domain", store.domain)
            .in("handle", handleChunk);

          if (existError) {
            throw new Error(
              `Editorial state fetch failed for ${store.domain}: ${existError.message}`
            );
          }
          if (data) existing.push(...data);
        }

        const editMap = Object.fromEntries(
          existing.map((r) => [r.handle, r])
        );

        const editorialRows = [];
        for (const handle of handles) {
          const p = productMap[handle];
          const ex = editMap[handle];
          if (!p || !ex) continue;

          const needsUpdate =
            (!ex.brand && p.brand) ||
            (!ex.title && p.title) ||
            (!ex.category && (p.category ?? null));

          if (!needsUpdate) continue;

          editorialRows.push({
            handle: p.handle,
            store_domain: p.storeDomain,
            brand: ex.brand ?? p.brand ?? null,
            title: ex.title ?? p.title ?? null,
            category: ex.category ?? p.category ?? null,
          });
        }

        if (editorialRows.length > 0) {
          const { error: editError } = await supabaseAdmin
            .from("products")
            .upsert(editorialRows, { onConflict: "handle,store_domain" });

          if (editError) {
            throw new Error(
              `Editorial upsert failed for ${store.domain}: ${editError.message}`
            );
          }
        }

        upserted += batch.length;
      }

      return {
        store: store.domain,
        count: upserted,
        resetsByName: storeResetsByName,
        resetsByDesc: storeResetsByDesc,
      };
    })
  );

  const successfulDomains = [];
  const perStoreResets = {};
  let totalResetsByName = 0;
  let totalResetsByDesc = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      summary.stores[r.value.store] = r.value.count;
      summary.totalUpserted += r.value.count;
      // Accumulate reset counts for enrich_runs logging
      perStoreResets[r.value.store] = (r.value.resetsByName ?? 0) + (r.value.resetsByDesc ?? 0);
      totalResetsByName += r.value.resetsByName ?? 0;
      totalResetsByDesc += r.value.resetsByDesc ?? 0;
      // Only eligible for stale cleanup if rows were actually upserted.
      // A count of 0 means the store returned empty — treat it as failed
      // so we don't delete its last-known-good inventory.
      if (r.value.count > 0) successfulDomains.push(r.value.store);
    } else {
      const msg = r.reason?.message ?? String(r.reason);
      summary.errors.push(msg);
      console.error("Sync error:", msg);
    }
  }

  // Remove stale products only for stores whose sync fulfilled. A store
  // whose promise rejected never refreshed `synced_at` for any of its rows,
  // so a global delete would wipe its last-known-good inventory based on
  // the previous run. This was the second half of the 2026-05-05 incident
  // that lost lobscur.com and dolcevitahub.com (15,751 rows).
  if (successfulDomains.length === 0) {
    summary.deleted = 0;
    summary.errors.push(
      "Stale cleanup skipped — no store sync fulfilled this run"
    );
  } else {
    const { error: deleteError, count: deletedCount } = await supabaseAdmin
      .from("products")
      .delete({ count: "exact" })
      .in("store_domain", successfulDomains)
      .lt("synced_at", syncStart);

    summary.deleted = deletedCount ?? 0;
    if (deleteError) {
      summary.errors.push(`Stale cleanup failed: ${deleteError.message}`);
    }
  }

  const enrichUrl = `${new URL(request.url).origin}/api/enrich?depth=0`;
  const enrichHeaders = {
    Authorization: `Bearer ${process.env.CRON_SECRET}`,
  };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    enrichHeaders["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  waitUntil(
    fetch(enrichUrl, { method: "POST", headers: enrichHeaders }).catch(() => {})
  );
  summary.enrichTriggered = true;

  try {
    await supabaseAdmin.from("enrich_runs").insert({
      run_type: "cron",
      duration_ms: Date.now() - syncStartMs,
      total_synced: summary.totalUpserted,
      reset_count: totalResetsByName + totalResetsByDesc,
      reset_by_name: totalResetsByName,
      reset_by_desc: totalResetsByDesc,
      per_store_synced: summary.stores,
      per_store_resets: perStoreResets,
      store_errors: summary.errors,
      stale_deleted: summary.deleted ?? 0,
    });
  } catch (e) {
    console.error("enrich_runs cron log failed:", e?.message ?? e);
  }

  const aliasDrift = await checkCdgAliasDrift(supabaseAdmin);
  if (aliasDrift.error) {
    console.error("alias drift probe failed:", aliasDrift.error.message ?? aliasDrift.error);
  } else if (aliasDrift.count > 0) {
    console.warn(
      JSON.stringify({
        event: "search_alias_drift",
        alias: "cdg",
        count: aliasDrift.count,
        samples: aliasDrift.samples,
      }),
    );
  }
  summary.aliasDrift = { cdg: aliasDrift.error ? null : aliasDrift.count };

  return Response.json(summary);
}
