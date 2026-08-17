-- Visibility partial indexes for the feed.
--
-- Every product read on the site is gated by the same three predicates
-- (`withVisibility` in app/lib/productQueries.js, and the duplicated WHERE in
-- BOTH interleaved RPCs). Nothing indexed that predicate, so each read did a
-- sequential scan over the whole products table under an 8s statement_timeout.
--
-- The WHERE clause below is a byte-for-byte match of `withVisibility`:
--   available = true AND hidden = false AND (price IS NULL OR price <> '€0.00')
-- Postgres only uses a partial index when it can prove the query predicate
-- implies the index predicate — a drifted clause silently degrades every one
-- of these back to a seq scan with no error. If the visibility rule ever
-- changes, it changes HERE too, in the same commit.
--
-- NOT `CONCURRENTLY`, on purpose. The Supabase SQL Editor submits a script as
-- a single transaction, and CREATE INDEX CONCURRENTLY is one of the commands
-- Postgres refuses to run inside one — it fails there even as a lone
-- statement. A plain CREATE INDEX takes a ShareLock that blocks WRITES to
-- `products` while it builds; reads are unaffected. At ~27.7k rows that is a
-- matter of seconds, and the only writer is the hourly cron sync (a run that
-- overlapped would simply retry next hour). Safe to paste this whole file.
--
-- If you ever need the non-blocking build (a much larger table, or a sync you
-- can't afford to interrupt), run these through `psql` against the direct
-- connection string instead, where CONCURRENTLY works — not the web editor.

-- 1. Per-store newest-first. Serves the homepage daily rotation,
--    MoreFromStore, the store-filtered feed, and — the reason this one is
--    first — the `store_order` CTE inside get_interleaved_products /
--    count_interleaved_products, whose GROUP BY store_domain over all visible
--    rows becomes an index-only scan.
CREATE INDEX IF NOT EXISTS idx_products_visible_store_synced
  ON products (store_domain, synced_at DESC, id DESC)
  WHERE available = true AND hidden = false
    AND (price IS NULL OR price <> '€0.00');

-- 2. Global newest-first: the unfiltered feed and the newest/oldest sorts.
CREATE INDEX IF NOT EXISTS idx_products_visible_synced
  ON products (synced_at DESC, id DESC)
  WHERE available = true AND hidden = false
    AND (price IS NULL OR price <> '€0.00');

-- 3. Category / leaf-subcategory filtering.
CREATE INDEX IF NOT EXISTS idx_products_visible_category
  ON products (category, subcategory)
  WHERE available = true AND hidden = false
    AND (price IS NULL OR price <> '€0.00');

-- 4. AFTER verifying with EXPLAIN that the above are actually chosen, drop the
--    near-useless boolean index (a two-value column; the planner will not use
--    it, and it still costs on every write). Note there are TWO of them —
--    `idx_products_available` and `products_available_idx` are duplicates of
--    each other. Run these last, and only once the EXPLAIN check has passed.
-- DROP INDEX IF EXISTS idx_products_available;
-- DROP INDEX IF EXISTS products_available_idx;

-- Verification (read-only, safe to run any time):
--
--   EXPLAIN ANALYZE
--   SELECT id FROM products
--   WHERE available = true AND hidden = false
--     AND (price IS NULL OR price <> '€0.00')
--   ORDER BY synced_at DESC, id DESC LIMIT 42;
--
--   EXPLAIN ANALYZE SELECT * FROM get_interleaved_products(
--     NULL, NULL, NULL, NULL, NULL, 42, 0);
--
-- Expect "Index Only Scan using idx_products_visible_synced" / "... using
-- idx_products_visible_store_synced" for the store_order CTE. If the CTE still
-- dominates the RPC plan after this, do NOT reach for the stores-table variant
-- of the CTE — see docs/plan-site-performance-optimization.md §2.3: it makes
-- `get` and `count` disagree whenever a deactivated store's rows linger, which
-- strands the tail of the feed.
