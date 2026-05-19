import { chunkArray } from "../../lib/chunk.js";

async function getDefaultClient() {
  const { supabase } = await import("../../lib/supabase.js");
  return supabase;
}

const ROW_SELECT =
  "id, name, title, brand, price, image_url, store_name, store_domain, product_url, available, handle";

function mapRow(row) {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    brand: row.brand,
    price: row.price,
    imageUrl: row.image_url,
    storeName: row.store_name,
    storeDomain: row.store_domain,
    productUrl: row.product_url,
    available: row.available,
    handle: row.handle,
  };
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
      const { data, error } = await client
        .from("products")
        .select(ROW_SELECT)
        .eq("store_domain", domain)
        .eq("available", true)
        .eq("hidden", false)
        .in("handle", chunk);
      if (error) {
        console.error("[fetchEditorialProducts] curated fetch error:", error.message);
        continue;
      }
      for (const row of data || []) {
        const mapped = mapRow(row);
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
  const { data, error } = await client.rpc("get_interleaved_products", {
    p_store: null,
    p_category: null,
    p_search: null,
    p_brand: brandFilter,
    p_limit: limit + excludeKeys.size + 4,
    p_offset: 0,
  });
  if (error) {
    console.error("[fetchEditorialProducts] brand-pool RPC error:", error.message);
    return [];
  }
  const out = [];
  for (const row of data || []) {
    const mapped = mapRow(row);
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
