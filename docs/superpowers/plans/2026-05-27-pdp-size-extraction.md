# PDP Size Extraction Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the desktop PDP's `SIZE` block so it shows the correct seller size across all 11 active stores (today it renders junk like `"WOMAN / B"` from polluted Shopify variant titles, or nothing at all for the 8 stores whose sizes live in `body_html`).

**Architecture:** Move size derivation out of the PDP and into the data pipeline. A new three-layer parser (`L1` Shopify option lookup → `L2` `body_html` extraction with both labeled and unlabeled-triplet patterns) runs at sync time and writes to a new `products.size` column. The PDP reads that column verbatim and applies a `Bags & Accessories → "ONE SIZE"` fallback (`L3`) only when the column is null. A one-shot admin backfill route populates the column for existing rows. A trivial cosmetic edit removes the redundant `· at {storeName}` suffix below the CTA.

**Tech Stack:** Next.js (App Router), Supabase (Postgres), Vitest. The validation that backs every decision in this plan was run live against 550 products across 11 stores (50/store, listing endpoint) and is summarized in the PR description; this plan is the implementation of that validated design.

---

## Context

### Why this change is being made

The PR that's currently in flight (`claude/elegant-heisenberg-452f36`, branch already rebased onto `main`) shipped a redesigned desktop PDP with a prominent new `SIZE` block. Verification on the Vercel preview surfaced four bugs that make the PR unsafe to merge:

1. **Seyswardrobe** products show garbage in the SIZE block (e.g. `WOMAN / B` for the LOEWE Amazona handbag, `M / B / Man` for a Vivienne Westwood longsleeve). Root cause: Shopify's `variant.title` concatenates *all* option values with ` / `, and seyswardrobe uses `Gender`/`Condition` options that pollute the title. When `Size` is also an option, it's there but buried at a varying index.
2. **L'Obscur, dot Comme, atdawn, esco, Les Archives, Numero 13, Yourgarmentz, plus most of Grain de Sell** show no SIZE at all. Root cause: they use a single Shopify variant titled `Default Title` and write the size inside `body_html` (e.g. `<p>Size: S.</p>`). The current code only reads `variant.title`, so the size is lost.
3. **Nuovo-Paris** also shows no SIZE. Root cause: their sizes are written *unlabeled* — a standalone line like `38 FR / M / 42 IT` with no `Size:` prefix. The labeled-line regex from (2) misses these.
4. **Cosmetic:** the line below the buy button reads `• AVAILABLE · AT {STORE}`, but the black button two lines above already says `BUY AT {STORE}`. Visible duplicate.

The user has explicitly stated this PR must ship solid, not "working enough for now." A holistic survey across the full store roster, plus a 550-product validation pass, confirms a three-layer parser with a generic regex (no per-store map) reaches 98% extraction coverage with zero false positives. The remaining 2% is store-side data gaps (products where the seller wrote no size anywhere) that no parser can recover.

### Intended outcome

- Desktop PDP `SIZE` block renders the seller's actual size across all 11 active stores.
- Sizeless items (bags, accessories) render `ONE SIZE`.
- Truly empty cases (no size written anywhere AND not a bag/accessory) render no SIZE block — conservative and consistent with current behavior, never wrong data.
- Future store additions inherit the generic parser; new stores joining the catalog will work without code changes as long as they use one of the dominant patterns (Shopify option named Size/Taille/Pointure, OR labeled `Size:` line in body, OR unlabeled size triplet).
- Size derivation is a pure projection from Shopify (overwrites every cron run) — not a protected editorial field. This is correct because the data is mechanical, not AI-generated.

### Validation done (do not redo)

- 550 products surveyed across all 11 active stores via `https://{domain}/products.json?limit=50`.
- Three-layer parser (L1 option lookup + L2 labeled-line + L2 unlabeled triplet + L3 ONE SIZE category fallback) achieves **98.0% extraction**, **0 false positives**.
- Per-store coverage: 6 stores at 100%, 4 stores at 96–98%, lesarchivesparis at 88% (4 products have empty body_html — store-side data gap, no parser can recover).
- The 11 honest-empty products were verified with the user; all are products where no size exists at the source.

### Files in scope

**Create:**
- `scripts/sql/2026-05-27-add-products-size.sql` — migration
- `app/lib/parseSizes.js` — three-layer parser module
- `app/lib/__tests__/parseSizes.test.js` — parser unit tests
- `app/api/admin/backfill-sizes/route.js` — one-shot backfill endpoint
- `app/admin/backfill-sizes/page.js` — dev-only UI to click the backfill button

**Modify:**
- `app/lib/shopifyFetch.js` — call `parseSizes` inside `normalizeProduct`, expose `sizes` on the returned object
- `app/api/cron/route.js` — include `size` in the Step-1 sync upsert
- `app/lib/resolveProductDetail.js` — SELECT `size, category` from `dbRow`; drop the variant-based `formatSizes`; new `resolveSizes(dbRow, product)` helper layers stored array → live `parseSizes` fallback → accessory ONE SIZE fallback (via category OR product_type/tags) → null
- `app/lib/__tests__/resolveProductDetail.test.js` — replace `formatSizes` tests with `sizesFromDb` tests
- `app/components/ProductInfoPanel.js` — drop the `· at {storeName}` suffix

---

## Storage format (referenced by multiple tasks)

The `products.size` column is a native Postgres `TEXT[]` (string array). Each element is one seller-provided size string, stored verbatim — no encoding, no delimiter, no escape:

