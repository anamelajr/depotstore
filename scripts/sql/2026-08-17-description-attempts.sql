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
--      selected ids BEFORE issuing any generation, so an overlapping or
--      retried invocation cannot claim the same rows. The write-side
--      `.is("editorial_description", null)` guard prevents duplicate WRITES;
--      it does nothing about duplicate CALLS, which are what costs money.
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

-- Supports the claim SELECT: newest-first among visible rows that still need a
-- description and have attempts left. Same visibility predicate as the feed
-- indexes — keep it byte-identical to `withVisibility`.
--
-- CREATE INDEX CONCURRENTLY cannot run in a transaction — run on its own.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_needs_description
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
