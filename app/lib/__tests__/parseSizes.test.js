import { describe, it, expect } from "vitest";
import {
  parseSizeFromOptions,
  parseSizeFromBody,
  parseSizes,
} from "../parseSizes.js";

// ---------- Layer 1: Shopify option lookup ----------

describe("parseSizeFromOptions", () => {
  it("returns null when product has no options array", () => {
    expect(parseSizeFromOptions({})).toBe(null);
    expect(parseSizeFromOptions({ variants: [] })).toBe(null);
  });

  it("returns null when no option name matches Size/Taille/Pointure/Talla", () => {
    const product = {
      options: [{ name: "Gender" }, { name: "Condition" }],
      variants: [{ option1: "Woman", option2: "B", title: "Woman / B" }],
    };
    expect(parseSizeFromOptions(product)).toBe(null);
  });

  it("extracts the Size option value when Size is at index 0", () => {
    const product = {
      options: [{ name: "Size" }, { name: "Gender" }, { name: "Condition" }],
      variants: [{ option1: "S", option2: "Man", option3: "A", title: "S / Man / A" }],
    };
    expect(parseSizeFromOptions(product)).toEqual(["S"]);
  });

  it("extracts the Size option value when Size is at index 1", () => {
    const product = {
      options: [{ name: "Color" }, { name: "Size" }],
      variants: [{ option1: "Black", option2: "M" }],
    };
    expect(parseSizeFromOptions(product)).toEqual(["M"]);
  });

  it("extracts via French synonyms Taille and Pointure", () => {
    const taille = {
      options: [{ name: "Taille" }],
      variants: [{ option1: "MEN S · WOMEN M" }],
    };
    expect(parseSizeFromOptions(taille)).toEqual(["MEN S · WOMEN M"]);

    const pointure = {
      options: [{ name: "Pointure" }],
      variants: [{ option1: "46" }],
    };
    expect(parseSizeFromOptions(pointure)).toEqual(["46"]);
  });

  it("trims surrounding whitespace on option name (nuovo-paris had 'Size ')", () => {
    const product = {
      options: [{ name: "Size " }],
      variants: [{ option1: "M" }],
    };
    expect(parseSizeFromOptions(product)).toEqual(["M"]);
  });

  it("returns multiple values for multi-variant products", () => {
    const product = {
      options: [{ name: "Size" }],
      variants: [{ option1: "S" }, { option1: "M" }, { option1: "L" }],
    };
    expect(parseSizeFromOptions(product)).toEqual(["S", "M", "L"]);
  });

  it("dedupes repeated size values across a Color × Size variant matrix", () => {
    // A product with two options (Color, Size) and a Red/S, Blue/S, Red/M,
    // Blue/M matrix should return ["S", "M"], not ["S", "S", "M", "M"].
    // The 2-option Shopify shape is common on seyswardrobe and would
    // otherwise inflate the SIZES list with duplicates.
    const product = {
      options: [{ name: "Color" }, { name: "Size" }],
      variants: [
        { option1: "Red", option2: "S" },
        { option1: "Blue", option2: "S" },
        { option1: "Red", option2: "M" },
        { option1: "Blue", option2: "M" },
      ],
    };
    expect(parseSizeFromOptions(product)).toEqual(["S", "M"]);
  });

  it("dedup preserves first-seen order, not sort order", () => {
    // Order matters because the seller's listing order is meaningful
    // (e.g. ascending size). First-occurrence dedup must not re-sort.
    const product = {
      options: [{ name: "Size" }, { name: "Color" }],
      variants: [
        { option1: "L", option2: "Red" },
        { option1: "S", option2: "Red" },
        { option1: "L", option2: "Blue" },
        { option1: "S", option2: "Blue" },
        { option1: "M", option2: "Red" },
      ],
    };
    expect(parseSizeFromOptions(product)).toEqual(["L", "S", "M"]);
  });

  it("skips Default Title and empty option values", () => {
    const product = {
      options: [{ name: "Size" }],
      variants: [
        { option1: "Default Title" },
        { option1: "" },
        { option1: null },
        { option1: "M" },
      ],
    };
    expect(parseSizeFromOptions(product)).toEqual(["M"]);
  });

  it("matches Size synonyms case-insensitively", () => {
    const product = {
      options: [{ name: "SIZE" }],
      variants: [{ option1: "L" }],
    };
    expect(parseSizeFromOptions(product)).toEqual(["L"]);
  });
});

