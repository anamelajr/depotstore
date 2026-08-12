-- Featured Archives — queryable era signal.
--
-- era_year: DERIVED — deterministic parse of season/year tokens in title/name
-- (app/lib/parseEra.js). NOT editorial: fully recomputable, no judgment; the
-- COALESCE/write-once protection that guards brand/title/category/subcategory
-- deliberately does NOT apply. Every writer (cron Step 2, enrich, the backfill)
-- performs a plain overwrite.
--
-- INT, not text/daterange: archive membership rules are gte/lte predicates, and
-- a split season (FW02/03) takes its opening year by definition.
ALTER TABLE products ADD COLUMN IF NOT EXISTS era_year INT;

-- Partial: ~1/3 of rows carry no era signal at all and no archive rule ever
-- selects on era_year IS NULL alone (the un-yeared rules always pair it with
-- brand + attribution).
CREATE INDEX IF NOT EXISTS idx_products_era_year
  ON products (era_year) WHERE era_year IS NOT NULL;
