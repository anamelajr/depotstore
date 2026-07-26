# Local Inventory-History Archive (Supabase → laptop)

## Context

Supabase free tier (0.5 GB) is at **126%** (0.632 GB), growing ~10 MB/day. The
culprit is `inventory_snapshots`: 1,012,687 rows — 46 daily full-catalog
snapshots × ~22k products (~400–500 MB incl. 4 indexes). This history feeds only
the **local-only** admin dashboard (`/admin/inventory`, 404 in prod). Departure
history is append-only and cannot be recomputed if lost.

**Approach (user-confirmed):** Supabase keeps a ~14-day hot window (table
reaches steady state); a launchd-scheduled archiver on the Mac mirrors all
snapshot history into a local SQLite file, verifies, then deletes verified rows
older than the cutoff. The dashboard computes lifecycle/flow over the full local
history. Fully hands-off: no user terminal commands, one-time setup by Claude.
User runs `npm run dev` for the dashboard; archive folder is backed up; user
accepts laptop as sole copy of old history.

## Invariants

- **Write path untouched**: `captureInventorySnapshot.js`, cron ordering, ledger
  gate, `products`, Vercel — all unchanged.
- **`inventory_snapshot_days` stays in Supabase forever** (capture gate +
  cold-start anchor; ~46 rows). Never pruned.
- **Delete never precedes verification** of that exact day; deletes target the
  frozen local id set, never a date-predicate delete (safety model from
  `scripts/backfillTitleClean.mjs`).
- Missed runs self-heal: Supabase buffers extra days until the next run drains.
- 8s PostgREST timeout: keyset-paged reads (1000/page by id), deletes chunked
  `.in("id", chunk)` of 500.
