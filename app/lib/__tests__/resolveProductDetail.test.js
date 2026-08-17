import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const generateDescription = vi.fn(async () => "generated");

vi.mock("../generateDescription", () => ({
  generateDescription: (...args) => generateDescription(...args),
}));

// Minimal PostgREST stub: every builder method chains, and the terminal
// `maybeSingle()` resolves to whatever the current test queued per table.
const tableRows = { stores: null, products: null };

function makeFrom() {
  return (table) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      update: () => builder,
      is: async () => ({ error: null }),
      maybeSingle: async () => ({ data: tableRows[table] ?? null }),
    };
    return builder;
  };
}

vi.mock("../supabase.js", () => ({
  supabase: { from: (t) => makeFrom()(t) },
  supabaseAdmin: { from: (t) => makeFrom()(t) },
}));

import {
  stripHtml,
  nonEmpty,
  resolveSizes,
  resolveProductDetailCore,
  resolveDescription,
  storeGateCache,
} from "../resolveProductDetail.js";

describe("stripHtml", () => {
  it("returns null for falsy input", () => {
    expect(stripHtml(null)).toBe(null);
    expect(stripHtml(undefined)).toBe(null);
    expect(stripHtml("")).toBe(null);
  });

  it("strips tags and collapses whitespace", () => {
    expect(stripHtml("<p>Hello   <strong>world</strong>.</p>")).toBe(
      "Hello world .",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(stripHtml("  <p>x</p>  ")).toBe("x");
  });
});

describe("nonEmpty", () => {
  it("returns null for non-strings", () => {
    expect(nonEmpty(null)).toBe(null);
    expect(nonEmpty(undefined)).toBe(null);
    expect(nonEmpty(0)).toBe(null);
    expect(nonEmpty(["a"])).toBe(null);
  });

  it("returns null for empty or whitespace-only strings", () => {
    expect(nonEmpty("")).toBe(null);
    expect(nonEmpty("   ")).toBe(null);
  });

  it("returns trimmed string when non-empty", () => {
    expect(nonEmpty("  foo  ")).toBe("foo");
    expect(nonEmpty("bar")).toBe("bar");
  });
});

describe("resolveSizes", () => {
  // ---------- L1: stored array ----------

  it("returns null when dbRow is null/undefined and no product", () => {
    expect(resolveSizes(null, null)).toBe(null);
    expect(resolveSizes(undefined, undefined)).toBe(null);
  });

  it("returns the stored array verbatim for a single-entry value", () => {
    expect(resolveSizes({ size: ["S"], category: "Tops" }, null)).toEqual([
      "S",
    ]);
    expect(
      resolveSizes({ size: ["42 IT"], category: "Bottoms" }, null),
    ).toEqual(["42 IT"]);
  });

  it("preserves dual-system strings as one element (no split on /)", () => {
    expect(
      resolveSizes(
        { size: ["38 FR / M / 42 IT"], category: "Dresses & Skirts" },
        null,
      ),
    ).toEqual(["38 FR / M / 42 IT"]);
  });

  it("preserves a single seller value containing ' · ' as one element", () => {
    // The motivating regression: TEXT[] keeps this whole as one element so
    // the PDP renders `SIZE: MEN S · WOMEN M`, not `SIZES: MEN S · WOMEN M`.
    expect(
      resolveSizes({ size: ["MEN S · WOMEN M"], category: "Tops" }, null),
    ).toEqual(["MEN S · WOMEN M"]);
  });

  it("returns multi-variant arrays element-by-element", () => {
    expect(
      resolveSizes({ size: ["S", "M", "L"], category: "Tops" }, null),
    ).toEqual(["S", "M", "L"]);
  });

  it("trims whitespace around each element and drops empties", () => {
    expect(
      resolveSizes(
        { size: ["  S  ", "M", "", "  ", "L"], category: "Tops" },
        null,
      ),
    ).toEqual(["S", "M", "L"]);
  });

  it("L1 wins over L2 even when the live product has a different Size option", () => {
    const dbRow = { size: ["M"], category: "Tops" };
    const product = {
      options: [{ name: "Size" }],
      variants: [{ option1: "L" }], // contradicts L1 — DB wins
    };
    expect(resolveSizes(dbRow, product)).toEqual(["M"]);
  });

  it("L1 wins over the accessory fallback when both apply", () => {
    expect(
      resolveSizes(
        { size: ["Tote OS"], category: "Bags & Accessories" },
        null,
      ),
    ).toEqual(["Tote OS"]);
  });

  it("tolerates a stray string for legacy rows that pre-date the migration", () => {
    // Defensive: a row inserted before the TEXT→TEXT[] migration could
    // still hand back a scalar string. We treat that as 'no value' (not
    // splitting it) and fall through to L2/L3 — the next sync overwrites
    // the row with the correct array shape.
    expect(
      resolveSizes({ size: "S · M · L", category: "Tops" }, null),
    ).toBe(null);
  });

  // ---------- L2: live parse fallback ----------

  it("falls back to live parseSizes when DB size is null", () => {
    // Cron-lag window: product listed since the last hourly sync. dbRow
    // exists (or doesn't) but `size` is null/empty; the live Shopify
    // payload still has the Size option, so the PDP renders it instead
    // of showing an empty SIZE block.
    const dbRow = { size: null, category: "Tops" };
    const product = {
      options: [{ name: "Size" }],
      variants: [{ option1: "M" }],
    };
    expect(resolveSizes(dbRow, product)).toEqual(["M"]);
  });

  it("falls back to live parseSizes when dbRow itself is null", () => {
    // Unsynced product (e.g., listed after the last cron, row not yet
    // inserted). The PDP page still fetches the live product and
    // resolveSizes uses it as the only available source.
    const product = {
      options: [{ name: "Size" }],
      variants: [{ option1: "S" }, { option1: "M" }],
    };
    expect(resolveSizes(null, product)).toEqual(["S", "M"]);
  });

  it("L2 parses body_html when no Size option exists", () => {
    const dbRow = { size: null, category: "Jackets & Coats" };
    const product = {
      options: [{ name: "Title" }],
      variants: [{ option1: "Default Title" }],
      body_html: "<p>Size: 40</p>",
    };
    expect(resolveSizes(dbRow, product)).toEqual(["40"]);
  });

  // ---------- L3: accessory fallback ----------

  it("returns ['ONE SIZE'] when DB category is Bags & Accessories and no size found", () => {
    expect(
      resolveSizes({ size: null, category: "Bags & Accessories" }, null),
    ).toEqual(["ONE SIZE"]);
    expect(
      resolveSizes({ size: [], category: "Bags & Accessories" }, null),
    ).toEqual(["ONE SIZE"]);
  });

  it("returns ['ONE SIZE'] when category is null but product_type indicates a bag", () => {
    // The uncategorized-bag case (e.g. LV Ellipse with category=NULL).
    // L3 branch (b) saves it from rendering with an empty SIZE block.
    const dbRow = { size: null, category: null };
    const product = {
      product_type: "Handbag",
      options: [{ name: "Title" }],
      variants: [{ option1: "Default Title" }],
    };
    expect(resolveSizes(dbRow, product)).toEqual(["ONE SIZE"]);
  });

  it("returns ['ONE SIZE'] when category is null but tags indicate an accessory", () => {
    const dbRow = { size: null, category: null };
    const product = {
      tags: ["vintage", "sunglasses", "70s"],
      options: [{ name: "Title" }],
      variants: [{ option1: "Default Title" }],
    };
    expect(resolveSizes(dbRow, product)).toEqual(["ONE SIZE"]);
  });

  it("accepts a comma-joined tag string (Shopify alt shape)", () => {
    const dbRow = { size: null, category: null };
    const product = {
      tags: "vintage, scarf, silk",
      options: [{ name: "Title" }],
      variants: [{ option1: "Default Title" }],
    };
    expect(resolveSizes(dbRow, product)).toEqual(["ONE SIZE"]);
  });

  it("does NOT trigger accessory fallback on a non-accessory product", () => {
    // A leather skirt with merchandising tags must not silently become
    // ONE SIZE. The keyword regex matches noun heads (bag/hat/belt/...)
    // not the generic word "accessory".
    const dbRow = { size: null, category: null };
    const product = {
      product_type: "Skirt",
      tags: ["accessory-collection-2024", "leather"],
      options: [{ name: "Title" }],
      variants: [{ option1: "Default Title" }],
    };
    expect(resolveSizes(dbRow, product)).toBe(null);
  });

  // ---------- L4: null ----------

  it("returns null when no layer matches", () => {
    expect(
      resolveSizes(
        { size: null, category: "Tops" },
        {
          product_type: "Top",
          options: [{ name: "Title" }],
          variants: [{ option1: "Default Title" }],
          body_html: "<p>A linen top.</p>",
        },
      ),
    ).toBe(null);
  });
});

// Zero-priced pieces are the stores' "NOT FOR SALE" / rental archive. The
// feed excludes them, so a direct link must resolve to null (the PDP renders
// "Product not found."), and no description generation should be spent on it.
describe("resolveProductDetailCore zero-price gate", () => {
  const shopifyProduct = (variantPrices) => ({
    title: "Miu Miu FW1999 Leather Long Coat",
    vendor: "Miu Miu",
    body_html: "<p>NOT FOR SALE</p>",
    tags: [],
    images: [{ src: "https://cdn/1.jpg" }],
    variants: variantPrices.map((price) => ({ price, title: "M" })),
  });

  beforeEach(() => {
    generateDescription.mockClear();
    tableRows.stores = { store_name: "grain de sell", display_name: "GRAIN DE SELL", location: "Paris" };
    tableRows.products = { brand: "Miu Miu", title: null, editorial_description: null, available: true, size: ["M"], category: "Jackets & Coats" };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubShopify(product) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ product }) }))
    );
  }

  it("returns null when every variant is priced 0.00", async () => {
    stubShopify(shopifyProduct(["0.00", "0.00"]));
    const result = await resolveProductDetailCore({
      handle: "miu-miu-fw1999-leather-long-coat",
      storeDomain: "graindesell.shop",
    });
    expect(result).toBe(null);
    expect(generateDescription).not.toHaveBeenCalled();
  });

  it("still resolves a normally priced product", async () => {
    stubShopify(shopifyProduct(["450.00"]));
    const result = await resolveProductDetailCore({
      handle: "some-coat",
      storeDomain: "graindesell.shop",
    });
    expect(result?.price).toBe("€450.00");
  });

  it("keeps a product whose min price is 0.00 out even when a variant is priced", async () => {
    stubShopify(shopifyProduct(["0.00", "450.00"]));
    expect(
      await resolveProductDetailCore({ handle: "mixed", storeDomain: "graindesell.shop" })
    ).toBe(null);
  });

  it("does not gate a product with no parseable variant price (null, not zero)", async () => {
    stubShopify(shopifyProduct([]));
    const result = await resolveProductDetailCore({
      handle: "no-variants",
      storeDomain: "graindesell.shop",
    });
    expect(result?.price).toBe(null);
  });
});

