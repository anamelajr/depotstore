// Archiver run algorithm (docs/plan-inventory-local-archive.md).
//
// Everything is injected — supabase client, sqlite handle, clock, logger — so
// the whole state machine is unit-testable against `new DatabaseSync(":memory:")`
// and a fake supabase builder.
//
// Safety model, in one line: nothing is ever deleted from Supabase that has not
// first been counted, hashed and watermarked into `day_manifest` AND witnessed in
// the remote `archive_day_registry`; and any divergence between those records and
// live state fails the run closed rather than repairing itself silently.

import { createHash } from "node:crypto";
import { rebuildDerived } from "./derive.js";
import { setMeta, getMeta } from "./localDb.js";

export const PAGE_SIZE = 1000;      // keyset page for remote reads (8s PostgREST cap)
export const DELETE_CHUNK = 500;    // ids per .in() delete (URL length)
export const DEFAULT_RETAIN = 14;   // ledger days kept hot in Supabase

/** Fatal, run-aborting condition. `code` is machine-readable in the JSON log. */
export class ArchiveError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ArchiveError";
    this.code = code;
  }
}

const RESTORE_HINT = "restore ~/DepotArchive from backup (inventory-archive.snapshot.sqlite)";

function fatal(code, message) {
  throw new ArchiveError(code, message);
}

const isoDate = (d) => d.toISOString().slice(0, 10);

// SHA-256 over the day's rows ordered by id. Deliberately narrow: identity +
// the two fields every derived value depends on (available, price).
export function hashRows(rows) {
  const h = createHash("sha256");
  for (const r of rows) {
    h.update(
      `${r.id}|${r.handle}|${r.store_domain}|${r.available == null ? "" : r.available ? 1 : 0}|${r.price ?? ""}\n`,
    );
  }
  return h.digest("hex");
}

function localDayRows(db, day, maxId = null) {
  const sql =
    "SELECT id, handle, store_domain, available, price FROM inventory_snapshots " +
    "WHERE observed_date = ?" + (maxId == null ? "" : " AND id <= ?") + " ORDER BY id";
  const stmt = db.prepare(sql);
  return maxId == null ? stmt.all(day) : stmt.all(day, maxId);
}

function localDayStats(db, day) {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS max_id FROM inventory_snapshots WHERE observed_date = ?",
    )
    .get(day);
  return { count: row.n, maxId: row.max_id };
}

function localCountUpTo(db, day, maxId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM inventory_snapshots WHERE observed_date = ? AND id <= ?")
    .get(day, maxId).n;
}

// --- remote helpers ---------------------------------------------------------