- Supabase MVs/views/pg_cron job are retired **before** pruning starts (post-
  deletion they'd compute wrong lifecycles).
- **Ledger days ≠ orphan days** (Codex finding #1, verified in prod): the
  2026-05-21 backfill (20,352 rows via
  `scripts/sql/2026-06-06-inventory-backfill-2026-05-21.sql`) exists in
  `inventory_snapshots` but deliberately NOT in the ledger — the ledger alone
  defines cold_start. `cold_start`, `departures`, seed-day, and `daily_flow`
  derive **only from mirrored ledger days** (`in_ledger = 1`); orphan days are
  tracked for pruning but never shape lifecycle semantics. An orphan-fed
  cold_start would flip every `gap_exit` to a false "departed", move the
  censoring boundary, and break MV parity.
- **Fail closed on archive-continuity violations** (Codex finding #2): a day
  with `local_row_count = 0` is NEVER marked verified — remote 0 == local 0 is
  evidence of a lost/fresh/mispathed archive after pruning, not of completeness.
  When remote state shows pruning has occurred (earliest remote snapshot day >
  earliest ledger day), the archiver refuses to verify/prune/rebuild against an
  uninitialized or gap-containing local DB and exits nonzero with a
  restore-from-backup message. Silent acceptance would let backup rotation age
  out the last good copy.
- **The `day_manifest` is the immutable verified baseline** (Codex round-2
  finding #1): at verification time each day (ledger AND orphan) gets exactly
  one manifest row `{row_count, row_hash, max_id}`. Recount/mirror NEVER update
  it; the ONLY mutation path is explicit re-verification against live remote
  data (below). Every run, before verify/prune/rebuild, every manifest day's
  live `COUNT(*)` must equal its manifest count — this catches truncated or
  mid-run-backup restores that a presence check would accept (a restored
  mid-mirror day with partial rows, or a missing orphan day, silently changes
  `agg`/`latest`/`flips`). A pruned remote day absent from the manifest is
  equally fatal. Hashes are rechecked only by `--deep-verify` (counts catch
  lost rows; rows are immutable — per-run hashing of 1M+ rows is not worth it).
- **Deletes are frozen at the verification watermark** (Codex round-3 finding
  #1): the delete set for a day is its local ids `<= manifest.max_id` — never
  "all local ids for the day". Postgres bigserial is monotonic, so any row
  inserted after verification (e.g. a manual old-date backfill, the 2026-05-21
  pattern) has a higher id and can NEVER be deleted unverified. Immediately
  before deleting, the day is rechecked (live count == manifest count, live
  MAX(id) == manifest.max_id); divergence routes through re-verification
  first. Post-verify divergence where the remote day still exists →
  **re-verify**: recompute count/hash/max_id against remote, update manifest +
  remote registry, log old→new loudly. Divergence where the remote day is gone
  → fatal. After deleting the frozen set, a nonzero remote remainder is a loud
  error and the tombstone is NOT written (no wedge: next run re-verifies).
- **`archive_day_registry` is the durable remote witness** (Codex round-3
  finding #2): a tiny never-pruned Supabase table (`observed_date PK,
  in_ledger, row_count, row_hash, verified_at`; RLS on, no policies — same
  convention as the ledger) upserted at verification time, BEFORE any pruning
  of that day. Orphan days have no ledger row, so after pruning the registry is
  the only durable proof they existed — without it, restoring a backup that
  predates a pruned orphan day passes every local check and silently loses the
  sole copy. The continuity guard enumerates required days from
  **registry ∪ ledger**, and registry counts must match the local manifest.
  Registry upsert failure fails verification (no tombstone possible). Size:
  ~1 row/day — negligible against the quota this project recovers.
- **Backups target the atomic snapshot, never the live WAL DB** (Codex round-2
  finding #2): file-copying a live WAL database (Time Machine during a run) can
  produce a torn/corrupt copy. Each successful run ends with `VACUUM INTO` a
  temp file → `PRAGMA integrity_check` → per-day counts vs manifest → atomic
  rename to `inventory-archive.snapshot.sqlite`. The snapshot is only ever
  replaced whole, so ANY backup of it is consistent; restores use the snapshot.
  First `--prune` is gated on a verified snapshot existing.

## Architecture

- **Local store:** built-in `node:sqlite` (Node 26, zero deps; verified working
  at `/opt/homebrew/bin/node`). File: `~/DepotArchive/inventory-archive.sqlite`
  — in `$HOME` root deliberately (iCloud sync interacts badly with WAL); user's
  backups cover the folder. Backup consistency comes from the per-run
  `VACUUM INTO` snapshot (`inventory-archive.snapshot.sqlite`, atomic-rename
  replaced, integrity-checked against the manifest) — never from file-copying
  the live WAL DB, which can tear mid-run.
- **Mirror-all, read-local-only:** archiver copies ALL new rows every run
  (keyset watermark on id), deletes only rows older than the cutoff. Local file
  always holds complete history; dashboard reads local only (staleness ≤ ~1 day,
  shown as a "Data as of …" note). No two-backend stitching.
- **Derived tables, not per-request compute:** the archiver rebuilds `lifecycle`
  + `daily_flow` tables at the end of each run (same rationale as the 2026-07-03
  MV fix — the raw query is too heavy to run per page load, and `DatabaseSync`
  is synchronous). Dashboard does trivial indexed SELECTs.
- **launchd:** `RunAtLoad=true` + StartCalendarInterval 09:30 & 21:30 (sleep-
  missed events coalesce on wake; RunAtLoad covers powered-off-at-schedule).

## Files

**Create:**
- `app/lib/inventoryArchive/localDb.js` — open/create/migrate SQLite (dynamic
  `await import("node:sqlite")` — never top-level, so prod builds never touch it).
  DDL below. `openArchiveDb({ path, readonly })`.
- `app/lib/inventoryArchive/derive.js` — translated lifecycle/flow SQL +
  `rebuildDerived(db)` (transactional refill + `ANALYZE`).
- `app/lib/inventoryArchive/archiverCore.js` — run algorithm, with injected
  supabase client / sqlite handle / clock (testable).
- `app/lib/inventoryArchive/localReaders.js` — `readLifecycleLocal({store})`,
  `readFlowLocal({since})`, `getArchiveMeta()`. Returns the exact 15-column
  lifecycle / 5-column flow shapes, ordered `store_domain, handle`, **coercing
  SQLite 0/1 → real booleans** (`first_seen_censored`, `is_seed_day`) — the pure
  functions use strict `=== false`/`=== true` (inventoryAnalytics.js:71,170,186).
- `app/lib/__tests__/inventoryArchive.test.js` — vitest units (below).
- `scripts/inventoryArchiver.mjs` — CLI following `backfillTitleClean.mjs`
  conventions: hand-parsed argv; `--env <path>` (default
  `join(__dirname,"../.env.local")` — launchd has cwd=/ and bare env); own
  `createClient(url, serviceRole, {auth:{persistSession:false}})` (never import
  `app/lib/supabase.js` from scripts); **mirror-only by default**, `--prune`
  enables deletion; `--parity`, `--deep-verify`, `--retain N` (default 14);
  `DEPOT_ARCHIVE_DB` env for file path. JSON-lines logs to
  `~/DepotArchive/logs/archiver-YYYY-MM.jsonl` (monthly rotation, prune >12mo).
- `scripts/launchd/com.depot.inventory-archiver.plist` — checked-in template
  (content below); installed copy → `~/Library/LaunchAgents/`.
- `scripts/sql/2026-07-XX-archive-day-registry.sql` — the durable remote
  witness table (DDL below in Invariants); **apply via SQL Editor BEFORE P1**
  (schema before dependent code — the archiver writes it at verify time).
- `scripts/sql/2026-07-XX-inventory-insights-retire.sql` — retirement + reclaim.

**Modify:**
- `app/lib/inventoryAnalytics.js` — extract flow query (L220–231) into
  `readFlow({since, db})`; add optional `readers = { readLifecycle, readFlow }`
  param to `getInventoryInsights` (defaults preserve current Supabase path; all
  pure functions and existing tests untouched).
- `app/admin/inventory/page.js` — if `process.env.DEPOT_ARCHIVE_DB` set:
  dynamic-import localReaders, pass `readers`, render "Data as of
  ⟨last_archived_day⟩ · local archive" note; friendly error if file missing;
  update the stale error copy naming `2026-06-08-inventory-insights.sql`.
  (Env var never set on Vercel → prod never touches `node:sqlite`.)
- `package.json` — `"archive": "node scripts/inventoryArchiver.mjs"` (dev use).
- `.env.local` (main checkout) —
  `DEPOT_ARCHIVE_DB=/Users/anamelajr/DepotArchive/inventory-archive.sqlite`.

## SQLite DDL (localDb.js)

```sql
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id INTEGER PRIMARY KEY,              -- Supabase bigserial id, verbatim
  observed_at TEXT NOT NULL,
  observed_date TEXT NOT NULL,         -- copied from Supabase generated col, NEVER recomputed (TZ safety)
  handle TEXT NOT NULL, store_domain TEXT NOT NULL, shopify_id INTEGER,
  brand TEXT, title TEXT, name TEXT, category TEXT, subcategory TEXT,
  price TEXT, available INTEGER, hidden INTEGER,
  UNIQUE (handle, store_domain, observed_date)
);
CREATE INDEX IF NOT EXISTS idx_snap_date ON inventory_snapshots(observed_date);
CREATE INDEX IF NOT EXISTS idx_snap_hsd  ON inventory_snapshots(handle, store_domain, observed_date);

CREATE TABLE IF NOT EXISTS archive_days (          -- ledger mirror + state machine
  observed_date TEXT PRIMARY KEY,
  in_ledger INTEGER NOT NULL DEFAULT 0,-- 1 = mirrored from inventory_snapshot_days;
                                       -- 0 = orphan day (rows, no ledger entry —
                                       -- e.g. the 2026-05-21 backfill). Derived
                                       -- SQL uses ONLY in_ledger=1; pruning uses both.
  supabase_row_count INTEGER,          -- ledger row_count (WARN-ONLY crosscheck)
  local_row_count INTEGER,
  verified_at TEXT,                    -- only after remote count == local count AND local > 0
  deleted_from_supabase_at TEXT        -- only after remote count == 0
);
-- Immutable verified baseline (Codex round-2 #1). One row per day, written at
-- verification time; mirror/recount never touch it — the only mutation path is
-- explicit re-verification against live remote data (round-3 #1). Covers
-- ledger AND orphan days. row_hash = SHA-256 over the day's rows ordered by id
-- (id|handle|store_domain|available|price per row) — rechecked only by
-- --deep-verify. max_id = MAX(id) at verification: the deletion watermark
-- (delete set = local ids <= max_id, never "all ids for the day").
CREATE TABLE IF NOT EXISTS day_manifest (
  observed_date TEXT PRIMARY KEY,
  in_ledger INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  row_hash TEXT NOT NULL,
  max_id INTEGER NOT NULL,
  verified_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
-- schema_version, last_run_at, last_run_status, last_archived_day,
-- initialized_at (set on first fully-verified mirror; continuity guard input),
-- last_snapshot_at (last successful VACUUM INTO snapshot)

CREATE TABLE IF NOT EXISTS lifecycle (             -- derived, rebuilt each run
  handle TEXT, store_domain TEXT, brand TEXT, title TEXT, name TEXT,
  category TEXT, subcategory TEXT, price TEXT,
  first_seen TEXT, last_seen TEXT, days_observed INTEGER,
  sold_at_flip TEXT, departed_at TEXT,
  days_to_sell_flip INTEGER, days_to_departure INTEGER, days_to_sell INTEGER,
  first_seen_censored INTEGER, current_status TEXT, sold_signal_type TEXT,
  PRIMARY KEY (handle, store_domain)
);
CREATE INDEX IF NOT EXISTS idx_lifecycle_store ON lifecycle(store_domain, handle);
CREATE TABLE IF NOT EXISTS daily_flow (
  observed_date TEXT PRIMARY KEY,
  arrivals INTEGER, departures INTEGER, active INTEGER, is_seed_day INTEGER
);
```

## Derived SQL (derive.js) — faithful translation of the MV

Source: `scripts/sql/2026-07-03-inventory-insights-mv.sql:44-117` (lifecycle),
`:129-143` (flow). Mappings: `DISTINCT ON` → `ROW_NUMBER()` (exactly equivalent
here — the UNIQUE constraint makes per-(handle,store,date) ties impossible);
`date - date` → `CAST(julianday(a)-julianday(b) AS INTEGER)`; booleans → 0/1
(NULL semantics of `available = 0 AND prev_available = 1` match Postgres);
`cold_start` = MIN over **ledger days only** (`archive_days WHERE in_ledger = 1`)
— exactly mirroring the MV's `FROM inventory_snapshot_days`. The 2026-05-21
orphan backfill day must NOT participate in bounds/departures/flow, or gap_exit
and censoring semantics diverge from the MV and parity fails.

```sql
INSERT INTO lifecycle
WITH
ledger AS (SELECT observed_date FROM archive_days WHERE in_ledger = 1),
bounds AS (SELECT MIN(observed_date) AS cold_start FROM ledger),
agg AS (
  SELECT handle, store_domain, MIN(observed_date) AS first_seen,
         MAX(observed_date) AS last_seen, COUNT(*) AS days_observed
  FROM inventory_snapshots GROUP BY handle, store_domain
),
latest AS (
  SELECT handle, store_domain, brand, title, name, category, subcategory,
         price, available AS latest_available
  FROM (SELECT s.*, ROW_NUMBER() OVER (
          PARTITION BY handle, store_domain ORDER BY observed_date DESC) AS rn
        FROM inventory_snapshots s) WHERE rn = 1
),
flips AS (
  SELECT handle, store_domain, MIN(observed_date) AS sold_at_flip
  FROM (SELECT handle, store_domain, observed_date, available,
               LAG(available) OVER (
                 PARTITION BY handle, store_domain ORDER BY observed_date) AS prev_available
        FROM inventory_snapshots)
  WHERE available = 0 AND prev_available = 1
  GROUP BY handle, store_domain
),
departures AS (
  SELECT a.handle, a.store_domain,
    CASE WHEN a.last_seen >= b.cold_start THEN
      (SELECT MIN(d.observed_date) FROM ledger d WHERE d.observed_date > a.last_seen)
    END AS departed_at,
    (a.last_seen < b.cold_start) AS gap_exit
  FROM agg a CROSS JOIN bounds b
)
SELECT a.handle, a.store_domain,
  l.brand, l.title, l.name, l.category, l.subcategory, l.price,
  a.first_seen, a.last_seen, a.days_observed, f.sold_at_flip, dep.departed_at,
  CAST(julianday(f.sold_at_flip)  - julianday(a.first_seen) AS INTEGER),
  CAST(julianday(dep.departed_at) - julianday(a.first_seen) AS INTEGER),
  CAST(COALESCE(julianday(f.sold_at_flip), julianday(dep.departed_at))
       - julianday(a.first_seen) AS INTEGER),
  (a.first_seen <= (SELECT cold_start FROM bounds)),
  CASE WHEN dep.departed_at IS NOT NULL THEN 'departed'
       WHEN dep.gap_exit THEN 'gap_exit'
       WHEN l.latest_available = 0 THEN 'sold'
       ELSE 'active' END,
  CASE WHEN f.sold_at_flip IS NOT NULL THEN 'flip'
       WHEN dep.departed_at IS NOT NULL THEN 'delist'
       ELSE NULL END
FROM agg a
JOIN latest l USING (handle, store_domain)
LEFT JOIN flips f USING (handle, store_domain)
JOIN departures dep USING (handle, store_domain)
WHERE (SELECT cold_start FROM bounds) IS NOT NULL;

INSERT INTO daily_flow
SELECT d.observed_date,
  (SELECT COUNT(*) FROM lifecycle l WHERE l.first_seen  = d.observed_date),
  (SELECT COUNT(*) FROM lifecycle l WHERE l.departed_at = d.observed_date),
  (SELECT COUNT(*) FROM inventory_snapshots s
     WHERE s.observed_date = d.observed_date AND s.available = 1),
  (d.observed_date = (SELECT MIN(observed_date) FROM archive_days WHERE in_ledger = 1))
FROM archive_days d WHERE d.in_ledger = 1 ORDER BY d.observed_date;
```

## Archiver run algorithm (archiverCore.js)

1. **Preflight** — load env, require URL + service key, mkdir archive+logs, open
   DB (note whether the file existed), migrate schema. `O_EXCL` lockfile with
   stale-PID detection (launchd already serializes per label; this guards
   manual runs).
2. **Mirror ledger** — page `inventory_snapshot_days` → upsert
   `archive_days` with `in_ledger = 1` + `supabase_row_count`.
2b. **Continuity guard (fail closed)** — two independent checks, both required
   BEFORE verify/prune/rebuild; failure of either aborts nonzero with
   `archive-continuity-violation: restore ~/DepotArchive from backup`.
   (a) *Remote-evidence check*: `remote_min_snap` = earliest
   `inventory_snapshots.observed_date` (indexed head query on `observed_at`);
   required-day set = **`archive_day_registry` ∪ ledger** days older than
   `remote_min_snap` (the registry is what makes pruned ORPHAN days
   enumerable — the ledger alone cannot witness them). If that set is
   non-empty (pruning has happened), the archive must be initialized
   (`meta.initialized_at`) and every required day must be present in
   `day_manifest` **with row_count matching the registry** — a pruned day
   missing or mismatched means this file never (or incompletely) verified it
   and Supabase can no longer repair it.
   (b) *Manifest-integrity check*: for EVERY `day_manifest` row, live
   `COUNT(*)` on `idx_snap_date` must equal `row_count`. Catches truncated and
   mid-run-backup restores (partial day rows) and missing orphan days that a
   presence check would accept. Cheap: one indexed count per day.
   Mirroring (step 3) may still run first — it only adds rows and is always
   safe; nothing may be verified, deleted, or republished to the dashboard from
   a continuity-violating archive. `meta.initialized_at` is set once, at the
   end of the first run in which every remote day verified clean (P1 exit
   criterion).
3. **Mirror rows by id watermark** — `cursor = local MAX(id)`; loop
   `.select("*").gt("id", cursor).order("id", asc).limit(1000)` (keyset — PK-
   indexed, immune to offset drift + 8s cap); each page one transaction with
   `INSERT OR IGNORE`. Sound: snapshot rows are append-only/immutable, new rows
   always higher ids. Crash mid-run → committed pages stand, resume from
   watermark.
4. **Recount** — refresh `archive_days.local_row_count` from local GROUP BY;
   also insert archive_days rows for **orphan days** (rows but no ledger entry)
   with `in_ledger = 0` — the known one is the 2026-05-21 backfill (20,352
   rows, verified in prod); future ones would be never-completed captures.
   Orphans are prunable (they hold real rows that Supabase should shed) but
   NEVER feed cold_start/departures/flow (invariant above).
5. **Cutoff** — 14th-newest ledger day (`--retain`). Candidates = local days
   strictly older, `deleted_from_supabase_at IS NULL`.
6. **Verify** (per candidate lacking `verified_at`) — remote
   `.select("id",{count:"exact",head:true}).eq("observed_date", day)` must
   **equal** local count **and local count must be > 0** → write the day's
   `day_manifest` row (count + hash + `max_id` watermark), **upsert the remote
   `archive_day_registry` row** (upsert failure = verification failure, no
   tombstone possible), then set `verified_at`. Remote 0 == local 0 is NEVER
   verification — it is a continuity violation: fatal, abort nonzero. Remote 0
   with local > 0 but **no manifest entry** is equally fatal (pruned day this
   file never verified — e.g. a mid-mirror restore). Ledger `row_count`
   mismatch is warn-only (partial-run capture races make it approximate — NOT
   ground truth). Remote > local → day-repair (paged re-read + INSERT OR
   IGNORE), re-verify once. Remote < local on unverified day → loud log, skip,
   never delete. `--deep-verify` re-reads remote days and hash-compares
   per-row, and recomputes local hashes against `day_manifest` (run once
   before drain).
6b. **Re-verify** (already-verified day whose live state diverged from its
   manifest — detected in 2b(b) or the pre-delete recheck): allowed ONLY when
   the divergent rows all have `id > manifest.max_id` AND the remote day still
   exists (i.e. a legitimate post-verification insert, like a manual old-date
   backfill). Recompute count/hash/max_id against remote, update manifest +
   registry, log old→new loudly. Any other divergence — remote day gone, or
   rows missing below the watermark — is fatal (restore-from-backup).
7. **Delete** (only `--prune`, per candidate WITH `verified_at`) — pre-delete
   recheck first: live count == manifest count AND live MAX(id) ==
   `manifest.max_id`; divergence routes through 6b before any delete. Delete
   set = local ids **`<= manifest.max_id`** (frozen at verification — a row
   inserted after verify has a higher bigserial id and can never enter the
   set), chunks of 500 → `.delete({count:"exact"}).in("id", chunk)`; then
   remote count must be 0 → set `deleted_from_supabase_at`. A nonzero
   remainder (post-verify rows appeared mid-run) → loud error, NO tombstone;
   next run re-verifies via 6b and finishes cleanly. Crash mid-delete
   self-heals: `verified_at` already set, next run resumes the same frozen
   ids. (Verification is skip-if-already-verified precisely so a half-deleted
   day can't deadlock the state machine.)
8. **Rebuild derived** — transactional refill of `lifecycle` + `daily_flow`,
   `ANALYZE`, update `meta`.
9. **Snapshot** (every successful run that changed data) — `VACUUM INTO`
   `inventory-archive.snapshot.tmp` → open it read-only: `PRAGMA
   integrity_check` + per-day counts vs `day_manifest` → fsync → atomic
   `rename()` over `inventory-archive.snapshot.sqlite`; set
   `meta.last_snapshot_at`. This IS the restore test: the file backups protect
   is verified-consistent by construction, and only ever replaced whole.
   (~seconds for a ~200 MB file, daily.) Snapshot failure fails the run
   nonzero but never blocks the already-completed mirror/verify state.
10. **Finish** — `PRAGMA wal_checkpoint(TRUNCATE)` (hygiene, no longer the
   backup-consistency mechanism); JSON summary line (`mirrored, verifiedDays,
   deletedDays, deletedRows, snapshotOk, durationMs`); exit 0. Fatal errors:
   structured log + nonzero exit; safe at any point by ordering.

Concurrency: cron writes only today; archiver deletes only old days; dashboard
opens the file `readonly` under WAL — no interference anywhere.

## launchd plist

`~/Library/LaunchAgents/com.depot.inventory-archiver.plist`: ProgramArguments
`[/opt/homebrew/bin/node, /Users/anamelajr/depotstore/scripts/inventoryArchiver.mjs,
--prune, --env, /Users/anamelajr/depotstore/.env.local]`;
StartCalendarInterval 09:30 + 21:30; `RunAtLoad=true`; `ThrottleInterval=300`;
WorkingDirectory `/Users/anamelajr/depotstore`; stdout/stderr →
`~/DepotArchive/logs/launchd.{out,err}.log`. **Paths point at the main checkout,
not the worktree — install only after merge**, via
`launchctl bootstrap gui/$(id -u) …` (one-time, done by Claude).

## Retirement + reclaim SQL (SQL Editor; MCP is read-only)

`scripts/sql/2026-07-XX-inventory-insights-retire.sql`, applied after parity:

```sql
BEGIN;
SELECT cron.unschedule('refresh-inventory-insights');
DROP VIEW IF EXISTS public.v_product_lifecycle;
DROP VIEW IF EXISTS public.v_daily_flow;
DROP MATERIALIZED VIEW IF EXISTS public.mv_daily_flow;
DROP MATERIALIZED VIEW IF EXISTS public.mv_product_lifecycle;
DROP FUNCTION IF EXISTS public.refresh_inventory_insights();
COMMIT;
```

Then, after the first `--prune` drain (verify via archiver log +
`SELECT COUNT(*), MIN(observed_date) FROM inventory_snapshots`):

```sql
VACUUM FULL public.inventory_snapshots;   -- runs alone, not in a txn
SELECT pg_size_pretty(pg_total_relation_size('public.inventory_snapshots')),
       pg_size_pretty(pg_database_size(current_database()));
```

VACUUM FULL over table-swap: post-drain table is ~150–200 MB so the rewrite is
short; preserves generated column, UNIQUE, indexes, RLS with zero recreation
risk. Its lock may collide with one hourly capture attempt — capture is failure-
isolated and retries next hour by design. Run a few minutes after the top of an
hour. Also drop the three dead backfill tables while in the editor (~25 MB):
`atdawn_hide_backfill_2026_05_17`, `products_subcategory_backfill_snapshot`,
`products_pre_subcategory_snapshot` — the last one's 2026-05-21 head-start was
**already imported** into `inventory_snapshots` (verified: 20,352 rows at
observed_date 2026-05-21), so dropping it forfeits nothing.

## Rollout (safety-first order)

- **P1 — Archiver, mirror-only.** Apply `archive-day-registry.sql` via the SQL
  Editor FIRST (schema before dependent code). Build modules + CLI + tests.
  Claude runs the archiver (no `--prune`) until every ledger day shows
  `local_row_count == remote count` and the registry is fully populated; run
  `--deep-verify` once over all days.
- **P2 — Dashboard on local + parity.** Wire readers; `--parity` diffs
  `v_product_lifecycle`/`v_daily_flow` vs local `lifecycle`/`daily_flow`
  (canonicalized: sorted store+handle, booleans coerced, dates as strings; run
  right after a mirror so local max day == MV max day — MV refreshes at :20).
  Must diff to zero. The 2026-05-21 orphan day is the acid test: the MV's
  `gap_exit` rows must reproduce exactly (any local "departed @ 2026-06-10"
  rows mean the orphan leaked into cold_start). Then diff full
  `getInventoryInsights` JSON with readers toggled. Eyeball `/admin/inventory`
  in `next dev`.
- **P3 — Retire + automate.** Apply retirement SQL. Preconditions for the first
  `--prune`: `--deep-verify` clean over all days, AND a verified snapshot file
  exists (`meta.last_snapshot_at` set, integrity-checked). Run `--prune` once
  manually (drains ~700k rows in ~1,400 chunked deletes). Install plist +
  bootstrap; confirm a scheduled run fires and logs.
- **P4 — Reclaim.** VACUUM FULL + size guards; confirm Supabase usage drops
  under quota; confirm row count plateaus at ~14 × 22k over following days.

## Verification / test plan

Vitest (`app/lib/__tests__/inventoryArchive.test.js`) against
`new DatabaseSync(":memory:")` + the repo's fake-supabase builder pattern
(`inventoryAnalytics.test.js:18-51`, extended with `.gt/.limit/.delete/.in`/head-count):

- **derive.js**: fixtures with hand-computed expectations — flip sale; delist-
  only; flip-then-linger (flip wins days_to_sell); gap_exit; censored seed-day;
  relist-after-gap (no departure); NULL `available` around a flip (LAG NULL must
  not count); empty ledger → zero rows; **orphan-day exclusion** (fixture
  mirroring the 2026-05-21 backfill: an `in_ledger=0` day older than every
  ledger day must not shift cold_start, must leave pre-ledger exits as
  `gap_exit` not `departed`, and must not appear in `daily_flow`).
- **localReaders**: exact 15/5-column shapes; strict boolean coercion; feed
  outputs through `computeKpis`/`buildVelocityBuckets`/`storeSummary` and match
  the supabase-path fixtures (cross-engine parity at unit level).
- **archiverCore**: mirror idempotency (run twice → identical DB); crash-resume;
  verify-gate blocks deletes on count mismatch; day-repair; **delete never
  called on unverified day**; delete-resume on half-deleted day; cutoff math;
  orphan-day handling (in_ledger=0, prunable); ledger-mismatch warn-only;
  **continuity guards**: remote-0==local-0 is fatal, never verified; fresh DB
  when remote shows pruning evidence → abort before verify/prune/rebuild
  (covers deleted file, mistyped `DEPOT_ARCHIVE_DB`, partial restore);
  `meta.initialized_at` set only after a fully-verified mirror; **manifest
  guards**: manifest rows written once at verify and never updated by
  recount/mirror; live count ≠ manifest count aborts (mid-mirror-restore
  fixture: day with partial rows); pruned day with rows but no manifest entry
  aborts; orphan days carry manifest rows too (restore missing only the
  2026-05-21 day must abort); **watermark guards** (round 3): late old-date
  insert between verify and delete → frozen set deletes only ids <= max_id,
  remainder detected, no tombstone, next run re-verifies via 6b and completes;
  pre-delete recheck routes divergence through 6b; re-verify is fatal when the
  remote day is gone or rows are missing below the watermark; **registry
  guards**: stale-snapshot restore missing a pruned orphan day's rows AND
  manifest is caught by the registry ∪ ledger required-day set; registry
  upsert failure blocks `verified_at` (and therefore any tombstone);
  **snapshot**: tmp → integrity+manifest check → atomic rename; failed check
  leaves the previous snapshot untouched; prune refuses to run when no
  verified snapshot exists.
- **inventoryAnalytics.js**: existing tests unchanged; one new test for the
  `readers` override.

End-to-end: P1/P2 live verification against production data (read-only until
P3); `npm test`; dashboard eyeball on localhost before any deletion is enabled.

## Residual risks (accepted)

- Laptop = sole copy of pruned history → user's backups capture the atomic
  `VACUUM INTO` snapshot (verified-consistent by construction, replaced only
  whole); the manifest makes any truncated/torn restore fail closed instead of
  silently publishing corrupted analytics. Deliberately NOT adopted from the
  Codex review: per-run hash verification (counts catch lost rows; rows are
  immutable; hashes live in the manifest and are checked by `--deep-verify`)
  and a separate automated restore drill (the snapshot's post-build
  integrity+manifest check on a freshly-opened file IS the restore test).
  From round 3, persisting exact verified id SETS was trimmed to the
  `max_id` watermark — bigserial monotonicity makes one integer equivalent to
  storing all ~22k ids per day.
- Homebrew node upgrades: `node:sqlite` is stable in 26.x; plist uses the stable
  symlink; if node vanishes, launchd logs failures and Supabase buffers days —
  no data-loss window exists by construction.
- Count-only verification could miss a corrupted row; rows are immutable and
  inserted from the same read they're verified against; `--deep-verify` hash-
  compares before the only mass deletion.
