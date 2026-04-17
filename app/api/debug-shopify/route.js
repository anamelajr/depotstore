export const dynamic = "force-dynamic";

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const TARGET_HANDLE = "jitrois-leather-dress-1";
  const STORE_DOMAIN = "escoparis.com";
  const base = `https://${STORE_DOMAIN}/products.json`;

  let page = 1;
  let rawProduct = null;
  let pagesChecked = 0;

  while (!rawProduct && page <= 20) {
    const res = await fetch(`${base}?limit=250&page=${page}`);
    pagesChecked = page;
    if (!res.ok) {
      return Response.json({ error: `Shopify fetch failed page ${page}: ${res.status}` });
    }
    const data = await res.json();
    const products = Array.isArray(data?.products) ? data.products : [];
    if (products.length === 0) break;
    const match = products.find((p) => p.handle === TARGET_HANDLE);
    if (match) {
      rawProduct = match;
      break;
    }
    if (products.length < 250) break;
    page++;
  }

  if (!rawProduct) {
    return Response.json({ found: false, pagesChecked, message: `Handle ${TARGET_HANDLE} not found` });
  }

  return Response.json({
    found: true,
    pagesChecked,
    handle: rawProduct.handle,
    title: rawProduct.title,
    updatedAt: rawProduct.updated_at,
    variants: rawProduct.variants?.map((v) => ({
      id: v.id,
      price: v.price,
      compare_at_price: v.compare_at_price,
      available: v.available,
      updated_at: v.updated_at,
    })),
  });
}
