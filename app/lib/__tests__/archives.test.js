import { describe, it, expect } from "vitest";
import { ARCHIVES, getLiveArchives, getArchiveBySlug } from "../archives.js";

const live = ARCHIVES.filter((a) => a.live);

describe("ARCHIVES — band contract", () => {
  it("has exactly five entries (the home band renders all of them)", () => {
    expect(ARCHIVES).toHaveLength(5);
  });

  it("gives every entry a name and a year range", () => {
    for (const a of ARCHIVES) {
      expect(typeof a.name).toBe("string");
      expect(a.name.length).toBeGreaterThan(0);
      expect(typeof a.years).toBe("string");
      expect(a.years.length).toBeGreaterThan(0);
    }
  });

  it("keeps live slugs unique", () => {
    const slugs = live.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("ARCHIVES — live entries", () => {
  it("carries every field the page renders", () => {
    for (const a of live) {
      expect(a.slug).toMatch(/^[a-z0-9-]+$/);
      // A portrait is optional (Margiela has none), but when present it must
      // be a local path with alt text — and alt text without an image is dead
      // data the hero never renders.
      expect(a.image === null || typeof a.image === "string").toBe(true);
      if (a.image !== null) {
        expect(a.image.startsWith("/")).toBe(true);
        expect(typeof a.imageAlt).toBe("string");
        expect(a.imageAlt.length).toBeGreaterThan(0);
      } else {
        expect(a.imageAlt).toBeNull();
      }
      expect(typeof a.description).toBe("string");
      expect(a.description.length).toBeGreaterThan(0);
      // Optional link target, but never an empty string.
      expect(a.editorialSlug === null || a.editorialSlug?.length > 0).toBe(true);
      expect(Array.isArray(a.rules)).toBe(true);
      expect(a.rules.length).toBeGreaterThan(0);
    }
  });

  it("keeps every rule well-formed", () => {
    for (const a of live) {
      for (const rule of a.rules) {
        // Brands are compared with .eq() against the canonicalized column.
        expect(typeof rule.brand).toBe("string");
        expect(rule.brand).toBe(rule.brand.toUpperCase());

        const hasEraPair = rule.eraStart != null || rule.eraEnd != null;
        if (hasEraPair) {
          expect(Number.isInteger(rule.eraStart)).toBe(true);
          expect(Number.isInteger(rule.eraEnd)).toBe(true);
          expect(rule.eraStart).toBeGreaterThanOrEqual(1960);
          expect(rule.eraEnd).toBeLessThanOrEqual(2029);
          expect(rule.eraStart).toBeLessThanOrEqual(rule.eraEnd);
        }
        if (rule.eraYearNull !== undefined) {
          expect(typeof rule.eraYearNull).toBe("boolean");
          // An era window and "no era at all" are mutually exclusive; a rule
          // carrying both would return nothing.
          expect(hasEraPair).toBe(false);
        }
        // Every rule must narrow on something beyond the brand.
        expect(hasEraPair || rule.eraYearNull === true).toBe(true);

        if (rule.excludeAttribution !== undefined) {
          expect(Array.isArray(rule.excludeAttribution)).toBe(true);
          expect(rule.excludeAttribution.length).toBeGreaterThan(0);
          for (const token of rule.excludeAttribution) {
            expect(typeof token).toBe("string");
            expect(token).toBe(token.toLowerCase());
            expect(token.length).toBeGreaterThan(0);
          }
        }

        if (rule.attribution !== undefined) {
          expect(Array.isArray(rule.attribution)).toBe(true);
          expect(rule.attribution.length).toBeGreaterThan(0);
          for (const token of rule.attribution) {
            expect(typeof token).toBe("string");
            expect(token).toBe(token.toLowerCase());
            expect(token.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("keeps curation overrides addressable", () => {
    for (const a of live) {
      for (const list of [a.include, a.exclude]) {
        expect(Array.isArray(list)).toBe(true);
        for (const entry of list) {
          expect(typeof entry.storeDomain).toBe("string");
          expect(entry.storeDomain.length).toBeGreaterThan(0);
          expect(typeof entry.handle).toBe("string");
          expect(entry.handle.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("accessors", () => {
  it("getLiveArchives returns only live entries, in band order", () => {
    const result = getLiveArchives();
    expect(result.every((a) => a.live)).toBe(true);
    expect(result.map((a) => a.slug)).toEqual(live.map((a) => a.slug));
  });

  it("getArchiveBySlug resolves a live slug", () => {
    expect(getArchiveBySlug("hedi-slimane")?.name).toBe("HEDI SLIMANE");
    expect(getArchiveBySlug("martin-margiela")?.name).toBe("MARTIN MARGIELA");
    expect(getArchiveBySlug("gucci-by-tom-ford")?.name).toBe("GUCCI BY TOM FORD");
  });

  // Pinned exactly: membership here is the rule config and nothing else, so a
  // typo'd year, a dropped denylist token or a lost rule must fail the suite
  // rather than only shifting the live item count.
  it("pins the Gucci by Tom Ford rule configuration", () => {
    expect(getArchiveBySlug("gucci-by-tom-ford")?.rules).toEqual([
      {
        brand: "GUCCI",
        eraStart: 1990,
        eraEnd: 2004,
        excludeAttribution: ["michele", "giannini"],
      },
      { brand: "GUCCI", eraYearNull: true, attribution: ["tom ford"] },
    ]);
  });

  it("getArchiveBySlug returns undefined for inert and unknown slugs", () => {
    // Inert entries carry no slug at all, so they can never resolve.
    expect(getArchiveBySlug(undefined)).toBeUndefined();
    expect(getArchiveBySlug("nope")).toBeUndefined();
  });
});
