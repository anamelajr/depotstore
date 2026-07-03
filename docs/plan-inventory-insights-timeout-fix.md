# Fix `/admin/inventory` statement-timeout: materialize the insights views

## Context — what broke and why

The inventory-insights dashboard (added in the Phase 2 PR: commits `500d569`
*feat(sql): inventory-insights views* + `de449d9` *feat(insights): /admin/inventory
page*, merged ~2026-06-08) now fails with:

> Could not load insights: lifecycle read failed: canceling statement due to statement timeout

**Root cause (confirmed against production, not guessed):**

1. `v_product_lifecycle` (scripts/sql/2026-06-08-inventory-insights.sql) is a
   plain view: every query recomputes three full passes over
   `inventory_snapshots` — a `GROUP BY` aggregate, a `DISTINCT ON` latest-row
   sort, and a `LAG()` window function.
2. The snapshot table has grown to **530,379 rows / 258 MB (24 ledger days,
   ~22k products/day)**. `EXPLAIN ANALYZE` of the exact first-page query
   `readLifecycle` issues (`ORDER BY store_domain, handle LIMIT 1000`) takes
   **~25.5 s**; the `flips` window-function branch alone is ~22 s.
3. All Supabase REST reads run through the `authenticator` role, which carries
   `statement_timeout = 8s` (verified in `pg_roles`). `SET ROLE service_role`
   does not reset it — so even the service-role admin client is capped at 8 s.
   25 s > 8 s → Postgres cancels the statement → the exact error on screen.
4. It worked at merge time because the table was days old and small; ~22k new
   rows/day pushed the view past 8 s some time after launch. Two aggravators
   guarantee it stays broken even if the view were tuned:
   - `readLifecycle` (app/lib/inventoryAnalytics.js) pages 1000 rows at a time
     → ~23 requests, **each recomputing the entire view**.
   - `v_daily_flow` runs two correlated subqueries *per ledger day* against
     `v_product_lifecycle` — cost grows with days² × rows.

**Fix direction:** precompute once per day (the data only changes once per day —
the daily snapshot capture), serve reads from stored rows. Materialized views +
a pg_cron refresh. Zero app-code changes: the existing view names are redefined
as thin wrappers, so `inventoryAnalytics.js` and its tests are untouched
(additive over shipped work).

## Changes

### 1. New SQL script `scripts/sql/2026-07-03-inventory-insights-mv.sql`

Applied via the Supabase SQL Editor (MCP is read-only). Contents:

1. `CREATE EXTENSION IF NOT EXISTS pg_cron;` (available, version 1.6.4, not yet
   installed).
2. **`public.mv_product_lifecycle`** — materialized view with the *same body*
   as today's `v_product_lifecycle` (copy the SELECT from
   scripts/sql/2026-06-08-inventory-insights.sql verbatim, including the
   pre-ledger guard and gap_exit gating — no behavior change). Indexes:
   - `UNIQUE (handle, store_domain)` — required for `REFRESH … CONCURRENTLY`.
   - `(store_domain, handle)` — matches `readLifecycle`'s ORDER BY paging.
3. **`public.mv_daily_flow`** — materialized view with `v_daily_flow`'s body,
   but its lifecycle subqueries read `mv_product_lifecycle` (the `active`
   count still reads `inventory_snapshots`; fine inside a refresh). Unique
   index on `(observed_date)` for CONCURRENTLY.
4. **Redefine the existing views as thin wrappers** (same names + columns, so
   the app needs no change): `CREATE OR REPLACE VIEW v_product_lifecycle …
   AS SELECT … FROM mv_product_lifecycle;` same for `v_daily_flow`
   (keep `security_invoker = true` and re-assert the existing REVOKE/GRANT).
5. **Lockdown** (MVs are PostgREST-visible like tables): `REVOKE ALL … FROM
   anon, authenticated;` `GRANT SELECT … TO service_role;` on both MVs —
   mirrors the shipped convention. (MVs can't use security_invoker/RLS;
   the REVOKE is the guard, same defense-in-depth note as the original file.)
6. **`public.refresh_inventory_insights()`** — SECURITY DEFINER function
   (owner postgres) that refreshes `mv_product_lifecycle` then `mv_daily_flow`
   with `REFRESH MATERIALIZED VIEW CONCURRENTLY`, **only when stale**: skip if
   `(SELECT MAX(observed_date) FROM inventory_snapshot_days)` is already
   present in `mv_daily_flow`. Revoke EXECUTE from anon/authenticated.
7. **pg_cron job** (hourly, e.g. minute 20 — after the hourly sync/capture
   window): `SET statement_timeout TO '10min'; SELECT
   public.refresh_inventory_insights();` — the staleness gate makes 23 of 24
   hourly runs a no-op comparison; the real refresh (~30 s today) runs once,
   right after the day's snapshot capture lands (capture time varies because
   the Phase-1 gate fires on the first *successful* cron of the day, so a
   fixed daily time would race it). `SET` as a separate statement sidesteps
   the "can't change statement_timeout mid-statement" caveat; pg_cron runs as
   postgres, not authenticator, so the 8 s cap doesn't apply.
8. Guard queries at the bottom (the file's existing convention): MV row count
   equals old-view row count; `SELECT * FROM cron.job;` shows the schedule;
   wrapper views return in <100 ms.

### 2. Docs

- **CLAUDE.md** — "DB objects not in git" section: add the two MVs, the
  refresh function, and the pg_cron job (they live only in Supabase). One
  invariant note: *insights MVs are refreshed by pg_cron post-capture; the
  `v_*` insights views are thin wrappers over them — don't query the heavy
  logic directly and don't re-inline it into the views.*
- **docs/plan-inventory-history-phase2-implementation.md** — short addendum
  recording the 2026-07-03 timeout incident and the materialization.

### 3. App code

**None.** `readLifecycle` / `getInventoryInsights` keep their exact query
shape; each page becomes an indexed read of stored rows (~ms). The 23
round-trips stay but are now cheap.

## Why not the alternatives

- *Tune the view SQL only:* the 22 s hotspot (flips window scan) could shrink,
  but ~23 per-page recomputations × linear growth (7.6 M rows/yr projected in
  the Phase-1 script) re-breaks it within months. Wrong altitude.
- *Refresh via `/api/cron` RPC call:* the refresh itself (~30 s) would be
  killed by the same 8 s PostgREST timeout. pg_cron runs inside Postgres and
  isn't subject to it.

## Rollout order (per CLAUDE.md workflow)

1. Apply the SQL script in the Supabase SQL Editor (schema changes land before
   dependent code — here there is no dependent code, so this alone fixes prod).
2. Merge the branch (script + docs) after user approval — the script is the
   tracked record of what was applied.

## Verification

1. In SQL Editor after apply: guard queries pass; `EXPLAIN ANALYZE SELECT …
   FROM v_product_lifecycle ORDER BY store_domain, handle LIMIT 1000` reports
   <100 ms; `SELECT jobname, schedule FROM cron.job` lists the refresh job.
2. `npm test` — `inventoryAnalytics.test.js` still green (no app change).
3. Load `http://localhost:3000/admin/inventory` (read-only page; safe per
   workflow rules) — KPIs, charts, and store table render; totals match the
   pre-timeout expectations (~22.5 k tracked products).
4. Anon lockdown: `curl` the REST endpoint for `mv_product_lifecycle` with the
   anon key → permission denied (matches the existing views' behavior).
5. Next day: `SELECT MAX(observed_date) FROM mv_daily_flow` equals the
   ledger's max — proves the staleness-gated refresh fired after capture; spot
   check `cron.job_run_details` for the run status.
