# Inventory History Capture — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a daily, full snapshot of every `products` row into a new
`inventory_snapshots` table from the hourly cron — additively, never touching the
existing inventory read/write path — so forward-going sell-through and turnover
history stops being discarded every hour.

**Architecture:** A new versioned SQL migration creates `inventory_snapshots`
(one row per product per UTC day, enforced by a UNIQUE constraint on a generated
`observed_date`). A new, strictly-additive `app/lib/captureInventorySnapshot.js`
exports one function that gates on a clean run + once-per-UTC-day, re-reads all
product rows paged deterministically by `id`, and bulk-inserts them idempotently.
It is wired into `app/api/cron/route.js` **after** the stale-delete and **before**
the enrich trigger, awaited, inside its own try/catch so a snapshot failure can
never block or corrupt the sync.

**Tech Stack:** Next.js App Router route handler, `@supabase/supabase-js` v2
(service-role admin client), Postgres (Supabase), Vitest for unit tests.

**Scope:** This plan covers **Phase 1 (capture) only.** Phase 2 (the SQL views +
`/admin` insights dashboard) is explicitly deferred to its own spec per the design
doc's sequencing — do **not** create any views, charts, or admin pages here.

**Source design:** [`docs/plan-inventory-history.md`](plan-inventory-history.md)
(the hardened design proposal — this is the *input*, do not edit it).

---

## Pre-flight facts (verified against live DB `pnjewddyeslsbozoeyks`)

These were confirmed via the read-only MCP at planning time so the engineer
doesn't have to re-derive them:

- `products` has 21 columns; all 11 we mirror exist:
  `handle, store_domain, shopify_id, brand, title, name, category, subcategory,
  price, available, hidden`. `price` is `text`, `available`/`hidden` are
  `boolean`, `shopify_id` is `bigint`.
