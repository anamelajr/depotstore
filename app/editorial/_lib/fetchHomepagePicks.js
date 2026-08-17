import { unstable_cache } from "next/cache";
import { chunkArray } from "../../lib/chunk.js";
import {
  withVisibility,
  PRODUCT_ROW_SELECT,
  mapProductRow,
} from "../../lib/productQueries.js";

function pairKey(p) {
  return `${p.storeDomain}::${p.handle}`;
}

export async function fetchHomepagePicks(picks, { client } = {}) {
  if (!picks || picks.length === 0) return [];

  // Shared anon client rather than a fresh createClient per call. Imported
  // lazily so this module stays importable where the Supabase env vars aren't
  // set at module-evaluation time (supabase.js calls createClient on import).
  const supabase = client || (await import("../../lib/supabase.js")).supabase;

  const orderIndex = new Map(picks.map((p, i) => [pairKey(p), i]));

  const byStore = new Map();
  for (const p of picks) {
    if (!byStore.has(p.storeDomain)) byStore.set(p.storeDomain, []);
    byStore.get(p.storeDomain).push(p.handle);
  }

  // (store, chunk) pairs run concurrently — the sequential for-of made the
  // homepage pay one round-trip per store in series. Handles are still
  // chunked at 100 per the PostgREST URL-length rule.
  const jobs = [];
  for (const [storeDomain, handles] of byStore) {
    for (const chunk of chunkArray(handles, 100)) {
      jobs.push({ storeDomain, chunk });
    }
  }

  const results = await Promise.all(
    jobs.map(async ({ storeDomain, chunk }) => {
      const { data, error } = await withVisibility(
        supabase
          .from("products")
          .select(PRODUCT_ROW_SELECT)
          .eq("store_domain", storeDomain),
      ).in("handle", chunk);
      // Throws rather than skipping the chunk: the call site caches this
      // result for an hour, and a silently-partial curation would be served
      // as authoritative for that whole window. The caller catches and falls
      // back to the date-seeded rotation.
      if (error) {
        throw new Error(`[fetchHomepagePicks] ${storeDomain}: ${error.message}`);
      }
      return data || [];
    }),
  );

  const all = results.flat();

  // Sort raw rows by curated order before mapping; the snake_case keys
  // come from the SELECT, the camelCase ones from mapProductRow below.
  all.sort((a, b) => {
    const ai = orderIndex.get(`${a.store_domain}::${a.handle}`) ?? 1e9;
    const bi = orderIndex.get(`${b.store_domain}::${b.handle}`) ?? 1e9;
    return ai - bi;
  });

  return all.slice(0, 8).map(mapProductRow);
}

// Cached entry point for the homepage. Keyed by the picks payload itself, so
// editing content/homepage-edit.json produces a new key rather than waiting
// out the previous entry.
export async function fetchCachedHomepagePicks(picks) {
  const cached = unstable_cache(
    () => fetchHomepagePicks(picks),
    ["homepage-picks-v1", JSON.stringify(picks)],
    { revalidate: 3600 },
  );
  return cached();
}
