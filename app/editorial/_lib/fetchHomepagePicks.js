import { createClient } from "@supabase/supabase-js";
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

  const supabase =
    client ||
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

  const orderIndex = new Map(picks.map((p, i) => [pairKey(p), i]));

  const byStore = new Map();
  for (const p of picks) {
    if (!byStore.has(p.storeDomain)) byStore.set(p.storeDomain, []);
    byStore.get(p.storeDomain).push(p.handle);
  }

  const all = [];
  for (const [storeDomain, handles] of byStore) {
    for (const chunk of chunkArray(handles, 100)) {
      const { data, error } = await withVisibility(
        supabase
          .from("products")
          .select(PRODUCT_ROW_SELECT)
          .eq("store_domain", storeDomain),
      ).in("handle", chunk);
      if (error) {
        console.warn(`[fetchHomepagePicks] ${storeDomain}: ${error.message}`);
        continue;
      }
      all.push(...(data || []));
    }
  }

  // Sort raw rows by curated order before mapping; the snake_case keys
  // come from the SELECT, the camelCase ones from mapProductRow below.
  all.sort((a, b) => {
    const ai = orderIndex.get(`${a.store_domain}::${a.handle}`) ?? 1e9;
    const bi = orderIndex.get(`${b.store_domain}::${b.handle}`) ?? 1e9;
    return ai - bi;
  });

  return all.slice(0, 8).map(mapProductRow);
}
