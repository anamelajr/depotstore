# Close the two brand-leak gaps in title cleaning

> Follow-on to [docs/plan-title-cleaning-fix.md](plan-title-cleaning-fix.md).

## Context

During the title-cleaning backfill ([docs/plan-title-cleaning-fix.md](plan-title-cleaning-fix.md))
we found that **brand names leak into titles** for collaboration / era-designer
pieces, and neither the live enrich path nor the planned recurring audit catches
them:

- **Live `/api/enrich`:** `cleanTitle`'s `brandInTitle` guard
  ([app/lib/cleanTitle.js:99-114](../app/lib/cleanTitle.js)) only compares the
  title against the brand the model *returned*. When a *different* allowlisted
  brand leaks (a collab partner, an era-designer), it passes:
  - id 2555 (yourgarmentz.com): chip `GUCCI`, title `"Tom Ford Shearling Jacket"`.
  - id 1893131 (seyswardrobe.fr): chip `CHROME HEARTS`, title `"Comme Des Garçons Tee"`.
- **Recurring audit:** the plan's bucket-2 predicate (single-word title from a
  ≥4-word name) cannot detect multi-word leaks like `"Comme Des Garçons Tee"`.

The one-off backfill ([scripts/backfillTitleClean.mjs:199](../scripts/backfillTitleClean.mjs))
already skips these via `titleContainsAllowedBrand(proposed)`. The task is to
close the same hole in the **live** path and in the **recurring audit**.

### Relationship to the first plan (already shipped, do not conflict)

This is a pure **extension** of the successfully-executed
[plan-title-cleaning-fix.md](plan-title-cleaning-fix.md). Every change here is
additive and must not weaken what shipped:

- **Prompt:** widen the `Remove:` rule and add a collab/era example *alongside*
  the existing TITLE rules; reconcile the line-62 give-up wording with the
  already-shipped line-58 sparse precedent. The over-compression guard (line 57,
  "never reduce to a bare noun if a descriptor exists") and the "keep a
  distinctive detail" intent are preserved verbatim.
- **Backfill:** the shipped bucket-2 `runBackfill`, its decision rules, and its
  frozen snapshot are **not touched**. New work is a new `--audit` mode, a new
  `matchesBrandLeak` predicate, new `runValidate` controls, and (follow-on) a
  separate brand-leak write set + new snapshot file.
- **No code-behavior change to `/api/enrich`, the RPC, schema, or visibility
  filters.** The only runtime change is the prompt text.

### Key finding: the live path and the backfill are asymmetric

The backfill operates on rows that **already have a valid (sparse) title**, so
"skip the rewrite, leave the existing title" is literal and safe there. But in
the live path, `cleanTitle`'s title output is **only ever written when `title`
was NULL** (the `enrich_product` RPC COALESCE-writes brand+title+category
atomically from one pass; the fast-path at [route.js:104](../app/api/enrich/route.js)
never re-runs `cleanTitle`). **There is no existing title to leave.** So a
write-time "skip" guard has no safe live meaning:

- Returning `null` (extending `brandInTitle` to the full allowlist) sends the
  row to the null branch, which **hides it at attempt 3** for
  `FILTER_BY_BRAND` / `SELF_BRANDED` / `title===null` stores — and seyswardrobe.fr
  is explicitly in the `title===null` hide branch ([route.js:298-311](../app/api/enrich/route.js)).
  That is the exact "hide on a cosmetic edge case kills legitimate rows" failure
  the plan and CLAUDE.md forbid.
- Writing brand+category but leaving `title` NULL either **loops forever**
  (the success branch never increments `enrich_attempts`, so the row re-enters
  every cycle and burns an OpenAI call each time) or, if forced to increment,
  ends as a **visible NULL-title row** — violating the homepage invariant.
- Stripping the leaked brand inline (`"Tom Ford Shearling Jacket"` →
  `"Shearling Jacket"`) works mechanically but **over-engineers**: it changes
  `cleanTitle`'s contract, needs a matched-brand variant of
  `titleContainsAllowedBrand` + re-validation + a degenerate-case fallback.

**The real live lever is the prompt, not a write-time guard** — exactly how the
plan already handled over-compression (tighten the prompt; enforce the residual
with a read-only audit; never add an inline reject that could hide inventory).
The deterministic `titleContainsAllowedBrand` check belongs in the read-only
**audit** (Gap 2), where it cannot hide anything — not in the live write path.

## Gap 1 — Live: tighten the `cleanTitle` prompt (no write-time guard)

**File:** [app/lib/cleanTitle.js](../app/lib/cleanTitle.js).

The TITLE rule at line 61 currently says `Remove: brand name` — only the brand
the model extracted. Widen it so the title carries **garment descriptors only**:

- Change `Remove: brand name` → `Remove: ALL brand / designer / label names —
  the item's own brand AND any collaborator or era-designer, even when different
  from the brand you extracted` (keep the rest of the list: `(New Arrival)`,
  `(runway)`, `(on hold)`, quoted collection names, parentheticals).
