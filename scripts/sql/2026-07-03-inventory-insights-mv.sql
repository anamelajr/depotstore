-- Materialize the inventory-insights layer (fix for the 2026-07-03 timeout
-- incident; plan: docs/plan-inventory-insights-timeout-fix.md).
--
-- WHY: v_product_lifecycle recomputed three full passes over inventory_snapshots
-- (GROUP BY + DISTINCT ON + LAG window) on EVERY query. At 530k rows / 24 ledger
-- days one page took ~25.5s, but every PostgREST read — service_role included —
-- runs under the authenticator role's statement_timeout=8s, so /admin/inventory
-- died with "canceling statement due to statement timeout". The data only
-- changes once per day (the daily snapshot capture), so compute once per day:
-- materialized views refreshed by pg_cron, with the existing v_* names
-- redefined as thin wrappers (zero app-code change).
--
-- SECURITY: materialized views cannot use security_invoker/RLS, and PostgREST
-- exposes them like tables. The guard is the same as the original views'
-- defense-in-depth layer: REVOKE from anon/authenticated, GRANT only to
-- service_role. The wrapper views keep security_invoker=true + the same grants.
--
-- REFRESH IS NON-CONCURRENT (deliberate deviation from the plan draft):
-- REFRESH ... CONCURRENTLY cannot run inside a plpgsql function (it refuses
-- transaction blocks, and pg_cron's multi-statement strings are an implicit
-- transaction too). Non-concurrent refresh works in a function, is faster, and
-- only costs a short AccessExclusive lock (~30-60s today) once per day on an
-- admin-only dashboard — a read landing in that window blocks and may hit the
-- 8s timeout once; reload. pg_cron runs as postgres (cluster default
-- statement_timeout = 2min, verified), not authenticator, so the refresh
-- itself is not subject to the 8s cap. Revisit alongside the year-one
-- rollup/retention checkpoint if refresh time approaches 2min.
--
-- Apply via the Supabase SQL Editor (MCP is read-only). Safe to re-run.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ---------------------------------------------------------------------------
-- mv_product_lifecycle: body copied VERBATIM from v_product_lifecycle
-- (scripts/sql/2026-06-08-inventory-insights.sql) — no behavior change. See
-- that file for the model-decision comments (ledger departures, gap_exit
-- gating, pre-ledger guard).
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.mv_daily_flow;
DROP MATERIALIZED VIEW IF EXISTS public.mv_product_lifecycle;

CREATE MATERIALIZED VIEW public.mv_product_lifecycle AS
WITH
ledger AS (
  SELECT observed_date FROM public.inventory_snapshot_days
),
bounds AS (
  SELECT (SELECT MIN(observed_date) FROM ledger) AS cold_start
),
agg AS (
  SELECT handle, store_domain,
         MIN(observed_date) AS first_seen,
         MAX(observed_date) AS last_seen,
         COUNT(*)           AS days_observed
  FROM public.inventory_snapshots
  GROUP BY handle, store_domain
),
latest AS (
  SELECT DISTINCT ON (handle, store_domain)
         handle, store_domain, brand, title, name, category, subcategory,
         price, available AS latest_available, hidden AS latest_hidden
  FROM public.inventory_snapshots
  ORDER BY handle, store_domain, observed_date DESC
),
flips AS (
  SELECT handle, store_domain, MIN(observed_date) AS sold_at_flip
  FROM (
    SELECT handle, store_domain, observed_date, available,
           LAG(available) OVER (
             PARTITION BY handle, store_domain ORDER BY observed_date
           ) AS prev_available
    FROM public.inventory_snapshots
  ) t
  WHERE available = false AND prev_available = true
  GROUP BY handle, store_domain
),
departures AS (
  SELECT a.handle, a.store_domain,
    CASE WHEN a.last_seen >= b.cold_start THEN
      (SELECT MIN(d.observed_date) FROM ledger d WHERE d.observed_date > a.last_seen)
    END AS departed_at,
    (a.last_seen < b.cold_start) AS gap_exit
  FROM agg a CROSS JOIN bounds b
)
SELECT
  a.handle,
  a.store_domain,
  l.brand, l.title, l.name, l.category, l.subcategory, l.price,
  a.first_seen,
  a.last_seen,
  a.days_observed,
  f.sold_at_flip,
  dep.departed_at,
  (f.sold_at_flip  - a.first_seen) AS days_to_sell_flip,
  (dep.departed_at - a.first_seen) AS days_to_departure,
  COALESCE(f.sold_at_flip - a.first_seen, dep.departed_at - a.first_seen)
    AS days_to_sell,
  (a.first_seen <= (SELECT cold_start FROM bounds)) AS first_seen_censored,
  CASE
    WHEN dep.departed_at IS NOT NULL THEN 'departed'
    WHEN dep.gap_exit                THEN 'gap_exit'
    WHEN l.latest_available = false  THEN 'sold'
    ELSE 'active'
  END AS current_status,
  CASE
    WHEN f.sold_at_flip IS NOT NULL  THEN 'flip'
    WHEN dep.departed_at IS NOT NULL THEN 'delist'
    ELSE NULL
  END AS sold_signal_type
FROM agg a
JOIN latest l       USING (handle, store_domain)
LEFT JOIN flips f   USING (handle, store_domain)
JOIN departures dep USING (handle, store_domain)
WHERE (SELECT cold_start FROM bounds) IS NOT NULL
WITH DATA;

