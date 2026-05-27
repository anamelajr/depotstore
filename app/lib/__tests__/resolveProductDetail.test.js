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
    expect(formatSizes([{ title: "Default Title", available: true }])).toBe(null);
    expect(formatSizes([{ title: "", available: true }, { title: null, available: true }])).toBe(null);
    expect(
      formatSizes([{ title: "default title", available: true }, { title: "Default Title", available: true }]),
    ).toBe(null);
  });

  it("returns null when all variants are sold out", () => {
    expect(formatSizes([{ title: "M", available: false }])).toBe(null);
    expect(
      formatSizes([{ title: "S", available: false }, { title: "L", available: false }]),
    ).toBe(null);
  });

  it("returns array with single label when one in-stock variant", () => {
    expect(formatSizes([{ title: "M", available: true }])).toEqual(["M"]);
    expect(
      formatSizes([{ title: "M", available: true }, { title: "Default Title", available: true }]),
    ).toEqual(["M"]);
  });

  it("returns array with multiple in-stock labels", () => {
    expect(
      formatSizes([
        { title: "S", available: true },
        { title: "M", available: true },
        { title: "L", available: true },
      ]),
    ).toEqual(["S", "M", "L"]);
  });

  it("filters sold-out variants from mixed-stock array", () => {
    expect(
      formatSizes([
        { title: "S", available: false },
        { title: "M", available: true },
        { title: "L", available: false },
      ]),
    ).toEqual(["M"]);
  });

  it("ignores variants without a usable title (in-stock only)", () => {
    expect(
      formatSizes([
        { title: "S", available: true },
        { title: "", available: true },
        { title: "L", available: true },
        { available: true },
      ]),
    ).toEqual(["S", "L"]);
  });

  it("preserves a variant title containing a comma as one entry", () => {
    expect(
      formatSizes([{ title: "Waist 32, Inseam 30", available: true }]),
    ).toEqual(["Waist 32, Inseam 30"]);
  });
});