- `inventory_snapshots` does **not** exist yet (`to_regclass` → null).
- `products` currently holds **20,972** rows (the snapshot's per-day row count).
- `products_pre_subcategory_snapshot` exists (the optional backfill source):
  **20,352** rows, `synced_at` spans `2026-05-20 23:21` → `2026-05-21 08:33` UTC,
  18 columns, **no `subcategory` / `image_url_2` / `size`** columns.

## Invariants this plan must not break (read before coding)

1. **The snapshot product re-read takes NO visibility filter.** It deliberately
   captures `available = false` AND `hidden = true` rows — sold/departed/hidden
   inventory is the entire point of the history table. This is a *deliberate*
   exception to the CLAUDE.md rule "every `available = true` read must also
   `.eq('hidden', false)`". A reviewer will try to "fix" this; the code comment
   must state it is intentional.
2. **`observed_date` is `GENERATED ALWAYS` — never put it in an insert payload.**
   The insert maps only the selected product columns + `observed_at`. The product
   SELECT deliberately omits `id` so the spread can't clobber the snapshot table's
   own `bigserial` id.
3. **Failure isolation is non-negotiable.** The capture call runs *outside* the
   `Promise.allSettled` store map and has its own try/catch that **never
   rethrows**. A broken/missing table or a failed insert degrades to a logged
   no-op — never a blocked or corrupted sync (this is the 2026-05-05 incident
   failure mode the design guards against).
4. **Daily-gate dates are computed in UTC** via `new Date(iso).toISOString()
   .slice(0, 10)` on *both* sides, matching the generated column's
   `(observed_at AT TIME ZONE 'UTC')::date`. Never use local-time extraction.

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `scripts/sql/2026-06-06-inventory-snapshots.sql` | DDL for the snapshot table + indexes + RLS. Applied via SQL Editor before code merges. | Create (Task 1) |
| `app/lib/captureInventorySnapshot.js` | The one exported capture function. Strictly additive — imported only by the cron. | Create (Tasks 2–5) |
| `app/lib/__tests__/captureInventorySnapshot.test.js` | Unit tests with an injected fake supabase client. | Create (Tasks 2–5) |
| `app/api/cron/route.js` | Wire the awaited capture call in at the hook point. | Modify (Task 6) |
| `scripts/sql/2026-06-06-inventory-backfill-2026-05-21.sql` | OPTIONAL one-time historical backfill from the pre-subcategory snapshot. | Create (Task 7, optional) |

---

## Task 1: Snapshot table migration

**Files:**
- Create: `scripts/sql/2026-06-06-inventory-snapshots.sql`

This is a SQL artifact applied manually via the Supabase SQL Editor (MCP is
read-only) — there is no Vitest coverage. It must land and be applied **before**
the code that reads/writes it merges (CLAUDE.md: "Schema/RPC changes apply to
Supabase before dependent code merges").

- [ ] **Step 1: Write the migration file**

Create `scripts/sql/2026-06-06-inventory-snapshots.sql` with exactly this content:

```sql
-- Add inventory_snapshots: forward-going daily history of every product row.
--
-- Phase 1 of the inventory-history feature (design:
-- docs/plan-inventory-history.md). The hourly Shopify->Supabase cron overwrites
-- `products` in place and hard-deletes departed rows, discarding all history.
-- This table captures one full snapshot per UTC day (including available=false
-- and hidden=true rows) so sell-through velocity and brand/category turnover can
-- be reconstructed later. It is WRITE-ONLY for analytics and never feeds the
-- storefront feed.
--
-- Write path: app/lib/captureInventorySnapshot.js, called once/day from
--             /api/cron AFTER the stale-delete, BEFORE the enrich trigger.
-- Read path:  none yet (Phase 2 dashboard, separate spec).
--
-- Storage: ~20,972 rows/day x 365 ~= 7.6M rows/yr ~= 1-3 GB/yr incl. indexes.
-- Keep indefinitely; revisit rollup/retention after a year of data.
--
-- Apply via the Supabase SQL Editor (MCP is read-only), BEFORE merging the code
-- that writes it, so the first post-deploy cron run finds the table.

BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_snapshots (
  id            bigserial PRIMARY KEY,
  observed_at   timestamptz NOT NULL,   -- = cron syncStart of the capturing run
  observed_date date GENERATED ALWAYS AS ((observed_at AT TIME ZONE 'UTC')::date) STORED,
  handle        text NOT NULL,
  store_domain  text NOT NULL,
  shopify_id    bigint,
  brand         text,
  title         text,
  name          text,
  category      text,
  subcategory   text,
  price         text,                   -- mirror canonical TEXT '€xx.xx' (EUR)
  available     boolean,
  hidden        boolean,
  -- One row per product per UTC day. Makes the daily insert idempotent and
  -- closes the read-then-insert duplicate-day race (insert uses ON CONFLICT
  -- DO NOTHING against this constraint).
  UNIQUE (handle, store_domain, observed_date)
);

CREATE INDEX IF NOT EXISTS idx_inv_snap_observed
  ON public.inventory_snapshots (observed_at);
CREATE INDEX IF NOT EXISTS idx_inv_snap_handle_store
  ON public.inventory_snapshots (handle, store_domain, observed_at);

-- RLS on, no policies: only the service-role server can read/write (matches the
-- fx_rates convention). Phase 2's admin reads also use the service-role client.
ALTER TABLE public.inventory_snapshots ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Guard (run after apply): table exists and is empty at creation time.
SELECT to_regclass('public.inventory_snapshots') AS table_exists,
       (SELECT COUNT(*) FROM public.inventory_snapshots) AS row_count;
```

- [ ] **Step 2: Commit the migration**

```bash
git add scripts/sql/2026-06-06-inventory-snapshots.sql
git commit -m "feat(sql): add inventory_snapshots table for daily history capture"
```

> **Apply step (Vercel/SQL-Editor only — do NOT run cron locally):** Before the
> Task 6 code merges, paste this file into the Supabase SQL Editor and run it.
> The guard query must show `table_exists = inventory_snapshots` and
> `row_count = 0`. This is also covered by the Verification section.

---

## Task 2: Capture function — skeleton, try/catch shell, clean-run gate

**Files:**
- Create: `app/lib/captureInventorySnapshot.js`
- Test: `app/lib/__tests__/captureInventorySnapshot.test.js`

The function is built incrementally across Tasks 2–5. The try/catch shell goes in
now so later tasks only fill the body (never restructure). The function takes the
supabase client as an injected third parameter (defaulting to `supabaseAdmin`) so
tests pass a fake client — the repo's existing always-empty `makeBuilder()` mock
can't model the three distinct query shapes (gate read, paged product read, batch
upsert) across two tables.

- [ ] **Step 1: Write the failing test (clean-run gate + fake-client harness)**

Create `app/lib/__tests__/captureInventorySnapshot.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { captureInventorySnapshot } from "../captureInventorySnapshot.js";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/__tests__/captureInventorySnapshot.test.js`
Expected: FAIL — `captureInventorySnapshot` is not exported / module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `app/lib/captureInventorySnapshot.js`:

```js
import { supabaseAdmin } from "./supabase.js";

/**
 * Capture a daily full snapshot of `products` into `inventory_snapshots`.
 * Strictly additive and failure-isolated — never throws.
 *
 * @param {string} syncStart ISO timestamp of the capturing cron run (UTC).
 * @param {object} summary   Cron summary: reads `.errors`, writes `.snapshot`.
 * @param {object} db        Supabase client (injected for tests; default admin).
 */
export async function captureInventorySnapshot(syncStart, summary, db = supabaseAdmin) {
  try {
    // 1. Clean-run gate — a partial run leaves errored stores' rows stale and
    //    un-reconciled in `products`; snapshotting would freeze contaminated
    //    data for the day. Skip and let a later clean run capture it.
    if (summary.errors.length > 0) {
      summary.snapshot = { captured: false, skipped: "run-had-errors" };
      return;
    }

    // Capture body filled in Tasks 3-5.
  } catch (e) {
    // Failure isolation — never rethrow. Structured logging added in Task 5.
    summary.snapshot = { captured: false, error: e?.message ?? String(e) };
    console.error("inventory snapshot failed:", e?.message ?? e);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/__tests__/captureInventorySnapshot.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/lib/captureInventorySnapshot.js app/lib/__tests__/captureInventorySnapshot.test.js
git commit -m "feat(snapshot): capture function skeleton + clean-run gate"
```

---

## Task 3: Daily gate (once per UTC day)

**Files:**
- Modify: `app/lib/captureInventorySnapshot.js`
- Test: `app/lib/__tests__/captureInventorySnapshot.test.js`

Reads the latest stored `observed_at`; if its UTC date equals this run's UTC date,
return without re-reading or inserting. An empty table (cold start) falls through
to capture. Because the gate keys off a *successful* prior insert, a transient
failure self-heals — the next hourly run retries until one clean run lands the day.

- [ ] **Step 1: Write the failing test**

Append to `describe`-level in `app/lib/__tests__/captureInventorySnapshot.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/__tests__/captureInventorySnapshot.test.js`
Expected: FAIL — current code falls through the gate stub; `summary.snapshot`
is `undefined`, no `inventory_snapshots` read recorded.

- [ ] **Step 3: Write the minimal implementation**

Replace the entire contents of `app/lib/captureInventorySnapshot.js` with:

```js
import { supabaseAdmin } from "./supabase.js";

// UTC calendar date of an ISO timestamp — matches the generated column's
// `(observed_at AT TIME ZONE 'UTC')::date`. Never use local-time extraction.
const utcDate = (iso) => new Date(iso).toISOString().slice(0, 10);

/**
 * Capture a daily full snapshot of `products` into `inventory_snapshots`.
 * Strictly additive and failure-isolated — never throws.
 *
 * @param {string} syncStart ISO timestamp of the capturing cron run (UTC).
 * @param {object} summary   Cron summary: reads `.errors`, writes `.snapshot`.
 * @param {object} db        Supabase client (injected for tests; default admin).
 */
export async function captureInventorySnapshot(syncStart, summary, db = supabaseAdmin) {
  try {
    // 1. Clean-run gate — see Task 2 rationale.
    if (summary.errors.length > 0) {
      summary.snapshot = { captured: false, skipped: "run-had-errors" };
      return;
    }

    // 2. Daily gate — one snapshot per UTC day. Empty table (cold start) =>
    //    proceed. Self-heals: keyed off a successful prior insert, so a
    //    transient failure is retried by the next hourly run.
    const { data: latest, error: gateError } = await db
      .from("inventory_snapshots")
      .select("observed_at")
      .order("observed_at", { ascending: false })
      .limit(1);
    if (gateError) throw new Error(`daily-gate read failed: ${gateError.message}`);
    if (
      latest &&
      latest.length > 0 &&
      utcDate(latest[0].observed_at) === utcDate(syncStart)
    ) {
      summary.snapshot = { captured: false, skipped: "already-captured-today" };
      return;
    }

    // Capture body filled in Tasks 4-5.
  } catch (e) {
    // Failure isolation — never rethrow. Structured logging added in Task 5.
    summary.snapshot = { captured: false, error: e?.message ?? String(e) };
    console.error("inventory snapshot failed:", e?.message ?? e);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/__tests__/captureInventorySnapshot.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/captureInventorySnapshot.js app/lib/__tests__/captureInventorySnapshot.test.js
git commit -m "feat(snapshot): add once-per-UTC-day gate"
```

---

## Task 4: Paged re-read + idempotent batched insert + success logging

**Files:**
- Modify: `app/lib/captureInventorySnapshot.js`
- Test: `app/lib/__tests__/captureInventorySnapshot.test.js`

Re-reads all product rows in pages of `PAGE_SIZE`, ordered deterministically by
`id` (so concurrent writes can't make pages skip/duplicate rows — a skipped row
would later misread as a false departure). Stamps each row `observed_at =
syncStart` and bulk-inserts in batches of `INSERT_BATCH` with ON CONFLICT DO
NOTHING. On success, logs a structured `inventory_snapshot_ok` line and stashes
`summary.snapshot`. `PAGE_SIZE`/`INSERT_BATCH` are exported so the test builds
exact-page fixtures without magic numbers.

- [ ] **Step 1: Write the failing test**

Append to `app/lib/__tests__/captureInventorySnapshot.test.js` (and update the
import line at the top of the file to also import the two constants):

```js
// At top of file — extend the existing import:
//   import { captureInventorySnapshot, PAGE_SIZE, INSERT_BATCH, SNAPSHOT_COLUMNS }
//     from "../captureInventorySnapshot.js";

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/__tests__/captureInventorySnapshot.test.js`
Expected: FAIL — `PAGE_SIZE`/`INSERT_BATCH` undefined and no `range`/`upsert`
calls recorded; `summary.snapshot` is `undefined` on the cold-start path.

- [ ] **Step 3: Write the minimal implementation**

Replace the entire contents of `app/lib/captureInventorySnapshot.js` with:

```js
import { supabaseAdmin } from "./supabase.js";

// Columns mirrored into inventory_snapshots. `id` is deliberately EXCLUDED:
// the snapshot table has its own bigserial id, and selecting products.id would
// let the `{ ...row }` spread below clobber it. `observed_date` is a GENERATED
// column and must never be in the insert payload (the SELECT omits it too).
// Exported so the unit test can assert the projection is exactly this set.
export const SNAPSHOT_COLUMNS =
  "handle, store_domain, shopify_id, brand, title, name, category, subcategory, price, available, hidden";

// Page size for the product re-read; batch size for the snapshot insert.
// Exported so tests build exact-page fixtures without magic numbers.
export const PAGE_SIZE = 1000;
export const INSERT_BATCH = 500;

// UTC calendar date of an ISO timestamp — matches the generated column's
// `(observed_at AT TIME ZONE 'UTC')::date`. Never use local-time extraction.
const utcDate = (iso) => new Date(iso).toISOString().slice(0, 10);

/**
 * Capture a daily full snapshot of `products` into `inventory_snapshots`.
 * Strictly additive and failure-isolated — never throws.
 *
 * @param {string} syncStart ISO timestamp of the capturing cron run (UTC).
 * @param {object} summary   Cron summary: reads `.errors`, writes `.snapshot`.
 * @param {object} db        Supabase client (injected for tests; default admin).
 */
export async function captureInventorySnapshot(syncStart, summary, db = supabaseAdmin) {
  try {
    // 1. Clean-run gate — see Task 2 rationale.
    if (summary.errors.length > 0) {
      summary.snapshot = { captured: false, skipped: "run-had-errors" };
      return;
    }

    // 2. Daily gate — one snapshot per UTC day; empty table => proceed.
    const { data: latest, error: gateError } = await db
      .from("inventory_snapshots")
      .select("observed_at")
      .order("observed_at", { ascending: false })
      .limit(1);
    if (gateError) throw new Error(`daily-gate read failed: ${gateError.message}`);
    if (
      latest &&
      latest.length > 0 &&
      utcDate(latest[0].observed_at) === utcDate(syncStart)
    ) {
      summary.snapshot = { captured: false, skipped: "already-captured-today" };
      return;
    }

    // 3. Re-read ALL product rows, paged, ORDERED BY id (deterministic — without
    //    it, concurrent writes can make pages skip/duplicate rows; a skipped row
    //    would later misread as a false departure). NO visibility filter: we
    //    DELIBERATELY capture available=false AND hidden=true rows — sold /
    //    departed / hidden inventory is the whole point of the history table.
    //    (Intentional exception to the CLAUDE.md available=true+hidden=false
    //    rule — do not "fix".) Ordering by id, an unselected column, is
    //    supported by PostgREST and keeps id out of the insert payload.
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await db
        .from("products")
        .select(SNAPSHOT_COLUMNS)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        throw new Error(`product re-read failed at offset ${from}: ${error.message}`);
      }
      if (!data || data.length === 0) break;
      for (const row of data) rows.push({ ...row, observed_at: syncStart });
      if (data.length < PAGE_SIZE) break;
    }

    // 4. Idempotent bulk insert. ignoreDuplicates:true => ON CONFLICT DO NOTHING
    //    in supabase-js v2, belt-and-suspenders with the UNIQUE
    //    (handle, store_domain, observed_date) constraint.
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const batch = rows.slice(i, i + INSERT_BATCH);
      const { error } = await db
        .from("inventory_snapshots")
        .upsert(batch, {
          onConflict: "handle,store_domain,observed_date",
          ignoreDuplicates: true,
        });
      if (error) {
        throw new Error(
          `snapshot insert failed at batch ${i / INSERT_BATCH}: ${error.message}`,
        );
      }
    }

    // 5. Success — structured log + summary stash.
    summary.snapshot = { captured: true, rows: rows.length };
    console.log(JSON.stringify({ event: "inventory_snapshot_ok", rows: rows.length }));
  } catch (e) {
    // Failure isolation — never rethrow. Structured failure logging added in Task 5.
    summary.snapshot = { captured: false, error: e?.message ?? String(e) };
    console.error("inventory snapshot failed:", e?.message ?? e);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/__tests__/captureInventorySnapshot.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/captureInventorySnapshot.js app/lib/__tests__/captureInventorySnapshot.test.js
git commit -m "feat(snapshot): paged re-read + idempotent batched insert"
```

---

## Task 5: Failure isolation + structured failure logging

**Files:**
- Modify: `app/lib/captureInventorySnapshot.js`
- Test: `app/lib/__tests__/captureInventorySnapshot.test.js`

The catch must (a) never rethrow, (b) record `summary.snapshot = { captured:
false, error }`, and (c) emit a structured `inventory_snapshot_fail` log so a
persistent failure is alertable (the FX-refresh precedent — inventory history is
data, not throwaway telemetry). This task swaps the generic catch log for the
structured one and proves all three failure injection points are caught.

- [ ] **Step 1: Write the failing test**

Append to `app/lib/__tests__/captureInventorySnapshot.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/__tests__/captureInventorySnapshot.test.js`
Expected: FAIL — the catch currently logs `"inventory snapshot failed:"` (not the
structured JSON), so the `errSpy` assertion fails.

- [ ] **Step 3: Write the minimal implementation**

In `app/lib/captureInventorySnapshot.js`, replace the `catch` block only:

```js
  } catch (e) {
    // Failure isolation (non-negotiable) — never rethrow. A broken/missing
    // table or a failed insert degrades to a logged no-op, never a blocked or
    // corrupted sync. Structured log so a persistent failure is alertable
    // (mirrors the FX-refresh precedent: history is data, not throwaway
    // telemetry).
    const error = e?.message ?? String(e);
    summary.snapshot = { captured: false, error };
    console.error(JSON.stringify({ event: "inventory_snapshot_fail", error }));
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/__tests__/captureInventorySnapshot.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS — all pre-existing suites plus the 8 new snapshot tests.

- [ ] **Step 6: Commit**

```bash
git add app/lib/captureInventorySnapshot.js app/lib/__tests__/captureInventorySnapshot.test.js
git commit -m "feat(snapshot): structured failure logging + isolation tests"
```

---

## Task 6: Wire the capture into the cron

**Files:**
- Modify: `app/api/cron/route.js` (import at top; awaited call between the
  stale-delete block at ~`:266` and the enrich trigger at ~`:268`)

No unit test: the repo has no cron-route test harness, and the call is a two-line
import + awaited invocation whose logic is fully covered by Tasks 2–5. Integration
correctness is verified on Vercel (see Verification). Placement is load-bearing:
**after** the stale-delete (so the clean-run gate can read `summary.errors`,
including any "Stale cleanup failed/skipped" message) and **before** the enrich
trigger (so the snapshot records deterministic *pre-enrich* state — enrich mutates
`brand`/`title`/`category`/`subcategory`/`hidden`).

- [ ] **Step 1: Add the import**

In `app/api/cron/route.js`, add to the import block at the top (after the
`refreshFxRates` import on line 6):

```js
import { captureInventorySnapshot } from "../../lib/captureInventorySnapshot.js";
```

- [ ] **Step 2: Insert the awaited capture call at the hook point**

The stale-delete `if/else` block ends at line 266 (`  }`) and the enrich trigger
begins at line 268 (`  const enrichUrl = ...`). Insert the call between them. The
edit anchors on those exact existing lines:

Find:
```js
    summary.deleted = deletedCount ?? 0;
    if (deleteError) {
      summary.errors.push(`Stale cleanup failed: ${deleteError.message}`);
    }
  }

  const enrichUrl = `${new URL(request.url).origin}/api/enrich?depth=0`;
