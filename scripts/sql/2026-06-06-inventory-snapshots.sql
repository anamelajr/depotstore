-- Add inventory_snapshots: forward-going daily history of every product row.
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

-- RLS on, no policies: only the service-role server can read/write (matches the
-- fx_rates convention). Phase 2's admin reads also use the service-role client.
ALTER TABLE public.inventory_snapshots ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Guard (run after apply): table exists and is empty at creation time.
SELECT to_regclass('public.inventory_snapshots') AS table_exists,
       (SELECT COUNT(*) FROM public.inventory_snapshots) AS row_count;
