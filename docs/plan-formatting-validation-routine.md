# Scheduled site formatting validation

## Context

There is no automated check that items on the site are correctly formatted.
`enrich-health.yml` polls `/api/health/enrich`, but that only alarms when OpenAI
stops responding — it says nothing about whether the titles and brands actually
written to the DB meet the house convention. The only formatting audit that
exists, `scripts/auditTitles.py`, is a hand-run one-off from the 2026-08-01
repair.

Measured against production while planning — **8,013 items genuinely live**
(`available AND NOT hidden AND price <> '€0.00'`; see the zero-price note under
Reuse) — the gap is real:

- **76 live items have `category IS NULL`** with `enrich_attempts >= 3` —
  enrichment permanently gave up. They appear in the unfiltered feed but drop
  out of every category filter. Concentrated in chezsnowbunny.fr, then
  graindesell.shop and dolcevitahub.com.
- **5 malformed titles**: one dangling `… Boots By` (id 14953917), and four
  sub-line prefixes ahead of the season code — `London SS87 …` (14880839),
  `Tao FW07 …` (14881061), `Boutique FW96 …` (14937632), `Y's FW11 …`
  (15239796).
- **4 brand families split across spellings**, filtering as separate brands:
  `A.P.C`/`A.P.C.` (29 rows), `Y-PROJECT`/`Y/PROJECT` (13),
  `A.F VANDEVORST`/`A.F. VANDEVORST` (7), `J.W. ANDERSON`/`JW ANDERSON` (3).

Goal: a recurring, read-only check that surfaces these classes automatically and
names the offending items — **without** firing on newly-synced rows whose
enrichment simply hasn't run yet.

**The quiet-on-new-arrivals requirement needs no time window.** The enrich queue
already encodes the distinction as a fact on the row:

| Row state | Meaning | Behaviour |
|---|---|---|
| editorial field NULL, `enrich_attempts < 3` | still queued | **silent** |
| editorial field NULL, `enrich_attempts >= 3` | enrichment gave up | **report** |
| field written but malformed | standardisation failed | **report** |

`MAX_ENRICH_ATTEMPTS = 3` (`app/api/enrich/route.js:25`). All 76 current
offenders are past it; **zero** are still queued.

Scope confirmed with user: **report only** — no writes, no auto-requeue,
respecting the write-once editorial invariant in CLAUDE.md.

## Approach

Mirror the existing `enrichHealth` pattern: pure evaluation logic in `app/lib/`,
a thin authed read-only route, a GitHub Actions workflow polling it. The
addition is that the workflow files results as a **GitHub issue** naming the
items, so the notification email is readable rather than "job failed".

Findings are reported in **two tiers**:

- **Violations** — rules known to be precise. These drive the issue lifecycle
  and are the only thing that can email you.
- **Review** — one deliberately fuzzy check (below). Rendered in its own section
  of the issue body, excluded from the change fingerprint, never emails on its
  own.

### Reuse — the rules must not become a second source of truth

Every violation check composes an existing helper. No regex is reinvented:

| Check | Reuses |
|---|---|
| visibility (incl. the €0.00 exclusion) | `withVisibility` (`app/lib/productQueries.js:16`) |
| brand name leaked into title | `titleLeaksAllowedBrandStrict` (`app/lib/brand.js:209`) |
| uncompacted season code (`SS2004`, `S/S 04`, `Fall/Winter 2003`) | `normalizeSeasonCodes(t) !== t` (`app/lib/seasonCodes.js:62`) — position-preserving and idempotent, so inequality *is* the violation |
| season not first, overlong year, bare letter-year, decade-with-season | `manualReviewFlags` (`app/lib/seasonCodes.js:110`) |
| non-canonical brand label | `canonicalBrand(b) !== b` (`app/lib/brand.js:79`) — catches `A.P.C` |
| split brand family | fold distinct stored labels through `normalizeBrand` + whitespace-strip, the two-pass fold `isAllowedBrand` uses (`app/lib/brand.js:142`); catches `JW`/`J.W.`, `Y-`/`Y/` |
| over 7 words, trailing `By` | mirrors `validateCleanTitleResult` (`app/lib/cleanTitle.js:30`) |

