import { describe, it, expect } from "vitest";
import { normalizeSeasonCodes, manualReviewFlags } from "../seasonCodes.js";

// Every case below was taken from a real production title (11,024-row sweep,
// 2026-07-29) unless marked as a synthetic guard.

describe("normalizeSeasonCodes — casing", () => {
  it("uppercases the reported Fw02/03 tee (the production canary)", () => {
    expect(normalizeSeasonCodes("Fw02/03 Printed Cotton Tee")).toBe(
      "FW02/03 Printed Cotton Tee",
    );
  });
  it("uppercases and shortens Ss2008", () => {
    expect(normalizeSeasonCodes("Ss2008 Cream Plissed Blazer")).toBe(
      "SS08 Cream Plissed Blazer",
    );
  });
  it("uppercases an all-lowercase prefix", () => {
    expect(normalizeSeasonCodes("fw99 Wide Trousers")).toBe("FW99 Wide Trousers");
  });
});

describe("normalizeSeasonCodes — 4-digit years shorten to 2", () => {
  it.each([
    ["SS2004 Leather Vest", "SS04 Leather Vest"],
    ["AW2003 Wool Coat", "AW03 Wool Coat"],
    ["FW1999 Denim Skirt", "FW99 Denim Skirt"],
    ["SS1992 Silk Blouse", "SS92 Silk Blouse"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeSeasonCodes(input)).toBe(expected);
  });

  it("leaves an already-2-digit year untouched", () => {
    expect(normalizeSeasonCodes("SS16 Wool Coat")).toBe("SS16 Wool Coat");
  });
});

describe("normalizeSeasonCodes — split years normalize onto a slash", () => {
  it.each([
    ["FW12/13 Costume Pants", "FW12/13 Costume Pants"],
    ["AW2013/2014 Knit Dress", "AW13/14 Knit Dress"],
    ["AW2001/02 Wool Cape", "AW01/02 Wool Cape"],
    ["FW10-11 Leather Boots", "FW10/11 Leather Boots"],
    ["FW88-89 Tweed Jacket", "FW88/89 Tweed Jacket"],
    ["FW00-01 Nylon Parka", "FW00/01 Nylon Parka"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeSeasonCodes(input)).toBe(expected);
  });
});

describe("normalizeSeasonCodes — letter-slash prefixes collapse", () => {
  it.each([
    ["S/S 2004 Leather Vest", "SS04 Leather Vest"],
    ["F/w 1997 Black Panelled Wool Cropped Top", "FW97 Black Panelled Wool Cropped Top"],
    ["S/s 1997 Grey Floral-print Midi Coat", "SS97 Grey Floral-print Midi Coat"],
    ["S/S03 Laced Butterfly Top", "SS03 Laced Butterfly Top"],
    ["A/W 2001 Baroque Slip Dress", "AW01 Baroque Slip Dress"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeSeasonCodes(input)).toBe(expected);
  });

  it("leaves an invalid letter pair alone (synthetic guard)", () => {
    expect(normalizeSeasonCodes("F/S 2004 Thing")).toBe("F/S 2004 Thing");
  });
  it("leaves a letter pair with no following year alone (synthetic guard)", () => {
    expect(normalizeSeasonCodes("A/W Collection Piece")).toBe("A/W Collection Piece");
  });
});

describe("normalizeSeasonCodes — spelled-out seasons", () => {
  it.each([
    ["Fall/Winter 2003 Pants", "FW03 Pants"],
    ["Autumn Winter 1997", "FW97"],
    ["Spring/Summer 1998 Top", "SS98 Top"],
    ["Spring 2000 Reversible Opera Set", "SS00 Reversible Opera Set"],
    ["Spring 2002 Fur Heels", "SS02 Fur Heels"],
    ["Fall 2003 Velour Dress", "FW03 Velour Dress"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeSeasonCodes(input)).toBe(expected);
  });

  it("keeps Pre-Fall, a season in its own right", () => {
    expect(normalizeSeasonCodes("Pre-Fall 2014 Black Silk Dress")).toBe(
      "Pre-Fall 2014 Black Silk Dress",
    );
  });
  it.each(["Resort 2015 Linen Shirt", "Cruise 2001 Beaded Top"])(
    "keeps %s untouched",
    (input) => {
      expect(normalizeSeasonCodes(input)).toBe(input);
    },
  );
  it("leaves a yearless season word alone (synthetic guard)", () => {
    expect(normalizeSeasonCodes("Indian Summer Dress")).toBe("Indian Summer Dress");
    expect(normalizeSeasonCodes("Fall Winter Coat")).toBe("Fall Winter Coat");
  });
  // Codex round 1: COMPOUND_* accept an apostrophe year, so SEASON_YEAR must
  // consume it too — otherwise this title strands as the half-normalized
  // "FW '03 Pants".
  it("completes normalization of an apostrophe-year compound season", () => {
    expect(normalizeSeasonCodes("Fall/Winter '03 Pants")).toBe("FW03 Pants");
    expect(normalizeSeasonCodes("Spring/Summer '99 Top")).toBe("SS99 Top");
  });
  it("consumes an apostrophe directly on a season code", () => {
    expect(normalizeSeasonCodes("FW '03 Wool Coat")).toBe("FW03 Wool Coat");
    expect(normalizeSeasonCodes("SS'04 Dress")).toBe("SS04 Dress");
  });
});

