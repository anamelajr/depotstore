// Default client is dynamically imported so this module stays importable
// in test/build environments that don't have NEXT_PUBLIC_SUPABASE_URL set
// at module-evaluation time. supabase.js eagerly calls createClient() on
// import, which throws when the URL is missing.
async function getDefaultClient() {
  const { supabase } = await import("./supabase.js");
  return supabase;
}

// Pure query transformer applying the visibility invariant from CLAUDE.md:
// every `available = true` read must also filter `hidden = false`. Wrapping
// the pair behind one helper means a future visibility rule (e.g.,
// `archived = false`) is a one-line change, not a sweep across every product
// read. Caller passes any PostgREST query builder mid-chain; the .eq() calls
// compose cleanly with .from().select(), .order(), .range(), .in(), etc.
export function withVisibility(query) {
  return query.eq("available", true).eq("hidden", false);
}

// Canonical SELECT for direct `.from("products").select(...)` reads. Every
// product-read surface used to spell out its own column list; the lists
// drifted (some included `id`, some included `category`, none agreed on
// what the feed actually returns). Locking the column set here is the
// counterpart to `mapProductRow` below: one constant on the way in, one
// mapper on the way out, no room for shape drift between sites.
//
// Distinct from INTERLEAVED_RPC_RETURN_COLUMNS — that array documents what
// the RPC returns (source of truth: the SQL migration). This string is
// for callers building their own SELECT against the `products` table. They
// overlap heavily, but unifying them would tangle the SQL contract with
// the JS read contract.
export const PRODUCT_ROW_SELECT =
  "name, title, brand, price, image_url, image_url_2, store_name, store_domain, product_url, available, handle";

// Feed surfaces (`/api/products`) need `category` for filtering chips on
// the card. Editorial / homepage / MoreFromStore surfaces don't render it.
// Append rather than fork the list so the base stays the single source of
// truth.
export const PRODUCT_ROW_SELECT_WITH_CATEGORY = `${PRODUCT_ROW_SELECT}, category`;

// Single mapper that snake_case → camelCase for every product row,
// regardless of which SELECT the caller used. Columns the caller didn't
// SELECT come back `undefined`, which `JSON.stringify` drops — so the API
// JSON shape stays identical to today even though the mapper is uniform.
//
// Deliberately NOT emitting `id` or `subcategory`: `id` was emitted by
// editorial mappers but no consumer reads it; `subcategory` was selected
// by the feed's direct-query path but never made it into the response.
// Both drop out by omission here.
export function mapProductRow(row) {
  return {
    name: row.name,
    title: row.title,
    brand: row.brand,
    price: row.price,
    imageUrl: row.image_url,
    imageUrl2: row.image_url_2,
    storeName: row.store_name,
    storeDomain: row.store_domain,
    productUrl: row.product_url,
    available: row.available,
    handle: row.handle,
    category: row.category,
  };
}

// Columns returned by get_interleaved_products. Source of truth lives in
// the SQL migrations: scripts/sql/2026-05-21-interleaved-rpcs.sql defines
// the original RETURNS TABLE; scripts/sql/2026-05-28-add-image-url-2.sql
// adds image_url_2. (count_interleaved_products returns bigint and is not
// described here.) `name` is mandatory: ProductCard falls back to it when
// `title` is null (CLAUDE.md invariant).
export const INTERLEAVED_RPC_RETURN_COLUMNS = Object.freeze([
  "id",
  "handle",
  "name",
  "title",
  "brand",
  "price",
  "image_url",
  "image_url_2",
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
