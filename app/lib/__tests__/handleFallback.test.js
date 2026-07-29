import { describe, it, expect } from "vitest";
import {
  toTitleCase,
  sanitizeFallbackTitle,
  nameWithoutBrand,
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
  const fallbackTitle = sanitizeFallbackTitle(
    toTitleCase(nameWithoutBrand(sanitizeFallbackTitle(name), handleBrand))
  );
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