// ---------- Layer 2: body_html parser ----------

describe("parseSizeFromBody — labeled lines", () => {
  it("returns null for null/empty/undefined input", () => {
    expect(parseSizeFromBody(null)).toBe(null);
    expect(parseSizeFromBody(undefined)).toBe(null);
    expect(parseSizeFromBody("")).toBe(null);
  });

  it("returns null when body has no size-like content", () => {
    expect(parseSizeFromBody("<p>Color: Black. Material: Wool.</p>")).toBe(null);
  });

  it("extracts S from 'Size: S.' (dot Comme)", () => {
    expect(parseSizeFromBody("<p>Size: S.</p>")).toEqual(["S"]);
  });

  it("extracts 40 from 'Size 40' with no colon (L'Obscur)", () => {
    expect(parseSizeFromBody("<p>Size 40</p>")).toEqual(["40"]);
  });

  it("extracts S from 'SIZE S' uppercase no colon (Esco)", () => {
    expect(parseSizeFromBody("<p>SIZE S</p>")).toEqual(["S"]);
  });

  it("extracts 42 IT from 'Size: 42IT fit S-M women' (Grain de Sell)", () => {
    // Cuts at 'fit' (body-shape note), normalizes 42IT → '42 IT'
    expect(parseSizeFromBody("<p>Size: 42IT fit S-M women</p>")).toEqual([
      "42 IT",
    ]);
  });

  it("extracts XS from 'SIZE : FITS XS' (Numero 13)", () => {
    expect(parseSizeFromBody("<p>SIZE : FITS XS</p>")).toEqual(["XS"]);
  });

  it("normalizes 'FROM XS TO S' to 'XS-S' (Numero 13)", () => {
    expect(parseSizeFromBody("<p>SIZE : FROM XS TO S</p>")).toEqual(["XS-S"]);
  });

  it("stops at next labeled field (atdawn paragraphs)", () => {
    // 'Size: ONE SIZE (STRETCH FIT) Color: BLACK Material: ACETATE'
    // — must capture only the ONE SIZE portion, not the trailing fields.
    expect(
      parseSizeFromBody(
        "<p>Size: ONE SIZE Color: BLACK Material: ACETATE Condition: 4/5</p>",
      ),
    ).toEqual(["ONE SIZE"]);
  });

  it("rejects 'No size tag fit M' (Grain de Sell sizeless rows)", () => {
    // Reject-list match → returns null, lets L3 / hidden block take over.
    expect(parseSizeFromBody("<p>No size tag fit M</p>")).toBe(null);
  });

  it("rejects 'Size: on request'", () => {
    expect(parseSizeFromBody("<p>Size: on request</p>")).toBe(null);
  });

  it("rejects 'SIZE : MISSING SIZE TAG' (Les Archives)", () => {
    expect(parseSizeFromBody("<p>SIZE : MISSING SIZE TAG</p>")).toBe(null);
  });

  it("trims trailing 'women'/'men' connectors", () => {
    expect(parseSizeFromBody("<p>Size M women</p>")).toEqual(["M"]);
  });

  it("cuts at first comma (avoid 'small to medium, Velcro closure')", () => {
    expect(
      parseSizeFromBody("<p>Size: small to medium, Velcro closure</p>"),
    ).toEqual(["small to medium"]);
  });

  // ----- heading-rejection (codex round-2 finding 3) -----
  // Common retail copy uses "Size and fit:", "Size & Fit:", "Size guide",
  // "Size range:" as section headings. A loose regex captures the next
  // word ("and", "&", "guide", "range") as a fake size; that value then
  // gets persisted into products.size. The tightened LABEL_RE requires
  // either a direct ":" after Size OR a size-shaped first token, so
  // these heading shapes don't match.

  it("rejects 'Size and fit:' section heading", () => {
    expect(
      parseSizeFromBody("<p>Size and fit: relaxed throughout the body.</p>"),
    ).toBe(null);
  });

  it("rejects 'Size & Fit:' section heading", () => {
    expect(parseSizeFromBody("<p>Size & Fit: true to size</p>")).toBe(null);
  });

  it("rejects 'Size guide' / 'Size chart' headings", () => {
    expect(parseSizeFromBody("<p>Size guide. Color: Black.</p>")).toBe(null);
    expect(parseSizeFromBody("<p>Size chart available on request.</p>")).toBe(
      null,
    );
  });

  it("rejects 'Size range:' heading even when followed by size tokens", () => {
    // "Size range: S to L" looks compositionally valid but is a heading,
    // not the seller's stated size. Better to drop than to invent.
    expect(parseSizeFromBody("<p>Size range: S to L</p>")).toBe(null);
  });

  // ----- decimal half-sizes (codex round-1 finding) -----
  // Shoe sizing routinely uses half-sizes (40.5, 41.5 EU). An earlier
  // version of LABEL_RE treated `.` as an unconditional terminator, so
  // "Pointure: 40.5" parsed to "40" and "Size: 38.5 IT" parsed to "38"
  // (silently dropping both the half and the unit). The terminator now
  // requires `.` followed by non-digit, so digit-period-digit survives.

  it("preserves decimal half-sizes after a colon (Pointure: 40.5)", () => {
    expect(parseSizeFromBody("<p>Pointure: 40.5</p>")).toEqual(["40.5"]);
  });

  it("preserves decimal half-sizes with a unit (Size: 38.5 IT)", () => {
    expect(parseSizeFromBody("<p>Size: 38.5 IT</p>")).toEqual(["38.5 IT"]);
  });

  it("preserves decimal half-sizes on the no-colon path (Pointure 41.5)", () => {
    expect(parseSizeFromBody("<p>Pointure 41.5</p>")).toEqual(["41.5"]);
  });

  it("preserves decimal half-sizes and trims trailing body-shape (Size 7.5 US fit men)", () => {
    expect(parseSizeFromBody("<p>Size 7.5 US fit men</p>")).toEqual(["7.5 US"]);
  });

  it("still treats sentence-ending '.' as a terminator (Size: M.)", () => {
    // Regression guard: the decimal fix loosened `.` rules; a period
    // followed by space/end-of-string must still terminate so single-
    // letter sizes followed by punctuation don't accumulate noise.
    expect(parseSizeFromBody("<p>Size: M.</p>")).toEqual(["M"]);
    expect(parseSizeFromBody("<p>Size: M. Color: Black.</p>")).toEqual(["M"]);
  });

  // ----- HTML whitespace entities (codex round-2 finding) -----
  // Shopify's rich-text product description editor routinely inserts
  // literal `&nbsp;` (and the numeric forms `&#160;` / `&#xa0;`) for
  // visual spacing. Without normalization, the regex captures the
  // entity text and persists "&NBSP;M" into products.size.

  it("normalizes &nbsp; before the regex sees it (Size:&nbsp;M)", () => {
    expect(parseSizeFromBody("<p>Size:&nbsp;M</p>")).toEqual(["M"]);
  });

  it("normalizes &nbsp; with a decimal half-size", () => {
    expect(parseSizeFromBody("<p>Size:&nbsp;38.5 IT</p>")).toEqual(["38.5 IT"]);
  });

  it("normalizes the decimal numeric entity &#160;", () => {
    expect(parseSizeFromBody("<p>Size:&#160;M</p>")).toEqual(["M"]);
  });

  it("normalizes the hex numeric entity &#xa0;", () => {
    expect(parseSizeFromBody("<p>Size:&#xa0;S</p>")).toEqual(["S"]);
  });

  // ----- "one size fits all" reject (codex round-3 finding) -----
  // Common body copy. The earlier no-colon branch allowed FITS as a
  // size token, so it captured "fits all" starting at the word `size`,
  // and canonicalizeLabeled stripped the FITS prefix leaving `["all"]`.
  // FITS removed from the no-colon token list; the colon path
  // (e.g. "SIZE : FITS XS") still works via the permissive value
  // capture + FITS_PREFIX_RE strip.

  it("returns null for 'One size fits all' (no longer captures 'all')", () => {
    expect(parseSizeFromBody("<p>One size fits all</p>")).toBe(null);
    expect(parseSizeFromBody("<p>one size fits all</p>")).toBe(null);
    expect(parseSizeFromBody("<p>ONE SIZE FITS ALL</p>")).toBe(null);
  });

  it("returns null for 'one size fits most'", () => {
    expect(parseSizeFromBody("<p>One size fits most</p>")).toBe(null);
  });

  it("returns null when the phrase is embedded in surrounding copy", () => {
    expect(
      parseSizeFromBody("<p>This piece is one size fits all.</p>"),
    ).toBe(null);
    expect(
      parseSizeFromBody("<p>Universal one size fits all design</p>"),
    ).toBe(null);
  });

  it("normalizes a raw U+00A0 character (was the previously-handled case)", () => {
    // Direct U+00A0 (not the entity) still resolves cleanly — the
    // existing replacement remains in place alongside the new entity
    // normalization.
    expect(parseSizeFromBody("<p>Size: M</p>")).toEqual(["M"]);
  });
});

