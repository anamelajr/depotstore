-- Add fx_rates: single-row EUR->GBP/USD snapshot for the currency selector.
--
-- Phase 1 of the currency/region feature. Prices are stored as EUR text
-- ('€29.99'); the UI converts to GBP/USD at display time using this row.
-- EUR stays the stored/sorted base — this table only feeds display conversion.
--
-- Read path:  app/lib/fx.js getFxRates() (service-role; bypasses RLS).
-- Write path: app/lib/fx.js refreshFxRates(), called hourly from /api/cron.
-- Fallback:   if this table is missing/unreadable, getFxRates() returns the
--             hardcoded FALLBACK_RATES { GBP: 0.85, USD: 1.08 } and logs a
--             structured warning. That fallback is a safety net, NOT a
--             substitute for this migration being applied.
--
-- IMPORTANT — seed with TODAY'S REAL rates, not the FALLBACK_RATES constant.
-- If the seed equals 0.85/1.08 and the read later fails silently, live and
-- fallback values are indistinguishable and verification passes on broken
-- infra. The values below are real EUR->GBP/USD from Frankfurter (ECB ref
-- rate dated 2026-05-29). The hourly cron (refreshFxRates) overwrites them on
-- its next run, so exactness at apply-time is not critical — they only need to
-- differ from 0.85/1.08 so live vs. fallback stays distinguishable. If you are
-- applying this much later, feel free to refresh from
-- https://api.frankfurter.dev/v1/latest?from=EUR&to=GBP,USD first.
--
-- Apply via Supabase SQL Editor (MCP is read-only). Run BEFORE merging the
-- code that reads it, so the first deploy's getFxRates() finds a row.

BEGIN;

CREATE TABLE IF NOT EXISTS public.fx_rates (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  base        TEXT NOT NULL DEFAULT 'EUR',
  gbp         NUMERIC NOT NULL,
  usd         NUMERIC NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fx_rates_singleton CHECK (id = 1)
);

-- Idempotent seed of row 1 with real EUR->GBP/USD (Frankfurter, 2026-05-29).
INSERT INTO public.fx_rates (id, base, gbp, usd, fetched_at)
  VALUES (1, 'EUR', 0.86723, 1.1644, now())
  ON CONFLICT (id) DO UPDATE
  SET gbp = EXCLUDED.gbp, usd = EXCLUDED.usd, fetched_at = EXCLUDED.fetched_at;

-- RLS on, no policies: only the service-role server can read/write.
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Guard: MUST return 0 rows after seeding. If it returns the row, you seeded
-- the FALLBACK_RATES values and the live-vs-fallback check is defeated — re-seed.
SELECT * FROM public.fx_rates WHERE gbp = 0.85 AND usd = 1.08;
