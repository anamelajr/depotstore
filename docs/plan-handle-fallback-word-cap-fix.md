# Recover long-named uncleaned rows AND close the FILTER_BY_BRAND
# null-branch leak

## Context

On production today the homepage rotation surfaced `numero13vintage.com /
alexander-mcqueen-fw1998-joan-black-denim-mini-skirt` with its raw
uppercase Shopify name (`ALEXANDER MCQUEEN FW1998 «JOAN» BLACK DENIM MINI
SKIRT`) instead of a clean editorial title. The row in Supabase has
`title=NULL, brand=NULL, enrich_attempts=3 (MAX), available=true,
hidden=false`. `ProductCard` falls back to `name` when `title` is null
([ProductCard.js:25](app/components/ProductCard.js:25)), so the raw name
leaks straight onto the card.

Investigation surfaced **two independent invariant failures** that
combine to produce this leak:

1. The handle-fallback in [enrich/route.js:194](app/api/enrich/route.js:194)
   gates on the **raw name's** word count (`nameWords >= 1 && nameWords
   <= 7`) before any brand stripping. The McQueen mini skirt's name is
   8 words, so the fallback short-circuits even though `brandFromHandle`
   would resolve `alexander-mcqueen` immediately and `nameWithoutBrand`
   would leave 6 words — well under cleanTitle's ceiling.

2. `FILTER_BY_BRAND` stores (today: `dolcevitahub.com`) have a
   success-branch allowlist hide at [enrich/route.js:229](app/api/enrich/route.js:229)
   but **no symmetric null-branch terminal hide**. Only
   `SELF_BRANDED_STORES` gets the null-branch hide at
   [enrich/route.js:290](app/api/enrich/route.js:290). So a dolcevitahub
   row whose Shopify vendor or name passes the fuzzy sync gate
   ([shopifyFetch.js:158-170](app/lib/shopifyFetch.js:158)) but later
   yields no brand from either cleanTitle or `brandFromHandle` exhausts
   its retries and stays visible with `title=NULL` — leaking the raw
   name on the card.

Current scope (`available=true AND hidden=false AND title IS NULL AND
enrich_attempts >= 3`): **4 rows total.**

| Store | Handle | Name | Failure class |
|---|---|---|---|
| numero13vintage.com | `alexander-mcqueen-fw1998-joan-black-denim-mini-skirt` | ALEXANDER MCQUEEN FW1998 «JOAN» BLACK DENIM MINI SKIRT | (1) handle-fallback word gate too strict |
| dolcevitahub.com | `comme-des-garcons-shirt-blue-abstract-face-shirt` | Comme des Garçons Shirt Blue Abstract Face Shirt | (1) handle-fallback word gate too strict |
| dolcevitahub.com | `2000s-snake-circle-silver-925-ring` | 2000s Snake Circle Silver 925 Ring | (2) FILTER_BY_BRAND null-branch leak |
| seyswardrobe.fr | `sans-titre-6sept-_13-50` | HYSTERIC GLAMOUR | neither — brand-only name, no policy match |

`visible_uncleaned_in_flight = 0`, so without intervention these never
re-enter the enrich SELECT. The 2 rows in class (2) are the canary —
new dolcevitahub rows that survive sync but fail enrichment will
accumulate into the same bucket each cycle until the null-branch hide
is added.

## Considerations

### Two invariants are being changed

Both are scoped to the enrich route and have the same goal — keep the
homepage from ever surfacing a row whose editorial title is NULL — but
they operate on different paths:

- **Invariant A (relax):** the handle-fallback gate should bound the
  **output** title length, not the **input** name length. The brand
  prefix is stripped before the title is computed, so a long brand
  shouldn't block recovery of a short title.
- **Invariant B (add):** `FILTER_BY_BRAND` stores get a null-branch
  terminal hide at MAX exhaustion, mirroring the existing
  `SELF_BRANDED_STORES` hide. Rationale: a curated allowlist store
  whose row produced no brand from either path doesn't belong in the
  feed.

Bundled in one PR because they share a rollout window and the
verification sweep tests both. Separable if needed, but keeping them
together means one cron tick clears the entire current backlog.

### Will this affect the filtering architecture?

No filter-side change. Walked each:

- **Brand filter** (`unaccent` + `ILIKE` substring on both interleaved
  RPCs). Recovering `brand="ALEXANDER MCQUEEN"` adds the row to that
  facet — strictly additive, no schema or query change.
- **Category filter** ([categories.js](app/lib/categories.js) +
  `resolveCategoryFilter` + `CATEGORY_SLUG_TO_DB` + interleaved RPCs).
  `assignCategory` runs on the success branch, so a recovered row
  picks up category + subcategory the same way LLM-cleaned rows do.
- **Store, search, sort.** None read `title` differently when null vs
  populated; they just stop using `name` as the card fallback.
- **`withVisibility`** ([productQueries.js](app/lib/productQueries.js)).
  Unchanged. Invariant B affects which rows ARE visible, but reads the
  same `hidden = false` predicate.
- **`get_interleaved_products` RPC.** Round-robins by store, filters by
  `p_brand`/`p_category`/`p_subcategory`/`p_search`. A newly-set brand
  on the McQueen row means it now participates in brand-filtered
  queries — the intended outcome.

### Fallback title quality — matching cleanTitle's editorial bar

The first version of this plan accepted `Fw1998 «Joan» Black Denim
Mini Skirt` as the recovered title. Two problems with that:

1. cleanTitle's prompt explicitly removes "collection names in quotes,
   parentheticals" ([cleanTitle.js:59](app/lib/cleanTitle.js:59)).
   Letting the fallback bypass that rule and write `«Joan»` via the
   COALESCE RPC means a permanently inferior title — never re-cleaned
   because `title IS NOT NULL` after the first write.
2. `toTitleCase` lowercases then re-capitalizes word boundaries, so
   `FW1998` becomes `Fw1998` — wrong per the cleanTitle prompt's
   examples (`SS16 Wool Coat`, `FW99 Wide Trousers`).

The deterministic path can match cleanTitle's display invariants
without invoking the LLM. Two small additions:

- **Sanitize collection markers before the word-count check.** Strip
  `«...»`, `"..."`, `(...)`, `[...]` chunks; collapse whitespace; trim.
  Then count words. This is a narrow, deterministic mirror of
  cleanTitle's prompt rule, not a duplication of its full validator
  set.
- **Preserve canonical casing for season/decade tokens** in
  `toTitleCase`. Token-level rule: `FW|SS|AW` + 2-4 digits stays upper
  ("FW1998", "SS99"); 4-digit-decade + `s` is preserved ("2000s",
  "1990s"); other tokens get standard title-case. `toTitleCase` has
  no other callers in the codebase, so this is a safe in-place
  refactor.

After sanitization, the McQueen skirt's recovered title is
`FW1998 Black Denim Mini Skirt` (5 words) — matches cleanTitle's
prompt format directly.

### Rollout sequencing — code-first, data-second

Previous draft proposed reset-on-preview, then preview enrich. Codex
flagged this as race-prone because the Supabase project is shared
between preview and prod, and the hourly cron
([.github/workflows/sync.yml:5](.github/workflows/sync.yml:5))
triggers prod `/api/cron` → `/api/enrich` on the top of the hour with
the OLD code's gate. A reset window of even one hour can let prod
re-burn the retries with the old gate, capping the row again.

Revised sequence: **merge to main → wait for prod deploy → then reset
attempts.** With the new code live on prod, the next cron tick (or a
manual enrich trigger) exercises the relaxed gate AND the new
null-branch hide on the recovered rows.

### `cleanTitle.js`'s 7-word ceiling stays untouched

Two reasons not to relax the LLM-side cap:
1. It's an editorial display constraint on the card, not a data-flow
   limit. The card's `line-clamp-2` is the real visual budget.
2. Raising it lets the LLM produce longer titles for rows that never
   needed the fallback, increasing display variance for no recovery
   benefit.

The handle-fallback gate is the surface that needed relaxing, not
cleanTitle.

### Editorial-protection invariant

Writes still go through `enrich_product` RPC with COALESCE
([CLAUDE.md](CLAUDE.md)). Recovered brand/title only lands on rows
where the field is currently NULL — never clobbers an existing
editorial value. Subcategory write remains parent-gated inside the RPC.
The sanitizer means we now write a CLEANER recovered title than before,
not a different shape of dirty title — so the COALESCE-permanence
concern is satisfied, not just acknowledged.

### Edge cases checked

1. **Brand-only name** (`name="FENDI"`, handle=`fendi-bag`). Sanitizer
   leaves the empty string from `nameWithoutBrand`. New `titleWords >= 1`
   guard rejects. Stays in null branch → no spurious write.
2. **Brand at end** (`LOAFERS GUCCI`). `nameWithoutBrand` `/g` strip
   handles it; sanitizer is a no-op; recovered title `Loafers`.
3. **Brand in middle** (`VINTAGE FENDI JACKET`). Strip + whitespace
   collapse from existing `nameWithoutBrand`; sanitizer is a no-op;
   recovered `Vintage Jacket`.
4. **Accented brand** (`Comme des Garçons Tee`). Already
   accent-insensitive ([nameWithoutBrand line 28](app/api/enrich/route.js:28));
   sanitizer doesn't change this.
5. **Whitespace-stripped brand variants** (`MiuMiu`-style handles).
   `BRAND_SET_COMPACT` upstream of `brandFromHandle`; no interaction.
6. **Nested or unbalanced quotes** (`name="(FW1998 «Joan») Black Denim
   Mini Skirt"`). Sanitizer is greedy on each delimiter class; nested
   `«»` inside `()` still gets stripped because both passes run.
   Unbalanced quote (e.g. `BLACK «JOAN BLACK MINI SKIRT`) leaves the
   stray `«` token — word count gate may still pass; the residual char
   is cosmetic. Acceptable for the deterministic safety net path;
   not a regression vs. today.