- Add one TITLE-rules example mirroring the existing style at line 57, so the
  model sees the leak being dropped while the **distinctive detail is kept**
  (consistent with the over-compression fix — never reduce to a bare noun):
  e.g. `"Gucci by Tom Ford shearling jacket" → "Shearling Jacket"`,
  `"Chrome Hearts × Comme des Garçons tee" → "Tee"`.
- **Reconcile the word-count contract in the same edit (do not skip this).** The
  prompt currently tells the model to return `{"brand":"","title":""}` if it
  "cannot produce a clean **2-7 word** title"
  ([cleanTitle.js:62](../app/lib/cleanTitle.js)), yet line 58 — shipped by the
  first plan — already blesses a 1-word result for a genuinely-sparse source
  (`ACNE STUDIOS - Sweater → Sweater`). Removing a collaborator / era-designer
  can legitimately leave a 1-word noun (`Tee`), so the new examples sit on the
  line-58 side of that contradiction. Make the floor explicit: **a single
  descriptive noun is a valid title when the source is genuinely sparse after
  brand/designer removal — do NOT return empty for it.** The code already
  accepts 1-word titles (`titleValid` requires only `titleWords <= 7`, no lower
  bound — [cleanTitle.js:88](../app/lib/cleanTitle.js)); the risk is purely that
  the model obeys the literal "2-7 word" wording, returns empty → `cleanTitle`
  null → the live route's `title === null` hide at attempt 3
  ([route.js:298-311](../app/api/enrich/route.js)). That is the exact
  hide-on-cosmetic failure this plan exists to avoid, so it is fixed in the
  prompt up front, not left for after-the-fact validation to catch.
  - **Non-regression (first plan stays intact).** This only aligns the line-62
    *give-up threshold* with the already-shipped line 58; it does **not** loosen
    the over-compression rule. Line 57 ("never reduce to a bare garment noun if
    the source has a usable descriptor") still governs rich sources, so a
    detail-bearing name still yields `Shearling Jacket`, never bare `Jacket`.
    The 1-word allowance is scoped to genuinely-sparse-after-removal cases only.

**Keep the existing `brandInTitle` echo guard as-is** ([cleanTitle.js:108-114](../app/lib/cleanTitle.js)).
Do **not** widen it to the full allowlist — that returns `null`, which hides.
The residual (model occasionally still leaks despite the prompt) is accepted at
write time and swept by the audit, exactly parallel to over-compression.

This is a prompt change to a live model, so it is validated by sampling
(below), not by deterministic unit tests.

## Gap 2 — Recurring audit: add the brand-leak predicate (read-only)

The plan's "Enforcement & monitoring" recurring audit currently flags only
bucket-2 (over-compression). Add a **second predicate** that flags titles
containing an allowlisted brand token, so collab/era leaks surface for sweeping.

**Implement in JS, not SQL.** `titleContainsAllowedBrand` normalizes via
`normalizeBrand` (accent-strip, `&`→`and`, punctuation→space) over `BRANDS`
(157 entries). A pure-Postgres `title ~* '(...)'` regex cannot reproduce that
normalization without drift (`alaïa`/`alaia`, `dolce & gabbana`/`dolce and
gabbana`). Reuse the JS function for exact parity and a single source of truth
(`app/brands.js`):

```js
// audit predicate (read-only) — mirror of matchesBucket2's shape
function matchesBrandLeak(row) {
  return row.available === true && row.hidden === false &&
         row.title != null && titleContainsAllowedBrand(row.title);
}
```

**Home (detection):** add a read-only `--audit` report mode to
[scripts/backfillTitleClean.mjs](../scripts/backfillTitleClean.mjs) that reuses
`fetchAllRows()` and reports the **union** of `matchesBucket2` and
`matchesBrandLeak` ids (writes nothing). This is detection only — it surfaces a
candidate list. The existing bucket-2 `runBackfill` and its frozen snapshot are
**left untouched**; `--audit` is a new, additive mode. (Wiring an actual cron is
out of scope; this gives the predicate a concrete, runnable home as the plan
intended.)

**Remediation (brand-leak rows need their OWN bounded write set).** The shipped
backfill cannot fix what this audit finds, and that is by design: its write set
is `frozen bucket-2 snapshot ∩ matchesBucket2`
([backfillTitleClean.mjs:147-158](../scripts/backfillTitleClean.mjs)), and
brand-leak titles are **multi-word** (`Comme Des Garçons Tee`), so they fail
`matchesBucket2` (which requires `wordCount(title) === 1`) and are absent from
the bucket-2 snapshot. Pointing the audit at "the same sweep" would report real
leaks forever while the backfill never touches them, leaving COALESCE-locked
leaked titles visible. So remediation **mirrors** the bucket-2 machinery as a
**separate, additive** path (the shipped bucket-2 logic and snapshot are never
modified):
1. Review the `--audit` brand-leak output and freeze the approved ids into a
   **new** `docs/snapshots/<date>-brand-leak-targets.json` (same role as the
   bucket-2 snapshot — the hard blast-radius ceiling).
2. Add a brand-leak write set bounded to
   `frozen brand-leak snapshot ∩ matchesBrandLeak`, re-cleaning each row with the
   tightened prompt and writing **title only** under the identical CAS
   (`.eq("title", oldTitle)`) + stale-source (`.eq("name", oldName)`) guards.
   The existing `SKIP:brand_in_title` guard still applies: a row whose re-clean
   still leaks is left as-is and stays flagged (limitation 2 below).
Until that snapshot + write set is wired, the audit is **detection-only** and
the leaked titles persist — stated honestly rather than implying an automatic
fix. Building that snapshot + write set can be a follow-on; this plan defines
its shape so detection is never mistaken for remediation.

**Document two limitations** in the plan doc:

1. **Substring false positives.** `titleContainsAllowedBrand` is substring, not
   token-bounded, so short normalized brands (`ami`, `mm6`, `ysl`, `424`) hit
   incidentally — e.g. `"Ceramic Vase Top"` flags via `ami` ⊂ "cer**ami**c"
   (confirmed). This is acceptable: the audit is a **review flag**, never an
   auto-fix or hide. Do not redesign the function — single source of truth with
   the live `brandInTitle`/backfill logic.
2. **Sweep depends on the prompt.** The backfill *skips* (`SKIP:brand_in_title`)
   any row whose re-clean still leaks, so the audit→backfill loop only *fixes* a
   leak when the tightened prompt yields a clean re-clean. A persistently-leaking
   residual **stays flagged**, not silently rewritten.

## Validate the prompt change

Add collab/era-designer positive controls to `runValidate()` in
[scripts/backfillTitleClean.mjs:98-143](../scripts/backfillTitleClean.mjs) (the
`--validate`, no-DB-write path), e.g. the GUCCI/Tom Ford jacket and the
Chrome Hearts × CDG tee. Confirm the tightened prompt **drops the foreign brand
while keeping the garment detail** (`"Shearling Jacket"` — not bare `"Jacket"`,
not `"Tom Ford…"`; `"Tee"`). This is the guard that the brand-strip wording
doesn't regress the over-compression work. The existing sparse + good-multiword
controls remain as the no-invention / no-regression check.

**The collab-sparse case (`Chrome Hearts × CDG tee → Tee`) is a BLOCKING
control:** a `null` / empty result for it is a **failure**, not an acceptable
sample outcome — it means the word-count contract is still pushing the model to
empty (the hide-path risk above) and the prompt must be re-tightened before
shipping. Distinguish a real contract failure from a transient API
`SKIP:openai_null` by re-running the single control before concluding.

## Critical files

- [app/lib/cleanTitle.js](../app/lib/cleanTitle.js) — widen the `Remove: brand name`
  TITLE rule + add a collab/era example. Keep `brandInTitle` echo guard as-is.
- [scripts/backfillTitleClean.mjs](../scripts/backfillTitleClean.mjs) —
  **additive only:** add `matchesBrandLeak` + a read-only `--audit` report mode
  + collab/era controls to `runValidate()`; (follow-on) a separate brand-leak
  write set bounded to a new snapshot. The shipped bucket-2 `runBackfill`,
  decision rules, and its frozen snapshot are not modified.
- New `docs/snapshots/<date>-brand-leak-targets.json` (follow-on) — the reviewed
  brand-leak id ceiling; sibling to the bucket-2 snapshot, which is untouched.
- [app/lib/brand.js](../app/lib/brand.js) — `titleContainsAllowedBrand` reused
  verbatim (no change).
- [docs/plan-title-cleaning-fix.md](plan-title-cleaning-fix.md) — update
  Track-2 prompt section, "Enforcement & monitoring" (add the brand-leak
  predicate + "why no inline brand-leak write guard" note mirroring the
  over-compression rationale), and the Diagnostic SQL section (add the JS
  brand-leak predicate; note the SQL-regex normalization caveat). Considered
  and rejected: inline strip / null-return write guards.

## Verification

1. `node scripts/backfillTitleClean.mjs --validate` — new collab/era controls
   drop the foreign brand and keep the detail; the collab-sparse control
   (`Chrome Hearts × CDG tee → Tee`) returns a non-empty 1-word title (a
   `null`/empty there is a **blocking failure** — re-tighten the word-count
   wording); sparse + good-multiword controls unchanged (no invented detail, no
   regression of the first plan).
2. `node scripts/backfillTitleClean.mjs --audit` — read-only; review the
   union'd bucket-2 + brand-leak flagged set. Writes nothing.
3. (Optional) On the Vercel preview branch, inspect a re-cleaned card via the
   preview tools — chip shows the brand, title carries no label name.
4. No schema/RPC change; no column that gates visibility is touched — **nothing
   hides**. The only runtime change is the prompt text the live model receives.

## Notes / risks

- The prompt affects **all** future enrichment; the `--validate` regression
  sample (good + sparse titles) is the guard against trading brand-leak removal
  for over-compression or invented detail.
- No write-time behavior changes in `/api/enrich` — the live fix is purely the
  prompt, so the hide gates, retry/attempt accounting, and homepage invariant
  are untouched.
- Branch + Vercel preview; do not push to `main`. Merge only on explicit
  instruction.
