# Enrich: Skip Unavailable Products

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `/api/enrich` job from spending Anthropic Haiku credits on products that are sold (`available = false`) and therefore invisible in the user-facing feed.

**Background:** A diagnostic pass on 2026-05-05 found 1,545 rows in `products` with one or more NULL editorial fields. **1,362 of those (88%) are `available = false`** and never reach the feed (the feed query filters `available = true`). Under the new hourly GitHub Actions cron, these invisible rows would be re-attempted ~24× per day — roughly 27,720 wasted Haiku calls/day, mostly from the lobscur.com long-name pile that fails the 7-word title cap and stays NULL forever.

This plan implements only the minimum change to stop the bleed. It does not touch the title-cap logic, the back-pressure question, or the `assignCategory` gaps — those are separate fixes (see "Out of scope" below).

**Architecture decision — why `available = true` only (and not `hidden = false`):**

- `available` is sync state. The cron sets it from Shopify on every run. A product that becomes available again gets flipped back to `true` automatically, and enrich picks it up the next run. Filtering on `available` is self-healing.
- `hidden` is editorial state, set by the operator. A row could be hidden *because* its editorial fields are wrong/missing — skipping hidden rows from enrich would leave them stuck. We leave `hidden` alone.

So the filter is `available = true AND (brand IS NULL OR title IS NULL OR category IS NULL)`.

**Symmetry guarantee — why this can't strand "eligible-but-skipped" products:** `products.available` is a nullable `boolean` with default `true` (verified against live schema; 0 NULL rows out of 18,586 today). The feed's read path uses identical equality semantics: `.eq("available", true)` in `app/api/products/route.js` and `app/components/MoreFromStore.js`, which under PostgREST translates to `available = true` and excludes NULLs. So the set `enrich-eligible` is exactly the set `feed-visible` — any NULL row is invisible on both sides, no asymmetric regression is possible. Task 3 Step 1's verification SQL counts `available IS NULL` explicitly so a future sync regression that starts inserting NULLs is caught before it can quietly break the symmetry.

**Tech Stack:** Next.js 16 (App Router), plain JS (ESM), Supabase JS client. No test framework. Verification is `npm run build`, `npm run lint`, then a Vercel preview triggering `/api/enrich` and observing the response body.

**Verification model:** No test runner. Each task ends with `npm run build` + `npm run lint`. End-to-end verification is a manual `/api/enrich` POST against the Vercel preview deploy, comparing the `processed`/`succeeded`/`failed`/`remaining` counts against expectations derived from a SQL query.

**Files touched:**
- Modify: `app/api/enrich/route.js` (two queries: SELECT batch + remaining count)
- Modify: `scripts/test-enrich.mjs` (match the new filter so its drain check stays meaningful)
- Create: nothing
- Delete: nothing

**Out of scope (deliberately):**
- Fix #1 from the diagnostic: `last_enrich_at` / attempts back-pressure to stop retrying the 119 unparseable available rows. Worth doing, separate PR.
- Fix #3: loosening the 7-word title cap to handle lobscur's long descriptive names. Future PR.
- Fix #4: adding "Sets", "Pendant", "Tie", "Bolero" to `assignCategory`. Free-tier improvement, separate.
- Backfilling/cleaning the 1,362 unavailable NULL rows already in DB. They become inert under this change — no read path touches them. Cleanup can wait or never happen.

---

## Task 1: Add `available = true` filter to the enrich endpoint

**Files:**
- Modify: `app/api/enrich/route.js`

- [ ] **Step 1: Add `.eq("available", true)` to the batch SELECT**

In `app/api/enrich/route.js`, update the SELECT at lines 35–40 from:

```js
const { data: rows, error: selErr } = await supabaseAdmin
  .from("products")
  .select("id, handle, store_domain, name, brand, title, category, description")
  .or("brand.is.null,title.is.null,category.is.null")
  .order("id", { ascending: false })
  .limit(BATCH_SIZE);
```

