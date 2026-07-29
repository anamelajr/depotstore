# Standardize season codes in product titles

## Context

The user spotted "Fw02/03 Printed Cotton Tee" on the site — the season code should be "FW02/03". Investigation found:

**Root cause — two independent gaps, both permanent because `enrich_product` is write-once (COALESCE):**
1. **OpenAI path** ([cleanTitle.js:53-63](app/lib/cleanTitle.js)): the prompt says "Title Case only" with no slashed-season examples, and the model's title is stored verbatim — no post-processing at all.
2. **Fallback path** ([handleFallback.js:15](app/lib/handleFallback.js)): `toTitleCase`'s season guard `/^(FW|SS|AW)\d{2,4}$/i` is fully anchored, so `FW02/03`, `F/W02`, `FW1998,` fall through to generic capitalization → `Fw02/03`.

**Production audit (11,024 titled rows, read-only sweep):**
- 110 miscased season codes: 108 letter-slash ("F/w 1997" — 107 from treviseparis.com, model echoed the store's naming), 2 compact ("Fw02/03", "Ss2008")
- 111 letter-slash forms total (incl. correctly-cased "S/S 2004")
- 12 spelled-out ("Fall/Winter 2003 Pants", "Autumn Winter 1997")
- 62 uppercase decades ("2000S PVC Trench Coat")
- Split/dash years: FW12/13, FW15/16, AW2013/2014, AW2001/02, FW10-11, FW88-89, FW00-01
- ~2,500+ rows mixing 2-digit and 4-digit years (SS2004 vs SS04)
- Manual-review oddities: SS19999, A2013, FW90s, 5 season-not-first titles

**User's standardization decisions:** keep both AW and FW prefixes; standardize to 2-digit years (SS2004→SS04); keep split years, uppercased (FW02/03); backfill via Node script with dry-run first.

## Implementation

### 1. New shared normalizer: `app/lib/seasonCodes.js`

Pure, idempotent, null-safe `normalizeSeasonCodes(title)`. Regex passes in order (each rewrites matched substrings in place; everything else byte-identical):

- **A. Spelled-out → prefix** (year-gated so "Indian Summer Dress" is safe):
  - `Fall/Autumn [/- ] Winter` → `FW`; `Spring [/- ] Summer` → `SS` (case-insensitive)
  - Standalone `Fall|Autumn` / `Spring` followed by a year → `FW` / `SS`, with lookbehind `(?<!Pre[-\s])` so "Pre-Fall 2014" survives. Resort/Cruise untouched by construction.
- **B. Letter-slash → compact:** `F/W`→`FW`, `S/S`→`SS`, `A/W`→`AW` (valid pairs only, must be followed by a digit run: `(?=\s*\d)`).
- **C. Canonical prefix+year (core):**
  `/\b(FW|SS|AW)\s?((?:19|20)\d{2}|\d{2})(?:\s?[\/\-]\s?((?:19|20)\d{2}|\d{2}))?(?!\d)(?!s\b)/gi`
  → uppercase prefix + last-2 digits of each year, split years joined with `/` (dominant existing form): `SS2004`→`SS04`, `Fw02/03`→`FW02/03`, `AW2013/2014`→`AW13/14`, `FW10-11`→`FW10/11`.
  Guards: `\b` + mandatory digits → "Sswing"/"Awning" safe; `(?!\d)` skips `SS19999`; `(?!s\b)` skips `FW90s` — both land in manual review instead of being half-fixed.
- **D. Decades:** `/\b((?:19|20)\d0)S\b/g` → `$1s` (`2000S`→`2000s`).

### 2. Wire into the enrich choke point

[route.js:205](app/api/enrich/route.js) — both OpenAI and fallback branches converge on `result` here; mirror `canonicalBrand`:
```js
const { brand: rawBrand, title: rawTitle } = result;
const newBrand = canonicalBrand(rawBrand);
const newTitle = normalizeSeasonCodes(rawTitle);
```
No downstream changes — `assignCategory` (line 247) and the RPC (line 259) already consume `newTitle`.

Also widen `toTitleCase`'s guard in [handleFallback.js:15](app/lib/handleFallback.js) so the fallback stops mangling before normalization:
```js
if (/^(F\/?W|S\/?S|A\/?W)\d{2,4}([\/\-]\d{2,4})?[.,]?$/i.test(token)) return token.toUpperCase();
if (/^[FSA]\/[WS]$/i.test(token)) return token.toUpperCase(); // bare "s/s" token before a year token
```

### 3. Prompt hardening (prevention layer)

[cleanTitle.js:53-63](app/lib/cleanTitle.js) TITLE rules: add "Season codes are ALWAYS uppercase, compact, 2-digit year: SS04 (never SS2004 / S/S 2004 / Ss04), split years as FW02/03; convert Fall/Winter 2003 → FW03, Spring 2000 → SS00; Pre-Fall/Resort/Cruise stay spelled out." Change "Title Case only" → "Title Case only (season codes and decade markers keep canonical casing)". Leave BRAND-rule examples (lines 42-44) alone — they describe raw inputs. The Step-2 normalizer remains the guarantee; the prompt is just cheap defense.

### 4. Backfill script: `scripts/backfillSeasonCodes.mjs`

Modeled on `scripts/backfillTitleClean.mjs` conventions (dotenv `.env.local`, `--env` override, service-role client, `fetchAllRows()` pagination by id, tab-separated report). Simpler: transform is pure/deterministic/idempotent — no OpenAI, no frozen snapshot.

- Header comment: sanctioned exception to the write-once editorial rule; applies ONLY `normalizeSeasonCodes` to existing non-null titles; never regenerates.
- Imports the normalizer from `../app/lib/seasonCodes.js` — same module as the route, one source of truth.
- Dry-run default: print `id, store_domain, old → new` for every proposed change (~2,600 expected, year-shortening dominates). `--apply` does per-row CAS: `.update({title: proposed}).eq("id", row.id).eq("title", row.title)`; count `cas_noop` on 0 rows.
- Manual-review section (printed, never written): `SS19999`-style 5+ digit codes, `A2013`, `FW90s`, season-code-not-first titles.
- Summary: scanned / would-write / unchanged / cas_noop / manual-review.

### 5. Tests (vitest, `npm test`)

**New `app/lib/__tests__/seasonCodes.test.js`** — full prod catalog: all forms above, the left-alone set (SS19999/A2013/FW90s/Pre-Fall/Resort/Cruise/`1998 Wool Coat`), non-matches (Sswing, Awning, Ferragamo), null/empty, and idempotence over every case.

**Extend `app/lib/__tests__/handleFallback.test.js`**: widened-guard cases (`Fw02/03`→`FW02/03`, `f/w02`→`F/W02`, `FW1998,` stays uppercase, bare `s/s`→`S/S`); update composition-test expectations to the 2-digit standard (e.g. McQueen canary `FW1998 …`→`FW98 …`) — deliberate expectation change, note in commit.

## Verification

1. `npm test` green.
2. Dry-run `node scripts/backfillSeasonCodes.mjs` — review the full before→after table; confirm the treviseparis block, spelled-out, decades, and dash split-years propose correctly; typos/Pre-Fall appear only under manual review.
3. Merge + deploy the route change **before** applying the backfill (so the hourly enrich can't write new non-canonical titles into a cleaned table). Never trigger `/api/enrich` locally.
4. `node scripts/backfillSeasonCodes.mjs --apply`, then re-run dry-run → expect 0 proposed writes (live idempotence proof).
5. Re-run the audit sweep (scratchpad script) → miscased/letter-slash/4-digit/uppercase-decade counts all 0 outside the manual-review set.
6. Optionally hand-fix the ~8 manual-review rows via Supabase SQL editor.

## Files

- `app/lib/seasonCodes.js` (new)
- `app/api/enrich/route.js` (~line 205)
- `app/lib/handleFallback.js` (line 15)
- `app/lib/cleanTitle.js` (lines 53-63)
- `scripts/backfillSeasonCodes.mjs` (new)
- `app/lib/__tests__/seasonCodes.test.js` (new), `app/lib/__tests__/handleFallback.test.js`
