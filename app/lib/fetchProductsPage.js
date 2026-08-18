import { unstable_cache } from "next/cache";

import { resolveCategoryFilter } from "./categories.js";
import { expandSearchAliases } from "./searchAliases.js";
import {
  fetchInterleavedProducts,
  countInterleavedProducts,
  withVisibility,
  PRODUCT_ROW_SELECT_WITH_CATEGORY,
  mapProductRow,
} from "./productQueries.js";
import { LOAD_SIZE } from "./feed-utils.js";

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
// Returns `{ products, total, hasMore }`.
//
// The exact count is computed ONLY on the first page (`offset === 0`). Every
// Load More used to repeat the full count scan alongside the row fetch —
// double the DB work for a number the UI already had. Subsequent pages
// instead over-fetch by one row and derive `hasMore` from whether that extra
// row materialized, so `total` comes back null past the first page.
//
// `hasMore` is deliberately server-derived and never reconstructed from a
// client-supplied total: the catalog mutates hourly, so a total captured at
// page 1 would either hide Load More early or drive repeated empty loads.
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
  // Only the first page pays for an exact count; later pages derive hasMore
  // from a limit+1 probe.
  const wantsCount = offset === 0;

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

    const [{ data, error }, countResult] = await Promise.all([
      fetchInterleavedProducts({
        store: store || null,
        category: categoryDbParam,
        subcategory: subcategoryDbParam,
        search: expandedSearch || null,
        brand: brand || null,
        // +1 probe row on Load More pages; sliced off below.
        limit: wantsCount ? limit : limit + 1,
        offset,
        signal,
      }),
      wantsCount
        ? countInterleavedProducts({
            store: store || null,
            category: categoryDbParam,
            subcategory: subcategoryDbParam,
            search: expandedSearch || null,
            brand: brand || null,
            signal,
          })
        : null,
    ]);

    if (error || countResult?.error) {
      const msg = error?.message || countResult?.error?.message;
      console.error("RPC error:", msg);
      throw new Error(msg || "Failed to fetch products");
    }

    const rows = data || [];
    if (wantsCount) {
      const total = Number(countResult.data);
      return {
        products: rows.map(mapProductRow),
        total,
        hasMore: offset + rows.length < total,
      };
    }
    return {
      products: rows.slice(0, limit).map(mapProductRow),
      total: null,
      hasMore: rows.length > limit,
    };
  }

  // Direct-query path: explicit sort OR a mixed parent+leaf selection.
  const supabase = await getDefaultClient();
  const from = offset;
  const to = from + limit - 1;

  // Price sorts order and paginate in the DB on `price_cents`, the STORED
  // GENERATED integer derived from the canonical TEXT `price`
  // (scripts/sql/2026-08-17-price-cents.sql). TEXT `price` remains canonical
  // and is what gets rendered; price_cents is never authored or written by
  // app code.
  //
  // This replaces a fetch-everything-and-sort-in-JS branch that ran with no
  // `.range()`. PostgREST caps an unranged read at 1,000 rows against ~8,000
  // visible products, so that branch sorted an arbitrary slice of the catalog
  // — wrong results, not just slow — and re-fetched the whole set on every
  // Load More.
  //
  // NULL price → NULL price_cents → sorted last in BOTH directions
  // (`nullsFirst: false`), and still returned: NULL means unknown, not
  // unsellable.
  if (sort === "price_asc" || sort === "price_desc") {
    const ascending = sort === "price_asc";
    let priceQuery = withVisibility(
      supabase
        .from("products")
        .select(
          PRODUCT_ROW_SELECT_WITH_CATEGORY,
          wantsCount ? { count: "exact" } : undefined,
        ),
    ).range(from, wantsCount ? to : to + 1);

    if (store) priceQuery = priceQuery.eq("store_domain", store);
    priceQuery = applyCategoryOrFilter(priceQuery, { parentCategories, leafFilters });
    if (brand) priceQuery = priceQuery.ilike("brand", `%${brand}%`);
    priceQuery = applySearchFilter(priceQuery, expandedSearch);
    priceQuery = priceQuery
      .order("price_cents", { ascending, nullsFirst: false })
      // Deterministic tiebreaker: without it, equal prices can reshuffle
      // between pages and produce duplicate or skipped cards on Load More.
      .order("id", { ascending });
    if (signal) priceQuery = priceQuery.abortSignal(signal);

    const { data, count, error } = await priceQuery;

    if (error) {
      console.error("Supabase fetch error:", error.message);
      throw new Error(error.message);
    }

    if (wantsCount) {
      return {
        products: data.map(mapProductRow),
        total: count,
        hasMore: from + data.length < count,
      };
    }
    return {
      products: data.slice(0, limit).map(mapProductRow),
      total: null,
      hasMore: data.length > limit,
    };
  }

  // Default newest-first ordering; covers explicit oldest/newest sorts AND
  // the leaf-bypass-of-interleaved fallback.
  let query = withVisibility(
    supabase
      .from("products")
      .select(
        PRODUCT_ROW_SELECT_WITH_CATEGORY,
        wantsCount ? { count: "exact" } : undefined,
      ),
  ).range(from, wantsCount ? to : to + 1);

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

  if (wantsCount) {
    return {
      products: data.map(mapProductRow),
      total: count,
      hasMore: from + data.length < count,
    };
  }
  return {
    products: data.slice(0, limit).map(mapProductRow),
    total: null,
    hasMore: data.length > limit,
  };
}

