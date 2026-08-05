import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "../../lib/supabase.js";
import { getActiveStores, fetchStoreProducts } from "../../lib/stores.js";
import { chunkArray } from "../../lib/chunk.js";
import { checkCdgAliasDrift } from "../../lib/searchAliases.js";
import { refreshFxRates } from "../../lib/fx.js";
import { captureInventorySnapshot } from "../../lib/captureInventorySnapshot.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Soft deadline for the sync phase. Stores still in flight at the deadline
// throw (cooperatively — no orphaned in-flight writes), reject, and are
// excluded from the scoped stale delete, so the tail (stale-delete →
// snapshot → enrich dispatch → enrich_runs log) always runs before the
// platform kills the function at maxDuration. 240s, not 270s: the once-daily
// snapshot capture needs up to ~60s of headroom.
const SYNC_DEADLINE_MS = 240_000;

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

  const deadline = syncStartMs + SYNC_DEADLINE_MS;
  const results = await Promise.allSettled(
    STORES.map(async (store) => {
      const storeStartMs = Date.now();
      const products = await fetchStoreProducts(store, { deadline });

      // Sync-only rows — editorial fields (brand, title, category) are
      // handled separately so the cron never overwrites backfilled data.
      // (fetchStoreProducts dedupes by handle, so a batch can't hit the
      // same (handle, store_domain) twice in one upsert.)
      const syncRows = products.map((p) => ({
        shopify_id: p.shopifyId,
        handle: p.handle,
        store_domain: p.storeDomain,
        name: p.name,
        store_name: p.storeName,
        price: p.price,
        image_url: p.imageUrl,
        image_url_2: p.imageUrl2,
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
        return { store: store.domain, count: 0, ms: Date.now() - storeStartMs };
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
        // Cooperative sync deadline — see SYNC_DEADLINE_MS. Checked between
        // batches so no store write starts after the breach.
        if (Date.now() > deadline) {
          throw new Error(
            `Sync deadline exceeded for ${store.domain} (batch at row ${i})`
          );
        }
        const batch = syncRows.slice(i, i + BATCH_SIZE);
        const handles = batch.map((r) => r.handle);

        // Pre-upsert state for sync-reset detection. Captures name/description
        // before the upsert overwrites them, so we can spot rows whose Shopify
        // listing changed since the last sync and reset their enrich budget.
        // Chunked so the URL stays under PostgREST's length limit on stores
        // with long handles (lobscur averages 76 chars/handle); chunks run
        // concurrently — each is ≤100 handles, far under the 8s
        // statement_timeout, and any failure still rejects the store promise.
        const preUpsert = (
          await Promise.all(
            chunkArray(handles, HANDLE_CHUNK).map(async (handleChunk) => {
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
              return data ?? [];
            })
          )
        ).flat();

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
          await Promise.all(
            chunkArray(resetHandles, HANDLE_CHUNK).map(async (handleChunk) => {
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
            })
          );
        }

        // Step 2: Editorial fields — only write where currently NULL in DB.
        // Chunked for the same URL-length reason as the pre-upsert SELECT.
        // The original block destructured only `data` and silently swallowed
        // any error; we now surface it so a future regression can't quietly
        // produce an empty editMap and re-classify curated rows as NULL.
        const existing = (
          await Promise.all(
            chunkArray(handles, HANDLE_CHUNK).map(async (handleChunk) => {
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
              return data ?? [];
            })
          )
        ).flat();

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
        ms: Date.now() - storeStartMs,
      };
    })
  );
  const syncTotalMs = Date.now() - syncStartMs;

  const successfulDomains = [];
  const perStoreMs = {};
  const deadlineHit = [];
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
      perStoreMs[r.value.store] = r.value.ms ?? null;
    } else {
      const msg = r.reason?.message ?? String(r.reason);
      summary.errors.push(msg);
      const deadlineMatch = msg.match(/^Sync deadline exceeded for (\S+)/);
      if (deadlineMatch) deadlineHit.push(deadlineMatch[1]);
      console.error("Sync error:", msg);
    }
  }

  // Remove stale products only for stores whose sync fulfilled. A store
  // whose promise rejected never refreshed `synced_at` for any of its rows,
  // so a global delete would wipe its last-known-good inventory based on
  // the previous run. This was the second half of the 2026-05-05 incident
  // that lost lobscur.com and dolcevitahub.com (15,751 rows).
  const staleDeleteStartMs = Date.now();
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

  // Capture a daily inventory snapshot for forward-going history/analytics.
  // Additive + failure-isolated: runs AFTER the stale-delete (so the clean-run
  // gate sees summary.errors) and BEFORE the enrich trigger (so it records
  // deterministic pre-enrich state). Its own try/catch never rethrows, so a
  // snapshot failure can never affect the sync response. Awaited adds latency
  // only on the ~once/day run that actually captures; the other ~23 runs hit the
  // cheap daily gate and return immediately, well within maxDuration = 300.
  const staleDeleteMs = Date.now() - staleDeleteStartMs;

  const snapshotStartMs = Date.now();
  await captureInventorySnapshot(syncStart, summary);
  const snapshotMs = Date.now() - snapshotStartMs;

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

  // Refresh FX rates off the response path. refreshFxRates is timeout-bounded
  // (~5 s AbortController), so a hung provider never delays the cron response
  // or the enrich_runs log. Unlike the enrich trigger above, do NOT swallow
  // silently: log structured success/failure so a blocked or malformed
  // Frankfurter doesn't age rates invisibly behind a healthy sync summary.
  // On success fx_rates.fetched_at advances; a run of fx_refresh_fail logs with
  // a stale fetched_at is the alertable condition. This path is isolated from
  // the successfulDomains stale-delete guard.
  waitUntil(
    refreshFxRates()
      .then(() => console.log(JSON.stringify({ event: "fx_refresh_ok" })))
      .catch((e) =>
        console.error(
          JSON.stringify({ event: "fx_refresh_fail", error: e?.message ?? String(e) }),
        ),
      ),
  );

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
      step_timings: {
        sync_total_ms: syncTotalMs,
        per_store_ms: perStoreMs,
        stale_delete_ms: staleDeleteMs,
        snapshot_ms: snapshotMs,
        deadline_hit: deadlineHit,
      },
    });
  } catch (e) {
    console.error("enrich_runs cron log failed:", e?.message ?? e);
  }

  // Alias-drift probe is logging-only (a full-table ILIKE scan) — keep it off
  // the response path so it can never delay the cron response or eat into
  // maxDuration headroom.
  waitUntil(
    checkCdgAliasDrift(supabaseAdmin)
      .then((aliasDrift) => {
        if (aliasDrift.error) {
          console.error(
            "alias drift probe failed:",
            aliasDrift.error.message ?? aliasDrift.error
          );
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
      })
      .catch((e) =>
        console.error("alias drift probe failed:", e?.message ?? e)
      )
  );

  return Response.json(summary);
}
