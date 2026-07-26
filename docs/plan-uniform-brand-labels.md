# Uniform brand labelling — Cavalli, Versace, Dior

## Context

One designer can appear on Dépôt under several different labels. Measured live
(2026-07-26):

| Designer | Variants in the DB |
|---|---|
| Cavalli | `ROBERTO CAVALLI` 459 · `CAVALLI` 313 · `JUST CAVALLI` 4 |
| Versace | `VERSACE` 115 · `GIANNI VERSACE` 29 · (`ATELIER VERSACE` 1, `VERSUS VERSACE` 1 — genuinely separate lines, out of scope) |
| Dior | `DIOR` 151 · `CHRISTIAN DIOR` 34 · `DIOR HOMME` 10 |
| Alaïa | `ALAÏA` 14 · `ALAIA` 7 |

**Root cause:** `app/lib/brand.js` already keeps a `BRAND_ALIASES` table
declaring these equivalences (`"GIANNI VERSACE": "VERSACE"`, `"CHRISTIAN DIOR":
"DIOR"`, …), but that table is only consulted when *comparing* brands
(`normalizeBrand` → `isAllowedBrand`). The value actually written to the DB is
the raw `cleanTitle` model output, passed through untouched at
[`app/api/enrich/route.js:250`](app/api/enrich/route.js) (`p_brand: newBrand`).
The alias table has therefore never influenced a single stored label.

A second, narrower defect: `"Cavalli"` is an entry in the `BRANDS` allowlist
rather than an alias, so it is recognised *and* persists as its own label. That
also mangles titles — `cleanTitle` strips only "Cavalli" from
`"Just Cavalli Leo Print Top"`, leaving the stranded `"Just Leo Print Top"`.

**Outcome wanted:** one label per designer, going forward and retroactively,
with no product losing visibility and nothing deleted.

## Decisions taken (user, this session)

- Dior Homme **merges** into `DIOR` (matches what the alias table already says).
- Duplicate `/designers` directory entries **removed** for the three designers.
- The 7 unaccented `ALAIA` rows **included** in the one-off cleanup.
- Allowlist membership otherwise unchanged — no new designers admitted.

## Design

Two jobs, deliberately separate: **code fixes the future, SQL fixes the past.**

Recognition and labelling are two different jobs sharing one set
([`brand.js:70`](app/lib/brand.js), `BRAND_SET_NORMALIZED`), built from *both*
`BRANDS` entries **and** `BRAND_ALIASES` keys. Moving a name from `BRANDS` to
an alias key keeps it recognised while making it resolve to the canonical
label — the pattern already used for `"MARGIELA" → "MAISON MARGIELA"`.

Verified experimentally this session (three isolated states):

| | `isAllowedBrand("Cavalli")` | `titleContainsAllowedBrand` | `normalizeBrand` |
|---|---|---|---|
| today | true | true | `"cavalli"` |
| BRANDS entry removed, **no alias** | **false** | **false** | `"cavalli"` |
| removed **+ alias added** | true | true | `"roberto cavalli"` |

**The two edits are a pair.** Removing a `BRANDS` entry without adding the
matching alias silently stops admitting that designer at sync time.

## Code changes (one branch)

### 1. `app/lib/brand.js` — alias table

Add / retarget inside `BRAND_ALIASES`:

```js
  "CAVALLI": "ROBERTO CAVALLI",
  "JUST CAVALLI": "ROBERTO CAVALLI",
  "CAVALLI CLASS": "ROBERTO CAVALLI",   // was: "CAVALLI"
```

`"GIANNI VERSACE" → "VERSACE"`, `"CHRISTIAN DIOR" → "DIOR"`, `"DIOR HOMME" →
"DIOR"` and `"ALAIA" → "ALAÏA"` already exist — no edit needed.

### 2. `app/lib/brand.js` — new export

```js
// Canonical DISPLAY form for persistence. normalizeBrand() answers "are these
// the same brand?" (lowercased, diacritic-stripped — not displayable);
// this answers "what label do we store?". Returns the input unchanged when no
// alias applies, so non-aliased brands keep the exact cleanTitle output.
export function canonicalBrand(value) {
  if (!value || typeof value !== "string") return value;
  const upper = value.trim().toUpperCase();
  return BRAND_ALIASES[upper] ?? value.trim();
}
```

### 3. `app/brands.js` — drop the three duplicate entries

Remove `"Cavalli"` (~line 105), `"Christian Dior"` (~76), `"Gianni Versace"`
(~102). Each is (or becomes) an alias key, so recognition is preserved by
change 1; `/designers` ([`app/designers/page.js:137`](app/designers/page.js))
renders `BRANDS` directly, so this is what de-duplicates that page.

Leave `"Alaia"` / `"Azzedine Alaïa"` in `BRANDS` — `"Alaïa"` itself is not an
entry, so removing them would empty Alaïa from the directory. Alaïa is
SQL-only in this plan.

### 4. `app/api/enrich/route.js` — canonicalize at the single write point

Apply once at destructuring (~line 198) so the allowlist gate, `isSelfBranded`,
`assignCategory` and the RPC write all see the same canonical value:

