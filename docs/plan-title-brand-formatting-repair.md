# Title & Brand Formatting Repair — Diagnosis + Fix Plan

## Context

Broken product titles/brands surfaced on the site (e.g. brand `YVES SAINT LAURENT` with title
`Ysl Rectangular Metal Ysl Logo Temples Glasses`; `Top - FW10`; `Shorts - Red`;
`Black - FW14 Heavy Wool Suspender Skirt`). The agreed convention (OpenAI prompt in
`app/lib/cleanTitle.js` + `docs/plan-season-code-standardization.md`) is
`[Season first, compact] [detail] [Garment]` — e.g. `FW10 Top` — ≤7 words Title Case, no brand names.

**Root cause (full audit of all 7,882 visible rows + git history of PRs 94–98):**

- **No single recent PR broke title output.** PR #98's `normalizeSeasonCodes` is position-preserving
  by documented design — it compacted `Top - FW2010` → `Top - FW10`, making pre-existing junk look
  *canonical* but never reordering. PR #94 (2026-07-26, vendor-veto fix) is the **amplifier**: it took
  chezsnowbunny.fr from 0 → 784 imported rows, flooding enrichment with names that hit two
  **pre-existing holes**:
  1. **Fallback-path hole** (`app/api/enrich/route.js` ~166-196 + `app/lib/handleFallback.js`):
     `nameWithoutBrand` strips only the full brand phrase, so alias tokens (`YSL` when brand resolved
     to "Yves Saint Laurent") and sub-line words (`CDG BLACK/GIRL`, `RICK OWENS DRKSHDW`,
     `ANN DEMEULEMEESTER BLANCHE`) survive, plus dangling ` - ` separators. `toTitleCase` then yields
     `Ysl …`, `Black - FW14 …`, `Drkshdw - …`.
  2. **Model-path guard hole** (`app/lib/cleanTitle.js:106-117`): the brand-leak guard skips tokens
     <4 chars, so `YSL` passes; era-designer leaks (`Gucci By FW96 …` under TOM FORD) and trailing
     `… By` also pass.
- **Brand `YVES SAINT LAURENT`**: PR #95 built `BRAND_ALIASES`/`canonicalBrand` for
  Cavalli/Versace/Dior but left the YSL family out; `app/brands.js` lists "Saint Laurent",
  "Yves Saint Laurent", "YSL" as three separate allowlist entries. `brandFromHandle` sorts slugs
  longest-first, so `yves-saint-laurent` always wins.

**Audit results (visible rows as of 2026-08-01; full id lists in
[`docs/snapshots/2026-08-01-title-audit.json`](snapshots/2026-08-01-title-audit.json)):**
36 brand-word-in-title · 16 season-not-first · 10 dash titles · 9 lowercase-after-slash ·
5 trailing "By" · 27 null-title (treviseparis, likely mid-queue — verify only).
Brand splits: SAINT LAURENT 119 / YVES SAINT LAURENT 165 / YSL 1; MAISON MARGIELA 141 /
MAISON MARTIN MARGIELA 20 / MARGIELA 5 / MARTIN MARGIELA 2; CDG accent variants 5+10;
GIANFRANCO FERRÉ 38 / FERRE 19; COURRÈGES/COURREGES; ALEXANDER McQUEEN casing; FAYÇAL/FAYCAL AMOR.

**User decisions:** canonical label `SAINT LAURENT`; merge ALL split brand families; junk titles get
NULL-out + re-enrich through the hardened guards.

---

## Phase A — Code fixes (one branch, PR before any data repair)

### A1. `app/lib/brand.js` — extend `BRAND_ALIASES`

```js
"YVES SAINT LAURENT": "SAINT LAURENT",
"YSL": "SAINT LAURENT",
"SAINT LAURENT PARIS": "SAINT LAURENT",
"COMME DES GARCONS": "COMME DES GARÇONS",
"COMME DES GARCONS HOMME PLUS": "COMME DES GARÇONS HOMME PLUS",
"FERRE": "GIANFRANCO FERRÉ",
"FERRÉ": "GIANFRANCO FERRÉ",
"MCQUEEN": "ALEXANDER MCQUEEN",
"FAYCAL": "FAYÇAL AMOR",
```
(Margiela family, COURREGES, GIANFRANCO FERRE, FAYCAL AMOR aliases already exist.)
Also add new export `brandSpellings(brand)` → `[canonical, ...alias keys mapping to it]`.
**Do NOT alias sub-line words** (BLACK/GIRL/DRKSHDW/BLANCHE) — they'd poison `brandFromHandle`.

### A2. `app/brands.js` — allowlist dedupe (same commit)

Remove `"Yves Saint Laurent"`, `"YSL"`, `"Margiela"` (now alias keys); dedupe literal duplicates
(`"Courrèges"`, `"Lanvin"`, `"Helmut Lang"`). **Keep `"MM6"`** — genuine diffusion line.