**Critical: use `withVisibility`, not a hand-rolled `available/hidden` pair.**
It already applies the `€0.00` read-time exclusion (`excludeZeroPrice`,
`productQueries.js:29`) that hides the "NOT FOR SALE" rental pieces. A
hand-rolled filter over-reports by ~130 rows that no visitor can see — that
discrepancy is exactly how the first draft of these numbers was wrong.

Remaining checks with no existing helper — parenthetical, `\s-\s` sub-line dash
— port from `scripts/auditTitles.py:classify`.

The four `season_not_first` hits are really **sub-line leaks** (`Tao`, `Y's`,
`Boutique`, `London` — cf. `SUB_LINE_PREFIXES` / `stripSubLinePrefix`,
`app/lib/handleFallback.js:117`). Report them under a distinct `sub_line_prefix`
key when the leading token matches a known sub-line for that brand, falling back
to `season_not_first` otherwise — otherwise the alert misdescribes the fix.

### The review tier: off-allowlist brand leaks

`titleLeaksAllowedBrandStrict` can only see the 147 houses in `app/brands.js`.
Verified: `titleLeaksAllowedBrandStrict("Calvin Klein 205w39nyc Cow-boy Leather
Boots By")` returns **false** — Calvin Klein is not on the list. That title is
caught today only by the incidental trailing `By`; strip the `By` and **no rule
fires at all**.

Detection without a new hand-maintained wordlist: derive genericness from the
corpus. A capitalised title token appearing under many distinct brands is a
garment/material/colour word (`Leather`, `Wool`, `Boots` — hundreds of brands);
a token appearing under one or two is likely a proper noun (`Calvin`, `Klein`).
Flag titles containing a capitalised token below a distinct-brand threshold.

- Threshold is a guess until measured. **The first run's review list must be
  eyeballed and the threshold tuned before the check is considered done** — an
  untuned threshold is why this is review-tier and not a violation.
- No new source of truth: the generic-word set is computed from the same rows
  being scanned.

### Explicitly rejected — do not re-propose

- **Lowercase-after-hyphen capitalisation rule** (`Cow-boy` → `Cowboy`). Tested
  against production: **205 matches, and the overwhelming majority are correct
  English** — `Zip-up Hoodie`, `Zip-up Sweater`, `Trompe-loeil`. Nothing
  structural separates right from wrong here. It would be 205 false alarms on
  day one and would destroy trust in the check.
- **Mojibake detection** (`GARÃ‡ONS`): zero occurrences in production.
- **Apostrophe normalisation**: 17 curly vs 18 straight. Cosmetic, not an error.
- **Missing image / €0 price**: already handled. Zero-price rows are excluded at
  read time by design (`docs/plan-hide-zero-price-items.md`); exactly one live
  row lacks an image.
- **Heartbeat / dead-man's-switch** (user declined): accepted risk that a
  disabled workflow looks like silence. Repo activity makes GitHub's 60-day
  auto-disable unlikely.

## Files

**New — `app/lib/formattingHealth.js`**
Pure, Supabase-free, unit-testable. Exports:
- `classifyRow(row)` → violation keys for one row
- `evaluateFormattingHealth(rows)` → `{ status, violations: {key: {count, items[], truncated}}, review: {…}, silent: {queued_null}, scanned, fingerprint }`
- `fingerprintViolations(violations)` → stable hash of sorted `(key, id)` tuples

**Compute the fingerprint here, in JS — not in the workflow's shell.** It is the
single most consequential piece of logic in the design (it decides whether you
are told), and a `jq`/`sha256sum` pipeline is neither unit-testable nor
reviewable. Returning it in the response payload reduces the workflow to a
string comparison and makes verification step 6 a real test rather than a hope.
  - rows with a NULL editorial field and `enrich_attempts < 3` counted into
    `silent.queued_null` and **never** into `violations`
  - brand-fold and corpus-genericness checks run across the whole row set (both
    are inherently cross-row) inside this function, so they stay testable
  - cap `items[]` per key (~50) with a `truncated` flag; `count` stays the true
    total

