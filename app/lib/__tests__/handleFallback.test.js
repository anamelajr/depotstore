import { describe, it, expect } from "vitest";
import {
  toTitleCase,
  sanitizeFallbackTitle,
  nameWithoutBrand,
  stripAllBrandSpellings,
  stripSubLinePrefix,
  collapseDanglingDash,
  seasonToFront,
  buildFallbackTitle,
} from "../handleFallback.js";
import { brandFromHandle } from "../brand.js";
import { normalizeSeasonCodes } from "../seasonCodes.js";

// Compose the helpers the same way enrich/route.js does at the fallback
// site so the tests exercise the actual integrated behavior, not just each
// helper in isolation. Note the ordering: the word-count gate runs on the
// title-cased text, and normalizeSeasonCodes is applied afterwards at the
// shared choke point — same as the route.
function recoverFromHandleFallback(name, handle) {
  const handleBrand = brandFromHandle(handle);
  if (!handleBrand) return null;
  const fallbackTitle = buildFallbackTitle(name, handleBrand);
  const titleWords = fallbackTitle.split(/\s+/).filter(Boolean).length;
  if (titleWords < 1 || titleWords > 7) return null;
  return {
    brand: handleBrand.toUpperCase(),
    title: normalizeSeasonCodes(fallbackTitle),
  };
}

describe("toTitleCase — season/decade preservation", () => {
  it("preserves FW + 4-digit season code", () => {
    expect(toTitleCase("FW1998 BLACK DENIM")).toBe("FW1998 Black Denim");
  });
  it("preserves 4-digit decade marker", () => {
    expect(toTitleCase("2000s RING")).toBe("2000s Ring");
  });
  it("uppercases lowercase SS + 2-digit season code", () => {
    expect(toTitleCase("ss99 Coat")).toBe("SS99 Coat");
  });
  it("preserves AW + 4-digit season code", () => {
    expect(toTitleCase("aw2000 wool blazer")).toBe("AW2000 Wool Blazer");
  });
  it("normalizes uppercase decade `s` suffix to lowercase", () => {
    expect(toTitleCase("1990S leather jacket")).toBe("1990s Leather Jacket");
  });
  it("treats a 4-digit year (no s) as a regular token", () => {
    expect(toTitleCase("1998 wool coat")).toBe("1998 Wool Coat");
  });
  it("title-cases mixed-case input", () => {
    expect(toTitleCase("WOOL BLAZER")).toBe("Wool Blazer");
  });
  it("returns empty string for empty input", () => {
    expect(toTitleCase("")).toBe("");
  });

  // Regression for the "Fw02/03" production bug: these tokens all used to miss
  // the anchored season guard and fall through to the generic branch, which
  // lowercases everything after the first character.
  it("preserves a split-year season code", () => {
    expect(toTitleCase("Fw02/03 PRINTED COTTON TEE")).toBe(
      "FW02/03 Printed Cotton Tee",
    );
  });
  it("preserves a letter-slash season code", () => {
    expect(toTitleCase("f/w02 wool coat")).toBe("F/W02 Wool Coat");
  });
  it("preserves a bare letter-slash prefix ahead of its year", () => {
    expect(toTitleCase("s/s 2004 leather vest")).toBe("S/S 2004 Leather Vest");
  });
  it("preserves a season code carrying trailing punctuation", () => {
    expect(toTitleCase("FW1998, black denim")).toBe("FW1998, Black Denim");
  });
  it("preserves a dash split-year season code", () => {
    expect(toTitleCase("fw10-11 LEATHER BOOTS")).toBe("FW10-11 Leather Boots");
  });
});

describe("sanitizeFallbackTitle — collection-marker strip", () => {
  it("strips «...» chunks", () => {
    expect(sanitizeFallbackTitle("FW1998 «joan» Black Denim Mini Skirt"))
      .toBe("FW1998 Black Denim Mini Skirt");
  });
  it("strips ASCII double-quoted chunks", () => {
    expect(sanitizeFallbackTitle('Wool Coat "Spring 99" Edition'))
      .toBe("Wool Coat Edition");
  });
  it("strips parentheticals", () => {
    expect(sanitizeFallbackTitle("(NEW ARRIVAL) Wool Coat"))
      .toBe("Wool Coat");
  });
  it("strips bracketed chunks", () => {
    expect(sanitizeFallbackTitle("Wool Coat [SOLD] Edition"))
      .toBe("Wool Coat Edition");
  });
  it("collapses whitespace introduced by strip", () => {
    expect(sanitizeFallbackTitle("A  B   C")).toBe("A B C");
  });
  it("is a no-op on titles without delimiters", () => {
    expect(sanitizeFallbackTitle("Wool Blazer")).toBe("Wool Blazer");
  });
});

