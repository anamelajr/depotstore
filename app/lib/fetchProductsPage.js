import { resolveCategoryFilter } from "./categories.js";
import { expandSearchAliases } from "./searchAliases.js";
import {
  fetchInterleavedProducts,
  countInterleavedProducts,
  withVisibility,
  PRODUCT_ROW_SELECT_WITH_CATEGORY,
  mapProductRow,
} from "./productQueries.js";

// Default client is dynamically imported so this module stays importable in
// test/build environments without NEXT_PUBLIC_SUPABASE_URL set at
// module-evaluation time (same rationale as productQueries.js:5-8).
async function getDefaultClient() {
  const { supabase } = await import("./supabase.js");
  return supabase;
}

// PostgREST treats `,` `.` `:` `(` `)` and whitespace as filter-syntax
// delimiters when unquoted. Wrap any value containing one of those in
// double quotes (doubling any embedded quote per PostgREST convention)
// so the parser reads it as a single literal value. Defensive against
// future category names like "Dresses, Skirts & Robes".
export function escapePostgrestValue(value) {
  const s = String(value);
  if (/[,.:()"\s]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Build the OR clause that unifies parent-only selections with
// (category, subcategory) leaf pairs. Without this, a request like
// ?category=tops,jackets would AND `category IN (Tops,J&C)` with
// `subcategory='jackets'`, silently dropping all Tops rows.
function applyCategoryOrFilter(query, { parentCategories, leafFilters }) {
  if (parentCategories.length === 0 && leafFilters.length === 0) return query;
  const parts = [
    ...parentCategories.map((c) => `category.eq.${escapePostgrestValue(c)}`),
    ...leafFilters.map(
      ({ category, subcategory }) =>
        `and(category.eq.${escapePostgrestValue(category)},subcategory.eq.${escapePostgrestValue(subcategory)})`,
    ),
  ];
  return query.or(parts.join(","));
}

// Split search query into words; each word must appear in title, brand, or name.
// Chained .or() calls are ANDed by PostgREST (append semantics, not overwrite).
function applySearchFilter(query, search) {
  if (!search) return query;
  const words = search
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[%_]/g, ""))
    .filter((w) => w.length >= 2);
  for (const word of words) {
    query = query.or(`title.ilike.%${word}%,brand.ilike.%${word}%,name.ilike.%${word}%`);
  }
  return query;
}

// Shared query core for the feed. Both `/api/products` (client fetches,
// Load More) and the server-rendered first page (`app/feed/page.js`) go
// through this one function so their semantics can't drift: alias
// expansion and category resolution happen INSIDE, on raw inputs.
//
// Throws on Supabase/RPC error or abort; callers decide how to degrade.
export async function fetchProductsPage({
  store = null,
  categorySlugs = [],
  search = null,
  brand = null,
  sort = null,
  limit,
  offset = 0,
  signal = undefined,
} = {}) {
  const { parentCategories, leafFilters } = resolveCategoryFilter(categorySlugs);
  const expandedSearch = expandSearchAliases(search);

  // Drop leaf filters whose category is already covered by a parent
  // selection — they're redundant (the parent subsumes them) and must
  // not push this request onto the newest-first fallback. UI lets users
  // toggle "All <Group>" and a child of the same group independently;
  // categories.test.js:53-61 documents `?category=tops,tops_tees` as a
  // supported shape.
  const effectiveLeafFilters = leafFilters.filter(
    (lf) => !parentCategories.includes(lf.category),
  );

  // The RPC's WHERE ANDs category and subcategory; that only drops rows
  // when a request mixes parent-only entries with leaf pairs IN A
  // DIFFERENT PARENT. Pure-leaf, multi-leaf, and same-parent parent+leaf
  // (post-normalization) all work because the
  // products_subcategory_matches_category CHECK constraint binds each
  // subcategory to one category, so AND'd ANY() lists across both axes
  // still return the right rows.
  const hasMixedShape =
    parentCategories.length > 0 && effectiveLeafFilters.length > 0;
  const useInterleavedRpc = (!sort || sort === "interleaved") && !hasMixedShape;

  if (useInterleavedRpc) {
    // Backfill effective leaves' parent categories into p_category so the
    // row set is constrained on category before subcategory matching.
    // Dedup keeps the CSV tidy; ANY() handles repeats either way.
    const categoryParts = [
      ...parentCategories,
      ...effectiveLeafFilters.map((lf) => lf.category),
    ];
    const subcategoryParts = effectiveLeafFilters.map((lf) => lf.subcategory);
    const categoryDbParam = categoryParts.length
      ? [...new Set(categoryParts)].join(",")
      : null;
    const subcategoryDbParam = subcategoryParts.length
      ? subcategoryParts.join(",")
      : null;

    const [{ data, error }, { data: countData, error: countError }] =
      await Promise.all([
        fetchInterleavedProducts({
          store: store || null,
          category: categoryDbParam,
          subcategory: subcategoryDbParam,
          search: expandedSearch || null,
          brand: brand || null,
          limit,
          offset,
          signal,
        }),
        countInterleavedProducts({
          store: store || null,
          category: categoryDbParam,
          subcategory: subcategoryDbParam,
          search: expandedSearch || null,
          brand: brand || null,
          signal,
        }),
      ]);

    if (error || countError) {
      const msg = error?.message || countError?.message;
      console.error("RPC error:", msg);
      throw new Error(msg || "Failed to fetch products");
    }

    return {
      products: (data || []).map(mapProductRow),
      total: Number(countData),
    };
  }

  // Direct-query path: explicit sort OR a mixed parent+leaf selection.
  const supabase = await getDefaultClient();
  const from = offset;
  const to = from + limit - 1;

  // Price is stored as TEXT ("€29.99") so DB ordering is lexicographic.
  // For price sorts: fetch all matching rows, sort numerically in JS, then paginate.
  if (sort === "price_asc" || sort === "price_desc") {
    // `id` is selected only for the tiebreaker below; it's stripped by
    // mapProductRow on the way out so the JSON response shape matches the
    // other surfaces.
    let priceQuery = withVisibility(
      supabase
        .from("products")
        .select(`${PRODUCT_ROW_SELECT_WITH_CATEGORY}, id`, { count: "exact" }),
    );

    if (store) priceQuery = priceQuery.eq("store_domain", store);
    priceQuery = applyCategoryOrFilter(priceQuery, { parentCategories, leafFilters });
    if (brand) priceQuery = priceQuery.ilike("brand", `%${brand}%`);
    priceQuery = applySearchFilter(priceQuery, expandedSearch);
    if (signal) priceQuery = priceQuery.abortSignal(signal);

    const { data, count, error } = await priceQuery;

    if (error) {
      console.error("Supabase fetch error:", error.message);
      throw new Error(error.message);
    }

    const parsePrice = (p) => parseFloat((p || "").replace(/[^0-9.]/g, "")) || 0;
    data.sort((a, b) => {
      const diff = parsePrice(a.price) - parsePrice(b.price);
      if (diff !== 0) return sort === "price_asc" ? diff : -diff;
      return sort === "price_asc" ? a.id - b.id : b.id - a.id;
    });

    const paged = data.slice(from, from + limit);
    return { products: paged.map(mapProductRow), total: count };
  }

  // Default newest-first ordering; covers explicit oldest/newest sorts AND
  // the leaf-bypass-of-interleaved fallback.
  let query = withVisibility(
    supabase
      .from("products")
      .select(PRODUCT_ROW_SELECT_WITH_CATEGORY, { count: "exact" }),
  ).range(from, to);

  if (store) query = query.eq("store_domain", store);
  query = applyCategoryOrFilter(query, { parentCategories, leafFilters });
  if (brand) query = query.ilike("brand", `%${brand}%`);
  query = applySearchFilter(query, expandedSearch);

  if (sort === "oldest") {
    query = query.order("synced_at", { ascending: true }).order("id", { ascending: true });
  } else {
    query = query.order("synced_at", { ascending: false }).order("id", { ascending: false });
  }

  if (signal) query = query.abortSignal(signal);

  const { data, count, error } = await query;

  if (error) {
    console.error("Supabase fetch error:", error.message);
    throw new Error(error.message);
  }

  return { products: data.map(mapProductRow), total: count };
}