```

Replace with:
```js
    summary.deleted = deletedCount ?? 0;
    if (deleteError) {
      summary.errors.push(`Stale cleanup failed: ${deleteError.message}`);
    }
  }

  // Capture a daily inventory snapshot for forward-going history/analytics.
  // Additive + failure-isolated: runs AFTER the stale-delete (so the clean-run
  // gate sees summary.errors) and BEFORE the enrich trigger (so it records
  // deterministic pre-enrich state). Its own try/catch never rethrows, so a
  // snapshot failure can never affect the sync response. Awaited adds latency
  // only on the ~once/day run that actually captures; the other ~23 runs hit the
  // cheap daily gate and return immediately, well within maxDuration = 300.
  await captureInventorySnapshot(syncStart, summary);

  const enrichUrl = `${new URL(request.url).origin}/api/enrich?depth=0`;
```

- [ ] **Step 3: Confirm the wiring compiles and existing tests pass**

Run: `npm run lint && npm test`
Expected: lint clean; all tests pass (the wire-in adds no new unit tests).

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/route.js
git commit -m "feat(cron): capture daily inventory snapshot after stale-delete"
```

---

## Task 7: Cold-start seed + OPTIONAL historical backfill

**Files:**
- Create (optional): `scripts/sql/2026-06-06-inventory-backfill-2026-05-21.sql`

