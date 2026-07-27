-- archive_day_registry: the durable REMOTE witness for the local inventory
-- archive (docs/plan-inventory-local-archive.md).
--
-- WHY: after a day's rows are pruned from inventory_snapshots, the only remote
-- proof that day ever existed is the ledger — and ORPHAN days (rows with no
-- ledger entry, e.g. the 2026-05-21 backfill) have no ledger row at all. Without
-- this table, restoring a laptop backup that predates a pruned orphan day passes
-- every local check and silently loses the sole copy of that day.
--
-- The archiver upserts one row here at VERIFICATION time, before any pruning of
-- that day; the continuity guard enumerates required days from
-- `archive_day_registry ∪ inventory_snapshot_days` and requires each to have a
-- matching local day_manifest row (same row_count). A failed upsert fails
-- verification, so no tombstone — and therefore no delete — can follow.
--
-- Size: ~1 row/day. Never pruned.
--
-- Apply via the Supabase SQL Editor (MCP is read-only), BEFORE merging the
-- archiver code that writes it. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.archive_day_registry (
  observed_date date PRIMARY KEY,
  in_ledger     boolean NOT NULL,
  row_count     integer NOT NULL,
  row_hash      text    NOT NULL,   -- SHA-256 over the day's rows ordered by id
  verified_at   timestamptz NOT NULL
);

-- Same convention as inventory_snapshot_days: RLS enabled with NO policies, so
-- anon/authenticated see nothing; the service_role key bypasses RLS.
ALTER TABLE public.archive_day_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.archive_day_registry FROM anon, authenticated;
GRANT ALL ON public.archive_day_registry TO service_role;

COMMIT;

-- Guard (run after apply): table exists, empty, RLS on.
SELECT relrowsecurity AS rls_on,
       (SELECT COUNT(*) FROM public.archive_day_registry) AS rows
FROM pg_class WHERE oid = 'public.archive_day_registry'::regclass;
