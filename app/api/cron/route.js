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

      const rows = products.map((p) => ({
        shopify_id: p.shopifyId,
        handle: p.handle,
        store_domain: p.storeDomain,
        name: p.name,
        title: p.title,
        brand: p.brand,
        price: p.price,
        image_url: p.imageUrl,
        store_name: p.storeName,
        product_url: p.productUrl,
        available: p.available,
        category: p.category ?? null,
        synced_at: syncStart,
      }));

      if (rows.length === 0) {
        return { store: store.domain, count: 0 };
      }

      // Upsert in batches of 500 to stay within payload limits
      const BATCH_SIZE = 500;
      let upserted = 0;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabaseAdmin
          .from("products")
          .upsert(batch, { onConflict: "handle,store_domain" });

        if (error) {
          throw new Error(
            `Supabase upsert failed for ${store.domain}: ${error.message}`
          );
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