to:

```js
const { data: rows, error: selErr } = await supabaseAdmin
  .from("products")
  .select("id, handle, store_domain, name, brand, title, category, description")
  .eq("available", true)
  .or("brand.is.null,title.is.null,category.is.null")
  .order("id", { ascending: false })
  .limit(BATCH_SIZE);
```

- [ ] **Step 2: Add `.eq("available", true)` to the remaining-count query**

In the same file, update the count at lines 128–131 from:

```js
const { count: remaining } = await supabaseAdmin
  .from("products")
  .select("*", { count: "exact", head: true })
  .or("brand.is.null,title.is.null,category.is.null");
```

to:

```js
const { count: remaining } = await supabaseAdmin
  .from("products")
  .select("*", { count: "exact", head: true })
  .eq("available", true)
  .or("brand.is.null,title.is.null,category.is.null");
```

**Why both queries must change together:** The chain decision at line 134 (`if ((remaining ?? 0) > 0 && depth < MAX_DEPTH)`) uses `remaining` to decide whether to self-fetch the next batch. If the SELECT excludes unavailable rows but the count includes them, the chain will keep firing on empty batches because `remaining` stays > 0 forever — burning depth=30 hops per cron run on no-op rounds. The two filters must match.

- [ ] **Step 3: Build and lint**

```bash
npm run build
npm run lint
```

Both must pass before moving on. No new lint warnings (the file uses Supabase chaining, which lint is already happy with).

---

## Task 2: Update the smoke-test script to match

**Files:**
- Modify: `scripts/test-enrich.mjs`

- [ ] **Step 1: Add the same `available = true` filter to the script's null-count query**

In `scripts/test-enrich.mjs`, update the `nullCount()` function at lines 28–34 from:

```js
async function nullCount() {
  const { count } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true })
    .or("brand.is.null,title.is.null");
  return count ?? 0;
}
```

to:

```js
async function nullCount() {
  const { count } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true })
    .eq("available", true)
    .or("brand.is.null,title.is.null,category.is.null");
  return count ?? 0;
}
```

Two changes in one edit:
1. Add `.eq("available", true)` so the script's "remaining" matches the endpoint's view.
2. Bring the `.or(...)` clause in line with the endpoint, which checks `category.is.null` too. The original script predates the category column being part of enrich's selection criteria.

**Why this matters:** Without the change, the script polls a count that includes the 1,362 unavailable NULL rows — those are now intentionally untouched, so the count never drops to zero, and the poll loop times out after 25 minutes claiming "Timed out polling" even on a healthy run.

- [ ] **Step 2: No build/lint needed for the script**

`scripts/test-enrich.mjs` is not part of the Next build. It's executed manually with `node scripts/test-enrich.mjs <base-url>`. Skip to verification.

---

## Task 3: Verify on Vercel preview

- [ ] **Step 1: Capture pre-deploy expectations**

Before pushing, run this in Supabase SQL editor and note the numbers:

```sql
SELECT
  COUNT(*) FILTER (WHERE available IS TRUE)  AS will_be_processed,
  COUNT(*) FILTER (WHERE available IS FALSE) AS will_be_skipped,
  COUNT(*) FILTER (WHERE available IS NULL)  AS available_unknown,
  COUNT(*)                                    AS total_null_rows
FROM products
WHERE brand IS NULL OR title IS NULL OR category IS NULL;
```

Expected today: ~183 will-be-processed, ~1,362 will-be-skipped, **0 available_unknown**, ~1,545 total. Numbers will drift between now and merge — record the live values so the post-deploy check has a baseline.

**Why `available_unknown` matters:** `products.available` is a nullable `boolean` (default `true`). Today the count is 0 across the whole table, but the schema permits NULL. PostgREST `.eq("available", true)` excludes NULLs, so does the feed query (`app/api/products/route.js:92`, `app/components/MoreFromStore.js:9`) — meaning NULL rows are symmetrically invisible to both the feed and to enrich. **If `available_unknown` is non-zero, stop and investigate** before merging: a sync regression may be inserting NULLs, and the symmetry assumption (feed-visible ⟺ enrich-eligible) needs re-checking before relying on it.

