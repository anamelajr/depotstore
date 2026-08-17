import { unstable_cache } from "next/cache";
import {
  withVisibility,
  PRODUCT_ROW_SELECT,
  mapProductRow,
} from "./productQueries.js";

// The homepage's date-seeded rotation, read straight from Supabase.
//
// This replaces a fan-out of one self-HTTP fetch per store to the site's own
// `/api/products` (13 requests → 26 Supabase queries, half of them exact
// counts that were discarded, ~260 rows fetched to render 8 cards). Going
// direct also removes the `NEXT_PUBLIC_BASE_URL` dependency, which silently
// produced an empty section whenever the var was unset in a deployed env.
//
// Throws on any per-store error rather than returning a partial rotation:
// `unstable_cache` will not cache a throw, but it WOULD happily cache a
// short/partial list for the full hour. The caller keeps its try/catch and
// degrades to an empty section.
const PER_STORE_LIMIT = 20;
const MAX_CARDS = 8;

export async function fetchDailyRotation({ storeDomains, seed, client }) {
  if (!Array.isArray(storeDomains) || storeDomains.length === 0) return [];

  const supabase = client || (await import("./supabase.js")).supabase;

  const perStore = await Promise.all(
    storeDomains.map(async (domain) => {
      const { data, error } = await withVisibility(
        supabase
          .from("products")
          .select(PRODUCT_ROW_SELECT)
          .eq("store_domain", domain),
      )
        // `id DESC` breaks synced_at ties deterministically — a whole store
        // syncs in one batch, so synced_at alone is not a total order.
        .order("synced_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PER_STORE_LIMIT);

      if (error) {
        throw new Error(`daily rotation: ${domain}: ${error.message}`);
      }

      const rows = data ?? [];
      if (rows.length === 0) return [];
      return [rows[seed % rows.length]];
    }),
  );

  return perStore.flat().filter(Boolean).slice(0, MAX_CARDS).map(mapProductRow);
}

// Cache key carries the seed and the sorted domain list, so the rotation turns
// over at the day boundary and a store activation/deactivation busts the entry
// instead of serving a card from a store that is no longer listed.
export async function fetchCachedDailyRotation({ storeDomains, seed }) {
  const key = [...storeDomains].sort().join(",");
  const cached = unstable_cache(
    () => fetchDailyRotation({ storeDomains, seed }),
    ["daily-rotation-v1", String(seed), key],
    { revalidate: 3600 },
  );
  return cached();
}
