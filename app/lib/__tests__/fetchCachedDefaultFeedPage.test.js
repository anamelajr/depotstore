import { describe, it, expect, vi, beforeEach } from "vitest";

// unstable_cache is identity here: we're asserting the INNER contract — that a
// transient failure or an empty result throws rather than being cached, which
// is what keeps `unstable_cache` from blanking the feed for a whole window.
vi.mock("next/cache", () => ({ unstable_cache: (fn) => fn }));

const fetchInterleavedProducts = vi.fn();
const countInterleavedProducts = vi.fn();

vi.mock("../productQueries.js", () => ({
  fetchInterleavedProducts: (...a) => fetchInterleavedProducts(...a),
  countInterleavedProducts: (...a) => countInterleavedProducts(...a),
  withVisibility: (q) => q,
  PRODUCT_ROW_SELECT_WITH_CATEGORY: "*",
  mapProductRow: (r) => r,
}));

const { fetchCachedDefaultFeedPage } = await import("../fetchProductsPage.js");

beforeEach(() => {
  fetchInterleavedProducts.mockReset();
  countInterleavedProducts.mockReset();
});

describe("fetchCachedDefaultFeedPage", () => {
  it("returns the page when rows come back", async () => {
    fetchInterleavedProducts.mockResolvedValue({ data: [{ handle: "a" }], error: null });
    countInterleavedProducts.mockResolvedValue({ data: 1, error: null });
    const result = await fetchCachedDefaultFeedPage();
    expect(result.products).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("throws on an empty result rather than caching a blank feed", async () => {
    fetchInterleavedProducts.mockResolvedValue({ data: [], error: null });
    countInterleavedProducts.mockResolvedValue({ data: 0, error: null });
    await expect(fetchCachedDefaultFeedPage()).rejects.toThrow(/empty/);
  });

  it("propagates an RPC error", async () => {
    fetchInterleavedProducts.mockResolvedValue({ data: null, error: { message: "boom" } });
    countInterleavedProducts.mockResolvedValue({ data: null, error: null });
    await expect(fetchCachedDefaultFeedPage()).rejects.toThrow("boom");
  });

  it("requests the unfiltered default page with its own abort signal", async () => {
    fetchInterleavedProducts.mockResolvedValue({ data: [{ handle: "a" }], error: null });
    countInterleavedProducts.mockResolvedValue({ data: 1, error: null });
    await fetchCachedDefaultFeedPage();
    const args = fetchInterleavedProducts.mock.calls[0][0];
    expect(args).toMatchObject({ store: null, category: null, subcategory: null, search: null, brand: null, offset: 0, limit: 30 });
    expect(args.signal).toBeInstanceOf(AbortSignal);
    expect(args.signal.aborted).toBe(false);
  });
});
