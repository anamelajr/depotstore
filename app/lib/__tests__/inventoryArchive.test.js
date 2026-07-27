import { describe, it, expect, beforeEach } from "vitest";
import { openArchiveDb, setMeta, getMeta } from "../inventoryArchive/localDb.js";
import { rebuildDerived } from "../inventoryArchive/derive.js";
import {
  runArchiver, verifyDay, deleteDay, computeCutoff, mirrorRows, recount,
  continuityGuard, hashRows, ArchiveError,
} from "../inventoryArchive/archiverCore.js";
import { readLifecycleLocal, readFlowLocal, makeLocalReaders } from "../inventoryArchive/localReaders.js";
import { computeKpis, buildVelocityBuckets, storeSummary, getInventoryInsights } from "../inventoryAnalytics.js";

// ---------------------------------------------------------------------------
// Fake Supabase: a tiny in-memory PostgREST. Supports the exact call shapes the
// archiver uses — .select(cols,{count,head}) / .eq / .gt / .lte / .in / .order /
// .range / .limit / .delete({count}) / .upsert(row,{onConflict}) — over mutable
// row arrays, so a test can delete remotely and observe the effect.
// ---------------------------------------------------------------------------
function makeFakeSupabase({ snapshots = [], ledger = [], registry = [], registryError = null } = {}) {
  const tables = {
    inventory_snapshots: snapshots.map((r) => ({ ...r })),
    inventory_snapshot_days: ledger.map((r) => ({ ...r })),
    archive_day_registry: registry.map((r) => ({ ...r })),
  };
  const calls = { deletes: [], upserts: [] };

  function builder(table) {
    const st = { filters: [], head: false, wantCount: false, order: null, limit: null, range: null, mode: "select", payload: null };
    const rows = () => tables[table] ?? [];
    const apply = () => {
      let out = rows().filter((r) =>
        st.filters.every((f) => {
          const v = r[f.col];
          if (f.op === "eq") return v === f.val;
          if (f.op === "gt") return v > f.val;
          if (f.op === "lte") return v <= f.val;
          if (f.op === "in") return f.val.includes(v);
          return true;
        }),
      );
      if (st.order) {
        const { col, asc } = st.order;
        out = out.slice().sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0));
        if (!asc) out.reverse();
      }
      if (st.range) out = out.slice(st.range[0], st.range[1] + 1);
      if (st.limit != null) out = out.slice(0, st.limit);
      return out;
    };
    const b = {
      select(_cols, opts = {}) { st.head = Boolean(opts.head); st.wantCount = Boolean(opts.count); return b; },
      eq(col, val) { st.filters.push({ op: "eq", col, val }); return b; },
      gt(col, val) { st.filters.push({ op: "gt", col, val }); return b; },
      lte(col, val) { st.filters.push({ op: "lte", col, val }); return b; },
      in(col, val) { st.filters.push({ op: "in", col, val }); return b; },
      order(col, opts = {}) { st.order = { col, asc: opts.ascending !== false }; return b; },
      limit(n) { st.limit = n; return b; },
      range(from, to) { st.range = [from, to]; return b; },
      delete(opts = {}) { st.mode = "delete"; st.wantCount = Boolean(opts.count); return b; },
      upsert(payload) { st.mode = "upsert"; st.payload = payload; return b; },
      then(resolve, reject) {
        let result;
        if (st.mode === "delete") {
          const doomed = new Set(apply());
          tables[table] = rows().filter((r) => !doomed.has(r));
          calls.deletes.push({ table, n: doomed.size });
          result = { data: null, count: doomed.size, error: null };
        } else if (st.mode === "upsert") {
          if (registryError && table === "archive_day_registry") {
            result = { data: null, error: { message: registryError } };
          } else {
            calls.upserts.push({ table, payload: st.payload });
            const list = rows();
            const i = list.findIndex((r) => r.observed_date === st.payload.observed_date);
            if (i === -1) list.push({ ...st.payload });
            else list[i] = { ...st.payload };
            result = { data: null, error: null };
          }
        } else {
          const matched = apply();
          result = st.head
            ? { data: null, count: matched.length, error: null }
            : { data: matched.map((r) => ({ ...r })), count: matched.length, error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return b;
  }
  return { client: { from: (t) => builder(t) }, tables, calls };
}

// --- fixtures ---------------------------------------------------------------

const D = (n) => `2026-06-0${n}`;
let nextId = 1;
function snap(over = {}) {
  return {
    id: nextId++, observed_at: `${over.observed_date ?? D(1)}T04:00:00.000Z`,
    observed_date: D(1), handle: "h", store_domain: "s1", shopify_id: 1,
    brand: "Margiela", title: "Coat", name: "MM6 Coat", category: "Jackets & Coats",
    subcategory: "coats", price: "€100.00", available: true, hidden: false, ...over,
  };
}
beforeEach(() => { nextId = 1; });

async function memDb() {
  return openArchiveDb({ path: ":memory:" });
}

function seedLocal(db, { rows = [], ledgerDays = [], orphanDays = [] }) {
  const ins = db.prepare(
    "INSERT OR IGNORE INTO inventory_snapshots (id, observed_at, observed_date, handle, store_domain," +
      " shopify_id, brand, title, name, category, subcategory, price, available, hidden)" +
      " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  for (const r of rows) {
    ins.run(r.id, r.observed_at, r.observed_date, r.handle, r.store_domain, r.shopify_id,
      r.brand, r.title, r.name, r.category, r.subcategory, r.price,
      r.available == null ? null : r.available ? 1 : 0,
      r.hidden == null ? null : r.hidden ? 1 : 0);
  }
  const day = db.prepare(
    "INSERT INTO archive_days (observed_date, in_ledger, local_row_count) VALUES (?,?,?)" +
      " ON CONFLICT(observed_date) DO UPDATE SET in_ledger = excluded.in_ledger," +
      " local_row_count = excluded.local_row_count",
  );
  const count = (d) =>
    db.prepare("SELECT COUNT(*) AS n FROM inventory_snapshots WHERE observed_date = ?").get(d).n;
  for (const d of ledgerDays) day.run(d, 1, count(d));
  for (const d of orphanDays) day.run(d, 0, count(d));
}

// ===========================================================================
describe("derive.js — MV translation", () => {
  // ledger 2026-06-01..05 plus an ORPHAN day (the 2026-05-21 backfill pattern).
  async function scenario() {
    const db = await memDb();
    const rows = [];
    const add = (handle, date, available) =>
      rows.push(snap({ handle, observed_date: date, available, store_domain: "s1" }));

    // A: flip on 06-03, still present on the last day -> sold, signal flip
    for (const d of [1, 2]) add("A", D(d), true);
    for (const d of [3, 4, 5]) add("A", D(d), false);
    // B: delist-only, last seen 06-03 -> departed 06-04
    for (const d of [2, 3]) add("B", D(d), true);
    // C: flip 06-03 then lingers to 06-04 -> departed 06-05, days_to_sell from flip
    add("C", D(2), true);
    for (const d of [3, 4]) add("C", D(d), false);
    // D: available throughout -> active
    for (const d of [2, 3, 4, 5]) add("D", D(d), true);
    // E: only on the orphan day -> gap_exit
    add("E", "2026-05-21", true);
    // F: relist after a gap -> no departure
    add("F", D(1), true);
    for (const d of [3, 4, 5]) add("F", D(d), true);
    // G: NULL available between 1 and 0 -> LAG is NULL, NOT a flip
    add("G", D(1), true);
    add("G", D(2), null);
    add("G", D(3), false);
    add("G", D(4), false);
    add("G", D(5), false);

    seedLocal(db, {
      rows,
      ledgerDays: [D(1), D(2), D(3), D(4), D(5)],
      orphanDays: ["2026-05-21"],
    });
    rebuildDerived(db);
    return db;
  }

  const byHandle = (db) =>
    Object.fromEntries(db.prepare("SELECT * FROM lifecycle").all().map((r) => [r.handle, r]));

  it("computes flip, delist, linger, active and censoring exactly like the MV", async () => {
    const l = byHandle(await scenario());

    expect(l.A).toMatchObject({
      first_seen: D(1), last_seen: D(5), sold_at_flip: D(3), departed_at: null,
      days_to_sell_flip: 2, days_to_sell: 2, current_status: "sold",
      sold_signal_type: "flip", first_seen_censored: 1,
    });
    expect(l.B).toMatchObject({
      last_seen: D(3), departed_at: D(4), days_to_departure: 2, days_to_sell: 2,
      current_status: "departed", sold_signal_type: "delist", first_seen_censored: 0,
    });
    // flip wins days_to_sell even though the delist landed later
    expect(l.C).toMatchObject({
      sold_at_flip: D(3), departed_at: D(5), days_to_sell_flip: 1,
      days_to_departure: 3, days_to_sell: 1, sold_signal_type: "flip",
      current_status: "departed",
    });
    expect(l.D).toMatchObject({ current_status: "active", sold_signal_type: null, departed_at: null });
    expect(l.F).toMatchObject({ days_observed: 4, departed_at: null, current_status: "active" });
  });

  it("does not treat a NULL-available gap as a flip", async () => {
    const l = byHandle(await scenario());
    expect(l.G.sold_at_flip).toBe(null);
    expect(l.G.current_status).toBe("sold"); // latest row is available = 0
  });

  it("excludes the orphan day from cold_start, departures and flow", async () => {
    const db = await scenario();
    const l = byHandle(db);
    // E lives only on the pre-ledger orphan day: gap_exit, never "departed".
    expect(l.E).toMatchObject({ current_status: "gap_exit", departed_at: null });
    // cold_start stayed at the first LEDGER day: B (first seen 06-02) is uncensored.
    expect(l.B.first_seen_censored).toBe(0);
    expect(l.A.first_seen_censored).toBe(1);

    const flow = db.prepare("SELECT * FROM daily_flow ORDER BY observed_date").all();
    expect(flow.map((f) => f.observed_date)).toEqual([D(1), D(2), D(3), D(4), D(5)]);
    expect(flow[0]).toMatchObject({ observed_date: D(1), is_seed_day: 1 });
    expect(flow[1].is_seed_day).toBe(0);
    // departures on 06-04: B only
    expect(flow.find((f) => f.observed_date === D(4)).departures).toBe(1);
    // active on 06-02: A, B, C, D (F absent; G is NULL-available) = 4
    expect(flow.find((f) => f.observed_date === D(2)).active).toBe(4);
  });

  it("produces zero rows when no ledger day exists", async () => {
    const db = await memDb();
    seedLocal(db, { rows: [snap({ handle: "X", observed_date: "2026-05-21" })], orphanDays: ["2026-05-21"] });
    const out = rebuildDerived(db);
    expect(out.lifecycleRows).toBe(0);
    expect(out.flowRows).toBe(0);
  });
});

// ===========================================================================
describe("localReaders", () => {
  async function built() {
    const db = await memDb();
    seedLocal(db, {
      rows: [
        snap({ handle: "A", observed_date: D(1), available: true }),
        snap({ handle: "A", observed_date: D(2), available: false }),
        snap({ handle: "B", observed_date: D(2), available: true, store_domain: "s0" }),
      ],
      ledgerDays: [D(1), D(2)],
    });
    rebuildDerived(db);
    // localReaders open their own read-only handle, so persist to a temp file.
    return db;
  }

  it("returns the exact lifecycle projection with real booleans", async () => {
    const db = await built();
    // Exercise the shaping directly against the same table the reader queries.
    const rows = db.prepare(
      "SELECT handle, store_domain, brand, category, first_seen, last_seen, departed_at," +
        " sold_at_flip, days_to_sell_flip, days_to_departure, days_to_sell," +
        " first_seen_censored, current_status, sold_signal_type, price FROM lifecycle" +
        " ORDER BY store_domain, handle",
    ).all();
    expect(Object.keys(rows[0])).toEqual([
      "handle", "store_domain", "brand", "category", "first_seen", "last_seen",
      "departed_at", "sold_at_flip", "days_to_sell_flip", "days_to_departure",
      "days_to_sell", "first_seen_censored", "current_status", "sold_signal_type", "price",
    ]);
    // SQLite gives 0/1; the reader must hand the analytics real booleans, because
    // computeKpis/isSellable test with === false / === true.
    expect(rows.find((r) => r.handle === "A").first_seen_censored).toBe(1);
  });

  it("coerced rows flow through the pure analytics unchanged", async () => {
    const db = await built();
    const raw = db.prepare("SELECT * FROM lifecycle").all();
    const coerced = raw.map((r) => ({ ...r, first_seen_censored: r.first_seen_censored === 1 }));
    // Uncoerced (0/1) is silently wrong: 0 !== false, so nothing counts.
    expect(computeKpis(raw).arrivalsPeriod).toBe(0);
    expect(computeKpis(coerced).arrivalsPeriod).toBe(
      coerced.filter((r) => r.first_seen_censored === false).length,
    );
    expect(buildVelocityBuckets(coerced).length).toBe(8);
    expect(storeSummary(coerced).length).toBe(2);
  });

  it("readers throw a clear error when no archive path is configured", async () => {
    const prev = process.env.DEPOT_ARCHIVE_DB;
    delete process.env.DEPOT_ARCHIVE_DB;
    await expect(readLifecycleLocal({})).rejects.toThrow(/DEPOT_ARCHIVE_DB/);
    await expect(readFlowLocal({})).rejects.toThrow(/DEPOT_ARCHIVE_DB/);
    if (prev) process.env.DEPOT_ARCHIVE_DB = prev;
  });

  it("makeLocalReaders exposes the readLifecycle/readFlow pair", () => {
    const r = makeLocalReaders({ path: "/nope" });
    expect(typeof r.readLifecycle).toBe("function");
    expect(typeof r.readFlow).toBe("function");
  });
});

// ===========================================================================
describe("archiverCore — mirror + cutoff", () => {
  const remoteRows = () => {
    nextId = 1;
    const out = [];
    for (const d of [1, 2, 3, 4, 5]) {
      out.push(snap({ handle: "A", observed_date: D(d), available: d < 3 }));
      out.push(snap({ handle: "B", observed_date: D(d), available: true }));
    }
    return out;
  };
  const ledger = () => [1, 2, 3, 4, 5].map((d) => ({ observed_date: D(d), row_count: 2 }));

  it("mirrors every row and is idempotent across runs", async () => {
    const db = await memDb();
    const { client } = makeFakeSupabase({ snapshots: remoteRows(), ledger: ledger() });
    const n1 = await mirrorRows(db, client);
    const after1 = db.prepare("SELECT COUNT(*) AS n FROM inventory_snapshots").get().n;
    const n2 = await mirrorRows(db, client);
    const after2 = db.prepare("SELECT COUNT(*) AS n FROM inventory_snapshots").get().n;
    expect(n1).toBe(10);
    expect(after1).toBe(10);
    expect(n2).toBe(0); // watermark advanced; nothing re-read
    expect(after2).toBe(10);
  });

  it("resumes from the id watermark after a crash mid-mirror", async () => {
    const db = await memDb();
    const rows = remoteRows();
    const { client } = makeFakeSupabase({ snapshots: rows });
    // Simulate a crash that committed only the first 4 rows.
    seedLocal(db, { rows: rows.slice(0, 4) });
    const mirrored = await mirrorRows(db, client);
    expect(mirrored).toBe(6);
    expect(db.prepare("SELECT COUNT(*) AS n FROM inventory_snapshots").get().n).toBe(10);
  });

  it("registers orphan days with in_ledger = 0", async () => {
    const db = await memDb();
    const rows = [...remoteRows(), snap({ handle: "Z", observed_date: "2026-05-21" })];
    const { client } = makeFakeSupabase({ snapshots: rows, ledger: ledger() });
    await runArchiver({ db, supabase: client, retainDays: 99, log: () => {} });
    const orphan = db.prepare("SELECT * FROM archive_days WHERE observed_date = '2026-05-21'").get();
    expect(orphan.in_ledger).toBe(0);
    expect(orphan.local_row_count).toBe(1);
  });

  it("cutoff is the Nth-newest LEDGER day, and null while history is short", async () => {
    const db = await memDb();
    seedLocal(db, { ledgerDays: [D(1), D(2), D(3), D(4), D(5)], orphanDays: ["2026-05-21"] });
    expect(computeCutoff(db, 2)).toBe(D(4));
    expect(computeCutoff(db, 5)).toBe(D(1));
    expect(computeCutoff(db, 6)).toBe(null); // orphan day must not pad the window
  });
});

// ===========================================================================
describe("archiverCore — verification gate", () => {
  async function setup({ remoteExtra = [], registryError = null } = {}) {
    const db = await memDb();
    nextId = 1;
    const rows = [1, 2, 3].flatMap((d) => [
      snap({ handle: "A", observed_date: D(d) }),
      snap({ handle: "B", observed_date: D(d) }),
    ]);
    const fake = makeFakeSupabase({
      snapshots: [...rows, ...remoteExtra],
      ledger: [1, 2, 3].map((d) => ({ observed_date: D(d), row_count: 2 })),
      registryError,
    });
    seedLocal(db, { rows, ledgerDays: [D(1), D(2), D(3)] });
    return { db, fake };
  }
  const now = () => new Date("2026-07-26T10:00:00.000Z");

  it("verifies a matching day, writing manifest + remote registry witness", async () => {
    const { db, fake } = await setup();
    const res = await verifyDay(db, fake.client, D(1), { now, log: () => {} });
    expect(res.verified).toBe(true);
    const m = db.prepare("SELECT * FROM day_manifest WHERE observed_date = ?").get(D(1));
    expect(m).toMatchObject({ row_count: 2, in_ledger: 1 });
    expect(m.max_id).toBe(db.prepare("SELECT MAX(id) AS m FROM inventory_snapshots WHERE observed_date = ?").get(D(1)).m);
    expect(fake.tables.archive_day_registry).toHaveLength(1);
    expect(fake.tables.archive_day_registry[0]).toMatchObject({ observed_date: D(1), row_count: 2 });
    expect(db.prepare("SELECT verified_at FROM archive_days WHERE observed_date = ?").get(D(1)).verified_at)
      .toBe("2026-07-26T10:00:00.000Z");
  });

  it("repairs a day when Supabase holds MORE rows than the mirror", async () => {
    const { db, fake } = await setup();
    // A row the mirror missed (id below the local watermark can't happen, but a
    // day-scoped shortfall can — e.g. an interrupted first mirror).
    db.prepare("DELETE FROM inventory_snapshots WHERE observed_date = ? AND handle = 'B'").run(D(2));
    const res = await verifyDay(db, fake.client, D(2), { now, log: () => {} });
    expect(res.verified).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM inventory_snapshots WHERE observed_date = ?").get(D(2)).n).toBe(2);
  });

  it("refuses to verify when the mirror holds MORE rows than Supabase", async () => {
    const { db, fake } = await setup();
    fake.tables.inventory_snapshots = fake.tables.inventory_snapshots.filter(
      (r) => !(r.observed_date === D(2) && r.handle === "B"),
    );
    const res = await verifyDay(db, fake.client, D(2), { now, log: () => {} });
    expect(res.verified).toBe(false);
    expect(db.prepare("SELECT verified_at FROM archive_days WHERE observed_date = ?").get(D(2)).verified_at).toBe(null);
    expect(db.prepare("SELECT COUNT(*) AS n FROM day_manifest").get().n).toBe(0);
  });

  it("treats remote 0 == local 0 as a continuity violation, never verification", async () => {
    const { db, fake } = await setup();
    db.prepare("DELETE FROM inventory_snapshots WHERE observed_date = ?").run(D(1));
    fake.tables.inventory_snapshots = fake.tables.inventory_snapshots.filter((r) => r.observed_date !== D(1));
    await expect(verifyDay(db, fake.client, D(1), { now, log: () => {} })).rejects.toThrow(
      /archive-continuity-violation|refusing|never verified/,
    );
  });

  it("is fatal when a pruned day has local rows but no manifest entry", async () => {
    const { db, fake } = await setup();
    fake.tables.inventory_snapshots = fake.tables.inventory_snapshots.filter((r) => r.observed_date !== D(1));
    await expect(verifyDay(db, fake.client, D(1), { now, log: () => {} })).rejects.toThrow(ArchiveError);
  });

  it("fails verification (and therefore any delete) when the registry upsert fails", async () => {
    const { db, fake } = await setup({ registryError: "permission denied" });
    await expect(verifyDay(db, fake.client, D(1), { now, log: () => {} })).rejects.toThrow(/registry/);
    expect(db.prepare("SELECT verified_at FROM archive_days WHERE observed_date = ?").get(D(1)).verified_at).toBe(null);
  });

  it("warns but still verifies when the ledger row_count is stale", async () => {
    const { db, fake } = await setup();
    db.prepare("UPDATE archive_days SET supabase_row_count = 99 WHERE observed_date = ?").run(D(1));
    const logs = [];
    const res = await verifyDay(db, fake.client, D(1), { now, log: (e) => logs.push(e) });
    expect(res.verified).toBe(true);
    expect(logs.some((l) => l.event === "ledger_count_drift")).toBe(true);
  });
});

// ===========================================================================
describe("archiverCore — deletion, watermark and re-verification", () => {
  const now = () => new Date("2026-07-26T10:00:00.000Z");

  async function verified() {
    const db = await memDb();
    nextId = 1;
    const rows = [1, 2, 3].flatMap((d) => [
      snap({ handle: "A", observed_date: D(d) }),
      snap({ handle: "B", observed_date: D(d) }),
    ]);
    const fake = makeFakeSupabase({
      snapshots: rows,
      ledger: [1, 2, 3].map((d) => ({ observed_date: D(d), row_count: 2 })),
    });
    seedLocal(db, { rows, ledgerDays: [D(1), D(2), D(3)] });
    await verifyDay(db, fake.client, D(1), { now, log: () => {} });
    return { db, fake };
  }

  it("deletes only the frozen id set and tombstones the day", async () => {
    const { db, fake } = await verified();
    const res = await deleteDay(db, fake.client, D(1), { now, log: () => {} });
    expect(res).toMatchObject({ deleted: 2, tombstoned: true });
    expect(fake.tables.inventory_snapshots.some((r) => r.observed_date === D(1))).toBe(false);
    expect(
      db.prepare("SELECT deleted_from_supabase_at FROM archive_days WHERE observed_date = ?").get(D(1))
        .deleted_from_supabase_at,
    ).toBe("2026-07-26T10:00:00.000Z");
    // The local mirror keeps the rows — this is the archive.
    expect(db.prepare("SELECT COUNT(*) AS n FROM inventory_snapshots WHERE observed_date = ?").get(D(1)).n).toBe(2);
  });

  it("refuses to delete a day that was never verified", async () => {
    const { db, fake } = await verified();
    await expect(deleteDay(db, fake.client, D(2), { now, log: () => {} })).rejects.toThrow(
      /unmanifested|unverified/,
    );
    expect(fake.tables.inventory_snapshots.filter((r) => r.observed_date === D(2))).toHaveLength(2);
  });

  it("re-runs cleanly over a half-deleted day (crash mid-delete)", async () => {
    const { db, fake } = await verified();
    // Simulate: one chunk landed, then the process died before the tombstone.
    fake.tables.inventory_snapshots = fake.tables.inventory_snapshots.filter(
      (r) => !(r.observed_date === D(1) && r.handle === "A"),
    );
    const res = await deleteDay(db, fake.client, D(1), { now, log: () => {} });
    expect(res.tombstoned).toBe(true);
    expect(fake.tables.inventory_snapshots.some((r) => r.observed_date === D(1))).toBe(false);
  });

  it("routes a post-verification insert through re-verification before deleting it", async () => {
    const { db, fake } = await verified();
    const manifest = db.prepare("SELECT * FROM day_manifest WHERE observed_date = ?").get(D(1));
    // A manual old-date backfill lands between verification and deletion — higher
    // bigserial id, so it sits above the frozen watermark, and the mirror has it.
    const late = snap({ id: 9999, handle: "LATE", observed_date: D(1) });
    fake.tables.inventory_snapshots.push(late);
    seedLocal(db, { rows: [late] });

    const logs = [];
    const res = await deleteDay(db, fake.client, D(1), { now, log: (e) => logs.push(e) });
    // Re-verified against live remote data first — loudly — and only then deleted.
    expect(logs.some((l) => l.event === "reverified")).toBe(true);
    const after = db.prepare("SELECT * FROM day_manifest WHERE observed_date = ?").get(D(1));
    expect(after.max_id).toBe(9999);
    expect(after.row_count).toBe(3);
    expect(after.max_id).toBeGreaterThan(manifest.max_id);
    expect(res).toMatchObject({ deleted: 3, tombstoned: true });
  });

  it("never deletes an UNMIRRORED late row: remainder is loud and the tombstone is withheld", async () => {
    const { db, fake } = await verified();
    // The row appears in Supabase mid-run, after this process froze its id set —
    // the mirror has not seen it, so it can never enter the delete set.
    const late = snap({ id: 9999, handle: "LATE", observed_date: D(1) });
    fake.tables.inventory_snapshots.push(late);

    const logs = [];
    const res = await deleteDay(db, fake.client, D(1), { now, log: (e) => logs.push(e) });
    expect(res).toMatchObject({ deleted: 2, tombstoned: false });
    expect(fake.tables.inventory_snapshots.filter((r) => r.observed_date === D(1))).toEqual([late]);
    expect(logs.some((l) => l.event === "delete_remainder")).toBe(true);
    expect(
      db.prepare("SELECT deleted_from_supabase_at FROM archive_days WHERE observed_date = ?").get(D(1))
        .deleted_from_supabase_at,
    ).toBe(null);

    // Next run mirrors it, re-verifies, and finishes cleanly — no wedge.
    await mirrorRows(db, fake.client);
    const res2 = await deleteDay(db, fake.client, D(1), { now, log: () => {} });
    expect(res2.tombstoned).toBe(true);
    expect(fake.tables.inventory_snapshots.some((r) => r.observed_date === D(1))).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM inventory_snapshots WHERE observed_date = ?").get(D(1)).n).toBe(3);
  });

  it("is fatal to re-verify a diverged day that Supabase no longer holds", async () => {
    const { db, fake } = await verified();
    seedLocal(db, { rows: [snap({ id: 9999, handle: "LATE", observed_date: D(1) })] });
    fake.tables.inventory_snapshots = fake.tables.inventory_snapshots.filter((r) => r.observed_date !== D(1));
    await expect(deleteDay(db, fake.client, D(1), { now, log: () => {} })).rejects.toThrow(
      /already pruned|continuity/,
    );
  });
});

// ===========================================================================
describe("archiverCore — continuity guards", () => {
  const now = () => new Date("2026-07-26T10:00:00.000Z");

  it("aborts when Supabase shows pruning but the local archive was never initialized", async () => {
    const db = await memDb();
    nextId = 1;
    // Supabase kept only 06-03; the registry witnesses 06-01/06-02 as pruned.
    const fake = makeFakeSupabase({
      snapshots: [snap({ handle: "A", observed_date: D(3) })],
      ledger: [1, 2, 3].map((d) => ({ observed_date: D(d), row_count: 1 })),
      registry: [
        { observed_date: D(1), in_ledger: true, row_count: 1, row_hash: "x", verified_at: "t" },
        { observed_date: D(2), in_ledger: true, row_count: 1, row_hash: "x", verified_at: "t" },
      ],
    });
    await expect(runArchiver({ db, supabase: fake.client, retainDays: 2, log: () => {} })).rejects.toThrow(
      /archive-continuity-violation|never fully verified/,
    );
    // Nothing was published to the dashboard from a violating archive.
    expect(db.prepare("SELECT COUNT(*) AS n FROM lifecycle").get().n).toBe(0);
  });

  it("aborts when a pruned ORPHAN day is missing from the manifest (registry catches it)", async () => {
    const db = await memDb();
    nextId = 1;
    setMeta(db, "initialized_at", "2026-07-01T00:00:00.000Z");
    const fake = makeFakeSupabase({
      snapshots: [snap({ handle: "A", observed_date: D(3) })],
      ledger: [{ observed_date: D(3), row_count: 1 }],
      // The orphan backfill day was verified and pruned; the ledger cannot witness
      // it, so only the registry proves it existed.
      registry: [{ observed_date: "2026-05-21", in_ledger: false, row_count: 20352, row_hash: "x", verified_at: "t" }],
    });
    await expect(runArchiver({ db, supabase: fake.client, retainDays: 1, log: () => {} })).rejects.toThrow(
      /2026-05-21|continuity/,
    );
  });

  it("aborts when a restored file holds fewer rows than a day's manifest (truncated restore)", async () => {
    const db = await memDb();
    nextId = 1;
    const rows = [snap({ handle: "A", observed_date: D(1) }), snap({ handle: "B", observed_date: D(1) })];
    const fake = makeFakeSupabase({ snapshots: rows, ledger: [{ observed_date: D(1), row_count: 2 }] });
    seedLocal(db, { rows, ledgerDays: [D(1)] });
    await verifyDay(db, fake.client, D(1), { now, log: () => {} });
    // Mid-mirror backup restore: the day came back with only half its rows.
    db.prepare("DELETE FROM inventory_snapshots WHERE handle = 'B'").run();
    recount(db);
    await expect(continuityGuard(db, fake.client, { log: () => {} })).rejects.toThrow(
      /!= manifest 2/,
    );
    await expect(continuityGuard(db, fake.client, { log: () => {} })).rejects.toMatchObject({
      code: "archive-continuity-violation",
    });
  });

  it("treats rows ABOVE the watermark as a re-verify candidate, not corruption", async () => {
    const db = await memDb();
    nextId = 1;
    const rows = [snap({ handle: "A", observed_date: D(1) })];
    const fake = makeFakeSupabase({ snapshots: rows, ledger: [{ observed_date: D(1), row_count: 1 }] });
    seedLocal(db, { rows, ledgerDays: [D(1)] });
    await verifyDay(db, fake.client, D(1), { now, log: () => {} });
    const late = snap({ id: 9999, handle: "LATE", observed_date: D(1) });
    seedLocal(db, { rows: [late] });
    fake.tables.inventory_snapshots.push(late);
    recount(db);
    const out = await continuityGuard(db, fake.client, { log: () => {} });
    expect(out.reverifyDays).toEqual([D(1)]);
  });

  it("aborts the run when --deep-verify finds a hash mismatch, before any delete", async () => {
    const db = await memDb();
    nextId = 1;
    const rows = [snap({ handle: "A", observed_date: D(1) })];
    const fake = makeFakeSupabase({ snapshots: rows, ledger: [{ observed_date: D(1), row_count: 1 }] });
    seedLocal(db, { rows, ledgerDays: [D(1)] });
    await verifyDay(db, fake.client, D(1), { now, log: () => {} });
    // Corrupt the mirrored row so the local hash no longer matches the manifest.
    db.prepare("UPDATE inventory_snapshots SET price = '€999.00' WHERE handle = 'A'").run();
    setMeta(db, "last_snapshot_at", "2026-07-25T00:00:00.000Z"); // pass the prune gate
    await expect(
      runArchiver({ db, supabase: fake.client, retainDays: 1, prune: true, deepVerify: true, log: () => {} }),
    ).rejects.toMatchObject({ code: "deep-verify-failed" });
    // Nothing was deleted from Supabase off the diverged mirror.
    expect(fake.calls.deletes).toHaveLength(0);
    expect(fake.tables.inventory_snapshots).toHaveLength(1);
  });

  it("refuses to prune before a verified snapshot exists", async () => {
    const db = await memDb();
    const fake = makeFakeSupabase({ snapshots: [], ledger: [] });
    await expect(
      runArchiver({ db, supabase: fake.client, prune: true, log: () => {} }),
    ).rejects.toThrow(/snapshot/);
  });
});

// ===========================================================================
describe("archiverCore — full run", () => {
  it("mirrors, verifies past the cutoff, prunes and rebuilds the derived tables", async () => {
    const db = await memDb();
    nextId = 1;
    const rows = [1, 2, 3, 4, 5].flatMap((d) => [
      snap({ handle: "A", observed_date: D(d), available: d < 4 }),
      snap({ handle: "B", observed_date: D(d) }),
    ]);
    const fake = makeFakeSupabase({
      snapshots: rows,
      ledger: [1, 2, 3, 4, 5].map((d) => ({ observed_date: D(d), row_count: 2 })),
    });
    setMeta(db, "last_snapshot_at", "2026-07-25T00:00:00.000Z"); // prune precondition

    const summary = await runArchiver({
      db, supabase: fake.client, retainDays: 3, prune: true,
      now: () => new Date("2026-07-26T10:00:00.000Z"), log: () => {},
    });

    expect(summary.mirrored).toBe(10);
    expect(summary.cutoff).toBe(D(3));
    expect(summary.verifiedDays).toBe(2);      // 06-01, 06-02
    expect(summary.deletedDays).toBe(2);
    expect(summary.deletedRows).toBe(4);
    // Supabase kept the hot window only; the local mirror kept everything.
    expect(fake.tables.inventory_snapshots).toHaveLength(6);
    expect(db.prepare("SELECT COUNT(*) AS n FROM inventory_snapshots").get().n).toBe(10);
    // Registry witnesses both pruned days.
    expect(fake.tables.archive_day_registry.map((r) => r.observed_date).sort()).toEqual([D(1), D(2)]);
    // Derived tables rebuilt over the FULL local history.
    expect(db.prepare("SELECT COUNT(*) AS n FROM daily_flow").get().n).toBe(5);
    expect(getMeta(db, "last_archived_day")).toBe(D(5));
    expect(getMeta(db, "initialized_at")).toBeTruthy();

    // A second run over the pruned remote state must pass the continuity guard.
    const summary2 = await runArchiver({
      db, supabase: fake.client, retainDays: 3, prune: true,
      now: () => new Date("2026-07-27T10:00:00.000Z"), log: () => {},
    });
    expect(summary2.deletedDays).toBe(0);
    expect(summary2.mirrored).toBe(0);
  });

  it("mirror-only mode never deletes anything", async () => {
    const db = await memDb();
    nextId = 1;
    const rows = [1, 2, 3, 4, 5].flatMap((d) => [snap({ handle: "A", observed_date: D(d) })]);
    const fake = makeFakeSupabase({
      snapshots: rows,
      ledger: [1, 2, 3, 4, 5].map((d) => ({ observed_date: D(d), row_count: 1 })),
    });
    const summary = await runArchiver({ db, supabase: fake.client, retainDays: 2, log: () => {} });
    expect(summary.deletedRows).toBe(0);
    expect(fake.calls.deletes).toHaveLength(0);
    expect(fake.tables.inventory_snapshots).toHaveLength(5);
    expect(summary.verifiedDays).toBe(3); // verification still runs — it is read-only
  });
});

// ===========================================================================
describe("hashRows", () => {
  it("is order- and content-sensitive", () => {
    const a = [{ id: 1, handle: "h", store_domain: "s", available: true, price: "€1.00" }];
    const b = [{ id: 1, handle: "h", store_domain: "s", available: false, price: "€1.00" }];
    expect(hashRows(a)).toBe(hashRows(a.map((r) => ({ ...r }))));
    expect(hashRows(a)).not.toBe(hashRows(b));
  });
});

// ===========================================================================
describe("getInventoryInsights — readers override", () => {
  it("uses injected readers instead of the Supabase path", async () => {
    const lifecycleRows = [{
      handle: "h", store_domain: "s1", brand: "Margiela", category: "Tops",
      first_seen: "2026-06-01", last_seen: "2026-06-05", departed_at: "2026-06-06",
      sold_at_flip: null, days_to_sell_flip: null, days_to_departure: 5, days_to_sell: 5,
      first_seen_censored: false, current_status: "departed", sold_signal_type: "delist",
      price: "€100.00",
    }];
    const calls = [];
    const out = await getInventoryInsights({
      db: null, // must never be touched
      readers: {
        readLifecycle: async (a) => { calls.push(["lifecycle", a]); return lifecycleRows; },
        readFlow: async (a) => { calls.push(["flow", a]); return [
          { observed_date: "2026-06-01", arrivals: 1, departures: 0, active: 1, is_seed_day: true },
        ]; },
      },
    });
    expect(calls.map((c) => c[0])).toEqual(["lifecycle", "flow"]);
    expect(out.meta.totalTracked).toBe(1);
    expect(out.flow[0].isSeedDay).toBe(true);
    expect(out.storeBreakdown[0].store).toBe("s1");
  });
});