### A3. `app/lib/handleFallback.js` — fallback-path hygiene (route only composes)

1. In the route's fallback, strip **every** spelling from `brandSpellings(handleBrand)`, not just one.
2. New `stripSubLinePrefix(title, brand)` — conservative per-brand map keyed by `canonicalBrand`:
   `RICK OWENS: [DRKSHDW, LILIES]`, `COMME DES GARÇONS: [BLACK, GIRL, HOMME PLUS, HOMME, SHIRT, PLAY, TAO]`,
   `ANN DEMEULEMEESTER: [BLANCHE]`, `MAISON MARGIELA: [MM6]` — matches only leading `^X\s*-\s*`.
3. New `collapseDanglingDash(title)` — remove leading/trailing/orphaned ` - ` artifacts.
4. New `seasonToFront(title)` — if exactly one `(FW|SS|AW)\d{2}(/\d{2})?` token exists and isn't
   first, move it to front. **Fallback path only; lives here, never in `seasonCodes.js`**
   (its position-preserving contract + zero-write backfill tests must keep passing).
5. `toTitleCase`: title-case each `/`-separated segment in the generic branch
   (`wool/silk` → `Wool/Silk`); season-code guards already return before this branch.

### A4. `app/lib/cleanTitle.js` — model-path guard hardening

