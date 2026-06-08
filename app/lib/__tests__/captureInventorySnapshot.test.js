import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { captureInventorySnapshot, PAGE_SIZE, INSERT_BATCH, SNAPSHOT_COLUMNS } from "../captureInventorySnapshot.js";

// --- Fake supabase client -------------------------------------------------
// Models the three query shapes the function issues:
//   gate:    .from("inventory_snapshots").select(...).order(...).limit(1)
//   read:    .from("products").select(...).order(...).range(from,to)
//   insert:  .from("inventory_snapshots").upsert(rows, opts)
// Each .from() returns a chainable, thenable builder. The awaited result is
// chosen by which terminal method (.limit / .range / .upsert) was called.
//
// config:
//   gate:        result object for the daily-gate read   (default: empty)
//   pages:       array of product-row arrays, one per .range() call
//   gateError:   Error to return from the gate read
//   productError:Error to return from a product read
//   upsertError: Error to return from a data upsert (inventory_snapshots)
//   markError:   Error to return from the completeness-ledger upsert
//                (inventory_snapshot_days)
function makeFakeSupabase(config = {}) {
  // selects/eqCalls record builder args so tests can assert the EXACT product
  // projection (invariant #2: no `id`) and that NO visibility filter is applied
  // (invariant #1: capture available=false + hidden=true). Without recording,
  // those guards would be trivially true and give false confidence.
  const recorded = { fromTables: [], selects: [], eqCalls: [], rangeCalls: [], upserts: [] };
  let pageCursor = 0;

  function builder(table) {
    const state = { table, terminal: null, pageForThisCall: null };
    const b = {
      select(cols) { recorded.selects.push({ table, cols }); return b; },
      order() { return b; },
      eq(col, val) { recorded.eqCalls.push({ table, col, val }); return b; },
      limit(n) { state.terminal = "limit"; state.limitN = n; return b; },
      range(from, to) {
        state.terminal = "range";
        state.pageForThisCall = pageCursor;
        pageCursor += 1;
        recorded.rangeCalls.push([from, to]);
        return b;
      },
      upsert(rows, opts) {
        recorded.upserts.push({ table, rows, opts });
        const err =
          table === "inventory_snapshot_days" ? config.markError : config.upsertError;
        return Promise.resolve(err ? { error: err } : { error: null });
      },
      then(resolve, reject) {
        let result;
        if (state.terminal === "limit") {
          result = config.gateError
            ? { data: null, error: config.gateError }
            : config.gate ?? { data: [], error: null };
        } else if (state.terminal === "range") {
          result = config.productError
            ? { data: null, error: config.productError }
            : { data: config.pages?.[state.pageForThisCall] ?? [], error: null };
        } else {
          result = { data: null, error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return b;
  }

  const client = {
    from(table) { recorded.fromTables.push(table); return builder(table); },
  };
  return { client, recorded };
}

// Build N product rows with distinct handles (no `id` — the real SELECT omits it).
function makeProducts(n, startIndex = 0) {
  return Array.from({ length: n }, (_, i) => ({
    handle: `h${startIndex + i}`,
    store_domain: "store.example",
    shopify_id: 1000 + startIndex + i,
    brand: "Brand",
    title: "Title",
    name: "Name",
    category: "Tops",
    subcategory: null,
    price: "€10.00",
    available: true,
    hidden: false,
  }));
}

let logSpy, errSpy;
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
});

describe("captureInventorySnapshot — clean-run gate", () => {
  it("skips (no DB calls) when the run had errors", async () => {
    const { client, recorded } = makeFakeSupabase();
    const summary = { errors: ["seys sync failed"] };

    await captureInventorySnapshot("2026-06-06T12:00:00.000Z", summary, client);

    expect(recorded.fromTables).toEqual([]); // never touched the DB
    expect(summary.snapshot).toEqual({ captured: false, skipped: "run-had-errors" });
  });

  it("skips (no DB calls) when any store returned zero products", async () => {
    // A count===0 store is a likely-failed fetch — the sync path treats it as
    // failed and excludes it from stale cleanup, but it never reaches
    // summary.errors. Snapshotting would freeze that store's stale rows.
    const { client, recorded } = makeFakeSupabase();
    const summary = { errors: [], stores: { "good.example": 12, "empty.example": 0 } };

    await captureInventorySnapshot("2026-06-06T12:00:00.000Z", summary, client);

    expect(recorded.fromTables).toEqual([]); // never touched the DB
    expect(summary.snapshot).toEqual({
      captured: false,
      skipped: "run-had-empty-store",
    });
  });

  it("proceeds when every store returned a positive count", async () => {
    const { client, recorded } = makeFakeSupabase({
      gate: { data: [], error: null }, // no ledger row for today => capture
      pages: [makeProducts(2, 0)],
    });
    const summary = { errors: [], stores: { "good.example": 12, "also.example": 3 } };

    await captureInventorySnapshot("2026-06-06T12:00:00.000Z", summary, client);

    expect(recorded.fromTables[0]).toBe("inventory_snapshot_days"); // passed the gate
    expect(summary.snapshot).toEqual({ captured: true, rows: 2 });
  });
});

describe("captureInventorySnapshot — daily completeness gate", () => {
  it("skips when the ledger marks this UTC day complete", async () => {
    const { client, recorded } = makeFakeSupabase({
      gate: { data: [{ observed_date: "2026-06-06" }], error: null },
    });
    const summary = { errors: [], stores: { a: 1 } };

    await captureInventorySnapshot("2026-06-06T12:00:00.000Z", summary, client);

    // Only the ledger table was read; products were never re-read.
    expect(recorded.fromTables).toEqual(["inventory_snapshot_days"]);
    expect(recorded.rangeCalls).toEqual([]);
    expect(recorded.upserts).toEqual([]);
    expect(summary.snapshot).toEqual({
      captured: false,
      skipped: "already-captured-today",
    });
  });

  it("queries the ledger by UTC date (late-UTC instant still same day)", async () => {
    // 23:30Z on the 6th is still 2026-06-06 in UTC even where local time has
    // rolled to the 7th — the gate must look up the ledger by the UTC date.
    const { client, recorded } = makeFakeSupabase({
      gate: { data: [{ observed_date: "2026-06-06" }], error: null },
    });
    const summary = { errors: [], stores: { a: 1 } };

    await captureInventorySnapshot("2026-06-06T23:30:00.000Z", summary, client);

    expect(recorded.eqCalls).toContainEqual({
      table: "inventory_snapshot_days",
      col: "observed_date",
      val: "2026-06-06",
    });
    expect(summary.snapshot).toEqual({
      captured: false,
      skipped: "already-captured-today",
    });
  });

  it("captures when a prior run left a PARTIAL day (no ledger row)", async () => {
    // The previous run committed some batches but failed before writing the
    // ledger, so no marker exists. This run must re-capture; the data insert's
    // ON CONFLICT DO NOTHING backfills only the rows the partial run missed.
    const { client, recorded } = makeFakeSupabase({
      gate: { data: [], error: null }, // partial day => no ledger row
      pages: [makeProducts(4, 0)],
    });
    const summary = { errors: [], stores: { a: 1 } };

    await captureInventorySnapshot("2026-06-06T12:00:00.000Z", summary, client);

    expect(recorded.rangeCalls).toEqual([[0, PAGE_SIZE - 1]]);
    expect(summary.snapshot).toEqual({ captured: true, rows: 4 });
  });
});

describe("captureInventorySnapshot — capture happy path", () => {
  it("pages by id, stamps observed_at, batches an idempotent insert, logs ok", async () => {
    // One full page forces a second .range() call; a short final page ends it.
    const page1 = makeProducts(PAGE_SIZE, 0);
    const page2 = makeProducts(3, PAGE_SIZE);
    const { client, recorded } = makeFakeSupabase({
      gate: { data: [], error: null }, // cold start — proceed
      pages: [page1, page2],
    });
    const syncStart = "2026-06-06T12:00:00.000Z";
    const summary = { errors: [], stores: { a: 1 } };

    await captureInventorySnapshot(syncStart, summary, client);

    // Paged by id with inclusive ranges, stopping on the short page.
    expect(recorded.rangeCalls).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
    ]);

    // Data upserts target inventory_snapshots; the ledger upsert is separate.
    const dataUpserts = recorded.upserts.filter(
      (u) => u.table === "inventory_snapshots",
    );

    // PAGE_SIZE + 3 rows => ceil((PAGE_SIZE+3)/INSERT_BATCH) batches.
    const totalRows = PAGE_SIZE + 3;
    const expectedBatches = Math.ceil(totalRows / INSERT_BATCH);
    expect(dataUpserts).toHaveLength(expectedBatches);

    // Invariant #2: the product projection is EXACTLY SNAPSHOT_COLUMNS, which
    // omits `id` (so the `{...row}` spread can't clobber the snapshot table's
    // bigserial) and omits `observed_date` (a GENERATED column).
    const productSelect = recorded.selects.find((s) => s.table === "products");
    expect(productSelect.cols).toBe(SNAPSHOT_COLUMNS);
    expect(SNAPSHOT_COLUMNS).not.toMatch(/\bid\b/);
    expect(SNAPSHOT_COLUMNS).not.toMatch(/\bobserved_date\b/);

    // Invariant #1: the PRODUCT re-read applies NO visibility filter — it must
    // capture available=false AND hidden=true rows. Proven by zero .eq() calls
    // against the products table. (The ledger gate legitimately .eq()s on
    // inventory_snapshot_days; that's not a visibility filter on products.)
    expect(recorded.eqCalls.filter((e) => e.table === "products")).toEqual([]);

    // Every data upsert uses ON CONFLICT DO NOTHING against the generated column
    // and every row carries the run's observed_at stamp.
    for (const { rows, opts } of dataUpserts) {
      expect(opts).toEqual({
        onConflict: "handle,store_domain,observed_date",
        ignoreDuplicates: true,
      });
      for (const r of rows) expect(r.observed_at).toBe(syncStart);
    }

    // The completeness ledger is written exactly once, AFTER the data, keyed by
    // the UTC date and carrying the row count.
    const markerUpserts = recorded.upserts.filter(
      (u) => u.table === "inventory_snapshot_days",
    );
    expect(markerUpserts).toHaveLength(1);
    expect(markerUpserts[0].rows).toEqual({
      observed_date: "2026-06-06",
      observed_at: syncStart,
      row_count: totalRows,
    });
    expect(markerUpserts[0].opts).toEqual({
      onConflict: "observed_date",
      ignoreDuplicates: true,
    });

    // Row count round-trips and success is logged + summarized.
    const insertedRows = dataUpserts.reduce((n, u) => n + u.rows.length, 0);
    expect(insertedRows).toBe(totalRows);
    expect(summary.snapshot).toEqual({ captured: true, rows: totalRows });
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ event: "inventory_snapshot_ok", rows: totalRows }),
    );
  });

  it("captures with a single short page (no second range call)", async () => {
    const { client, recorded } = makeFakeSupabase({
      gate: { data: [], error: null },
      pages: [makeProducts(5, 0)],
    });
    const summary = { errors: [], stores: { a: 1 } };

    await captureInventorySnapshot("2026-06-06T12:00:00.000Z", summary, client);

    expect(recorded.rangeCalls).toEqual([[0, PAGE_SIZE - 1]]);
    expect(summary.snapshot).toEqual({ captured: true, rows: 5 });
  });
});

