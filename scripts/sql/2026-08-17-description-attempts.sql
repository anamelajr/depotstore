-- description_attempts: claim/attempt counter for the editorial-description
-- backfill (app/api/backfill-descriptions/route.js).
--
-- Mirrors the `enrich_attempts` precedent exactly, and exists for two reasons:
--
--   1. Head-of-line starvation. The backfill selects the newest rows still
--      missing an `editorial_description`. Without a bounded attempt count, a
--      handful of rows whose source data can never produce a description would
--      be re-selected every hour forever, and the backlog behind them would
--      never drain.
--
--   2. Duplicate OpenAI spend. The route increments this counter on the
--      selected ids BEFORE issuing any generation, and its SELECT orders by
--      attempts ASC first — so an overlapping run sorts freshly-claimed rows
--      behind the untouched backlog and lands on a different batch. This is
--      soft deprioritization, not exclusion (attempts=1 still passes `< 3`);
--      see the route's claim comment for the accepted residual. The
--      write-side `.is("editorial_description", null)` guard prevents
--      duplicate WRITES; it does nothing about duplicate CALLS, which are
--      what costs money.
--
-- NOT NULL DEFAULT 0 so the route's `description_attempts < 3` predicate is
-- total — a nullable column would make `< 3` skip every existing row.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS description_attempts INT NOT NULL DEFAULT 0;

-- Claim RPC. PostgREST cannot express `col = col + 1`, so the counter bump is
-- a function — the same shape as the existing `increment_enrich_attempts`.
-- One statement over the whole claimed id set, issued BEFORE any generation.
CREATE OR REPLACE FUNCTION increment_description_attempts(p_ids BIGINT[])
RETURNS void
LANGUAGE sql
AS $$
  UPDATE products
     SET description_attempts = description_attempts + 1
   WHERE id = ANY(p_ids);
$$;

-- Release RPC. The route claims the whole batch up front, but the 240s
-- deadline can strand queued rows before any OpenAI call is issued for them.
-- After the pool drains, the route calls this on the never-attempted ids so a
-- stranded row doesn't burn attempts toward the < 3 cap without a single
-- generation. GREATEST floors at 0 defensively (a release should only ever
-- follow this run's own increment, but a double-release must not go negative).
CREATE OR REPLACE FUNCTION decrement_description_attempts(p_ids BIGINT[])
RETURNS void
LANGUAGE sql
AS $$
  UPDATE products
     SET description_attempts = GREATEST(description_attempts - 1, 0)
   WHERE id = ANY(p_ids);
$$;

-- Supports the claim SELECT: filters visible rows that still need a
-- description and have attempts left. The route orders by attempts ASC before
-- synced_at DESC, so this index serves the FILTER (partial-index predicate)
-- but not the sort order — Postgres sorts the surviving few-thousand rows,
-- which is fine under the 8s cap. Same visibility predicate as the feed
-- indexes — keep it byte-identical to `withVisibility`.
--
-- Plain CREATE INDEX (not CONCURRENTLY): see the note in
-- 2026-08-17-feed-indexes.sql.
CREATE INDEX IF NOT EXISTS idx_products_needs_description
  ON products (synced_at DESC, id DESC)
  WHERE available = true AND hidden = false
    AND (price IS NULL OR price <> '€0.00')
    AND editorial_description IS NULL
    AND description_attempts < 3;

-- Progress check (read-only):
--
--   SELECT count(*) FILTER (WHERE editorial_description IS NULL) AS missing,
--          count(*) FILTER (WHERE editorial_description IS NULL
--                             AND description_attempts >= 3) AS exhausted
--   FROM products
--   WHERE available = true AND hidden = false
--     AND (price IS NULL OR price <> '€0.00');