// `?store=` is user-controlled: a scanner cycling unique garbage domains must
// not grow the module-scope gate cache without bound (Codex review P3).
describe("store gate cache bound", () => {
  beforeEach(() => {
    storeGateCache.clear();
    tableRows.stores = null; // every probed domain is unknown → cached as null
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
  });

  afterEach(() => {
    storeGateCache.clear();
    vi.unstubAllGlobals();
  });

  it("evicts oldest entries past the cap instead of growing unbounded", async () => {
    for (let i = 0; i < 650; i++) {
      await resolveProductDetailCore({
        handle: "probe",
        storeDomain: `garbage-${i}.example`,
      });
    }
    expect(storeGateCache.size).toBeLessThanOrEqual(500);
    // Oldest probes evicted, newest retained.
    expect(storeGateCache.has("garbage-0.example")).toBe(false);
    expect(storeGateCache.has("garbage-649.example")).toBe(true);
  });
});

// The core resolves the page shell and MUST NOT call OpenAI — generation is
// split out so a missing editorial_description streams behind Suspense
// instead of blocking the document.
describe("description split", () => {
  const shopifyProduct = {
    title: "Helmut Lang Bondage Trousers",
    vendor: "Helmut Lang",
    body_html: "<p>raw</p>",
    tags: [],
    images: [{ src: "https://cdn/1.jpg" }],
    variants: [{ price: "300.00", title: "M" }],
  };

  beforeEach(() => {
    generateDescription.mockClear();
    tableRows.stores = { store_name: "grain de sell", display_name: "GRAIN DE SELL", location: "Paris" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ product: shopifyProduct }) })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("core never generates, even when the stored description is null", async () => {
    tableRows.products = { editorial_description: null, available: true, size: ["M"] };
    const core = await resolveProductDetailCore({
      handle: "core-no-desc",
      storeDomain: "graindesell.shop",
    });
    expect(core.description).toBe(null);
    expect(generateDescription).not.toHaveBeenCalled();
  });

  it("resolveDescription generates when the row has none", async () => {
    tableRows.products = { editorial_description: null, available: true, size: ["M"] };
    const text = await resolveDescription("gen-me", "graindesell.shop");
    expect(text).toBe("generated");
    expect(generateDescription).toHaveBeenCalledTimes(1);
  });

  it("resolveDescription returns the stored description without generating", async () => {
    tableRows.products = { editorial_description: "stored copy", available: true, size: ["M"] };
    const text = await resolveDescription("already-has", "graindesell.shop");
    expect(text).toBe("stored copy");
    expect(generateDescription).not.toHaveBeenCalled();
  });
});