describe("captureInventorySnapshot — failure isolation", () => {
  const failCases = [
    [
      "gate read error",
      { gateError: new Error("gate boom") },
      "daily-gate read failed: gate boom",
    ],
    [
      "product read error",
      { gate: { data: [], error: null }, productError: new Error("read boom") },
      "product re-read failed at offset 0: read boom",
    ],
    [
      "insert error",
      {
        gate: { data: [], error: null },
        pages: [makeProducts(2, 0)],
        upsertError: new Error("insert boom"),
      },
      "snapshot insert failed at batch 0: insert boom",
    ],
    [
      "ledger mark error",
      {
        gate: { data: [], error: null },
        pages: [makeProducts(2, 0)],
        markError: new Error("mark boom"),
      },
      "snapshot completeness mark failed: mark boom",
    ],
  ];

  it.each(failCases)(
    "catches a %s, never rethrows, logs inventory_snapshot_fail",
    async (_label, config, expectedError) => {
      const { client } = makeFakeSupabase(config);
      const summary = { errors: [] };

      // Must not throw.
      await expect(
        captureInventorySnapshot("2026-06-06T12:00:00.000Z", summary, client),
      ).resolves.toBeUndefined();

      expect(summary.snapshot).toEqual({ captured: false, error: expectedError });
      expect(errSpy).toHaveBeenCalledWith(
        JSON.stringify({ event: "inventory_snapshot_fail", error: expectedError }),
      );
    },
  );
});
