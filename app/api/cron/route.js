import { supabaseAdmin } from "../../lib/supabase.js";
import { STORES, fetchStoreProducts } from "../../lib/stores.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const syncStart = new Date().toISOString();
  const summary = { stores: {}, errors: [], totalUpserted: 0 };

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
      }));

      if (syncRows.length === 0) {
        return { store: store.domain, count: 0 };
      }

      // Build a lookup from handle → original product for editorial data
      const productMap = Object.fromEntries(
        products.map((p) => [p.handle, p])
      );

      const BATCH_SIZE = 500;
      let upserted = 0;
      for (let i = 0; i < syncRows.length; i += BATCH_SIZE) {
        const batch = syncRows.slice(i, i + BATCH_SIZE);

        // Step 1: Always upsert sync fields
        const { error } = await supabaseAdmin
          .from("products")
          .upsert(batch, { onConflict: "handle,store_domain" });

        if (error) {
          throw new Error(
            `Supabase upsert failed for ${store.domain}: ${error.message}`
          );
        }

        // Step 2: Editorial fields — only write where currently NULL in DB
        const handles = batch.map((r) => r.handle);
        const { data: existing } = await supabaseAdmin
          .from("products")
          .select("handle, brand, title, category")
          .eq("store_domain", store.domain)
          .in("handle", handles);

        const editMap = Object.fromEntries(
          (existing || []).map((r) => [r.handle, r])
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

      return { store: store.domain, count: upserted };
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      summary.stores[r.value.store] = r.value.count;
      summary.totalUpserted += r.value.count;
    } else {
      const msg = r.reason?.message ?? String(r.reason);
      summary.errors.push(msg);
      console.error("Sync error:", msg);
    }
  }

  // Remove stale products that were not refreshed in this sync run
  const { error: deleteError, count: deletedCount } = await supabaseAdmin
    .from("products")
    .delete({ count: "exact" })
    .lt("synced_at", syncStart);

  summary.deleted = deletedCount ?? 0;
  if (deleteError) {
    summary.errors.push(`Stale cleanup failed: ${deleteError.message}`);
  }

  return Response.json(summary);
}