7. **Very long name after strip** (15+ words after brand removal).
   `titleWords > 7` rejects. Stays in null branch.
8. **Season-token edge cases.** `FW1998` → `FW1998`; `Ss99` → `SS99`;
   `2000s` → `2000s`; `1990S` → `1990s` (lowercase the trailing `s`
   for consistency). Year-only like `1998` is treated as a regular
   token (no `s` suffix, no season prefix) — stays as `1998`.
9. **`FILTER_BY_BRAND` null-branch race** with a concurrent sync that
   re-creates the row. Sync only refreshes `synced_at` for existing
   rows; the new `hidden = true` write won't be undone. The
   stale-delete is `successfulDomains`-scoped ([CLAUDE.md invariant](CLAUDE.md))
   so a hidden row won't be deleted.
10. **`SELF_BRANDED` + `FILTER_BY_BRAND` overlap.** The two sets are
    currently disjoint (`SELF_BRANDED_STORES = {nuovo-paris.com,
    atdawnparis.com}`, `FILTER_BY_BRAND = {dolcevitahub.com}`). If
    they ever overlap, both null-branch hides fire and the second
    UPDATE is a no-op on `hidden = true`. Safe.
11. **OpenAI token cost.** The relaxed handle-fallback runs only after
    cleanTitle has returned null — it is the no-token recovery path.
    The new null-branch hide only fires on rows that already exhausted
    their token budget. Neither change adds or saves OpenAI calls.