**Cold-start seed is automatic — no code needed.** Once Task 1's migration is
applied and Task 6's code is deployed, the *first* post-deploy cron run finds an
empty `inventory_snapshots`, so the daily gate passes and it captures all ~20,972
current rows as the t0 baseline. This is the same event as Verification step 2 —
no separate action.

**The historical backfill below is OPTIONAL** (a free ~2.5-week head start from
the 2026-05-21 pre-subcategory snapshot). It is purely additive and safe to skip.
`first_seen` for pre-existing inventory remains a left-censored *lower bound*
either way; Phase 2's `v_product_lifecycle` will surface a "first seen ≥ deploy
date" flag (out of scope here).

- [ ] **Step 1 (optional): Write the backfill script**

Create `scripts/sql/2026-06-06-inventory-backfill-2026-05-21.sql`:

```sql
-- OPTIONAL one-time historical backfill of inventory_snapshots from the
-- 2026-05-21 full-row snapshot (products_pre_subcategory_snapshot, ~20,352 rows),
-- giving velocity metrics a ~2.5-week head start before the cold-start seed date.
-- Safe to skip entirely; safe to re-run (idempotent).
--
-- Apply AFTER 2026-06-06-inventory-snapshots.sql, via the Supabase SQL Editor.
--
-- observed_at is pinned to a single instant so every row shares observed_date
-- 2026-05-21 (the source's synced_at spans 2026-05-20 23:21 .. 05-21 08:33 UTC;
-- a per-row synced_at would split the tick across two UTC dates). subcategory is
-- NULL — the source table predates the subcategory column.

INSERT INTO public.inventory_snapshots
  (observed_at, handle, store_domain, shopify_id, brand, title, name,
   category, subcategory, price, available, hidden)
SELECT
  TIMESTAMPTZ '2026-05-21T00:00:00Z',
  handle, store_domain, shopify_id, brand, title, name,
  category, NULL::text, price, available, hidden
FROM public.products_pre_subcategory_snapshot
ON CONFLICT (handle, store_domain, observed_date) DO NOTHING;

-- Verify: expect ~20,352 rows for the 2026-05-21 tick.
SELECT COUNT(*) AS backfilled_rows
FROM public.inventory_snapshots
WHERE observed_date = DATE '2026-05-21';
```