**New — `app/lib/__tests__/formattingHealth.test.js`**
Follows `enrichHealth.test.js` style. Must cover at minimum: a NULL-field row
under the attempt cap yields zero violations; the same row at
`enrich_attempts = 3` yields `enrichment_failed`; each title class fires on a
real example from Context; two labels folding together report once, not twice;
`Zip-up Hoodie` produces **no** finding (regression guard for the rejected
rule); a clean row set returns `status: "ok"`; plus the fingerprint
discrimination pair in Verification step 6.

**New — `app/api/health/formatting/route.js`**
Copy the auth and shape of `app/api/health/enrich/route.js` (bearer
`CRON_SECRET`, explicit unset-secret guard, `dynamic = "force-dynamic"`).
Pages the product table via `withVisibility` at 1000 rows/request selecting
`id, store_domain, brand, title, category, enrich_attempts` (~8 requests at
current volume; each well under the 8s `authenticator` statement timeout — the
whole-table read must never become one query). Set `maxDuration = 60`.
Returns the `evaluateFormattingHealth` result plus `checked_at`.

**Paging must be keyset, not offset.** `.order("id", { ascending: true })` plus
`.gt("id", lastId)` per page, carrying the last id forward — **not**
`.range(from, to)`.

Ordering alone is not sufficient here, and the distinction matters:
`captureInventorySnapshot.js:68-75` documents this hazard already ("without it,
concurrent writes can make pages skip/duplicate rows") and solves it with an
ordered `.range()`. That is adequate *there* because the snapshot applies no
visibility filter, so a `hidden` flip cannot move a row in or out of its set.
This scan filters, and `/api/enrich` sets `hidden = true` in five places
(`route.js:315,330,386,399,412`). A row hidden between page 3 and page 4 shrinks
the filtered set, shifts every later offset down by one, and silently drops a
row. Keyset paging is immune because the cursor is a row value, not a position.

The consequence is worse than one missed row: a dropped violation changes the
fingerprint, emailing "something changed", then emailing again when it
reappears — exactly the false-alarm behaviour this design exists to prevent.

**Fail closed on any page error.** If a page query returns an error, throw and
let the route 500 (matching `captureInventorySnapshot.js:83-85`'s
`product re-read failed at offset …`). Never return a partial result set: a
short scan under-reports, and the workflow would read that as items being fixed.
Assert ids are unique across the assembled set before evaluating; a duplicate
means the cursor logic is wrong and must fail rather than double-count.

**New — `.github/workflows/formatting-audit.yml`**
Daily (e.g. `20 7 * * *`), `workflow_dispatch` on, `permissions: issues: write`.
- Add `concurrency: { group: formatting-audit, cancel-in-progress: false }` — a
  scheduled run overlapping a manual `workflow_dispatch` would otherwise race
  and can create two issues.
- Curl the endpoint with `CRON_SECRET`, URL from a new repo variable
  `FORMATTING_HEALTH_URL` (mirrors `ENRICH_HEALTH_URL`).
- **Validate the response contract before touching the issue, and fail closed.**
  Non-200 and unparseable JSON fail the job, but that is not enough: a `200`
  returning `{}` is valid JSON with no violations, which would read as all-clear
  and *close your issue*. Require `status`, `violations` and `review` objects, an
  integer `scanned`, a non-empty `fingerprint`, and `checked_at`; a missing or
  wrong-typed field fails the job and leaves the issue untouched. Violations themselves are still not a job
  failure — the issue is the alert. That keeps a red workflow meaningful and
  avoids double-notifying.
- Render JSON into a markdown body grouped by key with store + id + current
  value per item, a separate **Worth a glance** section for the review tier, and
  a fingerprint as an HTML comment.
- **The fingerprint hashes sorted `(violation_key, id)` tuples, not bare ids.**
  An id-only hash treats materially different states as identical: an item that
  swaps one violation class for another, gains a second violation, or has one of
  two violations fixed keeps the same id set and would be silently swallowed —
  breaking the guarantee that you hear about changes.
  **Deliberately excluded from the fingerprint:** the item's current field value.
  Including it would email on every bad-title→different-bad-title edit, which is
  noise in a system whose value rests on silence being trustworthy. Review-tier
  items are likewise excluded, so they can never generate mail.
- Maintain exactly one open issue labelled `formatting-audit` via `gh`:
  no open issue + violations → create; open + fingerprint changed → edit body
  **and comment** (the only path that emails); open + fingerprint unchanged →
  edit body silently; open + zero violations → edit body one last time (so the
  review section is preserved in the record) then close.
- **Create the `formatting-audit` label as a setup step**, or have the workflow
  ensure it (`gh label create … || true`) before first use. `gh issue create
  --label` fails outright against a label that does not exist, so without this
  the very first run errors.

**Docs** — add the endpoint + workflow to CLAUDE.md alongside the enrich probe;
note `FORMATTING_HEALTH_URL` under environment variables.

## Risks

- **Shared attempt cap.** `MAX_ENRICH_ATTEMPTS = 3` is a private const in
  `app/api/enrich/route.js`. The validator must not hardcode a second copy — if
  they drift, the silent/report line moves silently. Export it and import it, or
  lift it to a shared module the route imports back.
- **Review-tier threshold is unvalidated** until the first real run. Treat
  tuning it as part of the work, not a follow-up.
- **Row-count growth.** The paged scan is O(all live rows). Fine at 8k; an order
  of magnitude more moves this to a precomputed RPC. Return `scanned` so the
  trend is visible.
- **The scan is not a consistent snapshot even with keyset paging.** Keyset
  removes skips and duplicates; it does not make the read atomic. A row enriched
  mid-scan is evaluated in whichever state it was read. Acceptable — the check is
  eventually consistent by design and re-runs daily — but it means a single
  run's counts are a reading, not a transaction. Do not build anything that
  assumes otherwise.
- **First run will be loud** — ~85 items. That is the correct first reading.

## Verification

1. `npm test` — new unit tests pass alongside the existing suite.
2. Run the dev server and hit the endpoint locally with the real `CRON_SECRET`.
   Read-only, so this is safe against prod Supabase (CLAUDE.md forbids
   triggering `/api/cron` and `/api/enrich` locally — this is neither).
3. Cross-check the response against Context: expect **76** `enrichment_failed`
   (all `category`), **1** `trailing_by`, **4** sub-line/season-ordering, **4**
   split brand families, **0** `queued_null`, `scanned` ≈ **8,013**. A
   materially different count means a rule is mis-scoped — reconcile before
   merging. In particular `scanned` landing near 8,143 means `withVisibility`
   was bypassed and zero-price rows leaked in.
4. Confirm the silent path directly: find a row with a NULL editorial field and
   `enrich_attempts < 3` (read-only query) and verify it appears only under
   `silent`. If none exists at the time, assert it in the unit test instead.
5. Eyeball the review section and tune the distinct-brand threshold. It must at
   minimum surface id 14953917, and must not surface routine `Zip-up` titles.
6. **Fingerprint discrimination test** (unit-level, no network): two result sets
   with an identical id set but different violation keys must produce different
   fingerprints; the same set with only a changed field value must produce the
   same one. This is the finding that broke the "you'll hear about changes"
   guarantee — assert both directions, not just the first.
7. **Malformed-response test**: feed the workflow's parsing step a `200` body of
   `{}` and a body missing `scanned`. Both must fail the job and leave the issue
   untouched. A run that closes the issue on either is the failure mode.
8. **Keyset paging test**: assert the page loop issues `gt("id", lastId)` and
   terminates, and that a mocked page error propagates as a throw rather than a
   truncated result. Cheapest meaningful check is a fake client returning three
   pages then an error, asserting the route rejects instead of returning two
   pages' worth of findings.
9. After merge, create the `formatting-audit` label, set `FORMATTING_HEALTH_URL`,
   then `workflow_dispatch` once and confirm the issue is created naming the
   right items.
10. Re-run `workflow_dispatch` immediately: the second run must edit the issue
    **without** commenting (fingerprint unchanged). This is the anti-spam gate —
    verify it explicitly rather than assuming.

## Follow-ups (not in this change)

The ~85 existing outliers need fixing separately: the 76 uncategorised rows, the
4 brand-variant splits (2 resolvable via existing `BRAND_ALIASES` entries, 2
needing new ones), and the 5 malformed titles. Report-only was the chosen scope;
that cleanup is its own task once the check is live and trusted.