describe("normalizeSeasonCodes — decade markers", () => {
  it("lowercases an uppercase decade S", () => {
    expect(normalizeSeasonCodes("2000S PVC Trench Coat")).toBe("2000s PVC Trench Coat");
  });
  it("leaves an already-lowercase decade alone", () => {
    expect(normalizeSeasonCodes("2000s Crossbody Bag")).toBe("2000s Crossbody Bag");
  });
  it("leaves a bare 4-digit year alone", () => {
    expect(normalizeSeasonCodes("1998 Wool Coat")).toBe("1998 Wool Coat");
  });
});

describe("normalizeSeasonCodes — never touches non-season text", () => {
  it.each([
    "Sswing Panel Dress",
    "Awning Stripe Shirt",
    "Ferragamo Leather Wallet",
    "Assorted Silk Scarves",
    "Wool Blazer",
  ])("leaves %s unchanged", (input) => {
    expect(normalizeSeasonCodes(input)).toBe(input);
  });
});

describe("normalizeSeasonCodes — non-string and empty input", () => {
  it.each([null, undefined, "", 42])("returns %s as-is", (input) => {
    expect(normalizeSeasonCodes(input)).toBe(input);
  });
});

// The backfill's write predicate is `proposed !== row.title`. So proving a
// title is a fixed point of the normalizer IS proving the backfill can never
// write it — the contract Codex's adversarial review asked to be pinned rather
// than left as an accident of the regex guards.
describe("zero-write contract — malformed tokens are fixed points", () => {
  it.each([
    "SS19999 Cotton Tee",
    "A2013 Leather Jacket",
    "FW90s Oversized Coat",
  ])("%s is left byte-identical, so the backfill proposes no write", (input) => {
    expect(normalizeSeasonCodes(input)).toBe(input);
    expect(manualReviewFlags(input).length).toBeGreaterThan(0);
  });
});

describe("season-not-first titles — format fixed, order preserved", () => {
  it.each([
    ["Top - FW2010", "Top - FW10"],
    ["Pink White Sleeveless Knit SS20", "Pink White Sleeveless Knit SS20"],
    ["Christian SS2002 Monogram Nylon Pants", "Christian SS02 Monogram Nylon Pants"],
    ["Tao SS2009 Black Sheer Midi Skirt", "Tao SS09 Black Sheer Midi Skirt"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeSeasonCodes(input)).toBe(expected);
  });

  it("never reorders or drops tokens — only the season token changes", () => {
    const input = "Christian SS2002 Monogram Nylon Pants";
    const before = input.split(/\s+/);
    const after = normalizeSeasonCodes(input).split(/\s+/);
    expect(after).toHaveLength(before.length);
    before.forEach((token, i) => {
      if (i !== 1) expect(after[i]).toBe(token);
    });
  });

  it("is flagged for manual follow-up on position", () => {
    expect(manualReviewFlags("Top - FW2010")).toContain("season_not_first");
  });
  it("does not flag a title whose season code leads", () => {
    expect(manualReviewFlags("FW02/03 Printed Cotton Tee")).toEqual([]);
  });
});

describe("normalizeSeasonCodes — idempotence", () => {
  const corpus = [
    "Fw02/03 Printed Cotton Tee",
    "SS2004 Leather Vest",
    "S/S 2004 Leather Vest",
    "F/w 1997 Black Panelled Wool Cropped Top",
    "Fall/Winter 2003 Pants",
    "Autumn Winter 1997",
    "Spring 2000 Reversible Opera Set",
    "AW2013/2014 Knit Dress",
    "FW10-11 Leather Boots",
    "2000S PVC Trench Coat",
    "Pre-Fall 2014 Black Silk Dress",
    "SS19999 Cotton Tee",
    "Top - FW2010",
    "Wool Blazer",
  ];
  it.each(corpus)("normalizing %s twice equals normalizing once", (input) => {
    const once = normalizeSeasonCodes(input);
    expect(normalizeSeasonCodes(once)).toBe(once);
  });
});
