import { describe, it, expect } from "vitest";
import {
  classifyRow,
  evaluateFormattingHealth,
  fingerprintViolations,
  DISPLAY_CAP,
} from "../formattingHealth.js";
import { MAX_ENRICH_ATTEMPTS } from "../enrichLimits.js";

// Rows arrive already filtered by withVisibility (available + not hidden +
// no '€0.00'), selecting id, store_domain, brand, title, category,
// enrich_attempts.
const row = (over) => ({
  id: 1,
  store_domain: "example.com",
  brand: "RICK OWENS",
  title: "FW04 Leather Jacket",
  category: "Jackets & Coats",
  enrich_attempts: 0,
  ...over,
});

const keys = (over) => classifyRow(row(over)).violations;

describe("classifyRow — the silent/report line", () => {
  it("stays silent on a NULL editorial field still under the attempt cap", () => {
    const r = row({ category: null, enrich_attempts: MAX_ENRICH_ATTEMPTS - 1 });
    expect(classifyRow(r)).toEqual({ violations: [], queuedNull: true });
  });

  it("reports the same row once enrichment has given up", () => {
    const r = row({ category: null, enrich_attempts: MAX_ENRICH_ATTEMPTS });
    expect(classifyRow(r)).toEqual({
      violations: ["enrichment_failed"],
      queuedNull: false,
    });
  });

  it("treats a missing enrich_attempts as zero, i.e. still queued", () => {
    const r = row({ brand: null, enrich_attempts: undefined });
    expect(classifyRow(r).queuedNull).toBe(true);
  });
});

describe("classifyRow — title classes, on the real production examples", () => {
  it("flags the dangling trailing By (id 14953917)", () => {
    expect(keys({ title: "Calvin Klein 205w39nyc Cow-boy Leather Boots By" })).toContain(
      "trailing_by"
    );
  });

  it("flags a sub-line prefix ahead of the season code (Tao FW07 …)", () => {
    const found = keys({ brand: "COMME DES GARÇONS", title: "Tao FW07 Wool Dress" });
    expect(found).toContain("sub_line_prefix");
    expect(found).not.toContain("season_not_first");
  });

  it("falls back to season_not_first when the leading token is not a known sub-line", () => {
    const found = keys({ brand: "Y'S", title: "London SS87 Cotton Shirt" });
    expect(found).toContain("season_not_first");
    expect(found).not.toContain("sub_line_prefix");
  });

  it("flags an uncompacted season code via normalizeSeasonCodes inequality", () => {
    expect(keys({ title: "SS2004 Silk Blouse" })).toContain("uncompacted_season_code");
    expect(keys({ title: "Fall/Winter 2003 Wool Coat" })).toContain(
      "uncompacted_season_code"
    );
    // Already in house form — a fixed point, so no finding.
    expect(keys({ title: "FW04 Wool Coat" })).not.toContain("uncompacted_season_code");
  });

  it("flags a leaked allowlist brand, an over-long title, and a parenthetical", () => {
    expect(keys({ title: "Gucci Leather Belt" })).toContain("brand_in_title");
    expect(keys({ title: "One Two Three Four Five Six Seven Eight" })).toContain(
      "over_7_words"
    );
    expect(keys({ title: "Wool Coat (deadstock)" })).toContain("parenthetical");
    expect(keys({ title: "BLACK - Wool Coat" })).toContain("dash_in_title");
  });

  it("flags a non-canonical brand label (A.P.C)", () => {
    expect(keys({ brand: "A.P.C" })).toContain("non_canonical_brand");
    expect(keys({ brand: "A.P.C." })).not.toContain("non_canonical_brand");
  });

  it("does NOT fire on lowercase-after-hyphen — the deliberately rejected rule", () => {
    // 205 production matches, overwhelmingly correct English. Regression guard:
    // re-proposing this rule would be 205 false alarms on day one.
    for (const title of ["Zip-up Hoodie", "Zip-up Sweater", "Trompe-loeil Knit"]) {
      expect(classifyRow(row({ title })).violations).toEqual([]);
    }
  });
});

describe("evaluateFormattingHealth", () => {
  it("returns ok on a clean row set", () => {
    const result = evaluateFormattingHealth([row(), row({ id: 2 })]);
    expect(result.status).toBe("ok");
    expect(result.violations).toEqual({});
    expect(result.scanned).toBe(2);
    expect(result.silent.queued_null).toBe(0);
  });

  it("counts queued NULLs into silent and never into violations", () => {
    const result = evaluateFormattingHealth([
      row({ id: 1, category: null, enrich_attempts: 1 }),
      row({ id: 2, category: null, enrich_attempts: MAX_ENRICH_ATTEMPTS }),
    ]);
    expect(result.silent.queued_null).toBe(1);
    expect(result.violations.enrichment_failed.count).toBe(1);
    expect(result.violations.enrichment_failed.items[0].id).toBe(2);
  });

  it("reports a split brand family once per family, not once per row", () => {
    const result = evaluateFormattingHealth([
      row({ id: 1, brand: "JW ANDERSON" }),
      row({ id: 2, brand: "JW ANDERSON" }),
      row({ id: 3, brand: "J.W. ANDERSON" }),
    ]);
    expect(result.violations.split_brand_family.count).toBe(1);
    expect(result.violations.split_brand_family.items[0].brand).toContain("JW ANDERSON (2)");
  });

  it("does not report a family stored under a single label", () => {
    const result = evaluateFormattingHealth([
      row({ id: 1, brand: "JW ANDERSON" }),
      row({ id: 2, brand: "JW ANDERSON" }),
    ]);
    expect(result.violations.split_brand_family).toBeUndefined();
  });

  it("caps items[] for display while count stays the true total", () => {
    const rows = Array.from({ length: DISPLAY_CAP + 10 }, (_, i) =>
      row({ id: i + 1, category: null, enrich_attempts: MAX_ENRICH_ATTEMPTS })
    );
    const group = evaluateFormattingHealth(rows).violations.enrichment_failed;
    expect(group.count).toBe(DISPLAY_CAP + 10);
    expect(group.items).toHaveLength(DISPLAY_CAP);
    expect(group.truncated).toBe(true);
  });
});

