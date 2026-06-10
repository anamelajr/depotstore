-- Add inventory_snapshots (+ inventory_snapshot_days ledger): forward-going
-- daily history of every product row, with per-day completeness tracking.
--
-- Phase 1 of the inventory-history feature (design:
-- docs/plan-inventory-history.md). The hourly Shopify->Supabase cron overwrites
-- `products` in place and hard-deletes departed rows, discarding all history.
-- This table captures one full snapshot per UTC day (including available=false
-- and hidden=true rows) so sell-through velocity and brand/category turnover can
-- be reconstructed later. It is WRITE-ONLY for analytics and never feeds the
-- storefront feed.
--
-- Write path: app/lib/captureInventorySnapshot.js, called once/day from
--             /api/cron AFTER the stale-delete, BEFORE the enrich trigger.
-- Read path:  none yet (Phase 2 dashboard, separate spec).
--
-- Storage: ~20,972 rows/day x 365 ~= 7.6M rows/yr ~= 1-3 GB/yr incl. indexes.
-- Keep indefinitely; revisit rollup/retention after a year of data.
--
-- Apply via the Supabase SQL Editor (MCP is read-only), BEFORE merging the code
-- that writes it, so the first post-deploy cron run finds the table.

BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_snapshots (
  id            bigserial PRIMARY KEY,
  observed_at   timestamptz NOT NULL,   -- = cron syncStart of the capturing run
  observed_date date GENERATED ALWAYS AS ((observed_at AT TIME ZONE 'UTC')::date) STORED,
  handle        text NOT NULL,
  store_domain  text NOT NULL,
  shopify_id    bigint,
  brand         text,
  title         text,
  name          text,
  category      text,
  subcategory   text,
  price         text,                   -- mirror canonical TEXT '€xx.xx' (EUR)
  available     boolean,
  hidden        boolean,
  -- One row per product per UTC day. Makes the daily insert idempotent and
  -- closes the read-then-insert duplicate-day race (insert uses ON CONFLICT
  -- DO NOTHING against this constraint).
  UNIQUE (handle, store_domain, observed_date)
);

CREATE INDEX IF NOT EXISTS idx_inv_snap_observed
  ON public.inventory_snapshots (observed_at);
CREATE INDEX IF NOT EXISTS idx_inv_snap_handle_store
  ON public.inventory_snapshots (handle, store_domain, observed_at);

-- Completeness ledger: one row per UTC day that was FULLY captured. The daily
-- gate checks THIS table, not the existence of rows in inventory_snapshots. A
-- capture that fails mid-insert commits some batches (each .upsert() is its own
-- transaction) but writes NO ledger row, so the next hourly run sees the day as
-- incomplete and retries — the data table's ON CONFLICT DO NOTHING fills only
-- the rows the partial run missed. Without this, gating on "any row exists for
-- today" would freeze a partial day forever (the bug Codex P2 #1 flagged).
CREATE TABLE IF NOT EXISTS public.inventory_snapshot_days (
  observed_date date PRIMARY KEY,
  observed_at   timestamptz NOT NULL,   -- = cron syncStart of the capturing run
  row_count     integer NOT NULL,       -- rows written for the day
  completed_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS on, no policies: only the service-role server can read/write (matches the
-- fx_rates convention). Phase 2's admin reads also use the service-role client.
ALTER TABLE public.inventory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_snapshot_days ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Guard (run after apply): both tables exist and are empty at creation time.
SELECT to_regclass('public.inventory_snapshots')      AS snapshots_table,
       to_regclass('public.inventory_snapshot_days')  AS days_table,
       (SELECT COUNT(*) FROM public.inventory_snapshots)     AS snapshots_rows,
       (SELECT COUNT(*) FROM public.inventory_snapshot_days) AS days_rows;
