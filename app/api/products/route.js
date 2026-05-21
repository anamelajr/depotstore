import { supabase } from "../../lib/supabase.js";
import { resolveCategoryFilter } from "../../lib/categories.js";

export const dynamic = "force-dynamic";

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
  const { categoryDbValues, subcategorySlugs } = resolveCategoryFilter(categorySlugs);
  const categories = categoryDbValues;
  const search = searchParams.get("search");
  const brand = searchParams.get("brand");
  const sort = searchParams.get("sort");
  const offset = (page - 1) * limit;

  // Comma-separated DB category names for the RPC (which splits via string_to_array)
  const categoryDbParam = categories.length > 0 ? categories.join(",") : null;
  const subcategoryParam = subcategorySlugs.length > 0 ? subcategorySlugs.join(",") : null;

  // Use interleaved RPC when no explicit sort is set (default discovery mode)
  if (!sort || sort === "interleaved") {
    const [{ data, error }, { data: countData, error: countError }] = await Promise.all([
      supabase.rpc("get_interleaved_products", {
        p_store: store || null,
        p_category: categoryDbParam,
        p_subcategory: subcategoryParam,
        p_search: search || null,
        p_brand: brand || null,
        p_limit: limit,
        p_offset: offset,
      }),
      supabase.rpc("count_interleaved_products", {
        p_store: store || null,
        p_category: categoryDbParam,
        p_subcategory: subcategoryParam,
        p_search: search || null,
        p_brand: brand || null,
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

  // Explicit sort — fall back to standard query
  const from = offset;
  const to = from + limit - 1;

  const selectCols = "id, name, title, brand, price, image_url, store_name, store_domain, product_url, available, handle, category, subcategory";

  // Price is stored as TEXT ("€29.99") so DB ordering is lexicographic.
  // For price sorts: fetch all matching rows, sort numerically in JS, then paginate.
  if (sort === "price_asc" || sort === "price_desc") {
    let priceQuery = supabase
      .from("products")
      .select(selectCols, { count: "exact" })
      .eq("available", true)
      .eq("hidden", false);

    if (store) priceQuery = priceQuery.eq("store_domain", store);
    if (categories.length === 1) priceQuery = priceQuery.eq("category", categories[0]);
    else if (categories.length > 1) priceQuery = priceQuery.in("category", categories);
    if (subcategorySlugs.length === 1) priceQuery = priceQuery.eq("subcategory", subcategorySlugs[0]);
    else if (subcategorySlugs.length > 1) priceQuery = priceQuery.in("subcategory", subcategorySlugs);
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

  // Non-price explicit sorts (oldest, newest) — DB ordering is correct
  let query = supabase
    .from("products")
    .select(selectCols, { count: "exact" })
    .eq("available", true)
    .eq("hidden", false)
    .range(from, to);

  if (store) query = query.eq("store_domain", store);
  if (categories.length === 1) query = query.eq("category", categories[0]);
  else if (categories.length > 1) query = query.in("category", categories);
  if (subcategorySlugs.length === 1) query = query.eq("subcategory", subcategorySlugs[0]);
  else if (subcategorySlugs.length > 1) query = query.in("subcategory", subcategorySlugs);
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