- [ ] **Step 2: Push branch + open PR**

```bash
git push -u origin worktree-enrich-skip-unavailable
gh pr create --title "fix(enrich): skip unavailable products" --body ...
```

The PR body should include the cost rationale from this plan plus the will-be-processed / will-be-skipped numbers from Step 1.

- [ ] **Step 3: Trigger enrich on the Vercel preview**

Once Vercel preview is green:

```bash
node scripts/test-enrich.mjs <preview-url>
```

Expected behavior:
- Pre-run `nullCount()` matches `will_be_processed` from Step 1 (~183).
- One or more `/api/enrich` rounds drain the available NULL rows.
- Post-run `nullCount()` decreases to whatever's left after the round (could be 0, could be the unparseable available subset — that's a separate problem).
- The script does **not** time out. If it does, the filter is mismatched between the endpoint and the script.

- [ ] **Step 4: Confirm no API charges for the unavailable pile**

After the preview run completes, query again:

```sql
SELECT
  COUNT(*) FILTER (WHERE available IS FALSE) AS unavailable_null_rows,
  COUNT(*) FILTER (WHERE available IS NULL)  AS available_unknown_null_rows
FROM products
WHERE brand IS NULL OR title IS NULL OR category IS NULL;
```

`unavailable_null_rows` must match the Step 1 `will_be_skipped` value. If it dropped, the filter didn't take and the endpoint is still touching unavailable rows — investigate before merging.

`available_unknown_null_rows` must match Step 1's `available_unknown` (expected 0). If a non-zero value appeared between Step 1 and Step 4, sync started inserting NULLs during the test window — pause and investigate before merging.

- [ ] **Step 5: Merge to main**

After the user confirms the preview run looked correct, merge via the GitHub UI per CLAUDE.md ("Merge only after explicit user instruction"). The next hourly GitHub Actions trigger will run the cleaner enrich.

---

## Risk and rollback

**Risk surface:** Tiny. Two 4-character additions to an existing query. The filter is correct by definition (it matches the feed's read filter). The chain-decision logic is preserved by updating both queries together.

**Failure modes considered:**

1. **Filter applied to one query but not the other** → chain runs forever on empty batches. Mitigated by Task 1 Steps 1+2 being in the same task; reviewer must confirm both diffs are present.
2. **Race: a row flips `available` mid-batch** → SELECT picked it up while available=true, sync flipped it to false during the 1.2s/row loop. cleanTitle still runs, RPC writes editorial fields anyway. No harm — those fields are correct for if/when the product comes back. No rollback needed.
3. **A previously-enriched row goes unavailable, then becomes available again with NULL editorial** → cannot happen. `enrich_product` writes via COALESCE; once written, fields are not re-NULLed by sync (CLAUDE.md invariant: "editorial fields write only if NULL").

**Rollback:** revert the PR. The DB has no migration. The 1,362 unavailable NULL rows are exactly as they were before this change — no data lost, no data modified.

---

## Cost projection

- **Before this fix, on hourly cron:** ~1,155 rows × 24 runs/day ≈ **27,720 Haiku calls/day** spent on rows that fail (mostly invisible).
- **After this fix:** ~119 available rows that genuinely fail × 24 runs/day ≈ **2,856 Haiku calls/day**, all on rows visible in the feed. Still wasteful (those rows fail every run too — that's Fix #1's territory), but ~10× cheaper and bounded to the user-visible product set.
- **After this fix + Fix #1 (last_enrich_at back-pressure):** approaches zero steady-state cost. New listings drain on first run, failed rows back off.

This plan delivers the ~10× drop. Fix #1 is the follow-up.
