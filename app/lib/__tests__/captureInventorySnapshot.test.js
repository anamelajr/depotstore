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
//   upsertError: Error to return from an upsert
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
        recorded.upserts.push({ rows, opts });
        return Promise.resolve(
          config.upsertError ? { error: config.upsertError } : { error: null },
        );
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
});

describe("captureInventorySnapshot — daily gate", () => {
  it("skips when a snapshot already exists for this UTC day", async () => {
    const { client, recorded } = makeFakeSupabase({
      gate: { data: [{ observed_at: "2026-06-06T03:00:00.000Z" }], error: null },
    });
    const summary = { errors: [] };

    await captureInventorySnapshot("2026-06-06T12:00:00.000Z", summary, client);

    // Only the gate table was read; products were never re-read.
    expect(recorded.fromTables).toEqual(["inventory_snapshots"]);
    expect(recorded.rangeCalls).toEqual([]);
    expect(recorded.upserts).toEqual([]);
    expect(summary.snapshot).toEqual({
      captured: false,
      skipped: "already-captured-today",
    });
  });

  it("compares dates in UTC, not local time (late-UTC instant still same day)", async () => {
    // 23:30Z on the 6th is still 2026-06-06 in UTC even where local time has
    // rolled to the 7th — the gate must use the UTC date.
    const { client } = makeFakeSupabase({
      gate: { data: [{ observed_at: "2026-06-06T00:30:00.000Z" }], error: null },
    });
    const summary = { errors: [] };

    await captureInventorySnapshot("2026-06-06T23:30:00.000Z", summary, client);

    expect(summary.snapshot).toEqual({
      captured: false,
      skipped: "already-captured-today",
    });
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
    const summary = { errors: [] };

    await captureInventorySnapshot(syncStart, summary, client);

    // Paged by id with inclusive ranges, stopping on the short page.
    expect(recorded.rangeCalls).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
    ]);

    // PAGE_SIZE + 3 rows => ceil((PAGE_SIZE+3)/INSERT_BATCH) batches.
    const totalRows = PAGE_SIZE + 3;
    const expectedBatches = Math.ceil(totalRows / INSERT_BATCH);
    expect(recorded.upserts).toHaveLength(expectedBatches);

    // Invariant #2: the product projection is EXACTLY SNAPSHOT_COLUMNS, which
    // omits `id` (so the `{...row}` spread can't clobber the snapshot table's
    // bigserial) and omits `observed_date` (a GENERATED column).
    const productSelect = recorded.selects.find((s) => s.table === "products");
    expect(productSelect.cols).toBe(SNAPSHOT_COLUMNS);
    expect(SNAPSHOT_COLUMNS).not.toMatch(/\bid\b/);
    expect(SNAPSHOT_COLUMNS).not.toMatch(/\bobserved_date\b/);

    // Invariant #1: the re-read applies NO visibility filter — it must capture
    // available=false AND hidden=true rows. Proven by zero .eq() calls.
    expect(recorded.eqCalls).toEqual([]);

    // Every upsert uses ON CONFLICT DO NOTHING against the generated column and
    // every row carries the run's observed_at stamp.
    for (const { rows, opts } of recorded.upserts) {
      expect(opts).toEqual({
        onConflict: "handle,store_domain,observed_date",
        ignoreDuplicates: true,
      });
      for (const r of rows) expect(r.observed_at).toBe(syncStart);
    }

    // Row count round-trips and success is logged + summarized.
    const insertedRows = recorded.upserts.reduce((n, u) => n + u.rows.length, 0);
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
    const summary = { errors: [] };

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
