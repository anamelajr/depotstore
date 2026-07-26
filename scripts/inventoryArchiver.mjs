#!/usr/bin/env node
// Local inventory-history archiver (docs/plan-inventory-local-archive.md).
//
// Mirrors ALL inventory_snapshots rows into a local SQLite file, verifies each
// old day against Supabase (count + hash + id watermark, witnessed in the remote
// archive_day_registry), and — only with --prune — deletes the verified, frozen
// id set from Supabase. Rebuilds the derived lifecycle/flow tables the admin
// dashboard reads, then publishes an atomic VACUUM INTO snapshot for backups.
//
// SAFETY MODEL (same lineage as scripts/backfillTitleClean.mjs):
//   - Default mode is MIRROR-ONLY. Deletion requires --prune.
//   - A day is deletable only after remote count == local count > 0, a
//     day_manifest row, and a successful archive_day_registry upsert.
//   - The delete set is the FROZEN local id set <= manifest.max_id — never a
//     date-predicate delete, never "all ids for the day".
//   - Any continuity violation (lost local history, truncated restore, pruned
//     day with no manifest) aborts nonzero BEFORE anything is verified,
//     deleted, or republished.
//
// Usage (from the repo root, where .env.local lives):
//   node scripts/inventoryArchiver.mjs                    # mirror only (safe)
//   node scripts/inventoryArchiver.mjs --deep-verify      # + per-row hash compare
//   node scripts/inventoryArchiver.mjs --prune            # + delete verified old days
//   node scripts/inventoryArchiver.mjs --parity           # diff local vs Supabase MVs
//   node scripts/inventoryArchiver.mjs --retain 14        # hot-window ledger days
//   node scripts/inventoryArchiver.mjs --env <path>       # override .env.local
//   node scripts/inventoryArchiver.mjs --db <path>        # override DEPOT_ARCHIVE_DB

import * as dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mkdirSync, existsSync, openSync, fsyncSync, closeSync, renameSync, rmSync,
  appendFileSync, readdirSync, unlinkSync, statSync, readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PRUNE = flag("--prune");
const PARITY = flag("--parity");
const DEEP_VERIFY = flag("--deep-verify");
const RETAIN = Number(value("--retain", "14"));
const ENV_PATH = value("--env", join(__dirname, "../.env.local"));

dotenv.config({ path: ENV_PATH });

const DB_PATH =
  value("--db") ?? process.env.DEPOT_ARCHIVE_DB ?? join(homedir(), "DepotArchive/inventory-archive.sqlite");
const ARCHIVE_DIR = dirname(DB_PATH);
const LOG_DIR = join(ARCHIVE_DIR, "logs");
const SNAPSHOT_PATH = join(ARCHIVE_DIR, "inventory-archive.snapshot.sqlite");
const SNAPSHOT_TMP = join(ARCHIVE_DIR, "inventory-archive.snapshot.tmp");
const LOCK_PATH = join(ARCHIVE_DIR, "archiver.lock");

if (!Number.isInteger(RETAIN) || RETAIN < 1) {
  console.error(`--retain must be a positive integer (got ${value("--retain")})`);
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    `Missing Supabase env in ${ENV_PATH} (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)`,
  );
  process.exit(1);
}
// Scripts never import app/lib/supabase.js — that module reads env at import
// time inside the Next runtime; a CLI needs its own client after dotenv.
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

mkdirSync(ARCHIVE_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });

// --- logging: JSON lines, monthly file, 12-month retention -------------------

const logFile = () => join(LOG_DIR, `archiver-${new Date().toISOString().slice(0, 7)}.jsonl`);

function log(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  try {
    appendFileSync(logFile(), line + "\n");
  } catch {
    /* logging must never take the run down */
  }
  const out = entry.level === "error" ? console.error : console.log;
  out(line);
}

