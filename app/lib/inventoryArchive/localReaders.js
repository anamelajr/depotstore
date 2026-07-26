// Dashboard-side readers over the local archive. These are drop-in replacements
// for inventoryAnalytics.js's `readLifecycle` / `readFlow`, injected via
// getInventoryInsights({ readers }).
//
// SQLite has no boolean type: `first_seen_censored` / `is_seed_day` come back as
// 0/1. The pure analytics functions test them with STRICT equality
// (inventoryAnalytics.js:71, 170, 186 — `=== false` / `=== true`), so 0 would
// read as "unknown, exclude" and 1 would never equal true. Coercing here is the
// whole contract of this module.

import { openArchiveDb, getMeta } from "./localDb.js";

const DEFAULT_PATH = () => process.env.DEPOT_ARCHIVE_DB;

async function withDb(path, fn) {
  const file = path ?? DEFAULT_PATH();
  if (!file) throw new Error("DEPOT_ARCHIVE_DB is not set — no local archive path");
  const db = await openArchiveDb({ path: file, readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

// Exactly the projection of LIFECYCLE_COLUMNS (inventoryAnalytics.js), in order.
const LIFECYCLE_SELECT =
  "SELECT handle, store_domain, brand, category, first_seen, last_seen, " +
  "departed_at, sold_at_flip, days_to_sell_flip, days_to_departure, days_to_sell, " +
  "first_seen_censored, current_status, sold_signal_type, price FROM lifecycle";

const toBool = (v) => (v == null ? null : v === 1 || v === true);

function shapeLifecycle(r) {
  return {
    handle: r.handle,
    store_domain: r.store_domain,
    brand: r.brand,
    category: r.category,
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    departed_at: r.departed_at,
    sold_at_flip: r.sold_at_flip,
    days_to_sell_flip: r.days_to_sell_flip,
    days_to_departure: r.days_to_departure,
    days_to_sell: r.days_to_sell,
    first_seen_censored: toBool(r.first_seen_censored),
    current_status: r.current_status,
    sold_signal_type: r.sold_signal_type,
    price: r.price,
  };
}

/** All lifecycle rows (optionally store-filtered), ordered store_domain, handle. */
export async function readLifecycleLocal({ store = null, path = null } = {}) {
  return withDb(path, (db) => {
    const sql =
      LIFECYCLE_SELECT +
      (store ? " WHERE store_domain = ?" : "") +
      " ORDER BY store_domain, handle";
    const stmt = db.prepare(sql);
    const rows = store ? stmt.all(store) : stmt.all();
    return rows.map(shapeLifecycle);
  });
}

/** Daily flow rows, NEWEST-first (same order the Supabase path returns). */
export async function readFlowLocal({ since = null, path = null } = {}) {
  return withDb(path, (db) => {
    const sql =
      "SELECT observed_date, arrivals, departures, active, is_seed_day FROM daily_flow" +
      (since ? " WHERE observed_date >= ?" : "") +
      " ORDER BY observed_date DESC";
    const stmt = db.prepare(sql);
    const rows = since ? stmt.all(since) : stmt.all();
    return rows.map((r) => ({
      observed_date: r.observed_date,
      arrivals: r.arrivals,
      departures: r.departures,
      active: r.active,
      is_seed_day: toBool(r.is_seed_day),
    }));
  });
}

/** Freshness + provenance for the "Data as of …" note. */
export async function getArchiveMeta({ path = null } = {}) {
  return withDb(path, (db) => ({
    lastArchivedDay: getMeta(db, "last_archived_day"),
    lastRunAt: getMeta(db, "last_run_at"),
    lastRunStatus: getMeta(db, "last_run_status"),
    lastSnapshotAt: getMeta(db, "last_snapshot_at"),
    days: db.prepare("SELECT COUNT(*) AS n FROM archive_days WHERE in_ledger = 1").get().n,
    snapshotRows: db.prepare("SELECT COUNT(*) AS n FROM inventory_snapshots").get().n,
  }));
}

/** Reader pair shaped for getInventoryInsights({ readers }). */
export function makeLocalReaders({ path = null } = {}) {
  return {
    readLifecycle: ({ store = null } = {}) => readLifecycleLocal({ store, path }),
    readFlow: ({ since = null } = {}) => readFlowLocal({ since, path }),
  };
}
