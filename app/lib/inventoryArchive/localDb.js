// Local SQLite mirror of inventory_snapshots (docs/plan-inventory-local-archive.md).
//
// node:sqlite is imported DYNAMICALLY, never at module top level: this module is
// reachable from the admin dashboard bundle, and a static `import "node:sqlite"`
// would make prod builds (Vercel) resolve a Node-only builtin the app must never
// touch. `openArchiveDb` is the only entry point.

/**
 * Open (creating if needed) the local archive DB and migrate its schema.
 * @param {object} opts {path: string, readonly?: boolean}
 * @returns {Promise<import("node:sqlite").DatabaseSync>}
 */
export async function openArchiveDb({ path, readonly = false } = {}) {
  if (!path) throw new Error("openArchiveDb: path required");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path, readonly ? { readOnly: true } : {});
  if (!readonly) migrate(db);
  return db;
}

export const SCHEMA_VERSION = "1";

// Kept as one string so the migration is a single exec() — every statement is
// IF NOT EXISTS, so re-running is a no-op.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id INTEGER PRIMARY KEY,              -- Supabase bigserial id, verbatim
  observed_at TEXT NOT NULL,
  observed_date TEXT NOT NULL,         -- copied from the Supabase generated column, NEVER recomputed (TZ safety)
  handle TEXT NOT NULL,
  store_domain TEXT NOT NULL,
  shopify_id INTEGER,
  brand TEXT, title TEXT, name TEXT, category TEXT, subcategory TEXT,
  price TEXT, available INTEGER, hidden INTEGER,
  UNIQUE (handle, store_domain, observed_date)
);
CREATE INDEX IF NOT EXISTS idx_snap_date ON inventory_snapshots(observed_date);
CREATE INDEX IF NOT EXISTS idx_snap_hsd  ON inventory_snapshots(handle, store_domain, observed_date);

-- Ledger mirror + per-day state machine.
CREATE TABLE IF NOT EXISTS archive_days (
  observed_date TEXT PRIMARY KEY,
  -- 1 = mirrored from inventory_snapshot_days; 0 = orphan day (rows exist with
  -- no ledger entry — e.g. the 2026-05-21 backfill). Derived SQL uses ONLY
  -- in_ledger = 1; pruning uses both.
  in_ledger INTEGER NOT NULL DEFAULT 0,
  supabase_row_count INTEGER,          -- ledger row_count (WARN-ONLY crosscheck)
  local_row_count INTEGER,
  verified_at TEXT,                    -- only after remote count == local count AND local > 0
  deleted_from_supabase_at TEXT        -- only after remote count == 0
);

-- Immutable verified baseline. One row per day (ledger AND orphan), written at
-- verification time; mirror/recount never touch it — the only mutation path is
-- explicit re-verification against live remote data. row_hash = SHA-256 over the
-- day's rows ordered by id; rechecked only by --deep-verify. max_id = MAX(id) at
-- verification: the deletion watermark (delete set = local ids <= max_id).
CREATE TABLE IF NOT EXISTS day_manifest (
  observed_date TEXT PRIMARY KEY,
  in_ledger INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  row_hash TEXT NOT NULL,
  max_id INTEGER NOT NULL,
  verified_at TEXT NOT NULL
);

-- schema_version, last_run_at, last_run_status, last_archived_day,
-- initialized_at (first fully-verified mirror; continuity-guard input),
-- last_snapshot_at (last successful VACUUM INTO snapshot)
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

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
`;

/** Create/upgrade the schema. Safe to call on every open. */
export function migrate(db) {
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(SCHEMA_SQL);
  setMeta(db, "schema_version", SCHEMA_VERSION);
  return db;
}

export function setMeta(db, key, value) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value == null ? null : String(value));
}

export function getMeta(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : null;
}

/** The 13 snapshot columns, in the order the mirror insert binds them. */
export const SNAPSHOT_COLUMNS = [
  "id", "observed_at", "observed_date", "handle", "store_domain", "shopify_id",
  "brand", "title", "name", "category", "subcategory", "price", "available", "hidden",
];