- [ ] **Step 2 (optional): Commit the backfill script**

```bash
git add scripts/sql/2026-06-06-inventory-backfill-2026-05-21.sql
git commit -m "feat(sql): optional 2026-05-21 inventory-history backfill"
```

> **Apply step (SQL Editor only):** run *after* the cold-start seed has landed
> (so the table and constraint exist). The verify query should return ~20,352.

---

## Verification (Vercel only — never trigger `/api/cron` or `/api/enrich` locally)

Both routes write production rows and spend OpenAI (CLAUDE.md Workflow rule). All
checks run against a Vercel deployment. Run these SQL checks via the Supabase SQL
Editor or the read-only MCP.

- [ ] **1. Migration applied.** After Task 1, the guard query returns
  `table_exists = inventory_snapshots`, `row_count = 0`.
- [ ] **2. Cold-start capture.** Deploy Tasks 2–6; trigger one cron run. Confirm
  ~20,972 rows land with today's `observed_at`, and that there are no pagination
  skips/dups for the day:
  ```sql
  SELECT COUNT(*) AS rows,
         COUNT(DISTINCT handle || '|' || store_domain) AS distinct_products
  FROM inventory_snapshots
  WHERE observed_date = (now() AT TIME ZONE 'UTC')::date;
  -- rows == distinct_products, and rows ~= 20,972
  ```
  Confirm the cron JSON response carries `summary.snapshot = { captured: true,
  rows: ~20972 }` and its `errors` array is unchanged from a normal run.
