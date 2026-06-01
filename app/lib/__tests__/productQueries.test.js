import { describe, it, expect, vi } from "vitest";
import {
  fetchInterleavedProducts,
  countInterleavedProducts,
  INTERLEAVED_RPC_RETURN_COLUMNS,
  PRODUCT_ROW_SELECT,
  PRODUCT_ROW_SELECT_WITH_CATEGORY,
  mapProductRow,
  withVisibility,
  withCuratedVisibility,
} from "../productQueries.js";

function makeClient() {
  return {
    rpc: vi.fn(async () => ({ data: [], error: null })),
  };
}

describe("fetchInterleavedProducts", () => {
  it("calls get_interleaved_products with the full named-param shape", async () => {
    const client = makeClient();
    await fetchInterleavedProducts({
      store: "esco.fr",
      category: "Tops",
      subcategory: "tees",
      search: "rick",
      brand: "Rick Owens",
      limit: 42,
      offset: 84,
      client,
    });
    expect(client.rpc).toHaveBeenCalledWith("get_interleaved_products", {
      p_store: "esco.fr",
      p_category: "Tops",
      p_subcategory: "tees",
      p_search: "rick",
      p_brand: "Rick Owens",
      p_limit: 42,
      p_offset: 84,
    });
  });

  it("defaults all filters to null and offset to 0 when omitted", async () => {
    const client = makeClient();
    await fetchInterleavedProducts({ limit: 10, client });
    expect(client.rpc).toHaveBeenCalledWith("get_interleaved_products", {
      p_store: null,
      p_category: null,
      p_subcategory: null,
      p_search: null,
      p_brand: null,
      p_limit: 10,
      p_offset: 0,
    });
  });
});

describe("countInterleavedProducts", () => {
  it("calls count_interleaved_products with all 5 named params", async () => {
    const client = makeClient();
    await countInterleavedProducts({
      store: "esco.fr",
      category: "Tops",
      subcategory: "tees",
      search: "rick",
      brand: "Rick Owens",
      client,
    });
    expect(client.rpc).toHaveBeenCalledWith("count_interleaved_products", {
      p_store: "esco.fr",
      p_category: "Tops",
      p_subcategory: "tees",
      p_search: "rick",
      p_brand: "Rick Owens",
    });
  });

  it("defaults all filters to null when omitted", async () => {
    const client = makeClient();
    await countInterleavedProducts({ client });
    expect(client.rpc).toHaveBeenCalledWith("count_interleaved_products", {
      p_store: null,
      p_category: null,
      p_subcategory: null,
      p_search: null,
      p_brand: null,
    });
  });
});

describe("INTERLEAVED_RPC_RETURN_COLUMNS", () => {
  it("includes `name` (ProductCard falls back to it when title is null)", () => {
    expect(INTERLEAVED_RPC_RETURN_COLUMNS).toContain("name");
  });
});

describe("PRODUCT_ROW_SELECT", () => {
  it("does NOT include id or subcategory (mapper deliberately drops both)", () => {
    expect(PRODUCT_ROW_SELECT).not.toMatch(/\bid\b/);
    expect(PRODUCT_ROW_SELECT).not.toMatch(/\bsubcategory\b/);
  });

  it("WITH_CATEGORY appends category to the base list", () => {
    expect(PRODUCT_ROW_SELECT_WITH_CATEGORY).toBe(`${PRODUCT_ROW_SELECT}, category`);
  });

  it("base list covers the 11 columns every product surface needs", () => {
    for (const col of [
      "name", "title", "brand", "price", "image_url", "image_url_2",
      "store_name", "store_domain", "product_url", "available", "handle",
    ]) {
      expect(PRODUCT_ROW_SELECT).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });
});

describe("mapProductRow", () => {
  it("emits the exact 12 camelCase keys (no id, no subcategory)", () => {
    const out = mapProductRow({
      name: "n", title: "t", brand: "b", price: "€10",
      image_url: "u", image_url_2: "u2", store_name: "s", store_domain: "d.fr",
      product_url: "p", available: true, handle: "h", category: "Tops",
    });
    expect(Object.keys(out).sort()).toEqual([
      "available", "brand", "category", "handle", "imageUrl", "imageUrl2",
      "name", "price", "productUrl", "storeDomain", "storeName", "title",
    ]);
  });

  it("translates snake_case columns to camelCase", () => {
    const out = mapProductRow({
      image_url: "https://cdn/x.jpg",
      store_name: "Esco",
      store_domain: "esco.fr",
      product_url: "https://esco.fr/x",
    });
    expect(out.imageUrl).toBe("https://cdn/x.jpg");
    expect(out.storeName).toBe("Esco");
    expect(out.storeDomain).toBe("esco.fr");
    expect(out.productUrl).toBe("https://esco.fr/x");
  });

  it("returns undefined for unselected columns (category drops out of JSON on non-feed sites)", () => {
    // Non-feed sites use PRODUCT_ROW_SELECT (no category column). The
    // mapper still references row.category, so it must come back undefined
    // — JSON.stringify drops undefined keys, preserving the existing JSON
    // shape for editorial / homepage / MoreFromStore surfaces.
    const out = mapProductRow({ name: "n", handle: "h" });
    expect(out.category).toBeUndefined();
    expect(JSON.parse(JSON.stringify(out))).not.toHaveProperty("category");
  });
});

describe("withVisibility", () => {
  it("applies available=true and hidden=false to the passed query", () => {
    const eq = vi.fn();
    const query = { eq };
    eq.mockReturnValue(query);
    const result = withVisibility(query);
    expect(eq).toHaveBeenNthCalledWith(1, "available", true);
    expect(eq).toHaveBeenNthCalledWith(2, "hidden", false);
    expect(result).toBe(query);
  });

  it("returns the chained builder so callers can keep composing", () => {
    const final = { sentinel: true };
    const chain = { eq: vi.fn() };
    chain.eq.mockReturnValueOnce(chain).mockReturnValueOnce(final);
    expect(withVisibility(chain)).toBe(final);
  });
});

describe("withCuratedVisibility", () => {
  it("applies hidden=false but does NOT touch available (sold-inclusive)", () => {
    const eq = vi.fn();
    const query = { eq };
    eq.mockReturnValue(query);
    const result = withCuratedVisibility(query);
    expect(eq).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith("hidden", false);
    expect(eq).not.toHaveBeenCalledWith("available", true);
    expect(result).toBe(query);
  });

  it("returns the chained builder so callers can keep composing", () => {
    const final = { sentinel: true };
    const chain = { eq: vi.fn() };
    chain.eq.mockReturnValue(final);
    expect(withCuratedVisibility(chain)).toBe(final);
  });
});