describe("parseSizeFromBody — unlabeled triplet (nuovo-paris)", () => {
  it("extracts '38 FR / M / 42 IT' from a standalone line", () => {
    expect(parseSizeFromBody("<p>Dress description.</p><p>38 FR / M / 42 IT</p>"))
      .toEqual(["38 FR / M / 42 IT"]);
  });

  it("normalizes spacing — '38FR/M/42IT' becomes '38 FR / M / 42 IT'", () => {
    expect(parseSizeFromBody("<p>38FR/M/42IT</p>")).toEqual([
      "38 FR / M / 42 IT",
    ]);
  });

  it("uppercases the letter token", () => {
    expect(parseSizeFromBody("<p>36 FR / s / 40 IT</p>")).toEqual([
      "36 FR / S / 40 IT",
    ]);
  });

  it("accepts size duos (not just triplets)", () => {
    expect(parseSizeFromBody("<p>36 FR / 40 IT</p>")).toEqual(["36 FR / 40 IT"]);
    expect(parseSizeFromBody("<p>S / 40 IT</p>")).toEqual(["S / 40 IT"]);
  });

  it("does NOT match a standalone letter without separator", () => {
    // 'S' alone in body text would be a false positive — require at least
    // two atoms separated by /.
    expect(parseSizeFromBody("<p>This S is a sentence.</p>")).toBe(null);
  });

  it("does NOT match a year-shaped number", () => {
    // '2002' isn't a size atom — only \d{1,3}(FR|IT|EU|US|UK) qualifies.
    expect(parseSizeFromBody("<p>From 2002 / Vintage</p>")).toBe(null);
  });
});

// ---------- Orchestrator ----------

describe("parseSizes (orchestrator)", () => {
  it("Layer 1 wins when product has a Size option", () => {
    const product = {
      options: [{ name: "Size" }],
      variants: [{ option1: "M" }],
      body_html: "<p>Size: L.</p>", // contradicts L1 — L1 should win
    };
    expect(parseSizes(product)).toEqual(["M"]);
  });

  it("falls through to Layer 2 when no Size option exists", () => {
    const product = {
      options: [{ name: "Title" }],
      variants: [{ option1: "Default Title" }],
      body_html: "<p>Size: S.</p>",
    };
    expect(parseSizes(product)).toEqual(["S"]);
  });

  it("returns null when both layers fail", () => {
    const product = {
      options: [{ name: "Title" }],
      variants: [{ option1: "Default Title" }],
      body_html: "<p>A bag with leather trim.</p>",
    };
    expect(parseSizes(product)).toBe(null);
  });

  it("returns null for null/empty input", () => {
    expect(parseSizes(null)).toBe(null);
    expect(parseSizes(undefined)).toBe(null);
    expect(parseSizes({})).toBe(null);
  });
});
