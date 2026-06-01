import { describe, it, expect } from "vitest";
import {
  titleLeaksAllowedBrand,
  titleLeaksAllowedBrandStrict,
  normalizeBrand,
  isAllowedBrand,
} from "../brand.js";

// titleLeaksAllowedBrandStrict is the WRITE-path guard for
// scripts/backfillTitleClean.mjs (SKIP:brand_in_title). It must anchor at word
// boundaries: a write blocker that fired on incidental substrings would
// silently refuse legitimate enrichments forever. The loose
// titleLeaksAllowedBrand stays correct for the read-only audit (over-flagging
// there only adds review candidates) — these tests pin the divergence so a
// future "consolidate the two detectors" refactor can't reintroduce the bug.
describe("titleLeaksAllowedBrandStrict — write-path leak guard", () => {
  it("does NOT flag legitimate words that merely contain a short brand substring", () => {
    // "ami" (AMI Paris) is a substring of these real garment/material words.
    // The loose detector flags them; the strict guard must not.
    for (const title of [
      "Silk Camisole",
      "Ceramic Ring",
      "Ceramic Vase Coat",
      "Dynamic Print Tee",
      "Camisole",
    ]) {
      expect(titleLeaksAllowedBrand(title)).toBe(true); // loose over-flags
      expect(titleLeaksAllowedBrandStrict(title)).toBe(false); // strict does not
    }
  });

  it("does NOT flag a compact brand sitting inside a larger word", () => {
    // "apc" (A.P.C.) must not match inside "apricot".
    expect(titleLeaksAllowedBrandStrict("Apricot Knit Top")).toBe(false);
  });

  it("flags a brand that stands as its own word", () => {
    expect(titleLeaksAllowedBrandStrict("Ami Sweater")).toBe(true);
    expect(titleLeaksAllowedBrandStrict("Gucci Loafers")).toBe(true);
  });

  it("flags a collab partner / era-designer leaking under another chip", () => {
    // The whole reason the guard scans the entire allowlist rather than just
    // cleanTitle's extracted brand: "Tom Ford" under a GUCCI chip.
    expect(titleLeaksAllowedBrandStrict("Tom Ford Shearling Jacket")).toBe(true);
  });

  it("flags both spaced and compact spellings of a multi-word brand", () => {
    expect(titleLeaksAllowedBrandStrict("Miu Miu Wool Skirt")).toBe(true); // spaced
    expect(titleLeaksAllowedBrandStrict("MiuMiu Bag")).toBe(true); // compact
    expect(titleLeaksAllowedBrandStrict("APC Jacket")).toBe(true); // compact A.P.C.
  });

  it("returns false on empty / punctuation-only input (no crash)", () => {
    expect(titleLeaksAllowedBrandStrict("")).toBe(false);
    expect(titleLeaksAllowedBrandStrict(null)).toBe(false);
    expect(titleLeaksAllowedBrandStrict("—")).toBe(false);
  });
});

// Alias-only spellings whose canonical form is NOT a substring of them. The
// brand sets are seeded from BRANDS.map(normalizeBrand), which canonicalizes
// ("Margiela" → "maison margiela"), so without folding the raw alias keys back
// in, a title using the common short spelling slips past every substring
// detector. Margiela is the highest-value miss on an archive-fashion site.
describe("brand-leak detection — alias spellings", () => {
  it("flags the short alias spelling in both detectors", () => {
    for (const title of [
      "Margiela Jacket",
      "Martin Margiela Coat",
      "Bikkembergs Pants",
    ]) {
      expect(titleLeaksAllowedBrand(title)).toBe(true);
      expect(titleLeaksAllowedBrandStrict(title)).toBe(true);
    }
  });

  it("still flags the canonical spelling", () => {
    expect(titleLeaksAllowedBrandStrict("Maison Margiela Jacket")).toBe(true);
    expect(titleLeaksAllowedBrandStrict("Dirk Bikkembergs Boots")).toBe(true);
  });

  it("does not regress the camisole-class false positives", () => {
    // Folding aliases in must not reintroduce incidental substring hits.
    expect(titleLeaksAllowedBrandStrict("Silk Camisole")).toBe(false);
    expect(titleLeaksAllowedBrandStrict("Ceramic Ring")).toBe(false);
  });
});

// normalizeBrand was refactored to share normalizeBrandTokens with the set
// builders; these pin that the public canonicalization contract is unchanged.
describe("normalizeBrand — canonicalization preserved", () => {
  it("canonicalizes aliases to their allowlist form", () => {
    expect(normalizeBrand("Margiela")).toBe("maison margiela");
    expect(normalizeBrand("Christian Dior")).toBe("dior");
    expect(normalizeBrand("Bikkembergs")).toBe("dirk bikkembergs");
  });

  it("strips diacritics and trims", () => {
    expect(normalizeBrand("  CÉLINE  ")).toBe("celine");
  });

  it("returns null on empty / whitespace / non-string input", () => {
    expect(normalizeBrand("")).toBe(null);
    expect(normalizeBrand("   ")).toBe(null);
    expect(normalizeBrand(null)).toBe(null);
  });

  it("keeps isAllowedBrand accepting alias and compact spellings", () => {
    expect(isAllowedBrand("Margiela")).toBe(true);
    expect(isAllowedBrand("MiuMiu")).toBe(true);
    expect(isAllowedBrand("Not A Brand XYZ")).toBe(false);
  });
});
