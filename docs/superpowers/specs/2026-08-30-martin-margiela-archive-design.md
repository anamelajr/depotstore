# Featured Archive: Martin Margiela 1988–2009

## Context

The site has one live featured archive (Hedi Slimane) behind the home band and
`/archives/[slug]`. The user wants a second one for Martin Margiela's tenure at
his eponymous house, titled "MARTIN MARGIELA 1988–2009" (debut SS1989 shown
October 1988; departed after SS2009), formatted identically to the Slimane page.

**Data verification (done, against production Supabase):** 54 `MAISON MARGIELA`
pieces carry `era_year` in 1988–2009; **32 are currently buyable** under the
archive's exact production predicate (`withVisibility`: available + not hidden +
price ≠ €0.00). The live Slimane archive resolves to ~37 under the same
predicate, so the sizes are comparable. All Margiela brand variants are already
canonicalized to `MAISON MARGIELA` at write time ([brand.js:10](app/lib/brand.js)),
and MM6 is a separate brand value, so it's excluded automatically. **Brand-alias
audit (production, 2026-08-30):** an `ilike '%margiela%'` sweep returns exactly
two stored brand values — `MAISON MARGIELA` (277) and `MM6 MAISON MARGIELA` (1);
zero rows remain under `MARGIELA`/`MARTIN MARGIELA`/`MAISON MARTIN MARGIELA`
(history was normalized by `scripts/sql/2026-08-01-b1-brand-relabels.sql`), so
the exact `.eq("brand", …)` rule misses nothing today.

