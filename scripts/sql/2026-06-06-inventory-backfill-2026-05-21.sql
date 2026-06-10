-- OPTIONAL one-time historical backfill of inventory_snapshots from the
-- 2026-05-21 full-row snapshot (products_pre_subcategory_snapshot, ~20,352 rows),
-- giving velocity metrics a ~2.5-week head start before the cold-start seed date.
-- Safe to skip entirely; safe to re-run (idempotent).
--
-- Apply AFTER 2026-06-06-inventory-snapshots.sql, via the Supabase SQL Editor.
--
-- observed_at is pinned to a single instant so every row shares observed_date
-- 2026-05-21 (the source's synced_at spans 2026-05-20 23:21 .. 05-21 08:33 UTC;
-- a per-row synced_at would split the tick across two UTC dates). subcategory is
-- NULL — the source table predates the subcategory column.

INSERT INTO public.inventory_snapshots
  (observed_at, handle, store_domain, shopify_id, brand, title, name,
   category, subcategory, price, available, hidden)
SELECT
  TIMESTAMPTZ '2026-05-21T00:00:00Z',
  handle, store_domain, shopify_id, brand, title, name,
  category, NULL::text, price, available, hidden
FROM public.products_pre_subcategory_snapshot
ON CONFLICT (handle, store_domain, observed_date) DO NOTHING;

-- Verify: expect ~20,352 rows for the 2026-05-21 tick.
SELECT COUNT(*) AS backfilled_rows
FROM public.inventory_snapshots
WHERE observed_date = DATE '2026-05-21';