Extract post-parse validation (lines ~89-121) into exported `validateCleanTitleResult(parsed, rawTitle)`:
1. Strip trailing ` By` (repair, don't reject).
2. Guard 2 filter becomes `t.length >= 4 || SHORT_BRAND_TOKENS.has(t)` with
   `SHORT_BRAND_TOKENS = new Set(["ysl", "mm6", "cdg"])`.
3. Additionally reject via `titleLeaksAllowedBrandStrict(parsed.title)` (import from `brand.js`,
   word-bounded write blocker — catches `Gucci By FW96 …` under TOM FORD, `Ysl Logo` under
   SAINT LAURENT). Reject → null → retryable, same economics as existing guards.

### A4b. Shared choke-point gate (Codex adversarial-review finding — accepted)

A4 alone is bypassable: `cleanTitle` null (including a guard *reject*) triggers the handle
fallback (`route.js:157-197`), which strips only the handle brand's spellings — a foreign-brand
leak (`Gucci …` under a `tom-ford-*` handle) survives and the COALESCE write makes it permanent.
The production trailing-By rows (`2000s Gucci Black Leather Pants By`) are this bypass having
already fired; without this gate, B3's re-enrich would regenerate them and Phase C would never
converge for that class.

Fix: at the shared choke point (`route.js` ~211, next to `canonicalBrand`/`normalizeSeasonCodes`),
run `titleLeaksAllowedBrandStrict(newTitle)` against **both producers'** output. On failure, skip
the write (treat like the existing word-count bail: row retries, then exhausts → hidden/null).
Do NOT instead split `cleanTitle`'s null into reject-vs-transient — CLAUDE.md pins that null as
uniformly retryable. Known cost: a few genuine collab-era rows exhaust to null/hidden instead of
getting a title — consistent with the "hidden beats junk" stance; they're in the manual-review
list anyway.

### A5. Tests

- Extend `app/lib/__tests__/brand.test.js`: `canonicalBrand("YSL"/"Yves Saint Laurent") === "SAINT LAURENT"`,
  McQueen/CDG/Ferré cases, `isAllowedBrand` still true for removed entries,
  `brandFromHandle("ysl-…")` canonicalizes, `brandSpellings` contents.
- Extend `app/lib/__tests__/handleFallback.test.js`: YSL name → no `Ysl` in title;
  `RICK OWENS DRKSHDW - COTTON TANK TOP` → `Cotton Tank Top`;
  `COMME DES GARÇONS BLACK - FW2014 HEAVY WOOL SUSPENDER SKIRT` → `FW14 Heavy Wool Suspender Skirt`;
  `toTitleCase` slash cases; season-code tokens untouched; `seasonToFront` no-ops (already-first, two tokens).
- New `app/lib/__tests__/cleanTitle.test.js` for `validateCleanTitleResult`: trailing-By strip,
  YSL reject, `Gucci By FW96 …` reject, `Silk Camisole` accept (ami false-positive pin), echo reject.
- `seasonCodes.test.js` untouched and green.
- A4b regression (route-level): raw name `2000s Gucci Black Leather Pants By Tom Ford` with handle
  `tom-ford-…` and a null model result → fallback title is **blocked** by the choke-point gate
  (nothing written); i.e. a title the model guard rejects cannot re-enter via handle fallback.

## Phase B — One-time data repair (AFTER Phase A deploys; SQL via Supabase SQL Editor — MCP is read-only; snapshot `products` first)

### B1. Brand relabels (plain UPDATE is safe here: targets are non-NULL, so COALESCE writers are no-ops on them; no `hidden`/`available` scope — relabel everything)

```sql
UPDATE products SET brand = 'SAINT LAURENT'    WHERE brand IN ('YVES SAINT LAURENT','YSL');
UPDATE products SET brand = 'MAISON MARGIELA'  WHERE brand IN ('MARGIELA','MARTIN MARGIELA','MAISON MARTIN MARGIELA');
UPDATE products SET brand = 'COMME DES GARÇONS'            WHERE brand = 'COMME DES GARCONS';
UPDATE products SET brand = 'COMME DES GARÇONS HOMME PLUS' WHERE brand = 'COMME DES GARCONS HOMME PLUS';
UPDATE products SET brand = 'GIANFRANCO FERRÉ' WHERE brand IN ('GIANFRANCO FERRE','FERRE','FERRÉ');
UPDATE products SET brand = 'COURRÈGES'        WHERE brand = 'COURREGES';
UPDATE products SET brand = 'ALEXANDER MCQUEEN' WHERE brand IN ('McQUEEN','ALEXANDER McQUEEN');
UPDATE products SET brand = 'FAYÇAL AMOR'      WHERE brand IN ('FAYCAL','FAYCAL AMOR');
```
Run `SELECT brand, count(*)` per family before/after. Feed impact nil (brand filter is ILIKE substring).

### B2. Mechanical title repairs — new `scripts/backfillTitleRepairs.mjs`

Clone the `backfillSeasonCodes.mjs` safety model (dry-run default, `--apply`, per-row CAS
`.eq("id", id).eq("title", oldTitle)`); transform composes the A3 helpers (no second source of truth).
Classes: dash-suffix season reorder (`Top - FW10` → `FW10 Top`, `Silk Dress - SS07` → `SS07 Silk Dress`),
slash-casing (`Wool/silk` → `Wool/Silk`, token-local, don't re-case whole titles).

### B3. Junk titles — NULL-out + re-enrich (user-approved)

Mechanism confirmed: enrich batch SELECT picks `brand|title|category IS NULL` + `enrich_attempts < 3`;
NULLed titles re-enter the hourly queue and go through `cleanTitle` with the new guards. ~60–90 rows.

```sql
-- Bucket 1: brand correct, title junk (Ysl…, sub-line dashes, brand-leak, trailing By,
-- free-form season-not-first, "Shorts - Red"):
UPDATE products SET title = NULL, enrich_attempts = 0 WHERE id IN (…from docs/snapshots/2026-08-01-title-audit.json…);
-- Bucket 2: brand also wrong (e.g. "Dior - B23" under 1017 ALYX 9SM): full editorial reset —
-- subcategory must reset with category (products_subcategory_matches_category CHECK):
UPDATE products SET brand=NULL, title=NULL, category=NULL, subcategory=NULL, enrich_attempts=0
WHERE id IN (…);
```
Manual-review exclusions (flag, don't auto-reset): the two `MM6 …` titles under MAISON MARGIELA
(brand should possibly BE `MM6`), `Hermes By Martin 1990s Silk Cardigan Top` (Margiela Hermès era).

### B4. 27 treviseparis null-title rows — verify only

`SELECT enrich_attempts, count(*)` for them; if `attempts < 3` they're mid-queue → no action;
only if stuck at 3, reset attempts.

## Phase C — Verification

1. `npx vitest run` + `npm run build` before PR.
2. `node scripts/backfillTitleRepairs.mjs` dry-run → review → `--apply` → re-run dry expecting zero changes (idempotence).
3. After 1–2 hourly crons, re-run the read-only audit script
   (`scripts/auditTitles.py`, reads anon creds from `.env.local`): all violation classes ≈ 0 on
   visible rows; one label per brand family;
   `enrich_runs` shows normal null-rate and `remaining` draining to 0.
4. Never trigger `/api/cron` or `/api/enrich` locally (CLAUDE.md).

## Rollout order

1. Branch → A1-A5 → PR → merge (on user instruction) → Vercel deploy.
2. SQL Editor: snapshot → B1 relabels.
3. B2 backfill dry → apply.
4. B3 NULL-outs (only after deploy, so re-enrich hits new guards) → B4 check.
5. Wait 1–2 cron cycles → Phase C audit.

## Invariant notes

- Reordering lives in fallback-only helper, never `seasonCodes.js` (position-preserving contract kept).
- Fallback stays deterministic (static alias/sub-line tables, no model).
- B1 plain UPDATEs are safe because targets are non-NULL (COALESCE writers can't clobber them) —
  state this in the PR since CLAUDE.md's wording is absolute.
- No schema/RPC changes.
