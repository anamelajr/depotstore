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

  it("returns single label when one usable variant", () => {
    expect(formatSizes([{ title: "M" }])).toBe("M");
    expect(formatSizes([{ title: "M" }, { title: "Default Title" }])).toBe(
      "M",
    );
  });

  it("joins multiple labels with comma+space", () => {
    expect(formatSizes([{ title: "S" }, { title: "M" }, { title: "L" }])).toBe(
      "S, M, L",
    );
  });

  it("ignores variants without a usable title", () => {
    expect(
      formatSizes([{ title: "S" }, { title: "" }, { title: "L" }, {}]),
    ).toBe("S, L");
  });
});
