import { supabase } from "../../lib/supabase.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const PAGE_SIZE = 1000;
  const allRows = [];
  let from = 0;
  let pages = 0;

  while (true) {
    const { data, error } = await supabase
      .from("products")
      .select(
        "name, title, brand, price, image_url, store_name, store_domain, product_url, available, handle"
      )
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("Supabase fetch error:", JSON.stringify({
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      }));
      return Response.json({ error: "Failed to fetch products", detail: error.message, code: error.code }, { status: 500 });
    }

    pages++;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const products = allRows.map((row) => ({
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
  }));

  const distinctStores = new Set(products.map((p) => p.storeDomain)).size;
  console.log(`Supabase fetch: ${products.length} products, ${pages} pages, ${distinctStores} stores`);

  return Response.json(products);
}
