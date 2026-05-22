// Default client is dynamically imported so this module stays importable
// in test/build environments that don't have NEXT_PUBLIC_SUPABASE_URL set
// at module-evaluation time. supabase.js eagerly calls createClient() on
// import, which throws when the URL is missing.
async function getDefaultClient() {
  const { supabase } = await import("./supabase.js");
  return supabase;
}

// Columns returned by both get_interleaved_products and
// count_interleaved_products. Source of truth lives in
// scripts/sql/2026-05-21-interleaved-rpcs.sql (RETURNS TABLE block, ~lines
// 21–35 for get_; count_ returns bigint). `name` is mandatory: ProductCard
// falls back to it when `title` is null (CLAUDE.md invariant).
export const INTERLEAVED_RPC_RETURN_COLUMNS = Object.freeze([
  "id",
  "handle",
  "name",
  "title",
  "brand",
  "price",
  "image_url",
  "product_url",
  "available",
  "store_domain",
  "store_name",
  "category",
  "synced_at",
]);

// Single source of truth for the get_interleaved_products RPC call shape.
// Both /api/products and fetchEditorialProducts go through this; without
// it, a parameter rename in the SQL silently surfaces as data:null at one
// of the two call sites (PostgREST RPC errors → null data to the caller).
export async function fetchInterleavedProducts({
  store = null,
  category = null,
  subcategory = null,
  search = null,
  brand = null,
  limit,
  offset = 0,
  client = null,
} = {}) {
  const c = client || (await getDefaultClient());
  return c.rpc("get_interleaved_products", {
    p_store: store,
    p_category: category,
    p_subcategory: subcategory,
    p_search: search,
    p_brand: brand,
    p_limit: limit,
    p_offset: offset,
  });
}

export async function countInterleavedProducts({
  store = null,
  category = null,
  subcategory = null,
  search = null,
  brand = null,
  client = null,
} = {}) {
  const c = client || (await getDefaultClient());
  return c.rpc("count_interleaved_products", {
    p_store: store,
    p_category: category,
    p_subcategory: subcategory,
    p_search: search,
    p_brand: brand,
  });
}