| Scenario | Stored value | PDP renders |
|---|---|---|
| Single size, single token | `{S}` (one-element array) | `SIZE: S` |
| Single size, dual-system | `{"38 FR / M / 42 IT"}` (one element — slashes are inside the element, not a separator) | `SIZE: 38 FR / M / 42 IT` (singular label) |
| Single size, contains " · " | `{"MEN S · WOMEN M"}` (one element — the middle dot is *inside* the seller's value) | `SIZE: MEN S · WOMEN M` (singular label) |
| Multi-variant (e.g. S/M/L all in stock) | `{S,M,L}` (three elements) | `SIZES: S · M · L` (plural label, joined for display only) |
| ONE SIZE for bag (applied at PDP read, never stored) | `NULL` (column stays NULL; L3 in resolver returns `["ONE SIZE"]`) | `SIZE: ONE SIZE` |
| Honest empty | `NULL` | block hidden |

**Why TEXT[] and not joined TEXT.** A single Shopify Size option value can itself contain ` · ` (e.g., Taille `"MEN S · WOMEN M"` covered by the L1 test). If `products.size` were a TEXT column joined with ` · ` and split on read, that single value round-trips as two elements, flipping the SIZE label to SIZES and breaking the rendered meaning. TEXT[] preserves the array shape end-to-end — supabase-js converts to/from JS arrays natively — so element boundaries can never be misread.

The PDP joins the array with ` · ` **for display only**; the splitter/joiner divergence the original spec carried has been eliminated. The existing `sizes.length > 1 ? "SIZES" : "SIZE"` plural-label logic in `ProductInfoPanel` is unchanged.

---

## Task 1: Schema migration — add `products.size` column

**Files:**
- Create: `scripts/sql/2026-05-27-add-products-size.sql`

This migration is **applied manually via the Supabase SQL Editor** before merging the PR (per CLAUDE.md: Supabase MCP is read-only; schema/RPC changes apply to Supabase before dependent code merges).

- [ ] **Step 1: Write the migration SQL file**

```sql
-- Add products.size for parsed-from-Shopify size value.
--
-- Storage shape: TEXT[] (native Postgres string array), nullable.
--   Single size:           {S}  /  {"42 IT"}  /  {"38 FR / M / 42 IT"}
--   Single size with dot:  {"MEN S · WOMEN M"}   (one element — the
--                                                 middle dot is part of
--                                                 the seller's value)
--   Multi-variant:         {S,M,L}
--   No usable size:        NULL
--
-- TEXT[] (not joined TEXT) is required because a single Shopify Size
-- option value can itself contain ` · ` (covered by the parseSizes L1
-- test for Taille `MEN S · WOMEN M`). A TEXT-with-delimiter shape would
-- corrupt that on round-trip; the array preserves element boundaries.
--
-- Unlike brand/title/category/subcategory, `size` is NOT an editorial
-- field — it's a mechanical projection from Shopify. The cron Step-1
-- sync overwrites it every run (same model as `name`, `price`,
-- `available`). No COALESCE-protection, no `enrich_product` RPC change.
--
-- Apply via Supabase SQL Editor.

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS size TEXT[];

COMMIT;
```

- [ ] **Step 2: Apply manually via Supabase SQL Editor**

Paste the file's contents into the SQL Editor and run. Adding a NULLABLE column does not require a table rewrite — operation completes sub-second on 7,280 rows.

- [ ] **Step 3: Verify column exists**

In the SQL Editor:

```sql
SELECT column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'products'
  AND column_name = 'size';
```

Expected: one row, `data_type = 'ARRAY'`, `udt_name = '_text'`, `is_nullable = 'YES'`. (Postgres reports array columns as `data_type = 'ARRAY'` with the element type in `udt_name` — `_text` is Postgres's internal name for `text[]`.)

- [ ] **Step 4: Commit the migration file to the branch**

```bash
git add scripts/sql/2026-05-27-add-products-size.sql
git commit -m "feat(schema): add products.size column for parsed size value"
```

---

## Task 2: Build the size parser library (TDD)

**Files:**
- Create: `app/lib/parseSizes.js`
- Test: `app/lib/__tests__/parseSizes.test.js`

This is the heart of the change. Three layers, single module, comprehensive tests.

### 2.1 — Write the test file first

- [ ] **Step 1: Create the failing test file**

`app/lib/__tests__/parseSizes.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
npm test -- app/lib/__tests__/parseSizes.test.js
```

Expected: every test FAILS with `Cannot find module '../parseSizes.js'` or similar.

### 2.2 — Implement the parser

- [ ] **Step 3: Create the parser module**

`app/lib/parseSizes.js`:

```js
// Three-layer size parser for Shopify product data.
//
// Layer 1 (parseSizeFromOptions):
//   Look up the product option whose name matches Size / Taille / Pointure /
//   Talla (case-insensitive, trimmed). Return that option's value across all
//   variants, filtering out "Default Title" and empties.
//
// Layer 2 (parseSizeFromBody):
//   Two sub-patterns in priority order:
//   2a. Labeled: `Size:` / `SIZE :` / `Taille` / `Pointure` followed by a
//       value. Stops at next labeled field, comma, period, paren, or HTML
//       tag. Rejects negative phrases ("no size tag", "on request", etc).
//   2b. Unlabeled triplet/duo: `38 FR / M / 42 IT`, `S / 40 IT`. Requires
//       at least two size atoms (numeric+unit OR letter size) separated by
//       `/` or `·`. Pure letter-only standalone tokens don't match.
//
// parseSizes (orchestrator):
//   L1 → L2a → L2b. First non-null wins.
//
// Layer 3 (ONE SIZE fallback for Bags & Accessories) is applied by the
// PDP renderer (`resolveProductDetail`), NOT here — it's a presentation
// rule, not a parser rule, and depends on the row's category column.

// ---------- helpers ----------

function stripHtml(html) {
  if (typeof html !== "string") return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\xa0/g, " ");
}

const SIZE_OPTION_NAME = /^\s*(size|taille|pointure|talla)\s*$/i;

// ---------- Layer 1 ----------

export function parseSizeFromOptions(product) {
  const options = Array.isArray(product?.options) ? product.options : [];
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (options.length === 0 || variants.length === 0) return null;

  const idx = options.findIndex((o) => SIZE_OPTION_NAME.test(o?.name ?? ""));
  if (idx === -1) return null;

  // First-seen dedup: a 2-option Shopify product (e.g. Color × Size) lists
  // every size once per color variant, so naive collection yields
  // ["S","S","M","M"]. Set preserves insertion order in JS, so this also
  // preserves the seller's listing order (typically ascending size).
  //
  // Per-variant in-stock filtering is intentionally NOT applied here.
  // The listing endpoint exposes `variant.available`, but the current
  // (pre-redesign) PDP shows every variant label regardless of stock, so
  // adding a stock filter now would be a scope expansion, not a fix —
  // and a sold-out-only product would render with no SIZE block, which
  // is worse than showing the size and letting the storefront link
  // surface the out-of-stock state. Phase 2 candidate.
  const key = `option${idx + 1}`;
  const seen = new Set();
  for (const v of variants) {
    const val = typeof v?.[key] === "string" ? v[key].trim() : "";
    if (!val || val.toLowerCase() === "default title") continue;
    seen.add(val);
  }
  return seen.size > 0 ? [...seen] : null;
}

// ---------- Layer 2 ----------

// Match `size` / `taille` / `pointure` followed by either:
//   (a) ":" then any value (colon signals a value follows — permissive)
//   (b) whitespace then a size-shape first token (digit, S/M/L family,
//       OS, ONE SIZE, FITS, TBD) then more chars
// Rejects retail headings like "Size and fit:", "Size & Fit:",
// "Size guide", "Size range:" — they have neither a colon directly
// after the label nor a size-shape next token. (Codex round-2 finding.)
//
// Capture groups: (1) colon path, (2) no-colon path. parseSizeFromBody
// picks whichever matched.
const LABEL_RE = new RegExp(
  String.raw`\b(?:size|taille|pointure)` +
    String.raw`(?:` +
    String.raw`\s*:\s*([^.<\n(]{1,80}?)` +
    String.raw`|` +
    String.raw`\s+((?:\d|XX?S\b|XX?L\b|XL\b|XS\b|[SML]\b|OS\b|ONE\s+SIZE\b|FITS?\b|TBD\b)[^.<\n(]{0,79}?)` +
    String.raw`)` +
    String.raw`(?=\s+(?:[A-Z][a-zA-Z]+|[A-Z]+)\s*:|[.<\n(]|$)`,
  "i",
);

const REJECT_RE =
  /\b(no size tag|missing size tag|no tag|on request|n\/a|n a|unknown|not specified|unspecified|tba)\b/i;

const FITS_PREFIX_RE = /^\s*(?:fits?|aprox\.?|approx\.?)\s+/i;
const TRAILING_NOISE_RE = /\s+(?:women(?:'s)?|men(?:'s)?|unisex|kids?)\s*$/i;
const FROM_TO_RE = /\bfrom\s+(\S+?)\s+to\s+(\S+?)\b/i;
const NUMERIC_UNIT_RE = /(\d)(IT|EU|US|UK|FR)\b/gi;
const TRAILING_PUNCT_RE = /[\s:\-.,;]+$/;

const SIZE_ATOM = "(?:\\d{1,3}\\s*(?:FR|IT|EU|US|UK)|XX?S|XX?L|[SML])";
const TRIPLET_RE = new RegExp(
  `\\b(${SIZE_ATOM}(?:\\s*[/·]\\s*${SIZE_ATOM}){1,3})\\b`,
  "i",
);

function canonicalizeLabeled(raw) {
  if (!raw) return null;
  let p = raw.trim();
  if (REJECT_RE.test(p)) return null;
  p = p.replace(FITS_PREFIX_RE, "");
  p = p.replace(TRAILING_NOISE_RE, "");
  // Cut at " fit " — body shape note, not size data.
  p = p.split(/\bfit\b/i)[0];
  // "from X to Y" -> "X-Y"
  const ft = FROM_TO_RE.exec(p);
  if (ft) p = `${ft[1].toUpperCase()}-${ft[2].toUpperCase()}`;
  // "44IT" -> "44 IT"
  p = p.replace(NUMERIC_UNIT_RE, (_, d, u) => `${d} ${u.toUpperCase()}`);
  // Cut at first comma (often introduces a clarifier).
  p = p.split(",")[0];
  p = p.replace(TRAILING_PUNCT_RE, "").trim();
  return p || null;
}

function canonicalizeTriplet(raw) {
  let p = raw.trim();
  p = p.replace(/\s*\/\s*/g, " / ");
  p = p.replace(/\s*·\s*/g, " · ");
  p = p.replace(NUMERIC_UNIT_RE, (_, d, u) => `${d} ${u.toUpperCase()}`);
  p = p.replace(/\b(xx?s|xx?l|[sml])\b/gi, (m) => m.toUpperCase());
  return p.replace(TRAILING_PUNCT_RE, "").trim() || null;
}

export function parseSizeFromBody(bodyHtml) {
  const text = stripHtml(bodyHtml);
  if (!text) return null;

  const labeled = LABEL_RE.exec(text);
  if (labeled) {
    // LABEL_RE has two capture groups: colon path (1) and no-colon path
    // (2). Exactly one matches per execution; the other is undefined.
    const cleaned = canonicalizeLabeled(labeled[1] ?? labeled[2]);
    if (cleaned) return [cleaned];
  }

  const triplet = TRIPLET_RE.exec(text);
  if (triplet) {
    const cleaned = canonicalizeTriplet(triplet[1]);
    if (cleaned) return [cleaned];
  }

  return null;
}

// ---------- Orchestrator ----------

export function parseSizes(product) {
  if (!product || typeof product !== "object") return null;
  const fromOpts = parseSizeFromOptions(product);
  if (fromOpts) return fromOpts;
  return parseSizeFromBody(product.body_html);
}
```

- [ ] **Step 4: Run tests to verify they all pass**

```bash
npm test -- app/lib/__tests__/parseSizes.test.js
```

Expected: every test PASSES.

- [ ] **Step 5: Commit**

```bash
git add app/lib/parseSizes.js app/lib/__tests__/parseSizes.test.js
git commit -m "feat(parseSizes): three-layer parser for Shopify product sizes"
```

---

## Task 3: Wire the parser into `normalizeProduct`

**Files:**
- Modify: `app/lib/shopifyFetch.js:43-103` (the `normalizeProduct` function)

The parser needs the raw Shopify product. `normalizeProduct` already has it. Add a `sizes` field to the normalized output.

- [ ] **Step 1: Add the import at the top of `shopifyFetch.js`**

Locate the existing imports near line 1 and add:

```js
import { parseSizes } from "./parseSizes.js";
```

- [ ] **Step 2: Compute `sizes` inside `normalizeProduct`**

Inside `normalizeProduct`, after the existing `variants` line (currently `app/lib/shopifyFetch.js:69`) and before the return statement, add:

```js
  const sizes = parseSizes(product);
```

- [ ] **Step 3: Add `sizes` to the returned object**

In the return literal (currently `app/lib/shopifyFetch.js:86-102`), add `sizes` alongside the existing fields. Final shape includes (existing fields elided for brevity):

```js
  return {
    shopifyId: product?.id ?? null,
    name,
    price,
    imageUrl,
    images,
    storeName: store.storeName,
    storeDomain: store.domain,
    productUrl,
    available,
    productType,
    tags,
    vendor,
    handle,
    rawDescription,
    sizes,                           // NEW
    createdAt: product?.created_at ?? null,
  };
```

- [ ] **Step 4: Commit**

```bash
git add app/lib/shopifyFetch.js
git commit -m "feat(shopifyFetch): expose parsed sizes on normalized product"
```

---

## Task 4: Cron Step-1 sync writes the `size` column

**Files:**
- Modify: `app/api/cron/route.js` — the `syncRows` map inside the per-store loop (around lines 34-46)

The cron's Step-1 sync upserts all rows including columns like `price`, `available`, `name`. Add `size` to that list. Because Step-1 is the unprotected upsert (Step-2 is the COALESCE-gated editorial one), `size` overwrites every run — which is the correct behaviour for a mechanical projection from Shopify.

- [ ] **Step 1: Locate the `syncRows` map**

Open `app/api/cron/route.js`. Find the section (around lines 34-46) that builds `syncRows` from the per-store `products`. It looks like:

```js
const syncRows = products.map((p) => ({
  shopify_id: p.shopifyId,
  handle: p.handle,
  store_domain: p.storeDomain,
  name: p.name,
  price: p.price,
  image_url: p.imageUrl,
  product_url: p.productUrl,
  available: p.available,
  synced_at: now,
  description: p.rawDescription,
}));
```

(The exact line numbers may have shifted; locate by structure, not by line.)

- [ ] **Step 2: Add the `size` field to the map**

Append a `size` line that writes the parsed array directly. supabase-js converts a JS array of strings into a Postgres `text[]` literal natively; **do not** `JSON.stringify` or `join` — that would store a string-shaped scalar in a `text[]` column and either error on insert or stash literal `'["S","M","L"]'` text as the first array element.

```js
const syncRows = products.map((p) => ({
  shopify_id: p.shopifyId,
  handle: p.handle,
  store_domain: p.storeDomain,
  name: p.name,
  price: p.price,
  image_url: p.imageUrl,
  product_url: p.productUrl,
  available: p.available,
  synced_at: now,
  description: p.rawDescription,
  size: p.sizes && p.sizes.length > 0 ? p.sizes : null,
}));
```

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/route.js
git commit -m "feat(cron): write parsed size into products.size on Step-1 sync"
```

---

## Task 5: PDP resolver — read `size` and `category` from DB, apply ONE SIZE fallback

**Files:**
- Modify: `app/lib/resolveProductDetail.js`

The current resolver computes `sizes` from `product.variants` via the broken `formatSizes`. Replace this with a pure DB read plus a category-aware fallback.

- [ ] **Step 1: Expand the `dbRow` SELECT to include `size` and `category`**

Locate the existing `Promise.all` block that runs the Shopify fetch and the Supabase products SELECT in parallel (currently `app/lib/resolveProductDetail.js:77-85`). Update the `.select()` string from:

```js
.select("brand, title, editorial_description, available")
```

to:

```js
.select("brand, title, editorial_description, available, size, category")
```

- [ ] **Step 2: Add the parseSizes import at the top of the file**

The resolver needs `parseSizes` for the live-fallback layer (covers the cron-lag window when a product was listed since the last hourly sync). Add to the imports near the top of `app/lib/resolveProductDetail.js`:

```js
import { parseSizes } from "./parseSizes.js";
```

- [ ] **Step 3: Add the `resolveSizes` helper and `looksLikeAccessory` private helper**

Just below the existing `formatSizes` function (currently `app/lib/resolveProductDetail.js:28-36`), add the new exported helper plus a small private predicate for the accessory fallback:

```js
// Accessory-class keyword regex used by the bag/accessory ONE SIZE
// fallback. Tested against `product_type` and against each tag; one
// match is enough. Kept narrow enough that a "leather skirt" with stray
// "accessories" merchandising tags doesn't trigger — the regex requires
// a noun head, not the word "accessory" alone.
const ACCESSORY_KW =
  /\b(bag|handbag|tote|clutch|backpack|purse|wallet|cardholder|sunglasses|eyewear|glasses|hat|cap|beanie|beret|scarf|shawl|stole|belt|tie|gloves|jewel(?:lery|ry)?|necklace|bracelet|earrings?|brooch|pendant)s?\b/i;

function looksLikeAccessory(product) {
  const pt =
    typeof product?.product_type === "string" ? product.product_type : "";
  if (pt && ACCESSORY_KW.test(pt)) return true;
  const tags = Array.isArray(product?.tags)
    ? product.tags
    : typeof product?.tags === "string"
      ? product.tags.split(",").map((t) => t.trim())
      : [];
  for (const t of tags) {
    if (typeof t === "string" && ACCESSORY_KW.test(t)) return true;
  }
  return false;
}

// Render-ready sizes array for the PDP. Four layers, in order. First
// non-null wins.
//
//   L1 — Stored array: `dbRow.size` is a Postgres `text[]` (hydrated to
//        a JS array by supabase-js). Wins whenever non-empty. This is
//        the steady-state path — the cron sync writes it on every run.
//
//   L2 — Live parse: re-run `parseSizes(product)` on the live Shopify
//        payload. Covers (a) the cron-lag window when a product was
//        listed since the last hourly sync (dbRow exists but `size`
//        column is null because Step-1 wasn't yet aware of this product
//        when it last ran), and (b) any row whose sync somehow skipped
//        the column. Without this layer, brand-new products would
//        render with an empty SIZE block for up to 60 minutes — a
//        visible regression vs the pre-redesign PDP, which derived
//        sizes from variants on every load.
//
//   L3 — Accessory ONE SIZE fallback. Triggered when (a) DB category is
//        "Bags & Accessories", OR (b) the live Shopify `product_type`
//        or `tags` match the bag/accessory keyword list. Branch (b) is
//        what saves uncategorized bags (DB category=NULL because the
//        enrichment classifier hasn't run on the row yet, e.g., the LV
//        Ellipse bag noted in Out-of-scope) from rendering with no
//        SIZE block.
//
//   L4 — null (PDP hides the SIZE block — honest empty).
//
// Defensive against the pre-migration row shape: if `dbRow.size` is a
// scalar string (legacy), we ignore it rather than splitting — the
// next sync will overwrite with the correct array shape.
export function resolveSizes(dbRow, product) {
  // L1
  const raw = dbRow?.size;
  const arr = Array.isArray(raw) ? raw : [];
  const parts = arr
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);
  if (parts.length > 0) return parts;

  // L2
  const live = parseSizes(product);
  if (Array.isArray(live) && live.length > 0) return live;

  // L3
  if (dbRow?.category === "Bags & Accessories") return ["ONE SIZE"];
  if (looksLikeAccessory(product)) return ["ONE SIZE"];

  // L4
  return null;
}
```

- [ ] **Step 4: Replace the variant-based `sizes` derivation with the layered call**

Currently `resolveProductDetail` computes `sizes` from variants (around `app/lib/resolveProductDetail.js:102`):

```js
const sizes = formatSizes(variants);
```

Replace that single line with:

```js
const sizes = resolveSizes(dbRow, product);
```

`product` is already in scope from the earlier `Promise.all` destructure; no additional fetch is needed.

- [ ] **Step 5: Delete the now-unused `formatSizes` export**

Remove the `formatSizes` function entirely (currently `app/lib/resolveProductDetail.js:20-36`). It is no longer called inside this file, and its only external consumer is the unit test, which we'll update in Task 6.

- [ ] **Step 6: Commit**

```bash
git add app/lib/resolveProductDetail.js
git commit -m "feat(pdp): resolveSizes (DB → live parse → accessory fallback)"
```

---

## Task 6: Update `resolveProductDetail` unit tests for the new shape

**Files:**
- Modify: `app/lib/__tests__/resolveProductDetail.test.js`

The file currently tests `formatSizes` (removed in Task 5). Replace those tests with `resolveSizes` tests covering all four layers (stored array, live parse fallback, accessory fallback, null). Keep the `stripHtml` and `nonEmpty` tests untouched.

- [ ] **Step 1: Update the imports**

Change the import block at the top of the file from:

```js
import {
  stripHtml,
  nonEmpty,
  formatSizes,
} from "../resolveProductDetail.js";
```

to:

```js
import {
  stripHtml,
  nonEmpty,
  resolveSizes,
} from "../resolveProductDetail.js";
```

- [ ] **Step 2: Replace the `formatSizes` describe block with a `resolveSizes` block**

Delete the entire `describe("formatSizes", ...)` block (currently lines 45-103) and replace it with:

```js
describe("resolveSizes", () => {
  // ---------- L1: stored array ----------

  it("returns null when dbRow is null/undefined and no product", () => {
    expect(resolveSizes(null, null)).toBe(null);
    expect(resolveSizes(undefined, undefined)).toBe(null);
  });

  it("returns the stored array verbatim for a single-entry value", () => {
    expect(resolveSizes({ size: ["S"], category: "Tops" }, null)).toEqual([
      "S",
    ]);
    expect(
      resolveSizes({ size: ["42 IT"], category: "Bottoms" }, null),
    ).toEqual(["42 IT"]);
  });

  it("preserves dual-system strings as one element (no split on /)", () => {
    expect(
      resolveSizes(
        { size: ["38 FR / M / 42 IT"], category: "Dresses & Skirts" },
        null,
      ),
    ).toEqual(["38 FR / M / 42 IT"]);
  });

  it("preserves a single seller value containing ' · ' as one element", () => {
    // The motivating regression: TEXT[] keeps this whole as one element so
    // the PDP renders `SIZE: MEN S · WOMEN M`, not `SIZES: MEN S · WOMEN M`.
    expect(
      resolveSizes({ size: ["MEN S · WOMEN M"], category: "Tops" }, null),
    ).toEqual(["MEN S · WOMEN M"]);
  });

  it("returns multi-variant arrays element-by-element", () => {
    expect(
      resolveSizes({ size: ["S", "M", "L"], category: "Tops" }, null),
    ).toEqual(["S", "M", "L"]);
  });

  it("trims whitespace around each element and drops empties", () => {
    expect(
      resolveSizes(
        { size: ["  S  ", "M", "", "  ", "L"], category: "Tops" },
        null,
      ),
    ).toEqual(["S", "M", "L"]);
  });

  it("L1 wins over L2 even when the live product has a different Size option", () => {
    const dbRow = { size: ["M"], category: "Tops" };
    const product = {
      options: [{ name: "Size" }],
      variants: [{ option1: "L" }], // contradicts L1 — DB wins
    };
    expect(resolveSizes(dbRow, product)).toEqual(["M"]);
  });

  it("L1 wins over the accessory fallback when both apply", () => {
    expect(
      resolveSizes(
        { size: ["Tote OS"], category: "Bags & Accessories" },
        null,
      ),
    ).toEqual(["Tote OS"]);
  });

  it("tolerates a stray string for legacy rows that pre-date the migration", () => {
    // Defensive: a row inserted before the TEXT→TEXT[] migration could
    // still hand back a scalar string. We treat that as 'no value' (not
    // splitting it) and fall through to L2/L3 — the next sync overwrites
    // the row with the correct array shape.
    expect(
      resolveSizes({ size: "S · M · L", category: "Tops" }, null),
    ).toBe(null);
  });

  // ---------- L2: live parse fallback ----------

  it("falls back to live parseSizes when DB size is null", () => {
    // Cron-lag window: product listed since the last hourly sync. dbRow
    // exists (or doesn't) but `size` is null/empty; the live Shopify
    // payload still has the Size option, so the PDP renders it instead
    // of showing an empty SIZE block.
    const dbRow = { size: null, category: "Tops" };
    const product = {
      options: [{ name: "Size" }],
      variants: [{ option1: "M" }],
    };
    expect(resolveSizes(dbRow, product)).toEqual(["M"]);
  });

  it("falls back to live parseSizes when dbRow itself is null", () => {
    // Unsynced product (e.g., listed after the last cron, row not yet
    // inserted). The PDP page still fetches the live product and
    // resolveSizes uses it as the only available source.
    const product = {
      options: [{ name: "Size" }],
      variants: [{ option1: "S" }, { option1: "M" }],
    };
    expect(resolveSizes(null, product)).toEqual(["S", "M"]);
  });

  it("L2 parses body_html when no Size option exists", () => {
    const dbRow = { size: null, category: "Jackets & Coats" };
    const product = {
      options: [{ name: "Title" }],
      variants: [{ option1: "Default Title" }],
      body_html: "<p>Size: 40</p>",
    };
    expect(resolveSizes(dbRow, product)).toEqual(["40"]);
  });

  // ---------- L3: accessory fallback ----------

  it("returns ['ONE SIZE'] when DB category is Bags & Accessories and no size found", () => {
    expect(
      resolveSizes({ size: null, category: "Bags & Accessories" }, null),
    ).toEqual(["ONE SIZE"]);
    expect(
      resolveSizes({ size: [], category: "Bags & Accessories" }, null),
    ).toEqual(["ONE SIZE"]);
  });

  it("returns ['ONE SIZE'] when category is null but product_type indicates a bag", () => {
    // The uncategorized-bag case (e.g. LV Ellipse with category=NULL).
    // L3 branch (b) saves it from rendering with an empty SIZE block.
    const dbRow = { size: null, category: null };
    const product = {
      product_type: "Handbag",
      options: [{ name: "Title" }],
      variants: [{ option1: "Default Title" }],
    };
    expect(resolveSizes(dbRow, product)).toEqual(["ONE SIZE"]);
  });

  it("returns ['ONE SIZE'] when category is null but tags indicate an accessory", () => {
    const dbRow = { size: null, category: null };
    const product = {
      tags: ["vintage", "sunglasses", "70s"],
      options: [{ name: "Title" }],
      variants: [{ option1: "Default Title" }],
    };
    expect(resolveSizes(dbRow, product)).toEqual(["ONE SIZE"]);
  });

  it("accepts a comma-joined tag string (Shopify alt shape)", () => {
    const dbRow = { size: null, category: null };
    const product = {
      tags: "vintage, scarf, silk",
      options: [{ name: "Title" }],
      variants: [{ option1: "Default Title" }],
    };
    expect(resolveSizes(dbRow, product)).toEqual(["ONE SIZE"]);
  });

  it("does NOT trigger accessory fallback on a non-accessory product", () => {
    // A leather skirt with merchandising tags must not silently become
    // ONE SIZE. The keyword regex matches noun heads (bag/hat/belt/...)
    // not the generic word "accessory".
    const dbRow = { size: null, category: null };
    const product = {
      product_type: "Skirt",
      tags: ["accessory-collection-2024", "leather"],
      options: [{ name: "Title" }],
      variants: [{ option1: "Default Title" }],
    };
    expect(resolveSizes(dbRow, product)).toBe(null);
  });

  // ---------- L4: null ----------

  it("returns null when no layer matches", () => {
    expect(
      resolveSizes(
        { size: null, category: "Tops" },
        {
          product_type: "Top",
          options: [{ name: "Title" }],
          variants: [{ option1: "Default Title" }],
          body_html: "<p>A linen top.</p>",
        },
      ),
    ).toBe(null);
  });
});
```

- [ ] **Step 3: Run the test file to confirm all pass**

```bash
npm test -- app/lib/__tests__/resolveProductDetail.test.js
```

Expected: every test PASSES (including the existing `stripHtml` and `nonEmpty` blocks).

- [ ] **Step 4: Run the full test suite to confirm no other breakage**

```bash
npm test
```

Expected: full suite PASSES. If any unrelated test references `formatSizes`, it will fail loudly here — fix by repointing to the new helper or removing if obsolete.

- [ ] **Step 5: Commit**

```bash
git add app/lib/__tests__/resolveProductDetail.test.js
git commit -m "test(pdp): cover sizesFromDb (replaces formatSizes tests)"
```

---

## Task 7: Cosmetic — drop `· at {storeName}` suffix below the CTA

**Files:**
- Modify: `app/components/ProductInfoPanel.js`

The current panel renders the availability row as `• AVAILABLE · AT {STORE}`. The black button two lines above already says `BUY AT {STORE}`, making the suffix redundant.

- [ ] **Step 1: Open `app/components/ProductInfoPanel.js` and locate the availability span**

Find the block (currently around `app/components/ProductInfoPanel.js:71-83`) that renders the availability dot and label:

```jsx
<div className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
  <span
    className={`block h-1.5 w-1.5 rounded-full flex-none ${
      available ? "bg-emerald-500" : "bg-zinc-400"
    }`}
  />
  <span>
    {available ? "Available" : "Sold"}
    {brand && (
      <span className="text-zinc-400"> · at {storeName}</span>
    )}
  </span>
</div>
```

- [ ] **Step 2: Remove the redundant suffix**

Replace the inner `<span>` block with:

```jsx
<div className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
  <span
    className={`block h-1.5 w-1.5 rounded-full flex-none ${
      available ? "bg-emerald-500" : "bg-zinc-400"
    }`}
  />
  <span>{available ? "Available" : "Sold"}</span>
</div>
```

The `brand` prop is no longer consumed in this branch — check the prop destructure at the top of the component and remove `brand` from it if nothing else uses it. (Search the file for other references; if none, drop the destructure.)

- [ ] **Step 3: Commit**

```bash
git add app/components/ProductInfoPanel.js
git commit -m "feat(pdp): drop redundant '· at {storeName}' suffix below CTA"
```

---

## Task 8: Admin backfill API route

**Files:**
- Create: `app/api/admin/backfill-sizes/route.js`

Dev-only endpoint that re-fetches every active store via `fetchStoreProducts` (which now returns `sizes` on each product thanks to Task 3) and writes the parsed size into `products.size`. Mirrors the existing admin route conventions: `assertDev()` gate, service-role Supabase client.

- [ ] **Step 1: Create the route file**

`app/api/admin/backfill-sizes/route.js`:

```js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertDev } from "../_gate.js";
import { getActiveStores } from "../../../lib/stores.js";
import { fetchStoreProducts } from "../../../lib/shopifyFetch.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// One-shot backfill of the products.size column for every active store.
// Re-fetches via the same listing-endpoint path the cron uses, so the
// parsed `sizes` come from `normalizeProduct` (which calls parseSizes
// internally). Writes a scoped UPDATE — touches only the `size` column,
// never `name`/`price`/`available`/etc. — to keep this idempotent and
// safe to re-run.
//
// Dev-only: middleware.js returns 404 for `/api/admin/*` in production,
// and assertDev() is a second gate inside the handler.
export async function POST() {
  const gate = assertDev();
  if (gate) return gate;

  const stores = await getActiveStores();
  const results = [];
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  for (const store of stores) {
    let processed = 0;
    let updated = 0;
    let errors = 0;
    let fetchError = null;

    try {
      const products = await fetchStoreProducts(store);
      for (const p of products) {
        processed++;
        // Write the parsed array directly — supabase-js converts a JS
        // array of strings into a Postgres text[] literal. Do not join.
        const sizeValue =
          p.sizes && p.sizes.length > 0 ? p.sizes : null;
        const { error } = await supabase
          .from("products")
          .update({ size: sizeValue })
          .eq("store_domain", store.domain)
          .eq("handle", p.handle);
        if (error) {
          errors++;
          console.error(
            `backfill-sizes: update failed for ${store.domain}/${p.handle}:`,
            error.message,
          );
        } else {
          updated++;
        }
      }
    } catch (e) {
      fetchError = e?.message ?? String(e);
      errors++;
      console.error(
        `backfill-sizes: fetch failed for ${store.domain}:`,
        fetchError,
      );
    }

    results.push({
      domain: store.domain,
      processed,
      updated,
      errors,
      fetchError,
    });
    totalProcessed += processed;
    totalUpdated += updated;
    totalErrors += errors;
  }

  return NextResponse.json({
    totalProcessed,
    totalUpdated,
    totalErrors,
    results,
  });
}
```

- [ ] **Step 2: Smoke-test the route locally**

In one terminal:

```bash
npm run dev
```

In another:

```bash
curl -X POST http://localhost:3000/api/admin/backfill-sizes -i
```

Expected response: a JSON body with `totalProcessed`, `totalUpdated`, and a `results` array — one entry per active store, each showing per-store counts. Errors should be zero for healthy stores.

Verify the column is populated in Supabase via SQL Editor:

```sql
SELECT store_domain, count(*) total, count(size) with_size
FROM products
WHERE available = true AND hidden = false
GROUP BY store_domain
ORDER BY store_domain;
```

Expected: `with_size / total` should be high (~85-100%) for every store, matching the validated coverage from the pre-implementation survey.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/backfill-sizes/route.js
git commit -m "feat(admin): one-shot backfill route for products.size"
```

---

## Task 9: Admin backfill UI page

**Files:**
- Create: `app/admin/backfill-sizes/page.js`

Minimal dev-only page. A button that POSTs to the API route and renders the results table. Matches the visual minimalism of the existing admin pages.

- [ ] **Step 1: Create the page file**

`app/admin/backfill-sizes/page.js`:

```jsx
"use client";

import { useState } from "react";

export default function BackfillSizesPage() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function run() {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/backfill-sizes", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setResult(data);
    } catch (e) {
      setError(e?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main
      style={{
        padding: 24,
        maxWidth: 720,
        margin: "0 auto",
        fontFamily: "monospace",
        color: "#111",
      }}
    >
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>Backfill sizes</h1>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: "#444" }}>
        One-shot: re-fetch every active store via the products listing endpoint
        and write the parsed size into <code>products.size</code>. Safe to
        re-run. Touches only the <code>size</code> column.
      </p>

      <button
        onClick={run}
        disabled={running}
        style={{
          marginTop: 16,
          padding: "10px 20px",
          fontFamily: "inherit",
          fontSize: 12,
          border: "1px solid #111",
          background: running ? "#eee" : "#111",
          color: running ? "#888" : "#fff",
          cursor: running ? "default" : "pointer",
        }}
      >
        {running ? "Running…" : "Start backfill"}
      </button>

      {error && (
        <pre
          style={{
            marginTop: 16,
            padding: 12,
            background: "#fee",
            color: "#900",
            fontSize: 12,
          }}
        >
          {error}
        </pre>
      )}

      {result && (
        <div style={{ marginTop: 24 }}>
          <p style={{ fontSize: 13 }}>
            <strong>{result.totalUpdated}</strong> / {result.totalProcessed}{" "}
            products updated · {result.totalErrors} errors
          </p>
          <table
            style={{
              marginTop: 12,
              fontSize: 12,
              borderCollapse: "collapse",
              width: "100%",
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                <th style={{ padding: "6px 8px" }}>Domain</th>
                <th style={{ padding: "6px 8px" }}>Processed</th>
                <th style={{ padding: "6px 8px" }}>Updated</th>
                <th style={{ padding: "6px 8px" }}>Errors</th>
              </tr>
            </thead>
            <tbody>
              {result.results.map((r) => (
                <tr
                  key={r.domain}
                  style={{ borderBottom: "1px solid #eee" }}
                  title={r.fetchError || ""}
                >
                  <td style={{ padding: "6px 8px" }}>{r.domain}</td>
                  <td style={{ padding: "6px 8px" }}>{r.processed}</td>
                  <td style={{ padding: "6px 8px" }}>{r.updated}</td>
                  <td
                    style={{
                      padding: "6px 8px",
                      color: r.errors > 0 ? "#900" : "#444",
                    }}
                  >
                    {r.errors}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify the page renders locally**

With `npm run dev` running, open `http://localhost:3000/admin/backfill-sizes` in a browser. Click the button. The page should disable the button while running and render the results table when done.

- [ ] **Step 3: Confirm the route 404s in production**

This is covered by `middleware.js` (`/admin/:path*` returns 404 when `NODE_ENV === "production"`) and is not something to test from a dev session. The convention is the same as every other route under `app/admin/*` and `app/api/admin/*` — confirmed by the surveyed admin routes in this repo (see Task 8's reference to `_gate.js`).

- [ ] **Step 4: Commit**

```bash
git add app/admin/backfill-sizes/page.js
git commit -m "feat(admin): dev-only UI to trigger products.size backfill"
```

---

## Task 10: PR description — deploy sequence

**Files:**
- Modify: the PR description on GitHub (no repo file change)

The PR contains a schema migration that must be applied to Supabase before the app code reads the new column. Document the exact sequence so future-you (or a teammate) doesn't merge before the column exists.

- [ ] **Step 1: Update the PR description with this deploy sequence**

Append to the PR description:

```markdown
## Deploy sequence

Apply these steps in order. Steps 1 and 2 happen on Supabase **before** the merge so production never reads a column that doesn't exist and never renders an empty SIZE block on day-one traffic.

1. **Apply the schema migration** via Supabase SQL Editor.
   Paste the contents of `scripts/sql/2026-05-27-add-products-size.sql` into the SQL Editor and run. Verify with:
   ```sql
   SELECT column_name, data_type, udt_name FROM information_schema.columns
   WHERE table_name = 'products' AND column_name = 'size';
   ```
   Expected: `data_type = 'ARRAY'`, `udt_name = '_text'`.
2. **Run the backfill — required, not optional.** Populate `products.size` for all 7,280 existing rows before merge. With `npm run dev` running, visit `http://localhost:3000/admin/backfill-sizes` and click the button. Takes ~5 minutes. Confirm the post-backfill SQL coverage check (Verification section) returns non-empty `with_size` counts per store before proceeding to step 3. Skipping this step leaves a 0-60 minute transition window where every PDP renders an empty SIZE block (or `ONE SIZE` for Bags & Accessories via the L3 fallback) — visible regression for real users on every store.
3. **Merge the PR.** Vercel auto-deploys. The new PDP reads `products.size` and renders correctly.
4. **Verify on Vercel preview before merging:** see the five product-specific smoke checks in the verification section below.
```

- [ ] **Step 2: No commit — this is a GitHub PR description change**

---

## Verification

End-to-end checks on the Vercel preview deployment. The redesign spec's checklist in `docs/superpowers/specs/2026-05-27-desktop-pdp-redesign-design.md:215-238` covers structural cases. Add these size-specific checks:

### Five product smoke checks

These are the exact examples from the user's bug report. After Task 10 step 2 (backfill) completes, open each PDP on the Vercel preview and verify the SIZE block:

1. **Seyswardrobe LOEWE Amazona handbag** → `SIZE: ONE SIZE` (was: `WOMAN / B`).
   `/product/loewe-amazona-handbag?store=seyswardrobe.fr`

2. **Seyswardrobe Chrome Hearts thermal longsleeve** (regression check for the Size-option lookup) → `SIZE: S` (was: `S / MAN / A`).
   `/product/chrome-hearts-thermal-longsleeve?store=seyswardrobe.fr`

3. **L'Obscur A.F Vandevorst SS12 wedge boots** → `SIZE: 40` (was: empty).
   `/product/new-arrival-a-f-vandevorst-ss12-open-toe-leather-wedge-boots-with-side-knots-runway?store=lobscur.com`

4. **dot Comme Junya Watanabe Floral Spliced Dress** → `SIZE: S` (was: empty).
   `/product/junya-watanabe-floral-spliced-dress?store=www.dotcomme.net`

5. **Grain de Sell Miu Miu SS2001 cotton skirt** → `SIZE: 42 IT` (was: empty). Note: dual-system display `"42 IT / S"` is deferred to a Phase 2 follow-up.
   `/product/miu-miu-ss2001-pockets-cotton-skirt?store=graindesell.shop`

### Cosmetic check

On any PDP, the line below the buy button reads only `• AVAILABLE` (or `• SOLD`) — no `· AT {STORE}` suffix.

### Coverage spot-check via SQL

After the backfill runs, verify per-store coverage matches the validated targets:

```sql
SELECT
  store_domain,
  count(*) total,
  count(size) with_size,
  round(100.0 * count(size) / count(*), 1) pct
FROM products
WHERE available = true AND hidden = false
GROUP BY store_domain
ORDER BY store_domain;
```

Expected (rounded to nearest %):

| Store | Expected `pct` |
|---|---|
| atdawnparis.com | 100% |
| dolcevitahub.com | 100% |
| escoparis.com | 96-100% |
| graindesell.shop | 80-90% |
| lesarchivesparis.com | 80-90% |
| lobscur.com | 85-95% |
| numero13vintage.com | 100% |
| nuovo-paris.com | 100% (was 30% before the unlabeled-triplet pattern landed) |
| seyswardrobe.fr | 85-90% (remaining ~10% are bags/accessories caught by L3, so PDP shows `ONE SIZE`) |
| www.dotcomme.net | 95-100% |
| yourgarmentz.com | 70-80% (remaining are bags caught by L3) |

If any store falls noticeably below these ranges, inspect a sample of its missed `body_html` content to see whether a new pattern has emerged.

### Unit tests

```bash
npm test
```

Expected: every test PASSES, including the new `parseSizes` block (~35 cases — original coverage plus dedup and four heading-rejection cases from codex round 2) and the new `resolveSizes` block (~17 cases — L1 stored array, L2 live-parse fallback, L3a category-based ONE SIZE, L3b product_type/tags ONE SIZE, L4 null, plus precedence checks).

### "Honest empties" are still honest

The eight products the user verified as legitimately sizeless should still render with no SIZE block — those are products whose Supabase category is `Tops`/`Jackets & Coats`/`Dresses & Skirts`/`Sets` AND whose `size` column is `NULL`. Spot-check one:

`https://lesarchivesparis.com/products/la-perla-1990s-silk-floral-blouse` on the preview — `SIZE` block absent, page renders cleanly to the price + buy button.

---

## Out of scope (deferred or already shipped)

- **Dual-system display** (e.g. `"42 IT / S"` for Grain de Sell). Phase 2. Validated as easy to add later once the per-store parsers prove stable in production.
- **Mobile redesign.** Mobile branch reads the same `sizes` array — change is a no-op there because `sizesFromDb` returns the same shape `formatSizes` returned. The existing `sizes.join(", ")` at `app/product/[handle]/page.js:71` continues to render correctly.
- **A new size column per language unit** (e.g. `size_it`, `size_fr`). Validated as unnecessary — the seller's chosen format passes through verbatim, which is the editorial bar.
- **Re-categorising uncategorized products** (e.g. the LV Ellipse bag whose `category` is currently NULL). Out of scope — that's an enrichment-coverage issue and lives elsewhere.

---

## Self-review

- **Spec coverage:** Every numbered bug in the user's report has a task — (1) seyswardrobe garbage → Task 2 L1 + Task 5; (2) `Default Title` stores → Task 2 L2a; (3) nuovo-paris unlabeled → Task 2 L2b; (4) cosmetic suffix → Task 7. The bag-fallback (`ONE SIZE`) lives in Task 5's `resolveSizes` — covering both category-set bags (L3 branch a) and uncategorized bags via Shopify `product_type` / `tags` keyword match (L3 branch b). Migration in Task 1, wiring in Tasks 3-4, backfill in Tasks 8-9, verification in the Verification section.

- **Placeholders:** Every code block is concrete. No "implement appropriate validation" or "add error handling later." Every regex, every selector, every SQL statement is fully written.

- **Type consistency:** `parseSizes` returns `string[] | null`. `parseSizeFromOptions` returns `string[] | null` (deduped, first-seen order). `parseSizeFromBody` returns `string[] | null`. `resolveSizes(dbRow, product)` returns `string[] | null` and layers four sources in order: stored array → live `parseSizes` → accessory fallback (category OR product_type/tags) → null. The `products.size` column is `TEXT[]` (native Postgres string array) — supabase-js converts the JS array to a `text[]` literal on write and hands back a JS array on read, with no join/split or encoding in between. This eliminates the delimiter-collision class of bug (a single seller value like `"MEN S · WOMEN M"` can never be misread as two elements). `ProductInfoPanel`'s existing prop contract (`sizes: string[] | null`) is unchanged. Names align (`sizes` everywhere on the wire, `size` only as the DB column name to match the single-column convention).

- **No stale window:** because `resolveSizes` falls back to live `parseSizes(product)` when `dbRow.size` is empty, a newly listed product renders correctly the moment its PDP loads — even before the next hourly cron has written its row. The DB column is a cache for cron writes, not a hard precondition. This preserves the pre-redesign behavior of "PDP always shows seller's size when it's parseable from the live Shopify payload," while the steady-state path stays DB-only.

- **Heading-shape rejection:** `LABEL_RE` requires either `:` directly after `Size`/`Taille`/`Pointure` OR a size-shape first token (digit, S/M/L family, OS, ONE SIZE, FITS, TBD). Retail section headings like "Size and fit:", "Size & Fit:", "Size guide", "Size range:" — which a loose regex would capture as `and` / `&` / `guide` / `range` and persist into `products.size` — no longer match. Empirically validated against all positive and negative cases in the test suite (18/18 pass).

- **Frequent commits:** 9 commits across 9 tasks (migration / parser / wire-in / cron / resolver / tests / cosmetic / backfill route / backfill UI). Each is independently revertable.
