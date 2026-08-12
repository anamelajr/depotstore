import { describe, it, expect } from "vitest";
import { parseEraYear } from "../parseEra.js";

describe("parseEraYear — season codes", () => {
  it.each([
    ["FW03 Velour Dress", 2003],
    ["AW2016 Saint Laurent Teddy Jacket", 2016],
    ["Dior spring 2001 silk set", 2001],
    ["YVES SAINT LAURENT FW 1992 Wool Blazer", 1992],
    ["Fall/Winter '04 Leather Coat", 2004],
    ["S/S 2007 Cotton Shirt", 2007],
  ])("%s → %i", (title, expected) => {
    expect(parseEraYear(title, null)).toBe(expected);
  });

  it("takes the opening year of a split season", () => {
    expect(parseEraYear("FW02/03 Printed Cotton Tee", null)).toBe(2002);
  });
});

describe("parseEraYear — 2-digit pivot", () => {
  it.each([
    ["SS29 Sample", 2029], // upper bound of the 20xx side
    ["FW99 Wide Trousers", 1999], // >= 30 reads as 19xx
    ["SS60 Coat", 1960], // lower bound of the catalog window
  ])("%s → %i", (title, expected) => {
    expect(parseEraYear(title, null)).toBe(expected);
  });

  it("discards a pre-1960 expansion rather than storing it", () => {
    expect(parseEraYear("FW30 Jacket", null)).toBeNull();
  });
});

describe("parseEraYear — full years and decades", () => {
  it("reads a standalone 4-digit year", () => {
    expect(parseEraYear("2001 Parachute Pant", null)).toBe(2001);
  });

  it("reads a decade marker as its opening year", () => {
    expect(parseEraYear("2000s Crossbody Bag", null)).toBe(2000);
    expect(parseEraYear("1990s Mesh Top", null)).toBe(1990);
  });

  it("prefers a concrete year over a decade marker in the same title", () => {
    expect(parseEraYear("1990s archive 2004 jacket", null)).toBe(2004);
  });

  it("prefers a season code over a bare year in the same title", () => {
    expect(parseEraYear("FW98 reissue of the 2010 pattern", null)).toBe(1998);
  });

  it("skips an out-of-range year and keeps scanning", () => {
    expect(parseEraYear("Style 1908 — SS04 Wool Vest", null)).toBe(2004);
  });
});

describe("parseEraYear — title precedence", () => {
  it("uses the title when it carries a signal", () => {
    expect(parseEraYear("FW03 Velour Jacket", "AW1999 VELOUR JACKET")).toBe(2003);
  });

  it("falls back to name only when the title yields nothing", () => {
    expect(parseEraYear("Velour Jacket", "AW1999 VELOUR JACKET")).toBe(1999);
  });

  it("returns null when neither carries a signal", () => {
    expect(parseEraYear("Velour Jacket", "VELOUR JACKET")).toBeNull();
  });
});

describe("parseEraYear — no false positives", () => {
  it.each([
    ["1017 ALYX 9SM Chest Rig", null], // brand name, not a year
    ["SS19999 Typo Tee", null], // malformed token the normalizer also refuses
    ["Size 44 Wool Coat", null],
    ["Fall Winter Coat", null], // yearless season words
    ["", null],
  ])("%s → %s", (title, expected) => {
    expect(parseEraYear(title, null)).toBe(expected);
  });

  it("never throws on non-string input", () => {
    expect(parseEraYear(null, undefined)).toBeNull();
    expect(parseEraYear(42, {})).toBeNull();
  });
});
