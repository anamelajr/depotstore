import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks are hoisted before imports by Vitest.
// Paths resolve relative to THIS file (app/api/products/__tests__/route.test.js),
// so app/lib/* is three levels up.

vi.mock("../../../lib/productQueries.js", () => ({
  fetchInterleavedProducts: vi.fn(async () => ({ data: [], error: null })),
  countInterleavedProducts: vi.fn(async () => ({ data: 0, error: null })),
  withVisibility: vi.fn((q) => q),
  PRODUCT_ROW_SELECT_WITH_CATEGORY:
    "name,title,brand,price,image_url,image_url_2,store_name,store_domain,product_url,available,handle,category",
  mapProductRow: vi.fn((row) => row),
}));

// Chainable query builder that resolves to empty results when awaited.
// Needed by the direct-query fallback path in route.js.
const makeBuilder = () => {
  const b = {
    select: () => b,
    eq: () => b,
    or: () => b,
    ilike: () => b,
    range: () => b,
    order: () => b,
    // Make the builder thenable so `await builder` works.
    then: (resolve) =>
      Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
  };
  return b;
};

vi.mock("../../../lib/supabase.js", () => ({
  supabase: { from: vi.fn(() => makeBuilder()) },
}));

import { GET } from "../route.js";
import {
  fetchInterleavedProducts,
  countInterleavedProducts,
} from "../../../lib/productQueries.js";

function makeRequest(params = {}) {
  const url = new URL("http://localhost/api/products");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

describe("GET /api/products — routing decisions", () => {
  beforeEach(() => {
    vi.mocked(fetchInterleavedProducts).mockClear();
    vi.mocked(countInterleavedProducts).mockClear();
  });

  it("unfiltered: RPC with category=null, subcategory=null", async () => {
    await GET(makeRequest());
    expect(fetchInterleavedProducts).toHaveBeenCalledWith(
      expect.objectContaining({ category: null, subcategory: null }),
    );
  });

  it("parent-only (tops): RPC with category=Tops, subcategory=null", async () => {
    await GET(makeRequest({ category: "tops" }));
    expect(fetchInterleavedProducts).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Tops", subcategory: null }),
    );
  });

  it("pure leaf (tops_hoodies_sweaters): RPC with backfilled parent category", async () => {
    await GET(makeRequest({ category: "tops_hoodies_sweaters" }));
    expect(fetchInterleavedProducts).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Tops", subcategory: "hoodies_sweaters" }),
    );
  });

  it("multi-leaf same parent (hoodies + knitwear): RPC with combined subcategory", async () => {
    await GET(makeRequest({ category: "tops_hoodies_sweaters,tops_knitwear" }));
    expect(fetchInterleavedProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "Tops",
        subcategory: "hoodies_sweaters,knitwear",
      }),
    );
  });

  it("multi-leaf cross-parent (hoodies + coats): RPC with both parent categories backfilled", async () => {
    await GET(makeRequest({ category: "tops_hoodies_sweaters,coats" }));
    expect(fetchInterleavedProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "Tops,Jackets & Coats",
        subcategory: "hoodies_sweaters,coats",
      }),
    );
  });

  it("redundant same-parent (tops + tops_tees): leaf normalized away, RPC with category=Tops, subcategory=null", async () => {
    await GET(makeRequest({ category: "tops,tops_tees" }));
    expect(fetchInterleavedProducts).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Tops", subcategory: null }),
    );
  });

  it("true cross-group mix (tops + jackets): direct-query fallback — RPC not called", async () => {
    await GET(makeRequest({ category: "tops,jackets" }));
    expect(fetchInterleavedProducts).not.toHaveBeenCalled();
  });

  it("leaf + price sort: direct-query fallback — RPC not called", async () => {
    await GET(makeRequest({ category: "tops_hoodies_sweaters", sort: "price_asc" }));
    expect(fetchInterleavedProducts).not.toHaveBeenCalled();
  });
});

describe("GET /api/products — search alias propagation", () => {
  beforeEach(() => {
    vi.mocked(fetchInterleavedProducts).mockClear();
    vi.mocked(countInterleavedProducts).mockClear();
  });

  it("alias-aware search: cdg → comme on both fetch and count", async () => {
    await GET(makeRequest({ search: "CDG" }));
    expect(fetchInterleavedProducts).toHaveBeenCalledWith(
      expect.objectContaining({ search: "comme" }),
    );
    expect(countInterleavedProducts).toHaveBeenCalledWith(
      expect.objectContaining({ search: "comme" }),
    );
  });

  it("alias passthrough: unrelated search unchanged", async () => {
    await GET(makeRequest({ search: "dress" }));
    expect(fetchInterleavedProducts).toHaveBeenCalledWith(
      expect.objectContaining({ search: "dress" }),
    );
    expect(countInterleavedProducts).toHaveBeenCalledWith(
      expect.objectContaining({ search: "dress" }),
    );
  });

  it("alias-aware compound search: cdg + jacket → comme jacket", async () => {
    await GET(makeRequest({ search: "CDG jacket" }));
    expect(fetchInterleavedProducts).toHaveBeenCalledWith(
      expect.objectContaining({ search: "comme jacket" }),
    );
    expect(countInterleavedProducts).toHaveBeenCalledWith(
      expect.objectContaining({ search: "comme jacket" }),
    );
  });
});
