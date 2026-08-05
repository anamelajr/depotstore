# Spec: Enrich pipeline logging (`enrich_runs` table)

## Goal

Capture, for every cron run and every enrich batch, a one-line record of what
happened — enough to answer **"why did we spend X tokens on day Y?"** with a
single SQL query, instead of guessing from the OpenAI dashboard.

This is **pure measurement**: zero behavior changes to sync, enrich, or
OpenAI calls. After 24 hours of data we decide what (if anything) to optimize.

## Context

- Daily input-token spend has been trending around 425k–503k (May 7–8 2026),
  with ~266k partial-day on May 9. Output is ~3% — input/call-volume is the
  driver.
- At an average of ~750 input tokens per `cleanTitle` call, that's
  ~565–670 OpenAI calls/day. The cron runs hourly across ~10 Parisian
  vintage stores. ~28 calls/hour feels high for this inventory size.
- We don't currently know the breakdown between: new-product churn,
  description-reset-driven retries, sold-out-to-available toggles, or
  category-only failures.
- 165 rows are currently parked at `enrich_attempts = 3`; 70% of those
  (115 rows) are pure `assignCategory()` failures and **cost zero OpenAI
  tokens** — they're not the daily spend driver.

## Non-goals

- No prompt changes.
- No retry-count or batch-size changes.
- No PDP `generateDescription` logging in this PR (defer; add later if
  numbers don't reconcile against the OpenAI dashboard).
- No per-row tracking (which specific product consumed which call).
- No cleanup of the 165 stuck rows (separate concern).
- ~~No separate `openai_errored` counter for exceptions thrown from
  `cleanTitle` to the row loop. Codex flagged this as a concern, but
  `cleanTitle.js` has an internal catch-all that converts every failure
  mode (abort, network, JSON parse, malformed response) to a `null`
  return. No exception path reaches the outer catch under the current
  design. The call-start counter placement (see section 2.B) is enough
  to keep reconciliation accurate even if that contract is later weakened.~~

  **Superseded 2026-08-05.** From 2026-07-14 to 2026-08-05 every enrich
  batch recorded `openai_succeeded = 0` (~95 runs) and nobody noticed:
  lumping all null causes together made a silent total outage (a non-OK
  HTTP status, empty completions from reasoning-token starvation)
  indistinguishable from ordinary quality-gate churn. Per-mode counters
  were added (`openai_http_error`, `openai_empty_content`,
  `openai_parse_error`, `openai_validation_reject`,
  `openai_timeout_network`, `openai_last_http_status`, plus
  `brand_leak_blocked_model`/`_fallback` and `row_errors`) via
  `scripts/sql/2026-08-05-enrich-runs-failure-detail.sql`. The original
  rationale — no exception escapes `cleanTitle` — remains true; what
  changed is the need to decompose the null itself. cleanTitle's `null`
  stays uniformly retryable: the detail is telemetry-only and no
  behavior branches on it (CLAUDE.md pin).

---

## 1. The table: `enrich_runs`

One table with a `run_type` discriminator covering both cron ticks and
enrich batches. Columns that don't apply to a given row stay NULL.

```sql
CREATE TABLE enrich_runs (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_type     TEXT NOT NULL CHECK (run_type IN ('cron', 'enrich')),
  duration_ms  INT,

  -- run_type = 'cron' columns
  total_synced       INT,           -- total rows upserted across all stores
  reset_count        INT,           -- rows whose enrich_attempts were reset to 0
  reset_by_name      INT,           -- of those, how many reset because name changed
  reset_by_desc      INT,           -- of those, how many reset because description changed
  per_store_synced   JSONB,         -- { "escoparis.com": 643, "lobscur.com": 1822, ... }
  per_store_resets   JSONB,         -- { "escoparis.com": 12, "lobscur.com": 0, ... }
  store_errors       TEXT[],        -- errors from individual store syncs
  stale_deleted      INT,           -- rows removed by stale cleanup
  step_timings       JSONB,         -- { sync_total_ms, per_store_ms: {domain: ms},
                                    --   stale_delete_ms, snapshot_ms, alias_drift_ms,
                                    --   deadline_hit: [domain, ...] }
                                    -- added 2026-08-05 (scripts/sql/2026-08-05-enrich-runs-step-timings.sql)

  -- run_type = 'enrich' columns
  depth                       INT,    -- chain hop number (0 = first call from cron)
  queue_size                  INT,    -- rows.length returned by the SELECT
  fast_path_count             INT,    -- rows where brand+title were already set
  openai_calls                INT,    -- API calls attempted (counted at call start, not return)
  openai_succeeded            INT,    -- got valid {brand, title} that passed all guards
  openai_returned_null        INT,    -- API attempted but returned null (network/abort/parse/quality-gate)
  openai_no_call              INT,    -- skipped before any API request (e.g. row.name was empty)
  category_assigned           INT,    -- assignCategory() returned a value
  category_failed             INT,    -- assignCategory() returned null
  allowlist_rejected          INT,    -- Dolce Vita allowlist rejections (deletions)
  attempts_increment_failures INT,    -- supabase RPC failures on increment_enrich_attempts
  per_store_openai_calls      JSONB,  -- { "escoparis.com": 7, "lobscur.com": 3, ... }
  remaining_after             INT,    -- count after batch — drives chain decision
  chained                     BOOL,   -- true if this batch triggered the next hop

  -- run_type = 'enrich' failure detail (added 2026-08-05,
  -- scripts/sql/2026-08-05-enrich-runs-failure-detail.sql)
  openai_http_error           INT,    -- cleanTitle: !res.ok
  openai_empty_content        INT,    -- 200 with empty content (reasoning-token starvation)
  openai_parse_error          INT,    -- content present but JSON.parse failed
  openai_validation_reject    INT,    -- parsed OK, validateCleanTitleResult returned null
  openai_timeout_network      INT,    -- outer catch: 8s abort, network, res.json() throw
  openai_last_http_status     INT,    -- last non-OK status seen this batch (not a counter)
  brand_leak_blocked_model    INT,    -- brand-leak gate fired on a truthy cleanTitle result
  brand_leak_blocked_fallback INT,    -- brand-leak gate fired on a handle-fallback result
  row_errors                  INT     -- rows that threw out of the per-row try
);

CREATE INDEX idx_enrich_runs_created ON enrich_runs (created_at DESC);
CREATE INDEX idx_enrich_runs_type_created ON enrich_runs (run_type, created_at DESC);
```

### Column reference

**For cron runs (`run_type = 'cron'`):**

- `total_synced` — total products processed by the cron (should match active
  inventory count, ~6,500 currently).
- `reset_count` — **the key number for the description-reset theory.** If
  consistently <5/run, theory is dead. If 30+/run, we have our answer.
- `reset_by_name` vs `reset_by_desc` — splits the reset reason. If
  `reset_by_desc >> reset_by_name`, Shopify description churn is the
  dominant cost.
- `per_store_synced` / `per_store_resets` — per-store JSONB; spot a single
  misbehaving store.
- `stale_deleted` — products removed because they disappeared from Shopify.

**For enrich runs (`run_type = 'enrich'`):**

- `depth` — `0` = first enrich call triggered by cron, `1+` = chained
  continuations. Seeing `depth = 29` means the queue was huge.
- `queue_size` — how many rows the SELECT returned for this batch.
- `fast_path_count` — rows skipped past OpenAI because brand+title were
  already set.
- `openai_calls` — **API calls attempted, counted at call start (not after
  return).** Sum this column × ~750 over a day should reconcile with the
  OpenAI dashboard's input-token total within ~20%. Counting at call start
  (rather than after the await resolves) means the count is robust even if
  `cleanTitle` is later refactored in a way that lets exceptions propagate
  to the row loop. Today `cleanTitle` swallows all exceptions internally
  and returns null, so the difference vs counting on return is nil — but
  the call-start placement is cheap insurance against future regressions.
- `openai_succeeded` vs `openai_returned_null` — productive vs wasted
  attempted calls. All returned-null modes consumed at least some tokens.
  Since 2026-08-05, `openai_returned_null` is exactly decomposed by the
  failure-detail counters:
  `openai_returned_null == openai_http_error + openai_empty_content +
  openai_parse_error + openai_validation_reject + openai_timeout_network`.
  A batch dominated by `openai_http_error`/`openai_empty_content` is an
  outage (check `openai_last_http_status`); one dominated by
  `openai_validation_reject` is quality-gate churn.
- `openai_last_http_status` — the last non-OK HTTP status cleanTitle saw in
  the batch (e.g. 404 = model access revoked, 429 = rate limit). NULL when
  every call returned 200.
- `brand_leak_blocked_model` / `brand_leak_blocked_fallback` — the route's
  choke-point brand-leak gate, split by producer. Model-path blocks are the
  one case where a completed OpenAI call increments neither
  `openai_succeeded` nor `openai_returned_null`; fallback-path blocks are
  already inside `openai_returned_null`. Their sum equals the response
  JSON's `brandLeakBlocked`.
- `row_errors` — rows that threw out of the per-row try to the outer catch.
  Supersedes the "stays as-is, no counter" note in section 2.B: the catch
  still only keeps the loop running, but the count is now persisted.
  `openai_calls ≈ openai_succeeded + openai_returned_null +
  brand_leak_blocked_model + row_errors` (approximate only because a row
  exception can fire after a success/null counter already incremented).
- `openai_no_call` — short-circuited before any API request was attempted.
  Currently only fires when `row.name` is empty/null. This row consumed
  zero OpenAI tokens. Kept separate from `openai_returned_null` so the
  reconciliation math (`openai_calls × 750 ≈ dashboard input tokens`)
  stays clean.
- `category_failed` — rows where OpenAI succeeded but `assignCategory()`
  couldn't classify. **High numbers here mean expand the category map**, not
  the prompt.
- `per_store_openai_calls` — per-store attribution of OpenAI calls in this
  batch; "is one store burning my budget?".
- `remaining_after` — rows still pending after this batch finished.

---

## 2. Where the logging fires

### A. End of `/api/cron` (one row per hourly run)

**File:** `app/api/cron/route.js`
**Insert point:** just before the final `return Response.json(summary)` at
line 246.

**Existing data we already track:**

- `summary.totalUpserted`
- `summary.stores` (per-store counts)
- `summary.errors`
- `summary.deleted`

**New work needed inside the per-store loop:**

The reset block at lines 104–111 currently builds `resetHandles` without
splitting by reason. Split into:

```js
const resetHandlesByName = [];
const resetHandlesByDesc = [];
for (const row of batch) {
  const prev = preMap[row.handle];
  if (!prev) continue;
  const nameChanged = prev.name !== row.name;
  const descChanged = prev.description !== row.description;
  if (nameChanged) resetHandlesByName.push(row.handle);
  else if (descChanged) resetHandlesByDesc.push(row.handle);
}
const resetHandles = [...resetHandlesByName, ...resetHandlesByDesc];
```

Note: `else if` ensures a row counted in `by_name` is not double-counted
in `by_desc`. The actual reset UPDATE still uses the combined `resetHandles`.

Per-store result shape extends from `{ store, count }` to
`{ store, count, resetsByName, resetsByDesc }`.

After `Promise.allSettled` aggregation, build:

```js
const perStoreResets = {};      // { domain: total_resets }
let totalResetsByName = 0;
let totalResetsByDesc = 0;
for (const r of results) {
  if (r.status !== 'fulfilled') continue;
  perStoreResets[r.value.store] = r.value.resetsByName + r.value.resetsByDesc;
  totalResetsByName += r.value.resetsByName;
  totalResetsByDesc += r.value.resetsByDesc;
}
```

**The insert (immediately before `return Response.json(summary)`):**

```js
try {
  await supabaseAdmin.from('enrich_runs').insert({
    run_type: 'cron',
    duration_ms: Date.now() - syncStartMs,
    total_synced: summary.totalUpserted,
    reset_count: totalResetsByName + totalResetsByDesc,
    reset_by_name: totalResetsByName,
    reset_by_desc: totalResetsByDesc,
    per_store_synced: summary.stores,
    per_store_resets: perStoreResets,
    store_errors: summary.errors,
    stale_deleted: summary.deleted ?? 0,
  });
} catch (e) {
  console.error('enrich_runs cron log failed:', e?.message ?? e);
}
```

`syncStartMs` is captured at the top of the handler:
`const syncStartMs = Date.now();` (alongside the existing `syncStart` ISO
string at line 15).

### B. End of `/api/enrich` (one row per batch, including chained continuations)

**File:** `app/api/enrich/route.js`
**Insert point:** just before the final `return Response.json(...)` at
line 195.

**Counters added at the top of the handler (after `let rejected = 0`):**

```js
let fastPathCount = 0;
let openaiCalls = 0;
let openaiSucceeded = 0;
let openaiReturnedNull = 0;
let openaiNoCall = 0;
let categoryAssigned = 0;
let categoryFailed = 0;
const perStoreOpenaiCalls = {};
```

**Increment points inside the row loop:**

- `fastPathCount++` on entering the `if (row.brand && row.title)` branch
  (line 84).
- Inside that branch: `categoryAssigned++` if `newCategory` is non-null,
  else `categoryFailed++`.
- For the OpenAI path (the `else`-equivalent that falls through to
  `cleanTitle`):
  - **Pre-call short-circuit guard.** Before invoking `cleanTitle`, check
    if `row.name` is falsy. If so:
    ```js
    if (!row.name) {
      openaiNoCall++;
      failed++;
      await tally(row);
      const elapsed = Date.now() - t0;
      await sleep(Math.max(0, CYCLE_MS - elapsed));
      continue;
    }
    ```
    This makes explicit what `cleanTitle` would do internally
    (`if (!rawTitle) return null`) — but lets us count it correctly as
    "no API call made" rather than conflating with returned-null.
  - **Increment counters BEFORE the await.** Per Codex review feedback:
    counting at call start (rather than after return) means the count
    survives any future refactor of `cleanTitle` that lets exceptions
    propagate to the row loop's outer catch.
    ```js
    openaiCalls++;
    perStoreOpenaiCalls[row.store_domain] =
      (perStoreOpenaiCalls[row.store_domain] ?? 0) + 1;
    const result = await cleanTitle({ name: row.name, rawDescription: row.description });
    ```
  - In the `if (result)` branch after passing all guards: `openaiSucceeded++`,
    plus the same `categoryAssigned`/`categoryFailed` accounting on the
    branch's own `newCategory`.
  - In the `else` branch (line 159): `openaiReturnedNull++`.
  - **The outer catch at line 163 stays as-is** — it doesn't need a
    counter increment, because by the time we reach it `openaiCalls`
    has already been incremented. The catch's job is only to keep the
    row loop running.

**Counter invariant (verifiable via the sanity-check query in section 5):**

```
queue_size ≈ fast_path_count + openai_calls + openai_no_call + allowlist_rejected
```

**Failure-detail identities (added 2026-08-05):**

```
openai_returned_null == openai_http_error + openai_empty_content
                      + openai_parse_error + openai_validation_reject
                      + openai_timeout_network            (exact)

openai_calls ≈ openai_succeeded + openai_returned_null
             + brand_leak_blocked_model + row_errors      (approximate)

brandLeakBlocked (response JSON) == brand_leak_blocked_model
                                  + brand_leak_blocked_fallback
```

The first is exact — those five counters partition cleanTitle's internal
null sites (`noName` is excluded: the route pre-screens empty names into
`openai_no_call`). The second is approximate because a row exception can
fire after a success/null counter already incremented.

(Within rounding for rare exceptions — e.g. if the outer catch fires
before either path's counter increment, that row is unattributed. With
the call-start increment placement, the only such window is the
allowlist-gate failure path, which already increments `allowlist_rejected`
explicitly.)

**The insert (immediately before `return Response.json(...)`):**

```js
try {
  await supabaseAdmin.from('enrich_runs').insert({
    run_type: 'enrich',
    duration_ms: Date.now() - batchStartMs,
    depth,
    queue_size: rows?.length ?? 0,
    fast_path_count: fastPathCount,
    openai_calls: openaiCalls,
    openai_succeeded: openaiSucceeded,
    openai_returned_null: openaiReturnedNull,
    openai_no_call: openaiNoCall,
    category_assigned: categoryAssigned,
    category_failed: categoryFailed,
    allowlist_rejected: rejected,
    attempts_increment_failures: attemptIncrementFailures,
    per_store_openai_calls: perStoreOpenaiCalls,
    remaining_after: remaining ?? 0,
    chained,
  });
} catch (e) {
  console.error('enrich_runs enrich log failed:', e?.message ?? e);
}
```

`batchStartMs` is captured at the top of the handler:
`const batchStartMs = Date.now();`.

---

## 3. Safety guarantees

1. **Both inserts are wrapped in try/catch.** A log failure must never break
   sync or enrich. The catch logs to `console.error` and continues. If
   Supabase is down, the cron still works; we lose that hour's record only.
2. **No new external dependencies.** Uses the existing `supabaseAdmin`
   client.
3. **No latency impact on the existing flow.** The insert happens AFTER all
   the work is done, just before the response is returned. ~30–80ms added
   to the response. Cron-only endpoints — no user-facing impact.
4. **The table is additive.** Drop it any time and code keeps working —
   the catch swallows the "relation does not exist" error.
5. **No PII.** Counts and timestamps only. No product titles, descriptions,
   or user data.
6. **Counter ordering matters in the catch path.** Counters are updated
   throughout the row loop, but the insert is at the end. If a row
   throws inside the loop (already caught by the existing try/catch at
   line 163), counters reflect partial work. That's correct — we record
   what actually happened.
7. **`waitUntil`-chained next hop fires before the log insert.** That's
   intentional: we want the chain to start as fast as possible. If the log
   insert fails, the chain is already on its way.

---

## 4. Sample queries (after 24h of data)

### Daily token-spend reconstruction

```sql
SELECT
  DATE(created_at) AS day,
  SUM(openai_calls) AS calls,
  SUM(openai_calls) * 750 AS estimated_input_tokens,
  SUM(openai_succeeded) AS productive,
  SUM(openai_returned_null) AS wasted
FROM enrich_runs
WHERE run_type = 'enrich'
GROUP BY day
ORDER BY day DESC;
```

Compare `estimated_input_tokens` against the OpenAI dashboard. ±20% match
validates the model.

### Is the description-reset theory real?

```sql
SELECT
  DATE(created_at) AS day,
  SUM(reset_count) AS total_resets,
  SUM(reset_by_name) AS by_name,
  SUM(reset_by_desc) AS by_desc
FROM enrich_runs
WHERE run_type = 'cron'
GROUP BY day
ORDER BY day DESC;
```

If `by_desc` consistently >100/day, that's the leak.

### Which store is driving costs?

```sql
SELECT
  store,
  SUM((per_store_openai_calls->>store)::int) AS calls
FROM enrich_runs,
     LATERAL jsonb_object_keys(per_store_openai_calls) AS store
WHERE run_type = 'enrich'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY store
ORDER BY calls DESC;
```

### Productive vs wasted call ratio

```sql
SELECT
  ROUND(100.0 * SUM(openai_succeeded) / NULLIF(SUM(openai_calls), 0), 1) AS success_rate_pct,
  ROUND(100.0 * SUM(category_failed) / NULLIF(SUM(category_assigned + category_failed), 0), 1) AS category_fail_pct
FROM enrich_runs
WHERE run_type = 'enrich'
  AND created_at >= NOW() - INTERVAL '7 days';
```

### Hourly distribution (spike detection)

```sql
SELECT
  DATE_TRUNC('hour', created_at) AS hour,
  SUM(openai_calls) AS calls,
  SUM(reset_by_desc) FILTER (WHERE run_type = 'cron') AS desc_resets
FROM enrich_runs
WHERE created_at >= NOW() - INTERVAL '48 hours'
GROUP BY hour
ORDER BY hour DESC;
```

---

## 5. Rollout plan

1. **Apply the migration.** Single `CREATE TABLE` + 2 `CREATE INDEX`
   statements via the Supabase MCP. Non-destructive, instant.
2. **Branch + Vercel preview the code change.** Two files modified:
   `app/api/cron/route.js` and `app/api/enrich/route.js`. Trigger preview
   cron manually via `gh workflow run sync.yml` (against the preview URL)
   or `curl -H "Authorization: Bearer $CRON_SECRET" $PREVIEW_URL/api/cron`.
   Verify one `cron` row + ≥1 `enrich` row appear in `enrich_runs`.
3. **Sanity-check counter math.** For one preview run, manually verify:
   `fast_path_count + openai_calls + openai_no_call + allowlist_rejected ≈ queue_size`
   (within rounding for the rare row that throws before any branch's
   counter increment fires).
4. **Merge to main.** Production cron picks it up on the next hourly tick.
5. **24h waiting period.** Just let it run.
6. **Validation queries.** Run the four queries above. Cross-check against
   OpenAI dashboard for that day.
7. **Decide based on data.**
   - If `reset_by_desc` is huge → fix the reset trigger.
   - If `category_failed` is huge → expand the category keyword map.
   - If neither → it's genuine new-inventory churn; the lever is fix G
     (skip OpenAI for clean titles via a deterministic brand-prefix match).

**2026-08-05 amendment rollout:** apply
`scripts/sql/2026-08-05-enrich-runs-failure-detail.sql` by hand in the
Supabase SQL Editor before merging the failure-detail code (nullable adds
are backward-compatible). The identity checks live as comments in that
file; `/api/health/enrich` + `.github/workflows/enrich-health.yml` alarm
on the zero-success condition afterwards.

---

## 6. Schema-decision rationale

- **Single table with `run_type` discriminator** vs two tables: chosen for
  simplicity. Two tables would be cleaner per-type but doubles migration
  surface and complicates day-aggregation queries that need both.
- **JSONB for per-store breakdowns** vs a child table: chosen because
  per-store queries are ad-hoc, not dashboard-driven. Postgres JSONB
  syntax is fine for occasional SQL. A child table can be migrated to
  later if a real dashboard ever exists.
- **No FK constraints between cron and enrich rows.** A cron row triggers
  N enrich rows, but linking them via `cron_run_id` adds complexity for
  little gain — the timestamp ordering already correlates them.
- **No retention policy.** ~25 rows/day = ~9,000 rows/year. Trivial. Add
  `DELETE FROM enrich_runs WHERE created_at < NOW() - INTERVAL '90 days'`
  if it ever matters.
