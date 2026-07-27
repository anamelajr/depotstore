-- Index inventory_snapshots.observed_date (applied to production 2026-07-27).
--
-- WHY: the archiver's per-day verification/prune path counts and reads rows by
-- observed_date (`.eq("observed_date", day)`), but the table only had indexes
-- on observed_at and (handle, store_domain, observed_at). At ~1M bloated rows
-- the seq-scan count blew the authenticator's 8s statement_timeout (observed:
-- 8.7s → HTTP 500 with an empty message) and the first archiver run failed
-- closed at its first verify. With the index the same count returns in <1s.
--
-- Applied as a single statement OUTSIDE a transaction (CONCURRENTLY refuses
-- transaction blocks); CONCURRENTLY avoids blocking the hourly capture's
-- inserts. Safe to re-run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inv_snap_observed_date
  ON public.inventory_snapshots (observed_date);
