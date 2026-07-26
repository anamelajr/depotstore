// Derived lifecycle/flow tables for the local archive — a faithful translation
// of scripts/sql/2026-07-03-inventory-insights-mv.sql (:44-117 lifecycle,
// :129-143 flow) into SQLite.
//
// Mappings:
//   DISTINCT ON            -> ROW_NUMBER() (exactly equivalent here: the UNIQUE
//                             (handle, store_domain, observed_date) constraint
//                             makes per-partition ties impossible)
//   date - date            -> CAST(julianday(a) - julianday(b) AS INTEGER)
//   booleans               -> 0/1 (the NULL semantics of
//                             `available = 0 AND prev_available = 1` match Postgres)
//   FROM inventory_snapshot_days -> archive_days WHERE in_ledger = 1
//
// cold_start is MIN over LEDGER DAYS ONLY. The 2026-05-21 orphan backfill day
// has rows but deliberately no ledger entry; letting it into bounds/departures/
// flow would flip every gap_exit row to a false "departed", move the censoring
// boundary, and break MV parity.

export const LIFECYCLE_SQL = `
INSERT INTO lifecycle (
  handle, store_domain, brand, title, name, category, subcategory, price,
  first_seen, last_seen, days_observed, sold_at_flip, departed_at,
  days_to_sell_flip, days_to_departure, days_to_sell,
  first_seen_censored, current_status, sold_signal_type
)
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
`;

export const FLOW_SQL = `
INSERT INTO daily_flow (observed_date, arrivals, departures, active, is_seed_day)
SELECT d.observed_date,
  (SELECT COUNT(*) FROM lifecycle l WHERE l.first_seen  = d.observed_date),
  (SELECT COUNT(*) FROM lifecycle l WHERE l.departed_at = d.observed_date),
  (SELECT COUNT(*) FROM inventory_snapshots s
     WHERE s.observed_date = d.observed_date AND s.available = 1),
  (d.observed_date = (SELECT MIN(observed_date) FROM archive_days WHERE in_ledger = 1))
FROM archive_days d WHERE d.in_ledger = 1 ORDER BY d.observed_date;
`;

/**
 * Rebuild `lifecycle` + `daily_flow` from the mirrored snapshots. Transactional:
 * a failure leaves the previous derived tables intact.
 * @param {import("node:sqlite").DatabaseSync} db
 * @returns {{lifecycleRows: number, flowRows: number}}
 */
export function rebuildDerived(db) {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM lifecycle");
    db.exec("DELETE FROM daily_flow");
    db.exec(LIFECYCLE_SQL);
    db.exec(FLOW_SQL); // reads `lifecycle` — must run after it
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  db.exec("ANALYZE");
  return {
    lifecycleRows: db.prepare("SELECT COUNT(*) AS n FROM lifecycle").get().n,
    flowRows: db.prepare("SELECT COUNT(*) AS n FROM daily_flow").get().n,
  };
}
