# Recover long-named rows that the handle-fallback gate is silently
# rejecting

## Context

On production today the homepage rotation surfaced `numero13vintage.com /
alexander-mcqueen-fw1998-joan-black-denim-mini-skirt` with the raw
uppercase Shopify name (`ALEXANDER MCQUEEN FW1998 «JOAN» BLACK DENIM MINI
SKIRT`) instead of a clean editorial title. The row in Supabase has
`title=NULL, brand=NULL, enrich_attempts=3 (MAX), available=true,
hidden=false`. `ProductCard` falls back to `name` when `title` is null
([ProductCard.js:25](app/components/ProductCard.js:25)), so the raw name
leaks straight onto the card.

Cause: the handle-fallback in [enrich/route.js:194](app/api/enrich/route.js:194)
gates on the **raw name's** word count (`nameWords >= 1 && nameWords <= 7`)
before any brand stripping. The McQueen mini skirt's name is 8 words, so
the fallback short-circuits even though `brandFromHandle` would resolve
`alexander-mcqueen` immediately and `nameWithoutBrand` would leave a
6-word title (`FW1998 «JOAN» BLACK DENIM MINI SKIRT`) well under the
cleanTitle quality-gate ceiling.

Scope (`available=true AND hidden=false AND title IS NULL AND
enrich_attempts >= 3`): **4 rows total.**

| Store | Handle | Name | Recoverable? |
|---|---|---|---|
| numero13vintage.com | `alexander-mcqueen-fw1998-joan-black-denim-mini-skirt` | ALEXANDER MCQUEEN FW1998 «JOAN» BLACK DENIM MINI SKIRT | yes — handle brand + 6 stripped words |
| dolcevitahub.com | `comme-des-garcons-shirt-blue-abstract-face-shirt` | Comme des Garçons Shirt Blue Abstract Face Shirt | yes — handle brand + 5 stripped words |
| dolcevitahub.com | `2000s-snake-circle-silver-925-ring` | 2000s Snake Circle Silver 925 Ring | no — no allowlisted brand anywhere |
| seyswardrobe.fr | `sans-titre-6sept-_13-50` | HYSTERIC GLAMOUR | no — brand-only name, no title content possible |

`visible_uncleaned_in_flight = 0`, so without intervention these four
never re-enter the enrich SELECT (gated on `enrich_attempts < MAX`).

## Considerations

### Why the 7-word gate exists today

The same `<= 7 words` constant appears in two places:

- [cleanTitle.js:86](app/lib/cleanTitle.js:86) — bounds the **LLM
  output** title. This is the editorial ceiling for what fits the card.
- [enrich/route.js:194](app/api/enrich/route.js:194) — bounds the
  **input name** before computing the fallback title. This was meant
  to keep the fallback's title shape in sync with cleanTitle's ceiling,
  but it conflates two different things: input length vs output length.

The handle-fallback already strips the brand phrase first
([nameWithoutBrand](app/api/enrich/route.js:27)), so the right
invariant is on the post-strip length — bounding pre-strip length
artificially rejects every row where the brand happens to be wordy
(`ALEXANDER MCQUEEN`, `COMME DES GARÇONS`, `MAISON MARTIN MARGIELA`,
`YOHJI YAMAMOTO POUR HOMME`, etc.).

### Will this affect or ruin the filtering architecture?

No. Walked each filter:

- **Brand filter** (`unaccent` + `ILIKE` substring through both
  interleaved RPCs). Recovering `brand="ALEXANDER MCQUEEN"` adds the
  row to that brand's facet — strictly additive, no schema or query
  change.
- **Category filter** ([categories.js](app/lib/categories.js) +
  `resolveCategoryFilter` + `CATEGORY_SLUG_TO_DB` + the two interleaved
  RPCs). Category is assigned by [`assignCategory`](app/api/enrich/route.js:256)
  during the success branch, so a recovered row gets a category too.
  No filter-side change.
- **Store filter, search, sort.** None read `title` differently when
  it's null vs populated; they just stop falling back to `name` on the
  card.
- **`withVisibility`** ([productQueries.js](app/lib/productQueries.js)).
  Untouched. The change happens entirely inside the enrich success
  branch and only affects rows that were already visible.
- **`get_interleaved_products` RPC.** Round-robins by store and
  filters by `p_brand`/`p_category`/`p_subcategory`/`p_search`. A
  newly-set brand on the McQueen row means it now participates in
  brand-filtered queries; this is the intended outcome.

### `FILTER_BY_BRAND` interaction (dolcevitahub.com)