12. **seyswardrobe.fr's HYSTERIC GLAMOUR row** is in neither
    `SELF_BRANDED_STORES` nor `FILTER_BY_BRAND`. The new null-branch
    hide does NOT cover it. It needs a one-time manual hide today,
    AND it represents a residual leak surface if seyswardrobe ever
    sends another brand-only-name row. Out of scope for this PR
    (would require a policy decision: add seyswardrobe to a hide
    list, add a generic name-too-short-for-title gate, or accept the
    risk). Flagged for follow-up.

## Recommended fix

### Code change 1 — sanitize fallback title + relaxed gate

In [app/api/enrich/route.js](app/api/enrich/route.js), add a small
sanitizer alongside `toTitleCase` / `nameWithoutBrand`:

```js
// Mirror cleanTitle's prompt rule "remove collection names in quotes,
// parentheticals" so the deterministic fallback writes a title that
// meets the same editorial bar. Stripping is delimiter-class greedy
// (each class runs once over the string); collapse whitespace and
// trim afterward. No-op on titles without quotes/parens.
function sanitizeFallbackTitle(s) {
  return s
    .replace(/«[^»]*»/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

Refactor `toTitleCase` to preserve season/decade tokens:

```js
// Token-aware title case for the handle-fallback. Preserves canonical
// casing for season codes (FW1998, SS99, AW2000) and decade markers
// (2000s, 1990s) per cleanTitle's prompt examples. Other tokens get
// standard title case (first letter upper, rest lower). Only used by
// the handle-fallback path — no other call sites.
function toTitleCase(s) {
  return s
    .split(/\s+/)
    .map((token) => {
      if (!token) return token;
      if (/^(FW|SS|AW)\d{2,4}$/i.test(token)) return token.toUpperCase();
      if (/^\d{4}s$/i.test(token)) return token.toLowerCase();
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(" ");
}
```

Replace the gate at [enrich/route.js:192-211](app/api/enrich/route.js:192):

```js
const handleBrand = brandFromHandle(row.handle);
if (handleBrand) {
  // Bound the OUTPUT title's word count, not the input name's. The
  // brand is stripped first, so a wordy brand prefix shouldn't block
  // recovery of a short title.
  const fallbackTitle = sanitizeFallbackTitle(
    toTitleCase(nameWithoutBrand(row.name, handleBrand))
  );
  const titleWords = fallbackTitle.split(/\s+/).filter(Boolean).length;
  if (titleWords >= 1 && titleWords <= 7) {
    result = {
      brand: handleBrand.toUpperCase(),
      title: fallbackTitle,
    };
    isHandleFallback = true;
    console.log(
      `[enrich] handle-fallback recovered ${row.store_domain}/${row.handle} → ${result.brand}`
    );
  }
}
```

The existing `if (fallbackTitle.length > 0)` collapses into the
`titleWords >= 1` check — same effect, one comparison.

### Code change 2 — FILTER_BY_BRAND null-branch terminal hide

In the else (null) branch at [enrich/route.js:290-299](app/api/enrich/route.js:290),
add a second conditional after the existing `SELF_BRANDED_STORES`
block (do NOT collapse into one condition — keeping them separate
makes the two policies' rationales explicit at the call site, and the
two store lists may diverge later):

```js
// Existing — SELF_BRANDED null-branch hide
if (
  SELF_BRANDED_STORES.has(row.store_domain) &&
  row.enrich_attempts + 1 >= MAX_ENRICH_ATTEMPTS
) {
  await supabaseAdmin
    .from("products")
    .update({ hidden: true })
    .eq("id", row.id);
  rejected++;
}

// NEW — FILTER_BY_BRAND null-branch hide. Mirrors the SUCCESS-branch
// allowlist gate at line 229: a curated allowlist store whose row
// yielded no brand from cleanTitle OR brandFromHandle has nothing to
// place it in the feed. Same MAX-exhaustion deferral pattern as the
// SELF_BRANDED hide above: a transient OpenAI hiccup should not be
// the trigger.
if (
  FILTER_BY_BRAND.has(row.store_domain) &&
  row.enrich_attempts + 1 >= MAX_ENRICH_ATTEMPTS
) {
  await supabaseAdmin
    .from("products")
    .update({ hidden: true })
    .eq("id", row.id);
  rejected++;
}
```

### Data fix — sequenced AFTER prod deploy

Run these via Supabase SQL Editor (MCP is read-only per CLAUDE.md)
**only after** the PR is merged AND Vercel has deployed prod. Snapshot
the four rows before either UPDATE.

1. Reset the two recoverable rows (handle-fallback now resolves them
   with the relaxed gate):
   ```sql
   UPDATE products
   SET enrich_attempts = 0
   WHERE (store_domain, handle) IN (
     ('numero13vintage.com',
      'alexander-mcqueen-fw1998-joan-black-denim-mini-skirt'),
     ('dolcevitahub.com',
      'comme-des-garcons-shirt-blue-abstract-face-shirt')
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
   Matches the pattern at
   [enrich/route.js:248](app/api/enrich/route.js:248): set both
   `hidden = true` AND `enrich_attempts = MAX` so cron's
   content-churn reset doesn't re-queue them.

The dolcevitahub snake ring would also be hidden automatically by the
new null-branch gate the next time it cycles through enrich, but
manual SQL clears the current backlog immediately without waiting for
its next selection (which requires `enrich_attempts < MAX`, only
triggered by a cron-side content-churn reset).

## Critical files

- [app/api/enrich/route.js](app/api/enrich/route.js) — three hunks:
  add `sanitizeFallbackTitle`, refactor `toTitleCase`, replace
  handle-fallback gate (~lines 192-211), add `FILTER_BY_BRAND`
  null-branch hide (~line 300).
- [app/lib/cleanTitle.js](app/lib/cleanTitle.js) — untouched. LLM
  quality gate stays at 7 words.
- [app/lib/brand.js](app/lib/brand.js) — `brandFromHandle`,
  `BRAND_HANDLE_SLUGS`, `isAllowedBrand` reused as-is.
- [app/lib/shopifyFetch.js](app/lib/shopifyFetch.js) — read-only
  reference (the fuzzy sync gate that admits the rows now covered by
  invariant B).
- [app/lib/selfBranded.js](app/lib/selfBranded.js) and
  [app/lib/stores.js](app/lib/stores.js) — read-only.

## Verification

### Pre-merge (local + preview)

1. **Unit tests** for the new gate and sanitizer:
   - `ALEXANDER MCQUEEN FW1998 «JOAN» BLACK DENIM MINI SKIRT` +
     handle `alexander-mcqueen-fw1998-joan-black-denim-mini-skirt`
     → `{brand: "ALEXANDER MCQUEEN", title: "FW1998 Black Denim Mini
     Skirt"}` (5 words, «JOAN» stripped, FW1998 preserved).
   - `Comme des Garçons Shirt Blue Abstract Face Shirt` + handle
     `comme-des-garcons-shirt-blue-abstract-face-shirt` →
     `{brand: "COMME DES GARÇONS", title: "Shirt Blue Abstract Face
     Shirt"}`.
   - `FENDI` + handle `fendi-bag` → null (brand-only name).
   - 15-word descriptive name with brand-bearing handle → null
     (stripped title > 7 words).
   - `(NEW ARRIVAL) DIOR HOMME WOOL COAT` + handle `dior-homme-wool-coat`
     → `{brand: "DIOR HOMME", title: "Wool Coat"}` (parenthetical
     stripped).
   - `toTitleCase` direct: `"FW1998 BLACK DENIM"` → `"FW1998 Black
     Denim"`; `"2000s RING"` → `"2000s Ring"`; `"ss99 Coat"` → `"SS99
     Coat"`.
2. **Push branch → wait for Vercel preview.** Verify build passes;
   the preview deploy itself does not need to be exercised against
   the DB because verification happens post-merge to avoid the race
   Codex flagged.

### Post-merge (prod)

3. **Confirm prod deploy is live.** Check the Vercel deployment URL
   reports the new commit SHA.
4. **Run the two SQL statements** from the Data fix section. Snapshot
   the four rows first.
5. **Trigger one enrich pass** manually (faster than waiting for the
   next hourly cron):
   ```
   curl -H "Authorization: Bearer $CRON_SECRET" \
     https://depotstore-tau.vercel.app/api/enrich
   ```
6. **Sweep query — must return 0:**
   ```sql
   SELECT COUNT(*) FROM products
   WHERE available = true AND hidden = false
     AND title IS NULL AND enrich_attempts >= 3;
   ```
7. **Verify the McQueen skirt rendered title:**
   ```sql
   SELECT title, brand, category, subcategory, hidden
   FROM products
   WHERE store_domain = 'numero13vintage.com'
     AND handle = 'alexander-mcqueen-fw1998-joan-black-denim-mini-skirt';
   ```
   Expected: `title = 'FW1998 Black Denim Mini Skirt'`, `brand =
   'ALEXANDER MCQUEEN'`, `category` set, `hidden = false`.
8. **Verify the dolcevitahub snake ring is hidden:**
   ```sql
   SELECT hidden, enrich_attempts FROM products
   WHERE store_domain = 'dolcevitahub.com'
     AND handle = '2000s-snake-circle-silver-925-ring';
   ```
   Expected: `hidden = true, enrich_attempts = 3`.
9. **Filter regression spot-check on prod** — pick three feed combos:
   - `/feed?brand=Alexander+McQueen` — McQueen skirt now appears
     with the recovered title.
   - `/feed?store=numero13` — set unchanged plus the now-clean skirt
     title.
   - `/feed?category=bottoms` — McQueen skirt joins (after
     `assignCategory` runs on the recovered row).
10. **Invariant-B forward check** — observe the next 1-2 hourly cron
    runs in `enrich_runs` (or logs) to confirm no new dolcevitahub
    rows accumulate in the `visible_uncleaned_no_brand` bucket. The
    new null-branch hide is preventative; the sweep query at step 6
    should stay at 0 indefinitely (modulo the seyswardrobe residual
    flagged as out-of-scope edge case 12).
