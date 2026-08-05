-- 2026-08-05 — enrich_runs failure-detail counters.
--
-- Context: 2026-07-14 → 2026-08-05 every enrich run had openai_succeeded = 0
-- (~95 runs) and telemetry could not say why — cleanTitle.js collapses every
-- failure mode into the same retryable null. These columns decompose
-- openai_returned_null so a total outage (HTTP errors, empty completions) is
-- distinguishable from quality-gate churn. Telemetry only: cleanTitle's null
-- stays uniformly retryable and no behavior branches on the detail.
--
-- Apply by hand in the Supabase SQL Editor BEFORE merging the dependent code
-- (nullable adds are backward-compatible with the deployed insert).

ALTER TABLE enrich_runs
  ADD COLUMN openai_http_error INT,          -- cleanTitle: !res.ok (also see openai_last_http_status)
  ADD COLUMN openai_empty_content INT,       -- 200 with empty content (reasoning-token starvation)
  ADD COLUMN openai_parse_error INT,         -- content present but JSON.parse failed
  ADD COLUMN openai_validation_reject INT,   -- parsed OK, validateCleanTitleResult returned null
  ADD COLUMN openai_timeout_network INT,     -- outer catch: 8s abort, network, res.json() throw
  ADD COLUMN openai_last_http_status INT,    -- last non-OK status seen this batch (not a counter)
  ADD COLUMN brand_leak_blocked_model INT,   -- brand-leak gate fired on a truthy cleanTitle result
  ADD COLUMN brand_leak_blocked_fallback INT,-- brand-leak gate fired on a handle-fallback result
  ADD COLUMN row_errors INT;                 -- rows that threw out of the per-row try

-- Identity checks (read-only; expect zero rows violating):
--
-- Exact partition of cleanTitle-internal nulls:
--   SELECT id FROM enrich_runs
--   WHERE run_type = 'enrich' AND openai_http_error IS NOT NULL
--     AND openai_returned_null <> openai_http_error + openai_empty_content
--       + openai_parse_error + openai_validation_reject + openai_timeout_network;
--
-- Approximate (row_errors can fire after a success/null counter incremented):
--   SELECT id, openai_calls,
--          openai_succeeded + openai_returned_null
--        + brand_leak_blocked_model + row_errors AS accounted
--   FROM enrich_runs
--   WHERE run_type = 'enrich' AND openai_http_error IS NOT NULL
--     AND openai_calls <> openai_succeeded + openai_returned_null
--       + brand_leak_blocked_model + row_errors;