**Identity audit of the 54 matches (done, row by row):** `era_year` is a
heuristic parse ([parseEra.js](app/lib/parseEra.js)) — any year/season token in
title/name, with no judgment — so re-editions dated by the season they
reproduce land inside the window. The audit found exactly 7 false positives,
excluded below: 6 Margiela × H&M pieces (2012 collab, post-Martin, each titled
with the original season it re-editions) and 1 Hermès-by-Martin-Margiela piece
(Martin's Hermès tenure, not Maison Margiela — user chose to exclude). After
exclusions: **47 in-window pieces, 29 currently buyable.**

**Decisions made with the user:**
- **Membership: strict era rule only** — `{ brand: "MAISON MARGIELA", eraStart: 1988, eraEnd: 2009 }`.
  No `eraYearNull` attribution rule: unlike "Hedi Slimane", a "Martin" mention in
  Margiela copy is usually just the label name (the house was called "Maison
  Martin Margiela" until 2015, six years post-tenure — e.g. the un-dated
  Margiela × Converse piece is from the 2013 collab). Verified un-dated pieces
  can be hand-added later via the entry's `include` list.
- **Hero image: none for now** — the user will supply one later. The hero must
  tolerate a null image (text-only desktop hero); this is a small, arguably
  on-brand change given Margiela's anonymity.
- Unlike Dior/Galliano, the whole 1988–2009 window at Maison Margiela IS
  Martin's tenure, so no attribution token is needed on the era rule.

## Changes

### 1. `app/lib/archives.js` — flip the placeholder entry live

Replace line 25's inert `{ name: "MARTIN MARGIELA", years: "1999–2008", live: false }`
with a full live entry (keeping its position — first in band order):

```js
{
  live: true,
  slug: "martin-margiela",
  name: "MARTIN MARGIELA",
  years: "1988–2009",
  tenureLine: "Maison Martin Margiela 1988–2009",
  // No portrait yet — Margiela famously never appears in photographs. The
  // hero renders text-only until the curator supplies an image.
  image: null,
  imageAlt: null,
  editorialSlug: null,
  description: "<draft below — user copy, English-only>",
  rules: [
    // The entire window is Martin's own tenure — no competing designer, so
    // no attribution token (contrast the Dior/Galliano rule above). Un-dated
    // pieces are NOT pulled by a "martin" mention: the house kept the name
    // "Maison Martin Margiela" until 2015, so the token doesn't attribute era.
    // excludeAttribution keeps the known false-positive CLASS out durably:
    // 2012 H&M re-editions and Hermès-tenure pieces parse into the window via
    // the original season in their copy, and handle-pinned excludes wouldn't
    // survive a relisting.
    {
      brand: "MAISON MARGIELA",
      eraStart: 1988,
      eraEnd: 2009,
      excludeAttribution: ["h&m", "h & m", "hermes", "hermès"],
    },
  ],
  include: [],
  // Identity-audit exclusions (2026-08-30): era_year dates re-editions by the
  // season they reproduce, so the 2012 Margiela × H&M collab pieces parse into
  // the window; the Hermès piece is Martin's, but at Hermès. Future H&M /
  // re-edition listings will leak the same way — the rule can't express
  // "not a re-edition", so curation stays manual via this list.
  exclude: [
    { storeDomain: "dolcevitahub.com", handle: "2000s-maison-margiela-h-m-shearling-beige-reversible-long-jacket" },
    { storeDomain: "dolcevitahub.com", handle: "ss2005-maison-margiela-x-h-m-reversed-denim-jacket-re-edition-1" },
    { storeDomain: "dolcevitahub.com", handle: "ss2005-maison-margiela-x-h-m-reversed-denim-jacket-re-edition-3" },
    { storeDomain: "dolcevitahub.com", handle: "aw2006-maison-margiela-re-edition-h-m-silver-steel-no-dial-watch" },
    { storeDomain: "dolcevitahub.com", handle: "2006-maison-margiela-h-m-upside-brown-leather-shoulder-bag" },
    { storeDomain: "dolcevitahub.com", handle: "ss2009-maison-margiela-h-m-re-edition-white-t-shirt" },
    { storeDomain: "lesarchivesparis.com", handle: "hermes-by-martin-margiela-1990s-silk-cardigan-top" },
  ],
},
```

Draft description (user should feel free to rewrite; it's their copy):
> "Martin Margiela redefined fashion from his Paris maison between 1988 and
> 2009 — pioneering deconstruction, exposed linings, and the artisanal
> reworking of found garments, all under a strict anonymity that made the
> clothes themselves the only statement."

### 2. `app/archives/[slug]/page.js` — tolerate a null hero image

Wrap the portrait column (the `<div className="relative hidden md:block">`
containing the `<Image>` at ~line 143–158) in `archive.image ? (…) : null`.
When there's no image, also drop the two-column grid so the copy column can
breathe: make the `md:grid-cols-[minmax(0,57fr)_43fr]` class conditional on
`archive.image` (text-only heroes keep `grid-cols-1`). Everything else (eyebrow,
name, tenureLine, description, count row, `ArchiveProductsClient`) is untouched
and works as-is.

Also `generateMetadata` and the hero copy read only string fields — no other
null-tolerance needed. The home band ([FeaturedArchives.js](app/components/home/FeaturedArchives.js))
renders name + years only and links automatically once `live: true`; no change.

### 3. `app/lib/__tests__/archives.test.js` — update the contract

- The "carries every field the page renders" test asserts `image` is a string
  starting with `/`. Relax to: `image` is either `null` or a `/`-prefixed
  string, and `imageAlt` must be a string exactly when `image` is set.
- The accessor test `getArchiveBySlug("martin-margiela")` currently expects
  `undefined` — flip it to resolve (name `"MARTIN MARGIELA"`), and keep an
  inert-slug case using one of the still-inert entries (e.g. `"rick-owens"`
  isn't a slug — use `"nope"`/`undefined` cases which remain).

### 4. `app/lib/fetchArchiveProducts.js` — support `excludeAttribution`

New optional rule field: `excludeAttribution: [tokens]` — a row is dropped when
ANY token matches `name` OR `description` (case-insensitive substring, same
columns and escaping as the positive `attribution` filter). In `runRuleQuery`,
for each token `v = escapePostgrestValue("%token%")`:

```js
q = q
  .or(`name.is.null,name.not.ilike.${v}`)
  .or(`description.is.null,description.not.ilike.${v}`);
```

**Sharp edge — BOTH columns are nullable** (`supabase/schema.sql:9`;
`normalizeProduct` writes null for a missing Shopify title, and `era_year` can
still be in-window via the enriched `title`). A bare `.not(col, "ilike", v)`
evaluates to NULL for a NULL column and silently drops the row, so each column
gets its own `col.is.null,col.not.ilike.…` OR-group. (Each `.or()` call in
supabase-js adds one OR group ANDed with the rest, so per-token/per-column
chaining composes correctly.) Both accented and unaccented "hermes" tokens are
listed because direct-table queries don't `unaccent` (only the interleaved
RPCs do).

Update the rule-shape comment block in `archives.js` (lines 17–23) to document
the new field, and extend `archives.test.js`'s "keeps every rule well-formed"
block plus `fetchArchiveProducts.test.js` with: token match in name drops the
row, token match in description drops the row, NULL name survives, NULL
description survives, both-NULL survives, and
a manual `include` still bypasses `excludeAttribution` (includes are fetched by
handle, not through the rule — expected and documented behavior; the curator's
include is an explicit override).

No RPC/SQL changes, no i18n changes (designer name/years/description
are content, never translated; surrounding labels already exist).

## Verification

1. `npx vitest run app/lib/__tests__/archives.test.js` (and the full suite).
2. `npm run dev` in this worktree (needs `.env.local` copied from the main
   checkout + `npm ci`, per memory note), then verify in the browser pane:
   - Home band: MARTIN MARGIELA 1988–2009 is now a working link.
   - `/archives/martin-margiela`: text-only hero renders correctly on desktop
     width (no empty image column artifacts) and on mobile; item count shows
     ~29 (47 in-window minus sold, minus the 7 exclusions); filter/sort bars
     work; none of the excluded H&M / Hermès pieces appear in the grid.
   - `/archives/hedi-slimane` unchanged (portrait still renders).
3. Read-path only — safe against production Supabase; no cron/enrich involved.
