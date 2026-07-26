import { fetchProductsPage } from "../../lib/fetchProductsPage.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(600, Math.max(1, parseInt(searchParams.get("limit") || "42")));
  const store = searchParams.get("store");
  const categoryRaw = searchParams.get("category");
  const categorySlugs = categoryRaw ? categoryRaw.split(",").filter(Boolean) : [];
  const search = searchParams.get("search");
  const brand = searchParams.get("brand");
  const sort = searchParams.get("sort");
  // Explicit offset wins over (page - 1) * limit so FeedClient's Load More
  // can resume at a precise position when products.length isn't a multiple
  // of its page size (e.g., restore after the final partial batch + a cron
  // tick adding new rows; page math would silently snap to the wrong grid
  // and produce duplicate cards).
  const offsetParam = searchParams.get("offset");
  const offset = offsetParam !== null
    ? Math.max(0, parseInt(offsetParam) || 0)
    : (page - 1) * limit;

  try {
    const { products, total } = await fetchProductsPage({
      store: store || null,
      categorySlugs,
      search,
      brand: brand || null,
      sort,
      limit,
      offset,
    });
    return Response.json({ products, total, page, limit });
  } catch (err) {
    return Response.json(
      { error: "Failed to fetch products", detail: err.message },
      { status: 500 },
    );
  }
}
