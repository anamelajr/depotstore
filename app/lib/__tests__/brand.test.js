import { describe, it, expect } from "vitest";
import {
  titleLeaksAllowedBrand,
  titleLeaksAllowedBrandStrict,
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
