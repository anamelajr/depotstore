-- price_cents: a DB-derived integer for price sorting.
--
-- `price` is TEXT ('€29.99', EUR) and stays canonical — that is a CLAUDE.md
-- invariant and this migration does not change it. But TEXT ordering is
-- lexicographic, so the feed's price sort could not order in the DB. It
-- compensated by fetching every matching row and sorting in JS — which
-- PostgREST silently caps at 1,000 rows against a catalog of ~8,000 visible
-- ones. "Cheapest first" was therefore sorting an arbitrary eighth of the
-- catalog: not slow, wrong. It also re-fetched the whole set on every
-- Load More.
--
-- STORED GENERATED, not a plain column with a backfill, because that makes
-- divergence impossible by construction:
--   • no backfill UPDATE and no dual-write window,
--   • no writer changes — Postgres computes it on every INSERT/UPDATE,
--   • Postgres REJECTS direct writes to a generated column, so a cron payload
--     that ever tries to set it fails loudly instead of drifting,
--   • rolling the app code back cannot corrupt the column.
--
-- The parse uses only IMMUTABLE functions (`~` / textregexeq and
-- regexp_replace are both provolatile='i'), which a generated column
-- requires. It is deliberately strict: anything that is not exactly
-- '€<digits>.<2 digits>' yields NULL rather than a guess. Verified against
-- production before applying — all 27,737 rows match the canonical form, and
-- the edge cases ('', '29.99', '€12,99', NULL) all resolve to NULL.
--
-- NULL price → NULL price_cents → sorts last via `nullsFirst: false`, and the
-- row stays visible: NULL means unknown, not unsellable (CLAUDE.md).

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS price_cents INT
  GENERATED ALWAYS AS (
    CASE
      WHEN price ~ '^€[0-9]+\.[0-9]{2}$'
        THEN (regexp_replace(price, '[^0-9]', '', 'g'))::int
      ELSE NULL
    END
  ) STORED;

-- Sort index under the same visibility predicate as the feed reads
-- (see 2026-08-17-feed-indexes.sql — the clause must stay byte-identical to
-- `withVisibility`). `id` is the deterministic tiebreaker, matching the
-- read path's `.order("price_cents").order("id")`.
--
-- CREATE INDEX CONCURRENTLY cannot run in a transaction — run this statement
-- on its own, after the ALTER has finished.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_visible_price_cents
  ON products (price_cents, id)
  WHERE available = true AND hidden = false
    AND (price IS NULL OR price <> '€0.00');

-- Post-apply parity spot-check (read-only): must return zero rows.
--
--   SELECT id, price, price_cents FROM products
--   WHERE price IS NOT NULL
--     AND price_cents IS DISTINCT FROM
--         (regexp_replace(price, '[^0-9]', '', 'g'))::int
--   LIMIT 20;