function pruneOldLogs() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);
  const keep = cutoff.toISOString().slice(0, 7);
  for (const f of readdirSync(LOG_DIR)) {
    const m = /^archiver-(\d{4}-\d{2})\.jsonl$/.exec(f);
    if (m && m[1] < keep) {
      try { unlinkSync(join(LOG_DIR, f)); } catch { /* best effort */ }
    }
  }
}

// --- lock (launchd already serializes per label; this guards manual runs) ----

function acquireLock() {
  try {
    const fd = openSync(LOCK_PATH, "wx");
    closeSync(fd);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    // Stale-PID detection: a lock whose owner is gone is not a lock.
    let stale = true;
    try {
      const pid = Number(readFileSync(LOCK_PATH, "utf8").trim());
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); stale = false; } catch { stale = true; }
      }
    } catch { stale = true; }
    if (!stale) {
      log({ level: "error", event: "locked", lock: LOCK_PATH });
      process.exit(1);
    }
    log({ level: "warn", event: "stale_lock_cleared", lock: LOCK_PATH });
    rmSync(LOCK_PATH, { force: true });
    const fd = openSync(LOCK_PATH, "wx");
    closeSync(fd);
  }
  try { appendFileSync(LOCK_PATH, String(process.pid)); } catch { /* advisory only */ }
}

const releaseLock = () => rmSync(LOCK_PATH, { force: true });

// --- snapshot: VACUUM INTO -> verify -> atomic rename ------------------------

async function makeSnapshot(db) {
  const { openArchiveDb } = await import("../app/lib/inventoryArchive/localDb.js");
  rmSync(SNAPSHOT_TMP, { force: true });
  db.exec(`VACUUM INTO '${SNAPSHOT_TMP.replace(/'/g, "''")}'`);

  // Verify the file that backups will actually capture, on a fresh handle.
  const snap = await openArchiveDb({ path: SNAPSHOT_TMP, readonly: true });
  try {
    const integrity = snap.prepare("PRAGMA integrity_check").get();
    const verdict = integrity ? Object.values(integrity)[0] : "missing";
    if (verdict !== "ok") throw new Error(`snapshot integrity_check: ${verdict}`);
    const bad = snap
      .prepare(
        "SELECT m.observed_date, m.row_count, " +
          "(SELECT COUNT(*) FROM inventory_snapshots s WHERE s.observed_date = m.observed_date) AS n " +
          "FROM day_manifest m WHERE n < m.row_count",
      )
      .all();
    if (bad.length) {
      throw new Error(`snapshot manifest check failed for ${bad.length} day(s): ${JSON.stringify(bad.slice(0, 3))}`);
    }
  } finally {
    snap.close();
  }

  const fd = openSync(SNAPSHOT_TMP, "r");
  fsyncSync(fd);
  closeSync(fd);
  renameSync(SNAPSHOT_TMP, SNAPSHOT_PATH);

  const { setMeta } = await import("../app/lib/inventoryArchive/localDb.js");
  setMeta(db, "last_snapshot_at", new Date().toISOString());
  log({ level: "info", event: "snapshot", path: SNAPSHOT_PATH, bytes: statSync(SNAPSHOT_PATH).size });
}

// --- parity: local derived tables vs the Supabase MVs ------------------------

const canonLifecycle = (r) => ({
  handle: r.handle,
  store_domain: r.store_domain,
  first_seen: String(r.first_seen),
  last_seen: String(r.last_seen),
  departed_at: r.departed_at == null ? null : String(r.departed_at),
  sold_at_flip: r.sold_at_flip == null ? null : String(r.sold_at_flip),
  days_to_sell: r.days_to_sell ?? null,
  first_seen_censored: r.first_seen_censored === true || r.first_seen_censored === 1,
  current_status: r.current_status,
  sold_signal_type: r.sold_signal_type ?? null,
});

