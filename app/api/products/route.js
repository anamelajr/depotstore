import { supabase } from "../../lib/supabase.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "40")));
  const store = searchParams.get("store");
  const category = searchParams.get("category");
  const search = searchParams.get("search");
  const sort = searchParams.get("sort") || "newest";
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("products")
    .select("name, title, brand, price, image_url, store_name, store_domain, product_url, available, handle, category", { count: "exact" })
    .eq("available", true)
    .range(from, to);

  if (store) query = query.eq("store_domain", store);
  if (category) query = query.eq("category", category);
  if (search) query = query.ilike("title", `%${search}%`);

  query = sort === "oldest"
  ? query.order("synced_at", { ascending: true }).order("id", { ascending: true })
  : query.order("synced_at", { ascending: false }).order("id", { ascending: false });

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