describe("toTitleCase — slash segments", () => {
  it("title-cases each side of a slash", () => {
    expect(toTitleCase("WOOL/silk BLAZER")).toBe("Wool/Silk Blazer");
    expect(toTitleCase("black/white striped tee")).toBe("Black/White Striped Tee");
  });
  it("leaves season codes to the guards above it", () => {
    expect(toTitleCase("fw02/03 wool coat")).toBe("FW02/03 Wool Coat");
    expect(toTitleCase("s/s 2004 vest")).toBe("S/S 2004 Vest");
  });
  it("tolerates an empty segment", () => {
    expect(toTitleCase("wool/ silk")).toBe("Wool/ Silk");
  });
});

describe("stripAllBrandSpellings", () => {
  it("removes the alias spelling as well as the canonical one", () => {
    expect(
      stripAllBrandSpellings("YSL RECTANGULAR GLASSES", "Yves Saint Laurent"),
    ).toBe("RECTANGULAR GLASSES");
    expect(
      stripAllBrandSpellings("YVES SAINT LAURENT SILK BLOUSE", "YSL"),
    ).toBe("SILK BLOUSE");
  });
  it("does not strand a fragment of a longer spelling", () => {
    // Stripping "SAINT LAURENT" before "YVES SAINT LAURENT" would leave "YVES".
    expect(stripAllBrandSpellings("YVES SAINT LAURENT BAG", "Saint Laurent"))
      .toBe("BAG");
  });
  it("is a no-op when the name carries no spelling of the brand", () => {
    expect(stripAllBrandSpellings("WOOL BLAZER", "Fendi")).toBe("WOOL BLAZER");
  });
});

describe("stripSubLinePrefix", () => {
  it("strips a leading sub-line marker followed by a dash", () => {
    expect(stripSubLinePrefix("DRKSHDW - COTTON TANK TOP", "Rick Owens"))
      .toBe("COTTON TANK TOP");
    expect(stripSubLinePrefix("BLACK - FW2014 WOOL SKIRT", "COMME DES GARCONS"))
      .toBe("FW2014 WOOL SKIRT");
    expect(stripSubLinePrefix("BLANCHE - Silk Dress", "Ann Demeulemeester"))
      .toBe("Silk Dress");
  });
  it("prefers the longest matching marker", () => {
    expect(stripSubLinePrefix("HOMME PLUS - Wool Coat", "Comme des Garçons"))
      .toBe("Wool Coat");
  });
  it("leaves a genuine leading descriptor alone (no dash separator)", () => {
    expect(stripSubLinePrefix("Black Wool Coat", "Comme des Garçons"))
      .toBe("Black Wool Coat");
    expect(stripSubLinePrefix("Shirt Blue Abstract Face Shirt", "Comme des Garçons"))
      .toBe("Shirt Blue Abstract Face Shirt");
  });
  it("only matches at the start", () => {
    expect(stripSubLinePrefix("Wool Coat BLACK - Trim", "Comme des Garçons"))
      .toBe("Wool Coat BLACK - Trim");
  });
  it("is a no-op for brands with no sub-line table", () => {
    expect(stripSubLinePrefix("BLACK - Wool Coat", "Prada"))
      .toBe("BLACK - Wool Coat");
  });
});

describe("collapseDanglingDash", () => {
  it("removes leading and trailing dash artifacts", () => {
    expect(collapseDanglingDash("- Wool Coat")).toBe("Wool Coat");
    expect(collapseDanglingDash("Top - ")).toBe("Top");
    expect(collapseDanglingDash(" - Shorts - ")).toBe("Shorts");
  });
  it("collapses an orphaned double dash", () => {
    expect(collapseDanglingDash("Top - - FW10")).toBe("Top - FW10");
  });
  it("keeps a meaningful interior dash", () => {
    expect(collapseDanglingDash("Button-up Shirt")).toBe("Button-up Shirt");
    expect(collapseDanglingDash("Top - FW10")).toBe("Top - FW10");
  });
});

describe("seasonToFront", () => {
  it("moves a lone trailing season code to the front", () => {
    expect(seasonToFront("Top - FW10")).toBe("FW10 Top");
    expect(seasonToFront("Silk Dress - SS07")).toBe("SS07 Silk Dress");
    expect(seasonToFront("Heavy Wool Skirt FW2014")).toBe("FW2014 Heavy Wool Skirt");
  });
  it("no-ops when the season code is already first", () => {
    expect(seasonToFront("FW10 Top")).toBe("FW10 Top");
    expect(seasonToFront("FW02/03 Printed Tee")).toBe("FW02/03 Printed Tee");
  });
  it("no-ops when there are two season tokens (editorial call)", () => {
    expect(seasonToFront("Top FW10 SS11")).toBe("Top FW10 SS11");
  });
  it("no-ops on titles with no season token", () => {
    expect(seasonToFront("Wool Blazer")).toBe("Wool Blazer");
    expect(seasonToFront("")).toBe("");
  });
});

