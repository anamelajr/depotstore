-- Retire the Supabase-side inventory-insights layer (docs/plan-inventory-local-archive.md, P3).
--
-- Once /admin/inventory reads the LOCAL archive, the MVs are dead weight — and
-- worse than dead: after the first --prune drain they would compute lifecycles
-- over a 14-day window and report every older item as departed. Drop them BEFORE
-- pruning starts.
--
-- Order matters: unschedule the pg_cron job first (it calls the function), then
-- the wrapper views, then the MVs, then the function.
--
-- Apply via the Supabase SQL Editor (MCP is read-only), AFTER the P2 parity diff
-- is clean.

BEGIN;
SELECT cron.unschedule('refresh-inventory-insights');
DROP VIEW IF EXISTS public.v_product_lifecycle;
DROP VIEW IF EXISTS public.v_daily_flow;
DROP MATERIALIZED VIEW IF EXISTS public.mv_daily_flow;
DROP MATERIALIZED VIEW IF EXISTS public.mv_product_lifecycle;
DROP FUNCTION IF EXISTS public.refresh_inventory_insights();
COMMIT;

-- Then, AFTER the first --prune drain (confirm via the archiver log first):
--   SELECT COUNT(*), MIN(observed_date) FROM public.inventory_snapshots;
--
-- VACUUM FULL runs alone — not inside a transaction block. Its AccessExclusive
-- lock may collide with one hourly capture attempt; capture is failure-isolated
-- and retries the next hour by design, so run this a few minutes after the top
-- of an hour. Chosen over a table swap because the post-drain table is only
-- ~150-200 MB (short rewrite) and it preserves the generated column, the UNIQUE
-- constraint, the indexes and RLS with zero recreation risk.
--
--   VACUUM FULL public.inventory_snapshots;
--
--   SELECT pg_size_pretty(pg_total_relation_size('public.inventory_snapshots')),
--          pg_size_pretty(pg_database_size(current_database()));
--
-- Dead backfill tables to drop while in the editor (~25 MB). The last one's
-- 2026-05-21 head-start was ALREADY imported into inventory_snapshots (verified:
-- 20,352 rows at observed_date 2026-05-21), so dropping it forfeits nothing:
--
--   DROP TABLE IF EXISTS public.atdawn_hide_backfill_2026_05_17;
--   DROP TABLE IF EXISTS public.products_subcategory_backfill_snapshot;
--   DROP TABLE IF EXISTS public.products_pre_subcategory_snapshot;
