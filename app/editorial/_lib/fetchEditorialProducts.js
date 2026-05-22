import { chunkArray } from "../../lib/chunk.js";
import {
  fetchInterleavedProducts,
  withVisibility,
  PRODUCT_ROW_SELECT,
  mapProductRow,
} from "../../lib/productQueries.js";

async function getDefaultClient() {
  const { supabase } = await import("../../lib/supabase.js");
  return supabase;
}

function pairKey(p) {
  return `${p.storeDomain}::${p.handle}`;
}

function groupByDomain(pairs) {
  const map = new Map();
  for (const p of pairs) {
    if (!map.has(p.storeDomain)) map.set(p.storeDomain, []);
    map.get(p.storeDomain).push(p.handle);
  }
  return map;
}

async function fetchCurated(client, curatedProducts) {
  if (!curatedProducts?.length) return [];
  const byDomain = groupByDomain(curatedProducts);
  const wanted = new Set(curatedProducts.map(pairKey));
  const rows = [];

  for (const [domain, handles] of byDomain.entries()) {
    for (const chunk of chunkArray(handles, 100)) {
      const { data, error } = await withVisibility(
        client
          .from("products")
          .select(PRODUCT_ROW_SELECT)
          .eq("store_domain", domain),
      ).in("handle", chunk);
      if (error) {
        console.error("[fetchEditorialProducts] curated fetch error:", error.message);
        continue;
      }
      for (const row of data || []) {
        const mapped = mapProductRow(row);
        if (wanted.has(pairKey(mapped))) rows.push(mapped);
      }
    }
  }

  // Re-sort by author's curated order — Supabase IN does not preserve order.
  const orderIndex = new Map(
    curatedProducts.map((p, i) => [pairKey(p), i])
  );
  rows.sort((a, b) => orderIndex.get(pairKey(a)) - orderIndex.get(pairKey(b)));
  return rows;
}

async function fetchBrandPool(client, brandFilter, excludeKeys, limit) {
  if (!brandFilter || limit <= 0) return [];
  // Overfetch by excludeKeys.size + 4 so post-dedupe we still have `limit`
  // candidates even if curated handles dominate the top of the brand pool.
  const { data, error } = await fetchInterleavedProducts({
    brand: brandFilter,
    limit: limit + excludeKeys.size + 4,
    offset: 0,
    client,
  });
  if (error) {
    console.error("[fetchEditorialProducts] brand-pool RPC error:", error.message);
    return [];
  }
  const out = [];
  for (const row of data || []) {
    const mapped = mapProductRow(row);
    if (excludeKeys.has(pairKey(mapped))) continue;
    out.push(mapped);
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchEditorialProducts({
  curatedProducts = [],
  brandFilter = null,
  moreFromLimit = 8,
  minCurated = 4,
  client = null,
} = {}) {
  if (!client) client = await getDefaultClient();
  const curated = await fetchCurated(client, curatedProducts);
  const curatedKeys = new Set(curated.map(pairKey));

  const moreFrom = await fetchBrandPool(
    client,
    brandFilter,
    curatedKeys,
    moreFromLimit
  );

  let backfilled = curated;
  if (curated.length < minCurated && brandFilter) {
    const moreFromKeys = new Set(moreFrom.map(pairKey));
    const exclude = new Set([...curatedKeys, ...moreFromKeys]);
    const fillers = await fetchBrandPool(
      client,
      brandFilter,
      exclude,
      minCurated - curated.length
    );
    backfilled = [...curated, ...fillers];
  }

  return { curated: backfilled, moreFrom };
}
