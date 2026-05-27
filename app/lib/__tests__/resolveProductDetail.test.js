import { describe, it, expect } from "vitest";
import {
  stripHtml,
  nonEmpty,
  formatSizes,
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

describe("formatSizes", () => {
  it("returns null when variants is missing or empty", () => {
    expect(formatSizes(null)).toBe(null);
    expect(formatSizes(undefined)).toBe(null);
    expect(formatSizes([])).toBe(null);
    expect(formatSizes("not an array")).toBe(null);
  });

  it("returns null when every variant title is empty or 'Default Title'", () => {
    expect(formatSizes([{ title: "Default Title" }])).toBe(null);
    expect(formatSizes([{ title: "" }, { title: null }])).toBe(null);
    expect(
      formatSizes([{ title: "default title" }, { title: "Default Title" }]),
    ).toBe(null);
  });

  it("returns array with single label when one usable variant", () => {
    expect(formatSizes([{ title: "M" }])).toEqual(["M"]);
    expect(formatSizes([{ title: "M" }, { title: "Default Title" }])).toEqual(["M"]);
  });

  it("returns array with all usable variant labels", () => {
    expect(formatSizes([{ title: "S" }, { title: "M" }, { title: "L" }])).toEqual([
      "S",
      "M",
      "L",
    ]);
  });

  it("ignores variants without a usable title", () => {
    expect(
      formatSizes([{ title: "S" }, { title: "" }, { title: "L" }, {}]),
    ).toEqual(["S", "L"]);
  });

  it("preserves a variant title containing a comma as one entry", () => {
    expect(formatSizes([{ title: "Waist 32, Inseam 30" }])).toEqual([
      "Waist 32, Inseam 30",
    ]);
  });

  it("does NOT filter by variant.available (the single-product endpoint omits it)", () => {
    // Regression guard: an earlier draft of the redesign filtered to
    // `v.available === true`, but Shopify's /products/<handle>.json
    // endpoint doesn't return `available` on variants. Filtering on it
    // collapsed every product to "no sizes". Product-level availability
    // is now sourced from the cron-maintained `products.available` column
    // in Supabase; formatSizes returns all named variants verbatim.
    expect(
      formatSizes([
        { title: "S", available: false },
        { title: "M", available: true },
        { title: "L", available: false },
      ]),
    ).toEqual(["S", "M", "L"]);
    expect(
      formatSizes([{ title: "M" /* available field absent */ }]),
    ).toEqual(["M"]);
  });
});