```js
const { brand: rawBrand, title: newTitle } = result;
const newBrand = canonicalBrand(rawBrand);
```

Import `canonicalBrand` alongside the existing `isAllowedBrand` import from
`../../lib/stores.js` (re-exported there); add the re-export in
[`app/lib/stores.js`](app/lib/stores.js) if absent.

This is the **only** write site — cron's Step-2 upsert writes `brand: null` by
design ([`shopifyFetch.js`](app/lib/shopifyFetch.js), editorial fields stay
null at sync), so no second path needs touching.

### 5. Tests — `app/lib/__tests__/brand.test.js` (extend, 114 lines today)

- `canonicalBrand`: `"Cavalli"`/`"Just Cavalli"`/`"Cavalli Class"` → `"ROBERTO
  CAVALLI"`; `"Gianni Versace"` → `"VERSACE"`; `"Christian Dior"`/`"Dior
  Homme"` → `"DIOR"`; `"Prada"` → `"Prada"` (untouched); `null`/`""` safe.
- **Regression guard for the paired edit** — the state-B failure above:
  `isAllowedBrand("Cavalli")`, `isAllowedBrand("Christian Dior")`,
  `isAllowedBrand("Gianni Versace")` all still `true`, and
  `titleContainsAllowedBrand("Cavalli Turquoise Belt")` still `true`.

## Production SQL (user runs in Supabase SQL Editor, after deploy)

MCP is read-only per CLAUDE.md. Snapshot first. `UPDATE` only — no deletes, no
visibility change; `hidden`/`available` are untouched so nothing appears or
disappears from the feed.

```sql
-- 1. Cavalli family → ROBERTO CAVALLI  (~317 rows)
UPDATE products SET brand = 'ROBERTO CAVALLI'
WHERE brand IN ('CAVALLI', 'JUST CAVALLI', 'CAVALLI CLASS');

-- 2. Versace  (~29 rows) — ATELIER/VERSUS VERSACE deliberately excluded
UPDATE products SET brand = 'VERSACE' WHERE brand = 'GIANNI VERSACE';

-- 3. Dior, incl. the menswear line  (~44 rows)
UPDATE products SET brand = 'DIOR' WHERE brand IN ('CHRISTIAN DIOR', 'DIOR HOMME');

-- 4. Alaïa accent split  (~7 rows)
UPDATE products SET brand = 'ALAÏA' WHERE brand = 'ALAIA';

-- 5. Stranded "Just " left by stripping only "Cavalli" from the raw name.
--    Pattern-scoped to rows whose source name really is a Just Cavalli piece,
--    so titles legitimately starting with "Just" are untouched.
UPDATE products SET title = regexp_replace(title, '^Just ', '')
WHERE name ILIKE 'Just Cavalli%' AND title LIKE 'Just %';
```

Run 1–4 first and confirm the row counts roughly match the table above before
running 5.

**Rollback:** re-split is not recoverable from the label alone (a relabelled
row no longer records which variant it came from), so **snapshot `id, brand,
title` for the affected rows before running** — that snapshot is the rollback.

```sql
SELECT id, brand, title FROM products
WHERE brand IN ('CAVALLI','JUST CAVALLI','CAVALLI CLASS','GIANNI VERSACE',
                'CHRISTIAN DIOR','DIOR HOMME','ALAIA')
   OR (name ILIKE 'Just Cavalli%' AND title LIKE 'Just %');
```

## Verification

**Pre-merge (local, read-only — safe):**
1. `npx vitest run` — 331 existing + new cases pass.
2. `npm run build` passes. (Worktree needs `.env.local`; symlinked this session.)
3. Live-catalog admission unchanged — re-run the `passesBrandFilter` dry run
   against `treviseparis.com` and `chezsnowbunny.fr`: must stay **369** and
   **784** of 2,000 sampled. A drop means the paired-edit invariant broke.
4. Dev server: `/designers` shows one entry each for Dior, Versace, Roberto
   Cavalli; clicking through still returns products.

**Post-SQL (production):**
5. `/api/products?brand=cavalli` returns a single label, `ROBERTO CAVALLI`
   (~776 rows); same check for `versace` and `dior`.
6. Total visible product count is unchanged before vs after the SQL — this is
   the "nothing lost" check.
7. Spot-check a relabelled PDP: brand renders, page does not 404.
8. Next cron: new rows land canonical. `treviseparis.com` / `chezsnowbunny.fr`
   still have ~234 rows pending enrich at time of writing — those will now
   enrich straight to canonical labels.

## Out of scope (observed, not fixed)

- `ATELIER VERSACE`, `VERSUS VERSACE` — distinct lines, intentionally separate.
- The alias table's `"BELLEVILLE SASSOON" → "BELLVILLE SASSOON"` target is in
  neither `BRANDS` nor recognised (`isAllowedBrand` false for **both**
  spellings) — a pre-existing dead alias, unrelated to this change.
- `MARGIELA`, `ALAIA`, `CÉLINE` etc. remain duplicated in the `BRANDS`
  directory listing; only the three named designers are de-duplicated here.
- `FALLBACK_STORES` follow-up for the two new stores — still pending, separate.
