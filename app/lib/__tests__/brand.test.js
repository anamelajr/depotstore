import { describe, it, expect } from "vitest";
import {
  titleLeaksAllowedBrand,
  titleLeaksAllowedBrandStrict,
  normalizeBrand,
  isAllowedBrand,
  canonicalBrand,
  titleContainsAllowedBrand,
  brandFromHandle,
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


// One designer, one stored label. canonicalBrand is the persistence-side twin
// of normalizeBrand: it answers "what label do we store?" rather than "are
// these the same brand?". Applied at /api/enrich's single convergence point,
// so these cases pin what actually lands in products.brand.
describe("canonicalBrand — stored label", () => {
  it("folds the Cavalli family onto ROBERTO CAVALLI", () => {
    expect(canonicalBrand("Cavalli")).toBe("ROBERTO CAVALLI");
    expect(canonicalBrand("Just Cavalli")).toBe("ROBERTO CAVALLI");
    expect(canonicalBrand("CAVALLI CLASS")).toBe("ROBERTO CAVALLI");
  });

  it("folds the Versace and Dior sub-labels", () => {
    expect(canonicalBrand("Gianni Versace")).toBe("VERSACE");
    expect(canonicalBrand("Christian Dior")).toBe("DIOR");
    expect(canonicalBrand("Dior Homme")).toBe("DIOR");
  });

  it("leaves non-aliased brands exactly as produced", () => {
    expect(canonicalBrand("Prada")).toBe("Prada");
    expect(canonicalBrand("  Prada  ")).toBe("Prada");
  });

  it("is safe on empty / non-string input", () => {
    expect(canonicalBrand(null)).toBe(null);
    expect(canonicalBrand("")).toBe("");
    expect(canonicalBrand(undefined)).toBe(undefined);
  });
});

// Moving a name out of BRANDS and into BRAND_ALIASES is a PAIRED edit: the
// alias key is what keeps the name recognised. Drop the alias (or read the
// allowlist from BRANDS alone) and these designers stop being admitted at sync
// time — silently, with no error.
describe("alias-only brands stay recognised", () => {
  it("keeps allowlist membership for names that are now alias keys", () => {
    expect(isAllowedBrand("Cavalli")).toBe(true);
    expect(isAllowedBrand("Just Cavalli")).toBe(true);
    expect(isAllowedBrand("Christian Dior")).toBe(true);
    expect(isAllowedBrand("Gianni Versace")).toBe(true);
  });

  it("keeps title-substring detection", () => {
    expect(titleContainsAllowedBrand("Cavalli Turquoise Belt")).toBe(true);
    expect(titleContainsAllowedBrand("Gianni Versace Silk Shirt")).toBe(true);
  });

  // BRAND_HANDLE_SLUGS is the third consumer, and it does NOT read the alias
  // table unless explicitly built from it. brandFromHandle is the
  // deterministic rescue when cleanTitle returns null; losing it for these
  // handles means those rows burn their retry budget unlabelled.
  it("keeps handle recovery for alias-key slugs", () => {
    expect(brandFromHandle("cavalli-turquoise-belt")).toBeTruthy();
    expect(brandFromHandle("just-cavalli-zebra-print-skirt")).toBeTruthy();
    expect(brandFromHandle("christian-dior-saddle-bag")).toBeTruthy();
    expect(brandFromHandle("gianni-versace-silk-shirt")).toBeTruthy();
  });

  it("resolves recovered handles to the canonical stored label", () => {
    for (const handle of [
      "cavalli-turquoise-belt",
      "just-cavalli-zebra-print-skirt",
      "roberto-cavalli-tiger-fur-cardigan",
    ]) {
      expect(canonicalBrand(brandFromHandle(handle).toUpperCase())).toBe(
        "ROBERTO CAVALLI"
      );
    }
    expect(
      canonicalBrand(brandFromHandle("christian-dior-saddle-bag").toUpperCase())
    ).toBe("DIOR");
  });

  it("still returns null for a handle with no allowlisted slug", () => {
    expect(brandFromHandle("plain-wool-blazer")).toBe(null);
    expect(brandFromHandle("")).toBe(null);
  });
});