-- Identity for the row grain + the exact ORDER BY the paged dashboard read uses.
CREATE UNIQUE INDEX idx_mv_lifecycle_handle_store
  ON public.mv_product_lifecycle (handle, store_domain);
CREATE INDEX idx_mv_lifecycle_store_handle
  ON public.mv_product_lifecycle (store_domain, handle);

-- ---------------------------------------------------------------------------
-- mv_daily_flow: v_daily_flow's body, but the per-day lifecycle subqueries now
-- read the materialized lifecycle (precomputed rows, not a 25s recompute each).
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW public.mv_daily_flow AS
SELECT
  d.observed_date,
  (SELECT COUNT(*) FROM public.mv_product_lifecycle l
     WHERE l.first_seen = d.observed_date)               AS arrivals,
  (SELECT COUNT(*) FROM public.mv_product_lifecycle l
     WHERE l.departed_at = d.observed_date)              AS departures,
  (SELECT COUNT(*) FROM public.inventory_snapshots s
     WHERE s.observed_date = d.observed_date
       AND s.available = true)                           AS active,
  (d.observed_date = (SELECT MIN(observed_date)
                        FROM public.inventory_snapshot_days)) AS is_seed_day
FROM public.inventory_snapshot_days d
ORDER BY d.observed_date
WITH DATA;

CREATE UNIQUE INDEX idx_mv_daily_flow_date
  ON public.mv_daily_flow (observed_date);

-- Lock down the MVs (PostgREST-visible like tables; service-role only).
REVOKE ALL ON public.mv_product_lifecycle FROM anon, authenticated;
REVOKE ALL ON public.mv_daily_flow        FROM anon, authenticated;
GRANT SELECT ON public.mv_product_lifecycle TO service_role;
GRANT SELECT ON public.mv_daily_flow        TO service_role;

-- ---------------------------------------------------------------------------
-- Redefine the app-facing views as thin wrappers (same names, same columns,
-- same order — app/lib/inventoryAnalytics.js is untouched). security_invoker
-- stays: anon has no grant on the MVs, so the wrappers stay sealed too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_product_lifecycle
WITH (security_invoker = true) AS
SELECT handle, store_domain, brand, title, name, category, subcategory, price,
       first_seen, last_seen, days_observed, sold_at_flip, departed_at,
       days_to_sell_flip, days_to_departure, days_to_sell,
       first_seen_censored, current_status, sold_signal_type
FROM public.mv_product_lifecycle;

CREATE OR REPLACE VIEW public.v_daily_flow
WITH (security_invoker = true) AS
SELECT observed_date, arrivals, departures, active, is_seed_day
FROM public.mv_daily_flow;

-- Re-assert the shipped grants convention on the wrappers.
REVOKE ALL ON public.v_product_lifecycle FROM anon, authenticated;
REVOKE ALL ON public.v_daily_flow        FROM anon, authenticated;
GRANT SELECT ON public.v_product_lifecycle TO service_role;
GRANT SELECT ON public.v_daily_flow        TO service_role;

-- ---------------------------------------------------------------------------
-- Staleness-gated refresh. The Phase-1 capture gate fires on the first
-- SUCCESSFUL hourly cron of the day (time varies), so a fixed daily refresh
-- would race it; instead pg_cron checks hourly and refreshes only when the
-- ledger has a day the flow MV hasn't seen (23 of 24 runs are a no-op
-- comparison). Lifecycle refreshes before flow — flow reads lifecycle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_inventory_insights()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ledger_max date;
  flow_max   date;
BEGIN
  SELECT MAX(observed_date) INTO ledger_max FROM public.inventory_snapshot_days;
  SELECT MAX(observed_date) INTO flow_max   FROM public.mv_daily_flow;
  IF ledger_max IS NULL OR flow_max >= ledger_max THEN
    RETURN 'fresh (ledger ' || COALESCE(ledger_max::text, 'empty') || ')';
  END IF;
  REFRESH MATERIALIZED VIEW public.mv_product_lifecycle;
  REFRESH MATERIALIZED VIEW public.mv_daily_flow;
  RETURN 'refreshed to ' || ledger_max;
END $$;

REVOKE ALL ON FUNCTION public.refresh_inventory_insights() FROM PUBLIC, anon, authenticated;

-- Hourly at :20 — after the hourly sync/capture window. cron.schedule with the
-- same jobname replaces the existing schedule (idempotent re-run).
SELECT cron.schedule(
  'refresh-inventory-insights',
  '20 * * * *',
  $$SELECT public.refresh_inventory_insights();$$
);

COMMIT;

-- Guards (run after apply):
--  * both MVs populated, wrapper views readable, cron job registered
--  * the function smoke-test returns 'fresh …' (MVs were just built WITH DATA)
SELECT (SELECT COUNT(*) FROM public.mv_product_lifecycle)  AS lifecycle_rows,
       (SELECT COUNT(*) FROM public.v_product_lifecycle)   AS wrapper_rows,
       (SELECT COUNT(*) FROM public.mv_daily_flow)         AS flow_days,
       (SELECT COUNT(*) FROM cron.job
          WHERE jobname = 'refresh-inventory-insights')    AS cron_jobs,
       public.refresh_inventory_insights()                 AS refresh_smoke;