dolcevitahub.com IS in [`FILTER_BY_BRAND`](app/lib/shopifyFetch.js:8).
The CDG SHIRT row recovers `brand="COMME DES GARÇONS"`
(`brandFromHandle` returns the allowlist phrase, not the raw slug —
only "Comme des Garçons" is in [brands.js:8](app/brands.js:8); "Comme
des Garçons Shirt" is not). That brand passes `isAllowedBrand`, so
the allowlist gate at [enrich/route.js:229](app/api/enrich/route.js:229)
keeps the row visible. Correct behavior preserved.

The "2000s snake ring" row at dolcevitahub.com is unrecoverable —
`brandFromHandle` returns null on a brandless handle, the handle
fallback short-circuits, and the row stays in the
`failed → tally → null branch` path. dolcevitahub is not in
`SELF_BRANDED_STORES`, so the null-branch hide at
[enrich/route.js:290](app/api/enrich/route.js:290) does not fire. It
needs a manual hide (see Data fix below).

### Editorial-protection invariant

Writes still go through `enrich_product` RPC with COALESCE
([CLAUDE.md invariants](CLAUDE.md)). A recovered brand/title only
lands on a row where `brand`/`title` is currently NULL — never
clobbers an existing editorial value. Subcategory write remains
parent-gated inside the RPC. No invariant change.

### `cleanTitle.js`'s 7-word ceiling stays untouched

Two reasons not to relax the LLM-side cap:
1. It's an editorial display constraint on the card, not a data-flow
   limit. The card's `line-clamp-2` is the real visual budget.
2. Raising it would let the LLM produce longer titles for rows that
   never needed the fallback, increasing display variance for no
   recovery benefit.

The handle-fallback's separate gate is the right surface to relax.

### Things this fix deliberately does NOT do

- **Does not strip collection markers like «JOAN».** The handle-fallback
  is a deterministic safety net, not a content cleaner. cleanTitle's
  LLM prompt strips parentheticals and quoted collection names; the
  fallback intentionally does not duplicate that logic (avoiding a
  second source of truth). The recovered title for the skirt will read
  `Fw1998 «Joan» Black Denim Mini Skirt`. That's a real but small
  cosmetic compromise vs. the current state (full brand line leaking).
- **Does not raise `MAX_ENRICH_ATTEMPTS`.** A row that genuinely cannot
  be cleaned should stop costing OpenAI calls. The fix recovers rows
  that the deterministic path could always have handled — no LLM
  retries needed.
- **Does not introduce a brand-in-title guard inside the fallback.**
  `brandFromHandle` uses `BRAND_HANDLE_SLUGS` (longest-first match)
  and `nameWithoutBrand` strips every occurrence whole-word with the
  `/g` flag ([1222428](https://github.com/anamelajr/archiveapp/commit/1222428)).
  Existing tests cover the brand-at-start, brand-at-end,
  brand-in-middle, accent-insensitive, and brand-only cases.

### Edge cases checked

1. **Brand-only name** (e.g. `name="FENDI"`, handle=`fendi-bag`).
   `nameWithoutBrand` → empty string. Caught by the existing
   `if (fallbackTitle.length > 0)` guard at line 202. Stays in the
   null branch.
2. **Very long name** (e.g. 15 words). New gate bounds the
   **stripped** title, so noisy or descriptive long names still fail
   the gate (>7 words after strip) and stay in the null branch.
3. **Brand at end** (`LOAFERS GUCCI`). Already covered by existing
   `nameWithoutBrand` behavior — global match removes both leading
   and trailing brand occurrences; new gate still passes the resulting
   1–2 word title.
4. **Accented brand stripping** (`Comme des Garçons Tee`). The strip
   is accent-insensitive ([nameWithoutBrand line 28](app/api/enrich/route.js:28));
   new gate doesn't change this.
5. **Whitespace-stripped variants** (`MiuMiu`-style handles). Handled
   by `BRAND_SET_COMPACT` upstream of `brandFromHandle`; no
   interaction with the fallback gate.
6. **Race against concurrent enrich runs.** `enrich_product` RPC uses
   COALESCE inside the UPDATE; a parallel success cannot be clobbered.
7. **OpenAI token cost.** The fallback runs only when cleanTitle has
   already returned null — it is the no-token recovery path. The
   change does not add or save OpenAI calls; it changes only what
   happens after a null return.

## Recommended fix

### Code change — single hunk in `app/api/enrich/route.js`

Move the word-count check from the **input name** to the **stripped
title**. Compute the fallback title first, then gate on its word count.

Today ([enrich/route.js:192-211](app/api/enrich/route.js:192)):

```js
const handleBrand = brandFromHandle(row.handle);
const nameWords = row.name.trim().split(/\s+/).length;
if (handleBrand && nameWords >= 1 && nameWords <= 7) {
  const fallbackTitle = toTitleCase(
    nameWithoutBrand(row.name, handleBrand)
  );
  if (fallbackTitle.length > 0) {
    result = {
      brand: handleBrand.toUpperCase(),
      title: fallbackTitle,
    };
    isHandleFallback = true;
    console.log(...);
  }
}
```

Proposed:

```js
const handleBrand = brandFromHandle(row.handle);
if (handleBrand) {
  const fallbackTitle = toTitleCase(
    nameWithoutBrand(row.name, handleBrand)
  );
  const titleWords = fallbackTitle
    .split(/\s+/)
    .filter(Boolean).length;
  if (titleWords >= 1 && titleWords <= 7) {
    result = {
      brand: handleBrand.toUpperCase(),
      title: fallbackTitle,
    };
    isHandleFallback = true;
    console.log(...);
  }
}
```

The `if (fallbackTitle.length > 0)` guard collapses into the new
`titleWords >= 1` check — same effect, one comparison.

Add a one-line comment above the gate explaining why the word count is
measured on the stripped title (the invariant we care about is output
length, not input length; a wordy brand prefix should not block
recovery).

### Data fix — manual SQL via Supabase SQL Editor (per CLAUDE.md workflow)

After the code change ships to a preview:

1. Reset the two recoverable rows so the next enrich pass re-attempts
   them via the now-relaxed gate:
   ```sql
   UPDATE products
   SET enrich_attempts = 0
   WHERE (store_domain, handle) IN (
     ('numero13vintage.com', 'alexander-mcqueen-fw1998-joan-black-denim-mini-skirt'),
     ('dolcevitahub.com', 'comme-des-garcons-shirt-blue-abstract-face-shirt')
   );
   ```
2. Hide the two unrecoverable rows (no allowlisted brand reachable
   from name OR handle):
   ```sql
   UPDATE products
   SET hidden = true, enrich_attempts = 3
   WHERE (store_domain, handle) IN (
     ('dolcevitahub.com', '2000s-snake-circle-silver-925-ring'),
     ('seyswardrobe.fr', 'sans-titre-6sept-_13-50')
   );
   ```
   This matches the existing pattern at
   [enrich/route.js:248](app/api/enrich/route.js:248) (set both
   `hidden` and `enrich_attempts=MAX` so cron's content-churn reset
   doesn't re-queue them).

Snapshot the four rows before either UPDATE per the CLAUDE.md
destructive-run rule.

## Critical files

- [app/api/enrich/route.js](app/api/enrich/route.js) — the single
  code hunk (lines 192–211).
- [app/lib/cleanTitle.js](app/lib/cleanTitle.js) — untouched;
  invariant ceiling stays 7 words on the LLM path.
- [app/lib/brand.js](app/lib/brand.js) — `brandFromHandle`,
  `BRAND_HANDLE_SLUGS`, `isAllowedBrand` reused as-is.
- [app/lib/selfBranded.js](app/lib/selfBranded.js) — `SELF_BRANDED_STORES`
  read-only reference.
- [content/homepage-edit.json](content/homepage-edit.json) — empty
  array; today's rotation is the date-seeded fallback. No edit
  needed.

## Verification

1. **Local unit check** — Add (or extend) a unit test for the
   handle-fallback gate:
   - `ALEXANDER MCQUEEN FW1998 «JOAN» BLACK DENIM MINI SKIRT` +
     handle `alexander-mcqueen-fw1998-joan-black-denim-mini-skirt`
     → recovered `{brand: "ALEXANDER MCQUEEN", title: "Fw1998 «Joan»
     Black Denim Mini Skirt"}`.
   - `Comme des Garçons Shirt Blue Abstract Face Shirt` + handle
     `comme-des-garcons-shirt-blue-abstract-face-shirt` →
     recovered `{brand: "COMME DES GARÇONS", title: "Shirt Blue
     Abstract Face Shirt"}`.
   - `FENDI` + handle `fendi-bag` → still null (brand-only name).
   - 15-word descriptive name + brand-bearing handle → still null
     (stripped title >7 words).
2. **Preview deploy** — push branch, wait for Vercel preview, run
   the manual SQL on production Supabase **only after** preview
   passes (DB is shared between preview and prod).
3. **Trigger one enrich pass** — `curl -H "Authorization: Bearer
   $CRON_SECRET" https://<preview>.vercel.app/api/enrich`. The two
   reset rows should appear in the next batch SELECT, hit the
   relaxed fallback, write via `enrich_product` RPC, and surface
   on the next homepage fetch with clean titles.
4. **Post-merge sweep** — re-run the original diagnostic query:
   ```sql
   SELECT COUNT(*) FROM products
   WHERE available=true AND hidden=false
     AND title IS NULL AND enrich_attempts >= 3;
   ```
   Expected: 0.
5. **Filter regression spot-check on preview** — pick three feed
   filter combos to confirm nothing changed:
   - `/feed?brand=Alexander+McQueen` — McQueen skirt now appears.
   - `/feed?store=numero13` — same set as before plus the now-clean
     skirt title (was already visible).
   - `/feed?category=bottoms` — McQueen skirt joins after
     `assignCategory` re-runs.