describe("fingerprint discrimination", () => {
  const base = [
    row({ id: 1, title: "Calvin Klein Cow-boy Leather Boots By" }),
    row({ id: 2, category: null, enrich_attempts: MAX_ENRICH_ATTEMPTS }),
  ];

  it("differs when the same id set carries different violation keys", () => {
    const swapped = [
      row({ id: 1, title: "Wool Coat (deadstock)" }), // trailing_by → parenthetical
      base[1],
    ];
    const a = evaluateFormattingHealth(base).fingerprint;
    const b = evaluateFormattingHealth(swapped).fingerprint;
    expect(Object.keys(evaluateFormattingHealth(swapped).violations)).not.toEqual(
      Object.keys(evaluateFormattingHealth(base).violations)
    );
    expect(a).not.toBe(b);
  });

  it("is unchanged when only the field VALUE changes within the same class", () => {
    // A bad title edited into a DIFFERENT bad title of the same class must not
    // mail — silence is only trustworthy if churn within a state is quiet.
    const edited = [row({ id: 1, title: "Suede Ankle Boots By" }), base[1]];
    expect(evaluateFormattingHealth(edited).fingerprint).toBe(
      evaluateFormattingHealth(base).fingerprint
    );
  });

  it("changes when an item beyond the display cap changes", () => {
    // Fingerprint-before-truncation, asserted directly: the first DISPLAY_CAP
    // items are byte-identical in both sets, so hashing the capped structure
    // would call these states the same.
    const many = Array.from({ length: DISPLAY_CAP + 5 }, (_, i) =>
      row({ id: i + 1, category: null, enrich_attempts: MAX_ENRICH_ATTEMPTS })
    );
    const tailChanged = [...many.slice(0, -1), row({ id: 9999, category: null, enrich_attempts: MAX_ENRICH_ATTEMPTS })];
    const a = evaluateFormattingHealth(many);
    const b = evaluateFormattingHealth(tailChanged);
    expect(a.violations.enrichment_failed.items).toEqual(
      b.violations.enrichment_failed.items
    );
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("is order-independent over the tuple set", () => {
    expect(
      fingerprintViolations([
        ["trailing_by", 2],
        ["enrichment_failed", 1],
      ])
    ).toBe(
      fingerprintViolations([
        ["enrichment_failed", 1],
        ["trailing_by", 2],
      ])
    );
  });
});

describe("review tier", () => {
  // A corpus where garment words appear under many brands and "Calvin"/"Klein"
  // under one — the same derivation the real scan performs.
  const corpus = [
    ...["RICK OWENS", "PRADA", "GUCCI", "MARNI", "CELINE"].map((brand, i) =>
      row({ id: 100 + i, brand, title: "Zip-up Leather Boots" })
    ),
    row({
      id: 14953917,
      brand: "MISC",
      title: "Calvin Klein Cow-boy Leather Boots",
    }),
  ];

  it("surfaces the off-allowlist leak and leaves routine titles alone", () => {
    const review = evaluateFormattingHealth(corpus).review.possible_off_allowlist_brand;
    const ids = review.items.map((i) => i.id);
    expect(ids).toContain(14953917);
    expect(ids).not.toContain(100);
    expect(review.items.find((i) => i.id === 14953917).tokens).toEqual(
      expect.arrayContaining(["Calvin", "Klein"])
    );
  });

  it("ignores a lone rare token — one word cannot be told from a garment word", () => {
    // Measured against production: rarity alone flagged 1,528 of 8,012 rows
    // ("Tabi", "Mitten", "Purse"). Requiring a consecutive rare PAIR cut it to
    // 216, and requiring the pair to open the title to 109.
    const rows = [
      ...corpus,
      row({ id: 200, brand: "MISC", title: "Leather Tabi Boots" }),
    ];
    const ids = evaluateFormattingHealth(rows).review.possible_off_allowlist_brand.items.map(
      (i) => i.id
    );
    expect(ids).not.toContain(200);
  });

  it("ignores a rare pair that does not open the title", () => {
    const rows = [...corpus, row({ id: 201, brand: "MISC", title: "Leather Calvin Klein Coat" })];
    const ids = evaluateFormattingHealth(rows).review.possible_off_allowlist_brand.items.map(
      (i) => i.id
    );
    expect(ids).not.toContain(201);
  });

  it("looks past a leading season code, which legitimately opens a title", () => {
    const rows = [
      ...corpus,
      row({ id: 202, brand: "MISC", title: "SS15 Calvin Klein Boots" }),
    ];
    const ids = evaluateFormattingHealth(rows).review.possible_off_allowlist_brand.items.map(
      (i) => i.id
    );
    expect(ids).toContain(202);
  });

  it("never changes status and never enters the fingerprint", () => {
    const result = evaluateFormattingHealth(corpus);
    expect(result.status).toBe("ok");
    expect(result.violations).toEqual({});
    // Same violations (none) → same fingerprint, whatever the review tier says.
    expect(result.fingerprint).toBe(evaluateFormattingHealth([]).fingerprint);
  });
});
