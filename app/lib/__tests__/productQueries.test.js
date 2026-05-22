import { describe, it, expect, vi } from "vitest";
import {
  fetchInterleavedProducts,
  countInterleavedProducts,
  INTERLEAVED_RPC_RETURN_COLUMNS,
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