describe("handle-fallback gate — integrated", () => {
  it("recovers McQueen FW1998 «JOAN» mini skirt (the production canary)", () => {
    const result = recoverFromHandleFallback(
      "ALEXANDER MCQUEEN FW1998 «JOAN» BLACK DENIM MINI SKIRT",
      "alexander-mcqueen-fw1998-joan-black-denim-mini-skirt",
    );
    // The season code shortens to the 2-digit house form at the choke point;
    // before normalizeSeasonCodes existed this asserted "FW1998 …".
    expect(result).toEqual({
      brand: "ALEXANDER MCQUEEN",
      title: "FW98 Black Denim Mini Skirt",
    });
  });
  it("recovers CDG SHIRT 5-word descriptor (8-word input)", () => {
    const result = recoverFromHandleFallback(
      "Comme des Garçons Shirt Blue Abstract Face Shirt",
      "comme-des-garcons-shirt-blue-abstract-face-shirt",
    );
    expect(result).toEqual({
      brand: "COMME DES GARÇONS",
      title: "Shirt Blue Abstract Face Shirt",
    });
  });
  it("rejects brand-only name (stripped title is empty → 0 words)", () => {
    expect(recoverFromHandleFallback("FENDI", "fendi-bag")).toBeNull();
  });
  it("rejects a stripped name longer than 7 words", () => {
    const result = recoverFromHandleFallback(
      "FENDI A B C D E F G H I J K L M N O",
      "fendi-something",
    );
    expect(result).toBeNull();
  });
  it("returns null when handle carries no allowlisted brand", () => {
    expect(
      recoverFromHandleFallback("Some Random Item", "no-brand-here"),
    ).toBeNull();
  });
  it("preserves a brand sitting at the end of the name", () => {
    const result = recoverFromHandleFallback("LOAFERS GUCCI", "gucci-loafers");
    expect(result).toEqual({ brand: "GUCCI", title: "Loafers" });
  });
  it("strips a brand sitting in the middle of the name", () => {
    const result = recoverFromHandleFallback(
      "VINTAGE FENDI JACKET",
      "fendi-jacket",
    );
    expect(result).toEqual({ brand: "FENDI", title: "Vintage Jacket" });
  });
  // The chezsnowbunny flood class: the vendor name carries an alias spelling
  // of the brand the handle resolved to, so the single-phrase strip left it in
  // and toTitleCase produced "Ysl …".
  it("strips an alias spelling of the resolved brand (the Ysl class)", () => {
    const result = recoverFromHandleFallback(
      "YSL RECTANGULAR METAL LOGO TEMPLES GLASSES",
      "ysl-rectangular-metal-logo-temples-glasses",
    );
    expect(result.title).toBe("Rectangular Metal Logo Temples Glasses");
    expect(result.title).not.toMatch(/ysl/i);
  });

  it("strips a sub-line prefix left behind by the brand strip", () => {
    expect(
      recoverFromHandleFallback(
        "RICK OWENS DRKSHDW - COTTON TANK TOP",
        "rick-owens-drkshdw-cotton-tank-top",
      ),
    ).toEqual({ brand: "RICK OWENS", title: "Cotton Tank Top" });
  });

  it("strips a CDG sub-line and moves the season code to the front", () => {
    expect(
      recoverFromHandleFallback(
        "COMME DES GARÇONS BLACK - FW2014 HEAVY WOOL SUSPENDER SKIRT",
        "comme-des-garcons-black-fw2014-heavy-wool-suspender-skirt",
      ),
    ).toEqual({
      brand: "COMME DES GARÇONS",
      title: "FW14 Heavy Wool Suspender Skirt",
    });
  });

  it("recovers the Undercover wallet — leading parenthetical stripped before brand removal (id 5139850)", () => {
    // Regression for the ordering bug: nameWithoutBrand used to delete the
    // opening "(" before sanitizeFallbackTitle could strip the balanced
    // "(New Arrival)", leaving "New Arrival) - …" in the title. Sanitizing
    // the raw name first removes the whole parenthetical while balanced.
    const result = recoverFromHandleFallback(
      "(New Arrival) UNDERCOVER - FW04 « But Beautiful » Aged velevet wallet",
      "new-arrival-undercover-fw04-but-beautiful-aged-velevet-wallet",
    );
    expect(result).toEqual({
      brand: "UNDERCOVER",
      title: "FW04 Aged Velevet Wallet",
    });
  });
});