- [ ] **3. Daily gate.** Trigger a second same-day run → no new rows; the response
  shows `summary.snapshot.skipped = "already-captured-today"`.
- [ ] **4. Idempotency.** The `ON CONFLICT DO NOTHING` + UNIQUE constraint means a
  forced double-capture for one day cannot create duplicate per-product rows
  (re-confirm via the step-2 `rows == distinct_products` query).
- [ ] **5. Clean-run gate.** On a run where a store errored (`summary.errors`
  non-empty), confirm capture is skipped (`summary.snapshot.skipped =
  "run-had-errors"`) and a later clean run captures the day.
- [ ] **6. Failure isolation.** As a **deliberate, temporary** change (revert
  before merging — do not ship it), point the helper at a bad table name once →
  cron still returns 200 with a normal summary and an `inventory_snapshot_fail`
  log line; `summary.deleted` and the store counts are unaffected. (If you'd
  rather not edit code: this is also exercised naturally on the very first deploy
  if the migration hasn't been applied yet — the insert errors, the cron still
  succeeds.)
- [ ] **7. Sanity.** `SELECT brand, COUNT(*) FROM inventory_snapshots WHERE
  observed_date = (now() AT TIME ZONE 'UTC')::date GROUP BY brand ORDER BY 2 DESC
  LIMIT 10;` returns sensible counts.

---

## Spec coverage (design § → task)

| Design section | Covered by |
| --- | --- |
| Phase 1 → New table (DDL) | Task 1 |
| Capture logic step 1 (clean-run gate) | Task 2 |
| Capture logic step 2 (daily gate, self-heal) | Task 3 |
| Capture logic step 3 (paged re-read, ordered by id) | Task 4 |
| Capture logic step 4 (idempotent bulk insert) | Task 4 |
| Capture logic step 5 (structured logging + summary stash) | Task 4 (ok) + Task 5 (fail) |
| Hook point (after stale-delete, before enrich, awaited) | Task 6 |
| Failure isolation (non-negotiable) | Task 2 (shell) + Task 5 (structured log/tests) + Task 6 (placement) |
| Cold-start seed (automatic t0) | Task 7 (+ Verification step 2) |
| Optional 2026-05-21 backfill | Task 7 (optional) |
| Storage estimate | Task 1 header comment |
| Phase 1 verification (7 checks) | Verification section |
| Phase 2 (views + dashboard) | **Out of scope** — deferred to its own spec |
| Known limitations (daily resolution, left-censored first_seen) | Carried in design; affects Phase 2 reads, not Phase 1 capture |