async function runParity() {
  const { readLifecycle } = await import("../app/lib/inventoryAnalytics.js");
  const { readLifecycleLocal, readFlowLocal } = await import(
    "../app/lib/inventoryArchive/localReaders.js"
  );

  const remoteRows = await readLifecycle({ db: supabase });
  const localRows = await readLifecycleLocal({ path: DB_PATH });
  const key = (r) => `${r.store_domain} ${r.handle}`;
  const remoteMap = new Map(remoteRows.map((r) => [key(r), canonLifecycle(r)]));
  const localMap = new Map(localRows.map((r) => [key(r), canonLifecycle(r)]));

  const diffs = [];
  for (const [k, rv] of remoteMap) {
    const lv = localMap.get(k);
    if (!lv) { diffs.push({ key: k, kind: "missing_local" }); continue; }
    if (JSON.stringify(rv) !== JSON.stringify(lv)) diffs.push({ key: k, kind: "field", remote: rv, local: lv });
  }
  for (const k of localMap.keys()) if (!remoteMap.has(k)) diffs.push({ key: k, kind: "extra_local" });

  const { data: remoteFlow, error } = await supabase
    .from("v_daily_flow")
    .select("observed_date, arrivals, departures, active, is_seed_day")
    .order("observed_date", { ascending: true });
  if (error) throw new Error(`v_daily_flow read failed: ${error.message}`);
  const localFlow = (await readFlowLocal({ path: DB_PATH })).slice().reverse();
  const flowDiffs = [];
  const lf = new Map(localFlow.map((r) => [String(r.observed_date), r]));
  for (const r of remoteFlow) {
    const l = lf.get(String(r.observed_date));
    if (!l) { flowDiffs.push({ day: r.observed_date, kind: "missing_local" }); continue; }
    if (
      r.arrivals !== l.arrivals || r.departures !== l.departures ||
      r.active !== l.active || Boolean(r.is_seed_day) !== Boolean(l.is_seed_day)
    ) flowDiffs.push({ day: r.observed_date, remote: r, local: l });
  }

  console.log(`lifecycle: remote ${remoteMap.size} / local ${localMap.size} — ${diffs.length} diff(s)`);
  for (const d of diffs.slice(0, 20)) console.log("  " + JSON.stringify(d));
  console.log(`daily_flow: remote ${remoteFlow.length} / local ${localFlow.length} — ${flowDiffs.length} diff(s)`);
  for (const d of flowDiffs.slice(0, 20)) console.log("  " + JSON.stringify(d));
  const ok = diffs.length === 0 && flowDiffs.length === 0;
  console.log(ok ? "\nPARITY OK — zero diffs." : "\nPARITY FAILED.");
  return ok;
}

// --- main -------------------------------------------------------------------

(async () => {
  if (PARITY) {
    const ok = await runParity();
    process.exit(ok ? 0 : 1);
  }

  const { openArchiveDb, setMeta } = await import("../app/lib/inventoryArchive/localDb.js");
  const { runArchiver, ArchiveError } = await import(
    "../app/lib/inventoryArchive/archiverCore.js"
  );

  acquireLock();
  const existed = existsSync(DB_PATH);
  let db;
  try {
    db = await openArchiveDb({ path: DB_PATH });
    log({ level: "info", event: "start", db: DB_PATH, existed, prune: PRUNE, retain: RETAIN, deepVerify: DEEP_VERIFY });
    const summary = await runArchiver({
      db,
      supabase,
      retainDays: RETAIN,
      prune: PRUNE,
      deepVerify: DEEP_VERIFY,
      log,
      snapshot: makeSnapshot,
    });
    log({ level: "info", event: "done", ...summary });
    pruneOldLogs();
    process.exitCode = 0;
  } catch (e) {
    if (db) { try { setMeta(db, "last_run_status", `failed: ${e.message}`); } catch { /* db may be unusable */ } }
    log({
      level: "error",
      event: "failed",
      code: e instanceof ArchiveError ? e.code : "unexpected",
      message: e.message,
      stack: e.stack,
    });
    process.exitCode = 1;
  } finally {
    // WAL hygiene only — backup consistency comes from the atomic snapshot.
    if (db) { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* best effort */ } }
    if (db) { try { db.close(); } catch { /* already closed */ } }
    releaseLock();
  }
})();
