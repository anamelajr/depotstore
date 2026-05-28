import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertDev } from "../_gate.js";
import { getActiveStores } from "../../../lib/stores.js";
import { fetchStoreProducts } from "../../../lib/shopifyFetch.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// One-shot backfill of the products.size column for every active store.
// Re-fetches via the same listing-endpoint path the cron uses, so the
// parsed `sizes` come from `normalizeProduct` (which calls parseSizes
// internally). Writes a scoped UPDATE — touches only the `size` column,
// never `name`/`price`/`available`/etc. — to keep this idempotent and
// safe to re-run.
//
// Dev-only: middleware.js returns 404 for `/api/admin/*` in production,
// and assertDev() is a second gate inside the handler.
export async function POST() {
  const gate = assertDev();
  if (gate) return gate;

  const stores = await getActiveStores();
  const storeResults = [];
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  for (const store of stores) {
    let processed = 0;
    let updated = 0;
    let errors = 0;
    let fetchError = null;

    try {
      const products = await fetchStoreProducts(store);
      processed = products.length;
      // Run updates in bounded-concurrency chunks. A purely-serial
      // `await` per row at ~50-100ms each puts 7,280 rows well above
      // the 300s maxDuration on this route (Vercel kills the request,
      // leaving the DB in the exact partially-populated state the
      // deploy sequence says must not ship). Chunked parallelism with
      // CONCURRENCY=20 brings the wall time to roughly
      // ceil(rowCount / 20) × ~80ms ≈ 30s for a 7,280-row catalog
      // across 11 stores, well within the budget.
      const CONCURRENCY = 20;
      for (let i = 0; i < products.length; i += CONCURRENCY) {
        const chunk = products.slice(i, i + CONCURRENCY);
        const chunkResults = await Promise.all(
          chunk.map((p) => {
            const sizeValue =
              p.sizes && p.sizes.length > 0 ? p.sizes : null;
            return supabase
              .from("products")
              .update({ size: sizeValue })
              .eq("store_domain", store.domain)
              .eq("handle", p.handle);
          }),
        );
        for (let j = 0; j < chunkResults.length; j++) {
          const { error } = chunkResults[j];
          if (error) {
            errors++;
            console.error(
              `backfill-sizes: update failed for ${store.domain}/${chunk[j].handle}:`,
              error.message,
            );
          } else {
            updated++;
          }
        }
      }
    } catch (e) {
      fetchError = e?.message ?? String(e);
      errors++;
      console.error(
        `backfill-sizes: fetch failed for ${store.domain}:`,
        fetchError,
      );
    }

    storeResults.push({
      domain: store.domain,
      processed,
      updated,
      errors,
      fetchError,
    });
    totalProcessed += processed;
    totalUpdated += updated;
    totalErrors += errors;
  }

  return NextResponse.json({
    totalProcessed,
    totalUpdated,
    totalErrors,
    results: storeResults,
  });
}
