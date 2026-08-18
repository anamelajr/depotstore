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

  // Mirrors the feed loader's 4s bound. Unbounded, a slow ILIKE search could
  // hold this request open until the platform killed it; FeedClient's Load
  // More now surfaces a 504 as a retryable inline row rather than losing the
  // grid. No Cache-Control — the default first page is already served from the
  // server cache.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const { products, total, hasMore } = await fetchProductsPage({
      store: store || null,
      categorySlugs,
      search,
      brand: brand || null,
      sort,
      limit,
      offset,
      signal: controller.signal,
    });
    // `total` is null past the first page (the exact count is only computed at
    // offset 0); `hasMore` is the authoritative pagination signal from there
    // on. The client keeps displaying the offset-0 total.
    return Response.json({ products, total, hasMore, page, limit });
  } catch (err) {
    if (controller.signal.aborted) {
      return Response.json({ error: "Products query timed out" }, { status: 504 });
    }
    return Response.json(
      { error: "Failed to fetch products", detail: err.message },
      { status: 500 },
    );
  } finally {
    clearTimeout(timer);
  }
}
