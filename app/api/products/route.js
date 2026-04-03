import { supabase } from "../../lib/supabase.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase
    .from("products")
    .select(
      "name, title, brand, price, image_url, store_name, store_domain, product_url, available, handle"
    )
    .limit(25000);

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
  }));

  return Response.json(products);
}