// ── Cached default first page ──────────────────────────────────────────────
// The unfiltered, default-sorted first feed page is what every landing→feed
// click lands on, and it was paying a live interleaved-RPC round-trip every
// time (`/feed` is force-dynamic). It's the one variant with a hit rate worth
// caching; filtered/sorted variants stay live (combinatorial keys, low reuse).
//
// STALENESS CONTRACT (documented residual, mirrors stores.js / fx.js /
// fetchDailyRotation.js): `unstable_cache` is stale-while-revalidate — under
// sustained refresh failure it serves the old entry indefinitely, the exact
// property resolveProductDetail.js documents as the reason the PDP allowlist
// gate does NOT use it. That's acceptable here because this is *render* data,
// not authorization. A product hidden or sold inside the window renders as an
// ordinary card (not a SOLD overlay — withVisibility excludes sold from the
// feed entirely, so the stale entry simply still contains it); the accuracy
// boundary is the PDP, which is deliberately uncached and fails closed with a
// 404. Normal staleness is ≤120s; during a sustained Supabase outage the stale
// grid keeps serving, which beats the uncached alternative of an empty feed.
const DEFAULT_PAGE_FETCH_TIMEOUT_MS = 8000;

async function fetchDefaultFeedPageOrThrow() {
  // Deliberately NOT the FeedLoader's 4s race signal: the fill must be allowed
  // to outlive the render race so an abandoned cold miss still populates the
  // entry for the next visitor. This 8s bound (aligned with the PostgREST
  // statement-timeout cap) only guards the network-black-hole case the DB
  // statement timeout can't cover.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_PAGE_FETCH_TIMEOUT_MS);
  try {
    const result = await fetchProductsPage({
      store: null,
      categorySlugs: [],
      search: null,
      brand: null,
      sort: null,
      limit: LOAD_SIZE,
      offset: 0,
      signal: controller.signal,
    });
    // Never cache a blank feed: a transient failure would otherwise blank the
    // grid for a whole revalidate window. unstable_cache won't cache a throw.
    if (!result.products || result.products.length === 0) {
      throw new Error("default feed page returned empty");
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// Cache key bakes in LOAD_SIZE: changing the page size must not serve entries
// built at the old size.
export const fetchCachedDefaultFeedPage = unstable_cache(
  fetchDefaultFeedPageOrThrow,
  [`feed-default-page1-v1-ls${LOAD_SIZE}`],
  { revalidate: 120 },
);