async function remoteDayCount(supabase, day) {
  const { count, error } = await supabase
    .from("inventory_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("observed_date", day);
  if (error) fatal("remote-count-failed", `remote count for ${day} failed: ${error.message}`);
  return count ?? 0;
}

async function remoteCountAbove(supabase, day, maxId) {
  const { count, error } = await supabase
    .from("inventory_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("observed_date", day)
    .gt("id", maxId);
  if (error) fatal("remote-count-failed", `remote count above ${maxId} for ${day} failed: ${error.message}`);
  return count ?? 0;
}

function localCountAbove(db, day, maxId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM inventory_snapshots WHERE observed_date = ? AND id > ?")
    .get(day, maxId).n;
}

async function remoteMinSnapshotDay(supabase) {
  const { data, error } = await supabase
    .from("inventory_snapshots")
    .select("observed_date")
    .order("observed_at", { ascending: true })
    .limit(1);
  if (error) fatal("remote-min-failed", `earliest remote snapshot read failed: ${error.message}`);
  return data && data.length ? data[0].observed_date : null;
}

async function readRegistry(supabase) {
  const { data, error } = await supabase
    .from("archive_day_registry")
    .select("observed_date, in_ledger, row_count, row_hash, verified_at")
    .order("observed_date", { ascending: true });
  if (error) fatal("registry-read-failed", `archive_day_registry read failed: ${error.message}`);
  return data ?? [];
}

async function upsertRegistry(supabase, row) {
  const { error } = await supabase
    .from("archive_day_registry")
    .upsert(row, { onConflict: "observed_date" });
  // No registry row => no durable remote witness => verification must not stand,
  // or a later prune would erase the only proof the day existed.
  if (error) fatal("registry-upsert-failed", `archive_day_registry upsert for ${row.observed_date} failed: ${error.message}`);
}

// --- steps ------------------------------------------------------------------

/** Step 2 — mirror inventory_snapshot_days into archive_days (in_ledger = 1). */
export async function mirrorLedger(db, supabase) {
  const upsert = db.prepare(
    "INSERT INTO archive_days (observed_date, in_ledger, supabase_row_count) VALUES (?, 1, ?) " +
      "ON CONFLICT(observed_date) DO UPDATE SET in_ledger = 1, supabase_row_count = excluded.supabase_row_count",
  );
  let seen = 0;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("inventory_snapshot_days")
      .select("observed_date, row_count")
      .order("observed_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) fatal("ledger-read-failed", `ledger read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    db.exec("BEGIN");
    try {
      for (const d of data) upsert.run(d.observed_date, d.row_count ?? null);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    seen += data.length;
    if (data.length < PAGE_SIZE) break;
  }
  return seen;
}

const INSERT_SNAPSHOT_SQL =
  "INSERT OR IGNORE INTO inventory_snapshots " +
  "(id, observed_at, observed_date, handle, store_domain, shopify_id, brand, title, name, " +
  " category, subcategory, price, available, hidden) " +
  "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)";

const bool = (v) => (v == null ? null : v ? 1 : 0);

function insertRows(db, rows) {
  const stmt = db.prepare(INSERT_SNAPSHOT_SQL);
  db.exec("BEGIN");
  try {
    for (const r of rows) {
      stmt.run(
        r.id, r.observed_at, r.observed_date, r.handle, r.store_domain,
        r.shopify_id ?? null, r.brand ?? null, r.title ?? null, r.name ?? null,
        r.category ?? null, r.subcategory ?? null, r.price ?? null,
        bool(r.available), bool(r.hidden),
      );
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Step 3 — mirror rows by id watermark. Snapshot rows are append-only and
 * immutable, so `id > local MAX(id)` is a complete and drift-free cursor; each
 * page commits on its own, so a crash resumes from the watermark.
 */
export async function mirrorRows(db, supabase) {
  let cursor = db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM inventory_snapshots").get().m;
  let mirrored = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("inventory_snapshots")
      .select("*")
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (error) fatal("mirror-read-failed", `snapshot page read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    insertRows(db, data);
    mirrored += data.length;
    cursor = data[data.length - 1].id;
    if (data.length < PAGE_SIZE) break;
  }
  return mirrored;
}

/** Re-read one day from Supabase (day repair) and INSERT OR IGNORE it locally. */
async function repairDay(db, supabase, day) {
  let cursor = 0;
  let fetched = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("inventory_snapshots")
      .select("*")
      .eq("observed_date", day)
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (error) fatal("repair-read-failed", `day repair read for ${day} failed: ${error.message}`);
    if (!data || data.length === 0) break;
    insertRows(db, data);
    fetched += data.length;
    cursor = data[data.length - 1].id;
    if (data.length < PAGE_SIZE) break;
  }
  return fetched;
}

/**
 * Step 4 — refresh local per-day counts and register ORPHAN days (rows present
 * with no ledger entry, e.g. the 2026-05-21 backfill). Orphans are prunable but
 * never feed cold_start / departures / flow.
 */
export function recount(db) {
  const days = db
    .prepare("SELECT observed_date, COUNT(*) AS n FROM inventory_snapshots GROUP BY observed_date")
    .all();
  const insertOrphan = db.prepare(
    "INSERT INTO archive_days (observed_date, in_ledger, local_row_count) VALUES (?, 0, ?) " +
      "ON CONFLICT(observed_date) DO UPDATE SET local_row_count = excluded.local_row_count",
  );
  db.exec("BEGIN");
  try {
    db.exec("UPDATE archive_days SET local_row_count = 0");
    for (const d of days) insertOrphan.run(d.observed_date, d.n);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return db.prepare("SELECT COUNT(*) AS n FROM archive_days WHERE in_ledger = 0").get().n;
}

/**
 * Step 2b — continuity guard. Runs after mirroring (which only ever adds rows)
 * and BEFORE anything verifies, deletes, or republishes derived tables.
 * Returns the days whose local state legitimately grew past their watermark
 * (candidates for re-verification in step 6b).
 */
export async function continuityGuard(db, supabase, { log }) {
  const manifest = db.prepare("SELECT * FROM day_manifest").all();
  const manifestByDay = new Map(manifest.map((m) => [m.observed_date, m]));

  // (a) Remote-evidence check — has pruning happened, and can this file account
  //     for everything Supabase no longer holds?
  const remoteMin = await remoteMinSnapshotDay(supabase);
  const registry = await readRegistry(supabase);
  const registryByDay = new Map(registry.map((r) => [r.observed_date, r]));
  const ledgerDays = db
    .prepare("SELECT observed_date FROM archive_days WHERE in_ledger = 1")
    .all()
    .map((r) => r.observed_date);

  const required = new Set();
  if (remoteMin) {
    for (const d of registryByDay.keys()) if (d < remoteMin) required.add(d);
    for (const d of ledgerDays) if (d < remoteMin) required.add(d);
  }
  if (required.size > 0) {
    if (!getMeta(db, "initialized_at")) {
      fatal(
        "archive-continuity-violation",
        `remote history starts at ${remoteMin} (pruning has occurred) but this archive was never fully verified — ${RESTORE_HINT}`,
      );
    }
    for (const day of [...required].sort()) {
      const m = manifestByDay.get(day);
      if (!m) {
        fatal(
          "archive-continuity-violation",
          `day ${day} was pruned from Supabase but has no day_manifest entry here — ${RESTORE_HINT}`,
        );
      }
      const reg = registryByDay.get(day);
      if (!reg) {
        // Every pruned day was witnessed in the registry BEFORE its delete, so
        // a manifested-but-unwitnessed pruned day means the registry itself has
        // lost data — the guarantee orphan-day recovery depends on. Fail while
        // the local copy still exists and the registry can be repaired.
        fatal(
          "archive-continuity-violation",
          `day ${day} was pruned but has no archive_day_registry witness — the remote registry lost data; repair it from day_manifest before pruning anything further`,
        );
      }
      if (reg.row_count !== m.row_count) {
        fatal(
          "archive-continuity-violation",
          `day ${day}: registry row_count ${reg.row_count} != manifest ${m.row_count} — ${RESTORE_HINT}`,
        );
      }
    }
  }

  // (b) Manifest-integrity check — every verified day must still hold exactly the
  //     rows it was verified with. Rows ABOVE the watermark may legitimately have
  //     appeared since (a manual old-date backfill); rows missing BELOW it mean a
  //     truncated or mid-mirror restore.
  const reverifyDays = [];
  for (const m of manifest) {
    const { count } = localDayStats(db, m.observed_date);
    if (count === m.row_count) continue;
    const upTo = localCountUpTo(db, m.observed_date, m.max_id);
    if (upTo === m.row_count && count > m.row_count) {
      log({ level: "warn", event: "manifest_grew", day: m.observed_date, was: m.row_count, now: count });
      reverifyDays.push(m.observed_date);
      continue;
    }
    fatal(
      "archive-continuity-violation",
      `day ${m.observed_date}: local rows ${count} (${upTo} at/below watermark ${m.max_id}) != manifest ${m.row_count} — ${RESTORE_HINT}`,
    );
  }
  return { reverifyDays, remoteMin, registryByDay };
}

function writeManifest(db, { day, inLedger, count, hash, maxId, at }) {
  db.prepare(
    "INSERT INTO day_manifest (observed_date, in_ledger, row_count, row_hash, max_id, verified_at) " +
      "VALUES (?,?,?,?,?,?) ON CONFLICT(observed_date) DO UPDATE SET " +
      "in_ledger = excluded.in_ledger, row_count = excluded.row_count, " +
      "row_hash = excluded.row_hash, max_id = excluded.max_id, verified_at = excluded.verified_at",
  ).run(day, inLedger, count, hash, maxId, at);
}

/**
 * Step 6 — verify one candidate day. Writes the manifest row + the remote
 * registry witness, then the local `verified_at` tombstone-precursor.
 */
export async function verifyDay(db, supabase, day, { now, log }) {
  const row = db.prepare("SELECT * FROM archive_days WHERE observed_date = ?").get(day);
  const local = localDayStats(db, day);
  let remote = await remoteDayCount(supabase, day);

  if (remote === 0) {
    // Remote 0 is NEVER verification. Either we already verified it (manifest
    // present, tombstone pending) or the archive has lost history Supabase can
    // no longer repair.
    const m = db.prepare("SELECT * FROM day_manifest WHERE observed_date = ?").get(day);
    if (!m) {
      fatal(
        "archive-continuity-violation",
        `day ${day} is gone from Supabase but was never verified here (local rows ${local.count}) — ${RESTORE_HINT}`,
      );
    }
    fatal(
      "archive-continuity-violation",
      `day ${day} has no remote rows; refusing to treat 0 == ${local.count} as verification — ${RESTORE_HINT}`,
    );
  }

  if (remote > local.count) {
    log({ level: "warn", event: "day_repair", day, remote, local: local.count });
    await repairDay(db, supabase, day);
    Object.assign(local, localDayStats(db, day));
    remote = await remoteDayCount(supabase, day);
  }
  if (remote !== local.count) {
    log({ level: "error", event: "verify_mismatch", day, remote, local: local.count });
    return { verified: false, reason: "count_mismatch" };
  }
  if (local.count === 0) {
    fatal("archive-continuity-violation", `day ${day} has zero rows on both sides — ${RESTORE_HINT}`);
  }
  // Ledger row_count is approximate (partial-run capture races) — warn only.
  if (row?.supabase_row_count != null && row.supabase_row_count !== local.count) {
    log({ level: "warn", event: "ledger_count_drift", day, ledger: row.supabase_row_count, actual: local.count });
  }

  const at = now().toISOString();
  const hash = hashRows(localDayRows(db, day));
  const inLedger = row?.in_ledger ?? 0;
  writeManifest(db, { day, inLedger, count: local.count, hash, maxId: local.maxId, at });
  await upsertRegistry(supabase, {
    observed_date: day,
    in_ledger: inLedger === 1,
    row_count: local.count,
    row_hash: hash,
    verified_at: at,
  });
  db.prepare("UPDATE archive_days SET verified_at = ? WHERE observed_date = ?").run(at, day);
  log({ level: "info", event: "verified", day, rows: local.count, max_id: local.maxId });
  return { verified: true, count: local.count };
}

/**
 * Step 6b — re-verify a day whose live local state grew past its watermark.
 * Legitimate only when the remote day still exists; anything else is fatal.
 */
export async function reverifyDay(db, supabase, day, { now, log }) {
  const m = db.prepare("SELECT * FROM day_manifest WHERE observed_date = ?").get(day);
  if (!m) fatal("archive-continuity-violation", `re-verify called for unmanifested day ${day}`);
  const remote = await remoteDayCount(supabase, day);
  if (remote === 0) {
    fatal(
      "archive-continuity-violation",
      `day ${day} diverged from its manifest but is already pruned from Supabase — ${RESTORE_HINT}`,
    );
  }
  // Compare only ABOVE the old watermark. A day can legitimately be mid-drain
  // (its frozen set already deleted remotely), so remote total < local total is
  // expected there; what must hold is that every remote row above the watermark
  // is mirrored here, and that nothing below it went missing.
  let remoteAbove = await remoteCountAbove(supabase, day, m.max_id);
  let localAbove = localCountAbove(db, day, m.max_id);
  if (remoteAbove > localAbove) {
    await repairDay(db, supabase, day);
    remoteAbove = await remoteCountAbove(supabase, day, m.max_id);
    localAbove = localCountAbove(db, day, m.max_id);
  }
  if (remoteAbove !== localAbove) {
    fatal(
      "archive-continuity-violation",
      `day ${day} re-verify: ${remoteAbove} remote rows above watermark ${m.max_id} vs ${localAbove} local — ${RESTORE_HINT}`,
    );
  }
  const local = localDayStats(db, day);
  if (localCountUpTo(db, day, m.max_id) !== m.row_count) {
    fatal(
      "archive-continuity-violation",
      `day ${day} re-verify: rows missing at/below watermark ${m.max_id} — ${RESTORE_HINT}`,
    );
  }
  const at = now().toISOString();
  const hash = hashRows(localDayRows(db, day));
  log({
    level: "warn", event: "reverified", day,
    old: { row_count: m.row_count, max_id: m.max_id },
    new: { row_count: local.count, max_id: local.maxId },
  });
  writeManifest(db, { day, inLedger: m.in_ledger, count: local.count, hash, maxId: local.maxId, at });
  await upsertRegistry(supabase, {
    observed_date: day,
    in_ledger: m.in_ledger === 1,
    row_count: local.count,
    row_hash: hash,
    verified_at: at,
  });
  db.prepare("UPDATE archive_days SET verified_at = ? WHERE observed_date = ?").run(at, day);
  return { row_count: local.count, max_id: local.maxId };
}

/**
 * Step 7 — delete one verified day from Supabase, frozen at its watermark.
 * The delete set is `local ids <= manifest.max_id`, never "all ids for the day":
 * bigserial is monotonic, so a row inserted after verification always sorts
 * above the watermark and can never be deleted unverified.
 */
export async function deleteDay(db, supabase, day, { now, log }) {
  const m = db.prepare("SELECT * FROM day_manifest WHERE observed_date = ?").get(day);
  if (!m) fatal("delete-without-manifest", `refusing to delete unmanifested day ${day}`);
  const av = db.prepare("SELECT verified_at FROM archive_days WHERE observed_date = ?").get(day);
  if (!av?.verified_at) fatal("delete-without-verification", `refusing to delete unverified day ${day}`);

  // Pre-delete recheck; divergence routes through re-verification first.
  let stats = localDayStats(db, day);
  if (stats.count !== m.row_count || stats.maxId !== m.max_id) {
    await reverifyDay(db, supabase, day, { now, log });
    stats = localDayStats(db, day);
  }
  const freshManifest = db.prepare("SELECT * FROM day_manifest WHERE observed_date = ?").get(day);

  const ids = db
    .prepare("SELECT id FROM inventory_snapshots WHERE observed_date = ? AND id <= ? ORDER BY id")
    .all(day, freshManifest.max_id)
    .map((r) => r.id);

  let deleted = 0;
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const chunk = ids.slice(i, i + DELETE_CHUNK);
    const { error, count } = await supabase
      .from("inventory_snapshots")
      .delete({ count: "exact" })
      .in("id", chunk);
    if (error) fatal("delete-failed", `delete chunk for ${day} failed: ${error.message}`);
    deleted += count ?? 0;
  }

  const remainder = await remoteDayCount(supabase, day);
  if (remainder !== 0) {
    // Post-verify rows landed mid-run. No tombstone — the next run re-verifies
    // via 6b and finishes cleanly. Loud, but not a wedge.
    log({ level: "error", event: "delete_remainder", day, remainder, deleted });
    return { deleted, tombstoned: false };
  }
  db.prepare("UPDATE archive_days SET deleted_from_supabase_at = ? WHERE observed_date = ?").run(
    now().toISOString(), day,
  );
  log({ level: "info", event: "deleted", day, rows: deleted });
  return { deleted, tombstoned: true };
}

/**
 * True when every day Supabase still holds is mirrored row-for-row here. Days
 * already pruned (remote 0) are skipped — the manifest/registry guards own those.
 */
export async function isMirrorComplete(db, supabase, { log = () => {} } = {}) {
  const days = db
    .prepare("SELECT observed_date, local_row_count FROM archive_days ORDER BY observed_date")
    .all();
  let complete = true;
  for (const d of days) {
    const remote = await remoteDayCount(supabase, d.observed_date);
    if (remote === 0) continue;
    if (remote !== (d.local_row_count ?? 0)) {
      log({ level: "warn", event: "mirror_incomplete", day: d.observed_date, remote, local: d.local_row_count ?? 0 });
      complete = false;
    }
  }
  return complete;
}

/** Cutoff = the `retainDays`-th newest LEDGER day; null when history is shorter. */
export function computeCutoff(db, retainDays) {
  const days = db
    .prepare("SELECT observed_date FROM archive_days WHERE in_ledger = 1 ORDER BY observed_date DESC")
    .all()
    .map((r) => r.observed_date);
  if (days.length < retainDays) return null;
  return days[retainDays - 1];
}

/** --deep-verify: per-row hash comparison against remote + local manifest. */
export async function deepVerifyAll(db, supabase, { log }) {
  const manifest = db.prepare("SELECT * FROM day_manifest ORDER BY observed_date").all();
  let checked = 0;
  const problems = [];
  for (const m of manifest) {
    const localHash = hashRows(localDayRows(db, m.observed_date, m.max_id));
    if (localHash !== m.row_hash) {
      problems.push({ day: m.observed_date, kind: "local_hash" });
      continue;
    }
    const remote = await remoteDayCount(supabase, m.observed_date);
    if (remote === 0) { checked += 1; continue; } // already pruned; local hash is the record
    const rows = [];
    let cursor = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("inventory_snapshots")
        .select("id, handle, store_domain, available, price")
        .eq("observed_date", m.observed_date)
        .gt("id", cursor)
        .lte("id", m.max_id)
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);
      if (error) fatal("deep-verify-read-failed", `deep-verify read for ${m.observed_date} failed: ${error.message}`);
      if (!data || data.length === 0) break;
      rows.push(...data);
      cursor = data[data.length - 1].id;
      if (data.length < PAGE_SIZE) break;
    }
    if (hashRows(rows) !== m.row_hash) problems.push({ day: m.observed_date, kind: "remote_hash" });
    checked += 1;
  }
  log({ level: problems.length ? "error" : "info", event: "deep_verify", checked, problems });
  return { checked, problems };
}

/**
 * The whole run. Deletion happens only with `prune: true`, and only for days
 * that carry both a manifest row and a `verified_at`.
 */
export async function runArchiver({
  db,
  supabase,
  now = () => new Date(),
  retainDays = DEFAULT_RETAIN,
  prune = false,
  deepVerify = false,
  log = () => {},
  snapshot = null, // async () => void; injected by the CLI (VACUUM INTO + checks)
} = {}) {
  const started = Date.now();
  const summary = {
    mirrored: 0, ledgerDays: 0, orphanDays: 0, verifiedDays: 0, reverifiedDays: 0,
    deletedDays: 0, deletedRows: 0, cutoff: null, snapshotOk: null, prune,
  };

  if (prune && !getMeta(db, "last_snapshot_at")) {
    fatal(
      "prune-without-snapshot",
      "refusing to prune: no verified VACUUM INTO snapshot exists yet (run once without --prune first)",
    );
  }

  summary.ledgerDays = await mirrorLedger(db, supabase);
  summary.mirrored = await mirrorRows(db, supabase);
  summary.orphanDays = recount(db);

  const { reverifyDays } = await continuityGuard(db, supabase, { log });
  for (const day of reverifyDays) {
    await reverifyDay(db, supabase, day, { now, log });
    summary.reverifiedDays += 1;
  }

  if (deepVerify) {
    summary.deepVerify = await deepVerifyAll(db, supabase, { log });
    // A hash mismatch means the archive diverges from the source rows — fail
    // closed before any verification or deletion can act on a diverged mirror.
    if (summary.deepVerify.problems.length > 0) {
      fatal(
        "deep-verify-failed",
        `deep-verify found ${summary.deepVerify.problems.length} hash mismatch(es): ` +
          `${JSON.stringify(summary.deepVerify.problems.slice(0, 3))} — ${RESTORE_HINT}`,
      );
    }
  }

  const cutoff = computeCutoff(db, retainDays);
  summary.cutoff = cutoff;
  if (cutoff) {
    const candidates = db
      .prepare(
        "SELECT observed_date, verified_at FROM archive_days " +
          "WHERE observed_date < ? AND deleted_from_supabase_at IS NULL ORDER BY observed_date",
      )
      .all(cutoff);
    for (const c of candidates) {
      if (!c.verified_at) await verifyDay(db, supabase, c.observed_date, { now, log });
      const fresh = db
        .prepare("SELECT verified_at FROM archive_days WHERE observed_date = ?")
        .get(c.observed_date);
      if (!fresh?.verified_at) continue;
      summary.verifiedDays += 1;
      if (!prune) continue;
      const res = await deleteDay(db, supabase, c.observed_date, { now, log });
      summary.deletedRows += res.deleted;
      if (res.tombstoned) summary.deletedDays += 1;
    }
  }

  // `initialized_at` is the continuity guard's "this file has held the whole
  // history at least once" anchor. It cannot mean "every day is manifested" —
  // days inside the hot window are never verification candidates — so it means
  // "the mirror is complete": every day Supabase still holds has exactly as many
  // rows here as there. One head count per day (~tens), and only until it is set.
  if (!getMeta(db, "initialized_at")) {
    const complete = await isMirrorComplete(db, supabase, { log });
    if (complete) setMeta(db, "initialized_at", now().toISOString());
    summary.initialized = complete;
  }

  const derived = rebuildDerived(db);
  summary.lifecycleRows = derived.lifecycleRows;
  summary.flowRows = derived.flowRows;

  const lastDay = db
    .prepare("SELECT MAX(observed_date) AS d FROM archive_days WHERE in_ledger = 1")
    .get().d;
  setMeta(db, "last_archived_day", lastDay);
  setMeta(db, "last_run_at", now().toISOString());
  setMeta(db, "last_run_status", "ok");

  if (snapshot) {
    await snapshot(db);
    summary.snapshotOk = true;
  }

  summary.durationMs = Date.now() - started;
  return summary;
}
