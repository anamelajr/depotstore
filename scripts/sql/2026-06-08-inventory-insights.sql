-- Phase 2 of the inventory-history feature (design: docs/plan-inventory-history.md).
-- Two read-only VIEWS over the Phase 1 snapshot tables — the analytics math layer
-- for the private /admin/inventory dashboard. No base data is written or changed.
--
-- security_invoker = true is REQUIRED: PostgREST exposes public views, the anon key
-- is public, and middleware.js does NOT gate /rest/v1. A default (security-definer)
-- view would bypass the base tables' RLS and leak the entire history to anyone with
-- the anon key. With security_invoker the view runs as the CALLER: the dashboard's
-- service-role client (supabaseAdmin) bypasses RLS and sees everything; anon hits
-- the base-table RLS (no policy) and sees nothing. We also REVOKE from anon to keep
-- the views out of PostgREST's anon surface entirely (defense in depth).
--
-- KEY MODEL DECISIONS (see plan invariants):
--  * inventory_snapshot_days (the ledger) is the canonical valid-day sequence for
--    departure math — gaps are real (Phase 1 gates skip days), so calendar +1 would
--    manufacture false departures. departed_at = next LEDGER day after last_seen.
--  * The 2026-05-21 backfill day lives in inventory_snapshots but NOT the ledger, so
--    MIN(ledger.observed_date) = the true cold-start date (the censoring threshold),
--    and the backfill softens first_seen without a 2.5-week gap polluting the flow.
--  * departed_at is GATED on last_seen >= cold_start: a product seen ONLY on the
--    backfill day was never observed on a real ledger day, so its exit happened in
--    the unobserved gap — ungated, it would land as a false departure on the seed
--    day (the adversarial-review finding). Such rows get current_status='gap_exit'.
--  * days_to_sell = COALESCE(flip, departure) handles flip-and-linger AND delist
--    stores without classifying stores (design finding #4).
--
-- Apply via the Supabase SQL Editor BEFORE merging app/lib/inventoryAnalytics.js.
-- Requires Postgres 15+ (prod is 17.6).

BEGIN;

-- ---------------------------------------------------------------------------
-- v_product_lifecycle: one row per (handle, store_domain) product.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_product_lifecycle
WITH (security_invoker = true) AS
WITH
ledger AS (
  -- canonical cron-captured days only (backfill day excluded by design)
  SELECT observed_date FROM public.inventory_snapshot_days
),
bounds AS (
  SELECT (SELECT MIN(observed_date) FROM ledger) AS cold_start
),
agg AS (
  -- first/last seen across ALL snapshot rows (incl. backfill) + observation count
  SELECT handle, store_domain,
         MIN(observed_date) AS first_seen,
         MAX(observed_date) AS last_seen,
         COUNT(*)           AS days_observed
  FROM public.inventory_snapshots
  GROUP BY handle, store_domain
),
latest AS (
  -- most-recent attributes for each product
  SELECT DISTINCT ON (handle, store_domain)
         handle, store_domain, brand, title, name, category, subcategory,
         price, available AS latest_available, hidden AS latest_hidden
  FROM public.inventory_snapshots
  ORDER BY handle, store_domain, observed_date DESC
),
flips AS (
  -- first available true->false transition in the product's own observation order
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
  -- first LEDGER day strictly after last_seen (NULL => still present latest day).
  -- Gated on last_seen >= cold_start: a backfill-only product (never observed on
  -- a real ledger day) must NOT have its exit assigned to the seed day — its
  -- departure happened somewhere in the unobserved pre-ledger gap, date unknowable.
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
  -- unified time-to-first-sold-signal: flip if it fired, else departure (handles
  -- both store types without classification). NULL while still active.
  COALESCE(f.sold_at_flip - a.first_seen, dep.departed_at - a.first_seen)
    AS days_to_sell,
  -- left-censored: present on/before the first captured day => first_seen unknown
  (a.first_seen <= (SELECT cold_start FROM bounds)) AS first_seen_censored,
  CASE
    WHEN dep.departed_at IS NOT NULL THEN 'departed'  -- exit observed between two ledger days
    WHEN dep.gap_exit                THEN 'gap_exit'   -- backfill-only, gone before cold start
    WHEN l.latest_available = false  THEN 'sold'       -- flipped, still listed
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
-- PRE-LEDGER GUARD: before the first real captured day exists, cold_start is
-- NULL and every censoring/gap comparison above goes NULL — backfill-only rows
-- would surface as phantom 'active' inventory with NULL first_seen_censored
-- (which JS must not read as "uncensored"). No ledger => no analytics-valid
-- rows; the dashboard then shows its truthful day-0 empty state instead of
-- ~20k confident wrong numbers. (Round-3 adversarial finding.)
WHERE (SELECT cold_start FROM bounds) IS NOT NULL;

-- ---------------------------------------------------------------------------
-- v_daily_flow: one row per captured ledger day (global, all stores).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_daily_flow
WITH (security_invoker = true) AS
SELECT
  d.observed_date,
  (SELECT COUNT(*) FROM public.v_product_lifecycle l
     WHERE l.first_seen = d.observed_date)               AS arrivals,
  -- gap_exit rows carry departed_at = NULL, so pre-ledger backfill churn can
  -- never land here (no seed-day departure spike).
  (SELECT COUNT(*) FROM public.v_product_lifecycle l
     WHERE l.departed_at = d.observed_date)              AS departures,
  (SELECT COUNT(*) FROM public.inventory_snapshots s
     WHERE s.observed_date = d.observed_date
       AND s.available = true)                           AS active,
  -- the cold-start day's "arrivals" are the censored backlog seed, not real
  -- arrivals — flag it so the dashboard can gray it out.
  (d.observed_date = (SELECT MIN(observed_date)
                        FROM public.inventory_snapshot_days)) AS is_seed_day
FROM public.inventory_snapshot_days d
ORDER BY d.observed_date;

-- Lock down: service-role only (matches the fx_rates / snapshot-table convention).
REVOKE ALL ON public.v_product_lifecycle FROM anon, authenticated;
REVOKE ALL ON public.v_daily_flow        FROM anon, authenticated;
GRANT SELECT ON public.v_product_lifecycle TO service_role;
GRANT SELECT ON public.v_daily_flow        TO service_role;

COMMIT;

-- Guard (run after apply): both views resolve and are queryable (0 rows pre-capture).
SELECT (SELECT COUNT(*) FROM public.v_product_lifecycle) AS lifecycle_rows,
       (SELECT COUNT(*) FROM public.v_daily_flow)        AS flow_days;
