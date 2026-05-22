import { supabase } from "../../lib/supabase.js";
import { resolveCategoryFilter } from "../../lib/categories.js";
import {
  fetchInterleavedProducts,
  countInterleavedProducts,
  withVisibility,
} from "../../lib/productQueries.js";

export const dynamic = "force-dynamic";

// PostgREST treats `,` `.` `:` `(` `)` and whitespace as filter-syntax
// delimiters when unquoted. Wrap any value containing one of those in
// double quotes (doubling any embedded quote per PostgREST convention)
// so the parser reads it as a single literal value. Defensive against
// future category names like "Dresses, Skirts & Robes".
function escapePostgrestValue(value) {
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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(600, Math.max(1, parseInt(searchParams.get("limit") || "42")));
  const store = searchParams.get("store");
  const categoryRaw = searchParams.get("category");
  const categorySlugs = categoryRaw ? categoryRaw.split(",").filter(Boolean) : [];
  const { parentCategories, leafFilters } = resolveCategoryFilter(categorySlugs);
  const search = searchParams.get("search");
  const brand = searchParams.get("brand");
  const sort = searchParams.get("sort");
  const offset = (page - 1) * limit;

  // Interleaved RPC only works for parent-only selections — its WHERE clause
  // ANDs the category and subcategory filters, which silently drops parent
  // rows when leaf filters are present. Mixed or leaf-only requests fall
  // through to the direct-query path, which uses OR semantics. The cost
  // is losing store-interleaving for those requests; newest-first is the
  // pragmatic substitute order.
  const hasLeafFilters = leafFilters.length > 0;
  const useInterleavedRpc = (!sort || sort === "interleaved") && !hasLeafFilters;

  if (useInterleavedRpc) {
    const categoryDbParam = parentCategories.length > 0 ? parentCategories.join(",") : null;
    const [{ data, error }, { data: countData, error: countError }] = await Promise.all([
      fetchInterleavedProducts({
        store: store || null,
        category: categoryDbParam,
        search: search || null,
        brand: brand || null,
        limit,
        offset,
      }),
      countInterleavedProducts({
        store: store || null,
        category: categoryDbParam,
        search: search || null,
        brand: brand || null,
      }),
    ]);

    if (error || countError) {
      const msg = error?.message || countError?.message;
      console.error("RPC error:", msg);
      return Response.json({ error: "Failed to fetch products", detail: msg }, { status: 500 });
    }

    const products = (data || []).map((row) => ({
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
      category: row.category,
    }));

    return Response.json({ products, total: Number(countData), page, limit });
  }

  // Direct-query path: explicit sort OR a mixed parent+leaf selection.
  const from = offset;
  const to = from + limit - 1;

  const selectCols = "id, name, title, brand, price, image_url, store_name, store_domain, product_url, available, handle, category, subcategory";

  // Price is stored as TEXT ("€29.99") so DB ordering is lexicographic.
  // For price sorts: fetch all matching rows, sort numerically in JS, then paginate.
  if (sort === "price_asc" || sort === "price_desc") {
    let priceQuery = withVisibility(
      supabase.from("products").select(selectCols, { count: "exact" }),
    );

    if (store) priceQuery = priceQuery.eq("store_domain", store);
    priceQuery = applyCategoryOrFilter(priceQuery, { parentCategories, leafFilters });
    if (brand) priceQuery = priceQuery.ilike("brand", `%${brand}%`);
    priceQuery = applySearchFilter(priceQuery, search);

    const { data, count, error } = await priceQuery;

    if (error) {
      console.error("Supabase fetch error:", error.message);
      return Response.json({ error: "Failed to fetch products", detail: error.message }, { status: 500 });
    }

    const parsePrice = (p) => parseFloat((p || "").replace(/[^0-9.]/g, "")) || 0;
    data.sort((a, b) => {
      const diff = parsePrice(a.price) - parsePrice(b.price);
      if (diff !== 0) return sort === "price_asc" ? diff : -diff;
      return sort === "price_asc" ? a.id - b.id : b.id - a.id;
    });

    const paged = data.slice(from, from + limit);

    const products = paged.map((row) => ({
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
      category: row.category,
    }));

    return Response.json({ products, total: count, page, limit });
  }

  // Default newest-first ordering; covers explicit oldest/newest sorts AND
  // the leaf-bypass-of-interleaved fallback.
  let query = withVisibility(
    supabase.from("products").select(selectCols, { count: "exact" }),
  ).range(from, to);

  if (store) query = query.eq("store_domain", store);
  query = applyCategoryOrFilter(query, { parentCategories, leafFilters });
  if (brand) query = query.ilike("brand", `%${brand}%`);
  query = applySearchFilter(query, search);

  if (sort === "oldest") {
    query = query.order("synced_at", { ascending: true }).order("id", { ascending: true });
  } else {
    query = query.order("synced_at", { ascending: false }).order("id", { ascending: false });
  }

  const { data, count, error } = await query;

  if (error) {
    console.error("Supabase fetch error:", error.message);
    return Response.json({ error: "Failed to fetch products", detail: error.message }, { status: 500 });
  }

  const products = data.map((row) => ({
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
    category: row.category,
  }));

  return Response.json({ products, total: count, page, limit });
}
