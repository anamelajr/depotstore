import { describe, it, expect } from "vitest";
import { validateCleanTitleResult } from "../cleanTitle.js";
import { buildFallbackTitle } from "../handleFallback.js";
import { brandFromHandle, titleLeaksAllowedBrandStrict } from "../brand.js";
import { normalizeSeasonCodes } from "../seasonCodes.js";

// validateCleanTitleResult is the model path's post-parse gate. Returning null
// is RETRYABLE by contract (CLAUDE.md) — these tests pin what it repairs vs
// what it refuses, not how the caller reacts.
describe("validateCleanTitleResult — repairs", () => {
  it("strips a dangling trailing 'By' instead of rejecting", () => {
    expect(
      validateCleanTitleResult(
        { brand: "PRADA", title: "Black Leather Pants By" },
        "PRADA BLACK LEATHER PANTS BY SOMEONE",
      ),
    ).toEqual({ brand: "PRADA", title: "Black Leather Pants" });
  });

  it("counts words after the 'By' strip", () => {
    // 8 words as returned, 7 once the dangling attribution is removed.
    expect(
      validateCleanTitleResult(
        { brand: "PRADA", title: "1990s Black Nylon Wide Leg Cargo Pants By" },
        "raw",
      ).title,
    ).toBe("1990s Black Nylon Wide Leg Cargo Pants");
  });

  it("trims brand and title", () => {
    expect(
      validateCleanTitleResult({ brand: "  PRADA ", title: " Wool Coat " }, "raw"),
    ).toEqual({ brand: "PRADA", title: "Wool Coat" });
  });
});

describe("validateCleanTitleResult — rejections", () => {
  const reject = (parsed, raw = "SOME RAW NAME") =>
    expect(validateCleanTitleResult(parsed, raw)).toBe(null);

  it("rejects empty brand or title", () => {
    reject({ brand: "", title: "" });
    reject({ brand: "PRADA", title: "" });
    reject({ brand: "", title: "Wool Coat" });
    reject(null);
  });

  it("rejects a title over 7 words", () => {
    reject({ brand: "PRADA", title: "A B C D E F G H" });
  });

  it("rejects an echo of the raw name", () => {
    reject(
      { brand: "PRADA", title: "Vintage Prada Wool Coat" },
      "VINTAGE PRADA WOOL COAT",
    );
  });

  it("rejects a ≥4-char token of the extracted brand (guard 2)", () => {
    reject({ brand: "DIOR HOMME", title: "Dior Wool Coat" });
  });

  // The floor that let "YSL" into 100+ production titles.
  it("rejects the short brand tokens YSL / MM6 / CDG", () => {
    reject({ brand: "YSL", title: "Ysl Rectangular Metal Glasses" });
    reject({ brand: "MM6", title: "MM6 Velvet Distressed Pants" });
    reject({ brand: "CDG", title: "CDG Wool Coat" });
  });

  // Guard 3: a brand OTHER than the extracted one. Guard 2 structurally cannot
  // see these — the leaked name is not a token of parsed.brand.
  it("rejects an era-designer / collaborator leak under a different brand", () => {
    reject({ brand: "SAINT LAURENT", title: "Khaki Canvas Ysl Logo Bag" });
    reject({ brand: "TOM FORD", title: "Gucci By FW96 Pinstripe Wool Suit" });
    reject({ brand: "JOHN GALLIANO", title: "Dior By FW02 Printed Wrap Top" });
    reject({ brand: "1017 ALYX 9SM", title: "Dior B23 Sneakers" });
  });
});

describe("validateCleanTitleResult — false-positive pins", () => {
  it("accepts a title that merely contains a short brand as a substring", () => {
    // "ami" (AMI Paris) inside "Camisole" — the strict word-bounded guard is
    // what keeps this legitimate enrichment from being refused forever.
    expect(
      validateCleanTitleResult({ brand: "AMI", title: "Silk Camisole" }, "raw"),
    ).toEqual({ brand: "AMI", title: "Silk Camisole" });
  });

  it("accepts an ordinary clean title", () => {
    expect(
      validateCleanTitleResult(
        { brand: "RICK OWENS", title: "FW10 Wool Coat" },
        "RICK OWENS FALL WINTER 2010 WOOL COAT",
      ),
    ).toEqual({ brand: "RICK OWENS", title: "FW10 Wool Coat" });
  });
});

// A4b regression. The bypass: cleanTitle REJECTS a leaking title, returns null,
// and the null drops the row into the handle fallback — which strips only the
// handle brand's spellings, so a foreign-brand leak survives and the COALESCE
// write makes it permanent. This is the production `2000s Gucci … By` class.
//
// route.js is not importable in a unit test (it constructs the Supabase admin
// client at module load), so this composes the exact same sequence the route
// runs: buildFallbackTitle → normalizeSeasonCodes → titleLeaksAllowedBrandStrict.
describe("A4b choke-point gate — fallback cannot re-admit a rejected title", () => {
  const RAW = "2000s Gucci Black Leather Pants By Tom Ford";
  const HANDLE = "tom-ford-2000s-gucci-black-leather-pants";

  it("the model guard rejects the title", () => {
    expect(
      validateCleanTitleResult(
        { brand: "TOM FORD", title: "2000s Gucci Black Leather Pants By" },
        RAW,
      ),
    ).toBe(null);
  });

  it("the handle fallback still produces the leaking title", () => {
    const handleBrand = brandFromHandle(HANDLE);
    expect(handleBrand).toBeTruthy();
    const fallbackTitle = buildFallbackTitle(RAW, handleBrand);
    expect(fallbackTitle).toMatch(/Gucci/);
    // ...and the word-count bail would NOT stop it.
    expect(fallbackTitle.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(7);
  });

  it("the choke-point gate blocks the write", () => {
    const handleBrand = brandFromHandle(HANDLE);
    const written = normalizeSeasonCodes(buildFallbackTitle(RAW, handleBrand));
    expect(titleLeaksAllowedBrandStrict(written)).toBe(true);
  });

  it("does not block a clean fallback title", () => {
    const written = normalizeSeasonCodes(
      buildFallbackTitle("VINTAGE FENDI JACKET", brandFromHandle("fendi-jacket")),
    );
    expect(written).toBe("Vintage Jacket");
    expect(titleLeaksAllowedBrandStrict(written)).toBe(false);
  });
});
