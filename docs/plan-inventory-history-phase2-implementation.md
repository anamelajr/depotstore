# Inventory Insights Dashboard — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private `/admin/inventory` dashboard that turns the daily `inventory_snapshots` history (captured by Phase 1) into market signals — sell-through velocity, brand/category turnover, and inventory flow — reading from two new SQL views and rendering with Recharts.

**Architecture:** Two `security_invoker` SQL views (`v_product_lifecycle`, `v_daily_flow`) are the math layer over the snapshot tables; the ledger-aware lifecycle view is the keystone. A thin, fully-tested JS helper (`app/lib/inventoryAnalytics.js`) pages the lifecycle view, applies store/date filters, and shapes panel data (KPIs, velocity buckets, turnover ranking, flow series). A server-component page reads the helper and renders KPI cards + a per-store table directly; the three chart panels are `"use client"` Recharts components fed data as props. The whole surface is local-only (already 404'd in prod by `middleware.js`).

**Tech Stack:** Postgres 17 views (`security_invoker`), Next.js App Router server + client components, `@supabase/supabase-js` v2 service-role client, **Recharts** (new dependency), Vitest.

**Source design:** [`docs/plan-inventory-history.md`](docs/plan-inventory-history.md) § "Phase 2 — Insights dashboard" (the input; do not edit it). Phase 1 plan: [`docs/plan-inventory-history-implementation.md`](docs/plan-inventory-history-implementation.md).

**Plan-file location:** On approval, save this as `docs/plan-inventory-history-phase2-implementation.md` (matching the Phase 1 naming) before executing.

---

## Context

Phase 1 stopped the data loss: the hourly cron now (once deployed) captures a daily full snapshot of every `products` row into `inventory_snapshots`, plus an `inventory_snapshot_days` completeness ledger. But nothing reads it yet. Phase 2 is the payoff — a private dashboard that surfaces the signals the user actually wants: how long pieces stay live before they sell/leave (velocity), which brands/categories turn over fastest (demand proxy), and inventory flow over time. The dashboard is for the user's own market analysis; it never touches the storefront.

**Verified live state (prod `pnjewddyeslsbozoeyks`, 2026-06-08):**
- Postgres **17.6** → `security_invoker` views are supported (require PG15+).
- The Phase 1 migration **is applied**: `inventory_snapshots` and `inventory_snapshot_days` both exist, currently **0 rows** (cron not yet deployed/run).
- `products` has ~20,980 rows; the backfill source `products_pre_subcategory_snapshot` exists (optional 2026-05-21 head start, not yet run).
- **All view SQL in this plan was validated against the live PG17 schema** via the read-only MCP — `v_product_lifecycle`'s SELECT, `v_daily_flow`'s correlated-subquery + `is_seed_day` shape, the turnover `FILTER` aggregates, the `width_bucket` histogram, and the `percentile_cont` median all compile and produce correct results. The revised gated-`departures` + `gap_exit` shape (adversarial-review fix, 2026-06-09) was re-validated the same way: it compiles on the live schema, and a synthetic-data run confirmed backfill-only rows resolve to `gap_exit` (not a seed-day departure) while observed departures are unchanged. The round-3 **pre-ledger guard** (`WHERE cold_start IS NOT NULL`) was validated in both states: empty ledger → 0 rows (no phantom dashboard); non-empty ledger → all round-1 classifications intact.

**Charting decision:** **Recharts** (user chose it over zero-dependency CSS bars). Rationale: `/admin` is local-only and 404'd in production, so the usual knock on chart libraries — JS bundle weight shipped to visitors — does not apply; legibility (axis ticks, hover tooltips, a true line chart for the flow panel) wins for a personal analytics tool. Cost accepted: one dependency to keep current, and chart panels become `"use client"` components.

---

## Prerequisites (Task 0 — not code)

The dashboard renders **empty-safe** from day one (all helpers handle 0 rows), but it only shows signal once data accumulates. Before the panels are meaningful:

- [ ] **Phase 1 deployed.** Merge the Phase 1 branch and deploy so the hourly cron actually runs `captureInventorySnapshot`. The migration is already applied (confirmed above), so the first post-deploy clean run seeds ~21k rows + one ledger day.
- [ ] **(Optional) Run the backfill** `scripts/sql/2026-06-06-inventory-backfill-2026-05-21.sql` via the SQL Editor for a ~2.5-week `first_seen` head start (softens left-censoring). Safe to run **before or after** the first capture: the views' pre-ledger guard returns zero lifecycle rows until a real ledger day exists, so backfill-only data can never render as live analytics.
- [ ] **≥2 captured ledger days** before the flow/departure panels show anything but arrivals — a departure can only be observed between two consecutive ledger days. Velocity/turnover need a few weeks of churn to be trustworthy.

> Building and shipping the dashboard does **not** require waiting — it can be built and merged now; it will populate as the cron captures days. The verification steps that assert real numbers are gated on data existing (called out inline).

---

## Invariants this plan must not break (read before coding)

1. **The ledger (`inventory_snapshot_days`) is the canonical valid-day sequence** for departure and flow math — never calendar `+1`. The Phase 1 gates *deliberately skip days* (errored run, zero-count store, all-day outage), so gaps are real. Computing "departed" as "absent the next calendar day" would manufacture mass false departures on every skipped day. `departed_at` = the next *ledger* day strictly after a product's `last_seen` (`MIN(observed_date) FROM ledger WHERE observed_date > last_seen`).
2. **The backfill day is in `inventory_snapshots` but NOT in the ledger** (Phase 1's backfill script inserts only into the data table). This is load-bearing: it means `MIN(ledger.observed_date)` = the real cold-start date, so the backfill softens `first_seen` without polluting the consecutive-day flow math with a 2.5-week gap. Do not insert the backfill day into the ledger. **On its own this is not sufficient:** a product seen *only* on the backfill day (gone before cold start) would still get `departed_at` = the first ledger day, stacking ~2.5 weeks of gap churn into one false seed-day departure spike — in the flow chart AND the "Sold / left" KPI. So `departed_at` is additionally **gated on `last_seen >= cold_start`**, and backfill-only-and-gone rows get `current_status = 'gap_exit'`: excluded from flow, KPIs, velocity, and turnover, surfaced as a `meta.gapExits` count (never silently dropped). The distinct status matters — merely NULL-ing `departed_at` would let those rows fall through to phantom `active`/`sold`. **And the gate alone is not enough either:** with the backfill run before any real capture, `cold_start` is NULL, every comparison above goes NULL, and ~20k backfill rows would render as a confidently-wrong dashboard (phantom actives + arrivals, with the empty-state notice suppressed because `totalTracked > 0`). Hence the view's **pre-ledger guard** — `WHERE cold_start IS NOT NULL` returns zero lifecycle rows until the first real day is captured — and JS reads the censored flag strictly (`=== false`), never via `!r.first_seen_censored`.
3. **Unified sell signal handles both store types without classifying stores** (design finding #4): `days_to_sell = COALESCE(days_to_sell_flip, days_to_departure)`. Flip-and-linger stores emit a `available` true→false flip; delist-on-sale stores emit only a departure. A single hard-coded "days to sell" column would mismeasure ~half the stores. **The same flip-first precedence governs JS date-windowing** (`exitDate = sold_at_flip ?? departed_at` in `inventoryAnalytics.js`, used by both `filterLifecycle` and `computeKpis`): flip-and-linger stores (~74% of inventory) delist items weeks after they sold, so windowing on `departed_at ?? sold_at_flip` would drag old sales into recent periods — corrupting KPIs, velocity, and turnover — whenever the cleanup delist lands in-window. Exits are attributed to the *sale* (flip), not the shelf-removal; only the flow chart is departure-based, deliberately, because it measures listing flow.
4. **`first_seen_censored = first_seen <= MIN(ledger.observed_date)`** — items present on/before the first cold-start capture have an unknown true `first_seen` (lower bound only). Velocity metrics must be able to exclude or annotate censored rows, or the "fastest movers" panel is biased.
5. **Views must be `WITH (security_invoker = true)` AND `REVOKE`d from `anon, authenticated`.** PostgREST serves `/rest/v1/<view>` on a surface `middleware.js` does NOT gate, and the anon key is public. A default (security-definer) view bypasses base-table RLS and would leak the entire history to anyone with the anon key. The dashboard reads via the **service-role** client (`supabaseAdmin`), which bypasses RLS and sees everything.
6. **Strictly additive.** All new files/objects; the only edits to shipped code are two nav links (`app/admin/layout.js`, `app/admin/page.js`) and `package.json`. Do not touch Phase 1's capture path or the snapshot tables. (Per [[feedback_additive_extensions]].)

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `scripts/sql/2026-06-08-inventory-insights.sql` | The two views + grants. Applied via SQL Editor before code merges. | Create (Task 1) |
| `package.json` / lockfile | Add `recharts`. | Modify (Task 2) |
| `app/lib/inventoryAnalytics.js` | Read views (paged) + pure shaping functions (buckets, turnover, KPIs, flow, per-store). The single analytics implementation. | Create (Tasks 3–5) |
| `app/lib/__tests__/inventoryAnalytics.test.js` | Unit tests with a fake supabase client + synthetic lifecycle rows. | Create (Tasks 3–5) |
| `app/admin/inventory/page.js` | Server component: parse filters, call helper, render shell + KPI cards + per-store table + filter form. | Create (Task 6) |
| `app/admin/inventory/_components/InventoryCharts.js` | `"use client"` Recharts panels (turnover bars, velocity histogram, flow line). | Create (Task 7) |
| `app/admin/layout.js` | Add an "Inventory" nav link. | Modify (Task 8) |
| `app/admin/page.js` | Add an "Inventory insights" card. | Modify (Task 8) |

---

## Task 1: SQL views migration

**Files:**
- Create: `scripts/sql/2026-06-08-inventory-insights.sql`

A SQL artifact applied manually via the Supabase SQL Editor (MCP is read-only — see [[supabase_mcp_read_only]]). It must be applied **before** the code that reads the views merges. No Vitest coverage; verified via the SQL Editor checks in Verification.

- [ ] **Step 1: Write the migration file**

Create `scripts/sql/2026-06-08-inventory-insights.sql` with exactly this content:

```sql
-- Phase 2 of the inventory-history feature (design: docs/plan-inventory-history.md).
-- Two read-only VIEWS over the Phase 1 snapshot tables — the analytics math layer
-- for the private /admin/inventory dashboard. No base data is written or changed.
--
-- security_invoker = true is REQUIRED: PostgREST exposes public views, the anon key
-- is public, and middleware.js does NOT gate /rest/v1. A default (security-definer)
-- view would bypass the base tables' RLS and leak the entire history to anyone with
-- the anon key. With security_invoker the view runs as the CALLER: the dashboard's
-- service-role client (supabaseAdmin) bypasses RLS and sees everything; anon hits
-- the base-table RLS (no policy) and sees nothing. We also REVOKE from anon to keep
-- the views out of PostgREST's anon surface entirely (defense in depth).
--
-- KEY MODEL DECISIONS (see plan invariants):
--  * inventory_snapshot_days (the ledger) is the canonical valid-day sequence for
--    departure math — gaps are real (Phase 1 gates skip days), so calendar +1 would
--    manufacture false departures. departed_at = next LEDGER day after last_seen.
--  * The 2026-05-21 backfill day lives in inventory_snapshots but NOT the ledger, so
--    MIN(ledger.observed_date) = the true cold-start date (the censoring threshold),
--    and the backfill softens first_seen without a 2.5-week gap polluting the flow.
--  * departed_at is GATED on last_seen >= cold_start: a product seen ONLY on the
--    backfill day was never observed on a real ledger day, so its exit happened in
--    the unobserved gap — ungated, it would land as a false departure on the seed
--    day (the adversarial-review finding). Such rows get current_status='gap_exit'.
--  * days_to_sell = COALESCE(flip, departure) handles flip-and-linger AND delist
--    stores without classifying stores (design finding #4).
--
-- Apply via the Supabase SQL Editor BEFORE merging app/lib/inventoryAnalytics.js.
-- Requires Postgres 15+ (prod is 17.6).

BEGIN;

-- ---------------------------------------------------------------------------
-- v_product_lifecycle: one row per (handle, store_domain) product.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_product_lifecycle
WITH (security_invoker = true) AS
WITH
ledger AS (
  -- canonical cron-captured days only (backfill day excluded by design)
  SELECT observed_date FROM public.inventory_snapshot_days
),
bounds AS (
  SELECT (SELECT MIN(observed_date) FROM ledger) AS cold_start
),
agg AS (
  -- first/last seen across ALL snapshot rows (incl. backfill) + observation count
  SELECT handle, store_domain,
         MIN(observed_date) AS first_seen,
         MAX(observed_date) AS last_seen,
         COUNT(*)           AS days_observed
  FROM public.inventory_snapshots
  GROUP BY handle, store_domain
),
latest AS (
  -- most-recent attributes for each product
  SELECT DISTINCT ON (handle, store_domain)
         handle, store_domain, brand, title, name, category, subcategory,
         price, available AS latest_available, hidden AS latest_hidden
  FROM public.inventory_snapshots
  ORDER BY handle, store_domain, observed_date DESC
),
flips AS (
  -- first available true->false transition in the product's own observation order
  SELECT handle, store_domain, MIN(observed_date) AS sold_at_flip
  FROM (
    SELECT handle, store_domain, observed_date, available,
           LAG(available) OVER (
             PARTITION BY handle, store_domain ORDER BY observed_date
           ) AS prev_available
    FROM public.inventory_snapshots
  ) t
  WHERE available = false AND prev_available = true
  GROUP BY handle, store_domain
),
departures AS (
  -- first LEDGER day strictly after last_seen (NULL => still present latest day).
  -- Gated on last_seen >= cold_start: a backfill-only product (never observed on
  -- a real ledger day) must NOT have its exit assigned to the seed day — its
  -- departure happened somewhere in the unobserved pre-ledger gap, date unknowable.
  SELECT a.handle, a.store_domain,
    CASE WHEN a.last_seen >= b.cold_start THEN
      (SELECT MIN(d.observed_date) FROM ledger d WHERE d.observed_date > a.last_seen)
    END AS departed_at,
    (a.last_seen < b.cold_start) AS gap_exit
  FROM agg a CROSS JOIN bounds b
)
SELECT
  a.handle,
  a.store_domain,
  l.brand, l.title, l.name, l.category, l.subcategory, l.price,
  a.first_seen,
  a.last_seen,
  a.days_observed,
  f.sold_at_flip,
  dep.departed_at,
  (f.sold_at_flip  - a.first_seen) AS days_to_sell_flip,
  (dep.departed_at - a.first_seen) AS days_to_departure,
  -- unified time-to-first-sold-signal: flip if it fired, else departure (handles
  -- both store types without classification). NULL while still active.
  COALESCE(f.sold_at_flip - a.first_seen, dep.departed_at - a.first_seen)
    AS days_to_sell,
  -- left-censored: present on/before the first captured day => first_seen unknown
  (a.first_seen <= (SELECT cold_start FROM bounds)) AS first_seen_censored,
  CASE
    WHEN dep.departed_at IS NOT NULL THEN 'departed'  -- exit observed between two ledger days
    WHEN dep.gap_exit                THEN 'gap_exit'   -- backfill-only, gone before cold start
    WHEN l.latest_available = false  THEN 'sold'       -- flipped, still listed
    ELSE 'active'
  END AS current_status,
  CASE
    WHEN f.sold_at_flip IS NOT NULL  THEN 'flip'
    WHEN dep.departed_at IS NOT NULL THEN 'delist'
    ELSE NULL
  END AS sold_signal_type
FROM agg a
JOIN latest l       USING (handle, store_domain)
LEFT JOIN flips f   USING (handle, store_domain)
JOIN departures dep USING (handle, store_domain)
-- PRE-LEDGER GUARD: before the first real captured day exists, cold_start is
-- NULL and every censoring/gap comparison above goes NULL — backfill-only rows
-- would surface as phantom 'active' inventory with NULL first_seen_censored
-- (which JS must not read as "uncensored"). No ledger => no analytics-valid
-- rows; the dashboard then shows its truthful day-0 empty state instead of
-- ~20k confident wrong numbers. (Round-3 adversarial finding.)
WHERE (SELECT cold_start FROM bounds) IS NOT NULL;

-- ---------------------------------------------------------------------------
-- v_daily_flow: one row per captured ledger day (global, all stores).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_daily_flow
WITH (security_invoker = true) AS
SELECT
  d.observed_date,
  (SELECT COUNT(*) FROM public.v_product_lifecycle l
     WHERE l.first_seen = d.observed_date)               AS arrivals,
  -- gap_exit rows carry departed_at = NULL, so pre-ledger backfill churn can
  -- never land here (no seed-day departure spike).
  (SELECT COUNT(*) FROM public.v_product_lifecycle l
     WHERE l.departed_at = d.observed_date)              AS departures,
  (SELECT COUNT(*) FROM public.inventory_snapshots s
     WHERE s.observed_date = d.observed_date
       AND s.available = true)                           AS active,
  -- the cold-start day's "arrivals" are the censored backlog seed, not real
  -- arrivals — flag it so the dashboard can gray it out.
  (d.observed_date = (SELECT MIN(observed_date)
                        FROM public.inventory_snapshot_days)) AS is_seed_day
FROM public.inventory_snapshot_days d
ORDER BY d.observed_date;

-- Lock down: service-role only (matches the fx_rates / snapshot-table convention).
REVOKE ALL ON public.v_product_lifecycle FROM anon, authenticated;
REVOKE ALL ON public.v_daily_flow        FROM anon, authenticated;
GRANT SELECT ON public.v_product_lifecycle TO service_role;
GRANT SELECT ON public.v_daily_flow        TO service_role;

COMMIT;

-- Guard (run after apply): both views resolve and are queryable (0 rows pre-capture).
SELECT (SELECT COUNT(*) FROM public.v_product_lifecycle) AS lifecycle_rows,
       (SELECT COUNT(*) FROM public.v_daily_flow)        AS flow_days;
```

- [ ] **Step 2: Commit the migration**

```bash
git add scripts/sql/2026-06-08-inventory-insights.sql
git commit -m "feat(sql): inventory-insights views (lifecycle + daily flow)"
```

> **Apply step (SQL Editor only):** before Task 3+ merges, paste the file into the Supabase SQL Editor and run it. The guard query must return two integer columns without error (both 0 until the cron has captured a day).

---

## Task 2: Add the Recharts dependency

**Files:**
- Modify: `package.json` (+ lockfile)

- [ ] **Step 1: Install Recharts**

```bash
npm install recharts
```

> If the project is on React 19 (likely — Tailwind v4 / Next 15) and `npm install`
> hits a peer-dependency wall, ensure Recharts **2.13+** (React-19 compatible)
> resolves: `npm install recharts@^2.13`. Don't reach for `--legacy-peer-deps`
> without first checking the resolved version.

- [ ] **Step 2: Confirm it resolves and nothing else broke**

Run: `npm test`
Expected: the existing suites still pass (no usage yet; this just verifies install integrity).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add recharts for the inventory insights dashboard"
```

---

## Task 3: Analytics helper — paged read + filter (TDD)

**Files:**
- Create: `app/lib/inventoryAnalytics.js`
- Test: `app/lib/__tests__/inventoryAnalytics.test.js`

The helper pages `v_product_lifecycle` (reusing the Phase 1 paging idiom), applies an in-JS store/date filter, and exposes pure shaping functions (Tasks 4–5). Built incrementally. The supabase client is injected (default `supabaseAdmin`) so tests pass a fake — same pattern as `app/lib/captureInventorySnapshot.js` and `app/lib/__tests__/productQueries.test.js`.

- [ ] **Step 1: Write the failing test (paged read + store/date filter)**

Create `app/lib/__tests__/inventoryAnalytics.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import {
  PAGE_SIZE,
  LIFECYCLE_COLUMNS,
  readLifecycle,
  filterLifecycle,
} from "../inventoryAnalytics.js";

// Fake supabase: models .from(view).select(cols).eq(col,val).range(from,to) for the
// lifecycle paged read. `pages` is an array of row-arrays, one per .range() call.
function makeFakeSupabase(config = {}) {
  const recorded = { from: [], selects: [], eqCalls: [], gteCalls: [], ranges: [] };
  let cursor = 0;
  function builder(table) {
    const state = {};
    const b = {
      select(cols) { recorded.selects.push({ table, cols }); return b; },
      eq(col, val) { recorded.eqCalls.push({ table, col, val }); return b; },
      gte(col, val) { recorded.gteCalls.push({ table, col, val }); return b; },
      order() { return b; },
      range(from, to) {
        state.page = cursor++; recorded.ranges.push([from, to]); return b;
      },
      then(resolve, reject) {
        let result;
        if (table === "v_daily_flow") {
          result = config.flowError
            ? { data: null, error: config.flowError }
            : { data: config.flow ?? [], error: null };
        } else if (config.lifecycleError) {
          result = { data: null, error: config.lifecycleError };
        } else {
          result = { data: config.pages?.[state.page] ?? [], error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return b;
  }
  return {
    client: { from(t) { recorded.from.push(t); return builder(t); } },
    recorded,
  };
}

function lc(over = {}) {
  return {
    handle: "h", store_domain: "s1", brand: "Margiela", category: "Tops",
    first_seen: "2026-06-01", last_seen: "2026-06-05", departed_at: "2026-06-06",
    sold_at_flip: null, days_to_sell_flip: null, days_to_departure: 5,
    days_to_sell: 5, first_seen_censored: false, current_status: "departed",
    sold_signal_type: "delist", price: "€100.00", ...over,
  };
}

describe("readLifecycle", () => {
  it("pages by id until a short page, selecting the lifecycle projection", async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => lc({ handle: `a${i}` }));
    const page2 = [lc({ handle: "tail" })];
    const { client, recorded } = makeFakeSupabase({ pages: [page1, page2] });

    const rows = await readLifecycle({ db: client });

    expect(recorded.from).toEqual(["v_product_lifecycle", "v_product_lifecycle"]);
    expect(recorded.selects[0].cols).toBe(LIFECYCLE_COLUMNS);
    expect(recorded.ranges).toEqual([[0, PAGE_SIZE - 1], [PAGE_SIZE, 2 * PAGE_SIZE - 1]]);
    expect(rows).toHaveLength(PAGE_SIZE + 1);
  });

  it("pushes a store filter into the query (.eq), not JS", async () => {
    const { client, recorded } = makeFakeSupabase({ pages: [[lc()]] });
    await readLifecycle({ store: "dolcevitahub", db: client });
    expect(recorded.eqCalls).toContainEqual({
      table: "v_product_lifecycle", col: "store_domain", val: "dolcevitahub",
    });
  });

  it("throws a labelled error when the read fails", async () => {
    const { client } = makeFakeSupabase({ lifecycleError: new Error("boom") });
    await expect(readLifecycle({ db: client })).rejects.toThrow(/lifecycle read failed: boom/);
  });
});

describe("filterLifecycle (date window)", () => {
  const rows = [
    lc({ handle: "old", first_seen: "2026-05-01", departed_at: "2026-05-10", last_seen: "2026-05-09" }),
    lc({ handle: "recent", first_seen: "2026-06-07", departed_at: null, last_seen: "2026-06-08", current_status: "active" }),
  ];
  it("keeps rows active in, or that exited within, the window", () => {
    // since = 2026-06-06 => 'old' (departed 05-10) excluded, 'recent' kept
    const out = filterLifecycle(rows, { since: "2026-06-06" });
    expect(out.map((r) => r.handle)).toEqual(["recent"]);
  });
  it("returns all rows when since is null", () => {
    expect(filterLifecycle(rows, { since: null })).toHaveLength(2);
  });
  it("windows flip-and-linger rows by their FLIP date, not the later cleanup delist", () => {
    const flipThenDelist = lc({
      handle: "lingerer", sold_at_flip: "2026-05-20", departed_at: "2026-06-07",
      days_to_sell: 19, current_status: "departed",
    });
    const delistOnly = lc({ handle: "delisted", sold_at_flip: null, departed_at: "2026-06-07" });
    const out = filterLifecycle([flipThenDelist, delistOnly], { since: "2026-06-06" });
    // the lingerer SOLD on 05-20 — its late delist must not drag the old sale into a June window
    expect(out.map((r) => r.handle)).toEqual(["delisted"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/__tests__/inventoryAnalytics.test.js`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Write the minimal implementation**

Create `app/lib/inventoryAnalytics.js`:

```js
import { supabaseAdmin } from "./supabase.js";

// Page size for the lifecycle read; matches the Phase 1 capture idiom.
export const PAGE_SIZE = 1000;

// Projection pulled from v_product_lifecycle. Explicit so the read is stable and
// the test can assert it.
export const LIFECYCLE_COLUMNS =
  "handle, store_domain, brand, category, first_seen, last_seen, departed_at, " +
  "sold_at_flip, days_to_sell_flip, days_to_departure, days_to_sell, " +
  "first_seen_censored, current_status, sold_signal_type, price";

/**
 * Page all rows of v_product_lifecycle (optionally store-filtered in SQL).
 * @param {object} opts {store?: string|null, db?: client}
 * @returns {Promise<object[]>}
 */
export async function readLifecycle({ store = null, db = supabaseAdmin } = {}) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = db
      .from("v_product_lifecycle")
      .select(LIFECYCLE_COLUMNS)
      .order("store_domain", { ascending: true })
      .order("handle", { ascending: true });
    if (store) q = q.eq("store_domain", store);
    const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`lifecycle read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

// Canonical exit date for date-windowing: flip FIRST, then departure — the same
// precedence as the SQL sell signal (days_to_sell = COALESCE(flip, departure)).
// Flip-and-linger stores (~74% of inventory) delist an item weeks after it
// actually sold; windowing on `departed_at ?? sold_at_flip` would drag those old
// sales into recent periods (KPIs, velocity, turnover) whenever the cleanup
// delist lands in-window (round-2 adversarial finding).
const exitDate = (r) => r.sold_at_flip ?? r.departed_at;

/**
 * Date-window filter applied in JS over already-read lifecycle rows. A row is in
 * the window if it is still active OR its canonical exit (flip-first, then
 * departure) is on/after `since`.
 * @param {object[]} rows
 * @param {object} opts {since?: string|null}  ISO date 'YYYY-MM-DD'
 */
export function filterLifecycle(rows, { since = null } = {}) {
  if (!since) return rows;
  return rows.filter((r) => {
    if (r.current_status === "active") return true;
    const exit = exitDate(r);
    return exit != null && exit >= since;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/__tests__/inventoryAnalytics.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/inventoryAnalytics.js app/lib/__tests__/inventoryAnalytics.test.js
git commit -m "feat(insights): lifecycle paged read + date-window filter"
```

---

## Task 4: Shaping functions — velocity buckets, turnover, per-store (TDD)

**Files:**
- Modify: `app/lib/inventoryAnalytics.js`
- Test: `app/lib/__tests__/inventoryAnalytics.test.js`

Pure functions over lifecycle rows. Velocity buckets mirror the SQL `width_bucket` edges (validated on PG17); turnover ranking matches the validated `FILTER` aggregate semantics.

- [ ] **Step 1: Write the failing test**

Append to `app/lib/__tests__/inventoryAnalytics.test.js` (extend the top import to add `buildVelocityBuckets, rankTurnover, storeSummary, BUCKET_LABELS`):

```js
describe("buildVelocityBuckets", () => {
  // edges 0-2,3-5,6-10,11-15,16-21,22-30,31-45,46+ ; only uncensored exited items
  const rows = [
    lc({ days_to_sell: 1, first_seen_censored: false, current_status: "departed" }),
    lc({ days_to_sell: 4, first_seen_censored: false, current_status: "sold" }),
    lc({ days_to_sell: 8, first_seen_censored: false, current_status: "departed" }),
    lc({ days_to_sell: 9, first_seen_censored: false, current_status: "sold" }),
    lc({ days_to_sell: 40, first_seen_censored: true, current_status: "departed" }), // censored -> excluded
    lc({ days_to_sell: null, first_seen_censored: false, current_status: "active" }), // active -> excluded
  ];
  it("buckets uncensored exited items into the 8 fixed bins", () => {
    const out = buildVelocityBuckets(rows);
    expect(out).toHaveLength(BUCKET_LABELS.length);
    const byLabel = Object.fromEntries(out.map((b) => [b.label, b.count]));
    expect(byLabel["0–2"]).toBe(1);
    expect(byLabel["3–5"]).toBe(1);
    expect(byLabel["6–10"]).toBe(2);
    expect(byLabel["31–45"]).toBe(0); // the only 40-day item was censored
  });
});

describe("rankTurnover", () => {
  const rows = [
    lc({ brand: "Margiela", current_status: "departed", days_to_sell: 5, first_seen_censored: false }),
    lc({ brand: "Margiela", current_status: "sold", days_to_sell: 12, first_seen_censored: false }),
    lc({ brand: "Margiela", current_status: "departed", days_to_sell: 3, first_seen_censored: false }),
    lc({ brand: "Rick Owens", current_status: "active", days_to_sell: null, first_seen_censored: false }),
    lc({ brand: null, current_status: "active", days_to_sell: null }), // null brand dropped
  ];
  it("ranks by exited desc with avg-days-to-sell over uncensored items", () => {
    const out = rankTurnover(rows, "brand");
    expect(out[0]).toMatchObject({ name: "Margiela", total: 3, active: 0, exited: 3 });
    expect(out[0].avgDaysToSell).toBeCloseTo(6.7, 1);
    expect(out[0].turnoverRate).toBeCloseTo(1, 3);
    expect(out.find((b) => b.name === "Rick Owens")).toMatchObject({ exited: 0, avgDaysToSell: null });
    expect(out.some((b) => b.name === null)).toBe(false);
  });
});

describe("storeSummary", () => {
  const rows = [
    lc({ store_domain: "a", current_status: "departed", sold_signal_type: "delist", days_to_sell: 6, first_seen_censored: false }),
    lc({ store_domain: "a", current_status: "sold", sold_signal_type: "flip", days_to_sell: 10, first_seen_censored: false }),
    lc({ store_domain: "a", current_status: "active", sold_signal_type: null, days_to_sell: null }),
  ];
  it("summarises per store with the dominant sold-signal label", () => {
    const out = storeSummary(rows);
    expect(out[0]).toMatchObject({ store: "a", active: 1, exited: 2 });
    expect(["flip-and-linger", "delist-on-sale", "mixed"]).toContain(out[0].signal);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/__tests__/inventoryAnalytics.test.js`
Expected: FAIL — the three functions are not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `app/lib/inventoryAnalytics.js`:

```js
// Fixed days-to-sell histogram edges; mirror the SQL width_bucket(ARRAY[3,6,11,16,22,31,46]).
const BUCKET_EDGES = [3, 6, 11, 16, 22, 31, 46];
export const BUCKET_LABELS = [
  "0–2", "3–5", "6–10", "11–15", "16–21", "22–30", "31–45", "46+",
];

// 'gap_exit' (backfill-only, gone before cold start) is deliberately NOT exited:
// its exit date is unknowable, so it can't be attributed to any period or panel.
// getInventoryInsights drops those rows up front and reports meta.gapExits.
const isExited = (r) => r.current_status === "sold" || r.current_status === "departed";
const isSellable = (r) =>
  r.days_to_sell != null && r.first_seen_censored === false && isExited(r);

function bucketIndex(days) {
  let i = 0;
  while (i < BUCKET_EDGES.length && days >= BUCKET_EDGES[i]) i += 1;
  return i; // 0..7
}

/** Days-to-sell histogram over uncensored exited items. */
export function buildVelocityBuckets(rows) {
  const counts = BUCKET_LABELS.map(() => 0);
  for (const r of rows) if (isSellable(r)) counts[bucketIndex(r.days_to_sell)] += 1;
  return BUCKET_LABELS.map((label, i) => ({ label, count: counts[i] }));
}

function avg(nums) {
  const v = nums.filter((n) => n != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Rank a dimension (brand|category) by exited count; demand proxy. */
export function rankTurnover(rows, key) {
  const groups = new Map();
  for (const r of rows) {
    const name = r[key];
    if (name == null) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(r);
  }
  const out = [];
  for (const [name, rs] of groups) {
    const exited = rs.filter(isExited).length;
    const a = avg(rs.filter(isSellable).map((r) => r.days_to_sell));
    out.push({
      name,
      total: rs.length,
      active: rs.filter((r) => r.current_status === "active").length,
      exited,
      avgDaysToSell: a == null ? null : Math.round(a * 10) / 10,
      turnoverRate: rs.length ? Math.round((exited / rs.length) * 1000) / 1000 : 0,
    });
  }
  return out.sort((x, y) => y.exited - x.exited);
}

/** Per-store rollup with a human label for the store's dominant sold signal. */
export function storeSummary(rows) {
  const byStore = new Map();
  for (const r of rows) {
    if (!byStore.has(r.store_domain)) byStore.set(r.store_domain, []);
    byStore.get(r.store_domain).push(r);
  }
  const out = [];
  for (const [store, rs] of byStore) {
    const flips = rs.filter((r) => r.sold_signal_type === "flip").length;
    const delists = rs.filter((r) => r.sold_signal_type === "delist").length;
    const a = avg(rs.filter(isSellable).map((r) => r.days_to_sell));
    let signal = "mixed";
    if (flips + delists > 0) {
      const flipShare = flips / (flips + delists);
      signal = flipShare >= 0.7 ? "flip-and-linger" : flipShare <= 0.3 ? "delist-on-sale" : "mixed";
    }
    out.push({
      store,
      total: rs.length,
      active: rs.filter((r) => r.current_status === "active").length,
      exited: rs.filter(isExited).length,
      avgDaysToSell: a == null ? null : Math.round(a * 10) / 10,
      signal,
    });
  }
  return out.sort((x, y) => y.active - x.active);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/__tests__/inventoryAnalytics.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/inventoryAnalytics.js app/lib/__tests__/inventoryAnalytics.test.js
git commit -m "feat(insights): velocity buckets + turnover + per-store shaping"
```

---

## Task 5: KPIs, flow series, and the `getInventoryInsights` orchestrator (TDD)

**Files:**
- Modify: `app/lib/inventoryAnalytics.js`
- Test: `app/lib/__tests__/inventoryAnalytics.test.js`

`computeKpis` derives the four KPI-card numbers **from lifecycle rows only** — arrivals included, so every card respects the store filter (the global `v_daily_flow` feeds only the line chart; sourcing the arrivals KPI from it would silently mix per-store cards with an all-store count — the adversarial-review finding). `flowSeries` shapes `v_daily_flow` rows for the line chart; `getInventoryInsights` orchestrates the reads + shaping, drops `gap_exit` rows up front (reported as `meta.gapExits`), and is the single entry point the page calls. All must be **empty-safe** (0 rows → zeros/empty, never throw) so the dashboard renders on day 0.

- [ ] **Step 1: Write the failing test**

Append to `app/lib/__tests__/inventoryAnalytics.test.js` (extend imports with `computeKpis, flowSeries, getInventoryInsights`). Also extend `makeFakeSupabase` config to serve a daily-flow read:

```js
// The Task 3 fake already serves the v_daily_flow read via `config.flow` (its
// then() branches on table === "v_daily_flow"). Pass `flow: [...]` to populate it.

describe("computeKpis (empty-safe)", () => {
  it("returns zeros/nulls for an empty dataset", () => {
    expect(computeKpis([], { since: null })).toEqual({
      activeNow: 0, exitedPeriod: 0, arrivalsPeriod: 0, medianDaysToSell: null,
    });
  });
  it("counts active now, period exits/arrivals, and median days-to-sell (uncensored)", () => {
    const rows = [
      lc({ current_status: "active", days_to_sell: null, first_seen: "2026-06-07", first_seen_censored: false }),
      // censored backlog: active, but NOT a period arrival (first_seen is a lower bound)
      lc({ current_status: "active", days_to_sell: null, first_seen: "2026-05-01", first_seen_censored: true }),
      // defensive: a NULL censored flag (pre-ledger view edge) is "unknown" — never an arrival
      lc({ current_status: "active", days_to_sell: null, first_seen: "2026-06-08", first_seen_censored: null }),
      lc({ current_status: "departed", departed_at: "2026-06-07", days_to_sell: 4, first_seen: "2026-06-03", first_seen_censored: false }),
      lc({ current_status: "sold", sold_at_flip: "2026-06-08", departed_at: null, days_to_sell: 10, first_seen: "2026-05-29", first_seen_censored: false }),
      // flipped (sold) 05-01 — long before the window — then delisted inside it:
      // flip-first precedence keeps this OLD sale out of the period exits
      lc({ current_status: "departed", sold_at_flip: "2026-05-01", departed_at: "2026-06-07", days_to_sell: 7, first_seen: "2026-04-24", first_seen_censored: false }),
    ];
    const k = computeKpis(rows, { since: "2026-06-06" });
    expect(k.activeNow).toBe(3);
    expect(k.exitedPeriod).toBe(2);          // the 06-07/06-08 exits; the May flip is NOT pulled in by its June delist
    expect(k.arrivalsPeriod).toBe(1);        // only the strictly-uncensored 06-07 first_seen; null flag excluded
    expect(k.medianDaysToSell).toBe(7);      // median of [4,7,10] = 7
  });
});

describe("flowSeries", () => {
  it("adds net and keeps the seed-day flag", () => {
    const out = flowSeries([
      { observed_date: "2026-06-06", arrivals: 100, departures: 0, active: 100, is_seed_day: true },
      { observed_date: "2026-06-07", arrivals: 8, departures: 3, active: 105, is_seed_day: false },
    ]);
    expect(out[1]).toMatchObject({ date: "2026-06-07", arrivals: 8, departures: 3, net: 5, isSeedDay: false });
    expect(out[0].isSeedDay).toBe(true);
  });
});

describe("getInventoryInsights (integration, empty-safe)", () => {
  it("returns a fully-shaped empty payload when there is no data", async () => {
    const { client } = makeFakeSupabase({ pages: [[]], flow: [] });
    const out = await getInventoryInsights({ db: client });
    expect(out.kpis).toEqual({ activeNow: 0, exitedPeriod: 0, arrivalsPeriod: 0, medianDaysToSell: null });
    expect(out.velocity).toHaveLength(BUCKET_LABELS.length);
    expect(out.brandTurnover).toEqual([]);
    expect(out.flow).toEqual([]);
  });
  it("drops gap_exit rows from every panel and reports them in meta", async () => {
    const gap = lc({
      handle: "gap", current_status: "gap_exit", departed_at: null, days_to_sell: null,
      first_seen: "2026-05-21", last_seen: "2026-05-21", first_seen_censored: true, sold_signal_type: null,
    });
    const kept = lc({ handle: "kept" });
    const { client } = makeFakeSupabase({ pages: [[gap, kept]], flow: [] });
    const out = await getInventoryInsights({ db: client });
    expect(out.meta.totalTracked).toBe(1);
    expect(out.meta.gapExits).toBe(1);
    expect(out.storeBreakdown[0]).toMatchObject({ store: "s1", total: 1 });
    expect(out.kpis.exitedPeriod).toBe(1); // only the observed departure, never the gap exit
  });
  it("pushes the date window into the flow query and re-sorts the DESC read ascending", async () => {
    const flow = [
      // newest-first, as the DESC read returns them
      { observed_date: "2026-06-08", arrivals: 2, departures: 1, active: 10, is_seed_day: false },
      { observed_date: "2026-06-07", arrivals: 5, departures: 1, active: 9, is_seed_day: false },
    ];
    const { client, recorded } = makeFakeSupabase({ pages: [[]], flow });
    const out = await getInventoryInsights({ sinceDays: 30, db: client });
    // window pushed into SQL — an unranged ascending read would silently keep
    // only the OLDEST days once the ledger outgrows PostgREST's max-rows cap
    expect(recorded.gteCalls).toContainEqual(
      expect.objectContaining({ table: "v_daily_flow", col: "observed_date" }),
    );
    expect(out.flow.map((d) => d.date)).toEqual(["2026-06-07", "2026-06-08"]); // ascending for the chart
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/__tests__/inventoryAnalytics.test.js`
Expected: FAIL — `computeKpis`/`flowSeries`/`getInventoryInsights` not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `app/lib/inventoryAnalytics.js`:

```js
function median(nums) {
  const v = nums.filter((n) => n != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/**
 * The four KPI-card numbers. Empty-safe. All four derive from the SAME
 * (store-filtered) lifecycle rows — arrivals deliberately do NOT come from the
 * global v_daily_flow, or a store-filtered view would mix per-store cards with
 * an all-store arrivals count. Censored rows are excluded from arrivals (their
 * first_seen is a lower bound — the lifecycle-side analogue of the flow view's
 * is_seed_day exclusion).
 */
export function computeKpis(rows, { since = null } = {}) {
  const activeNow = rows.filter((r) => r.current_status === "active").length;
  const exitedPeriod = rows.filter((r) => {
    if (r.current_status === "active") return false;
    const exit = exitDate(r); // flip-first — same precedence as filterLifecycle
    return exit != null && (since == null || exit >= since);
  }).length;
  const arrivalsPeriod = rows.filter(
    // strict === false (matching isSellable): a NULL censored flag must read as
    // "unknown, exclude", never as "uncensored" — !null would count it.
    (r) => r.first_seen_censored === false && (since == null || r.first_seen >= since),
  ).length;
  const medianDaysToSell = median(
    rows.filter(isSellable).map((r) => r.days_to_sell),
  );
  return { activeNow, exitedPeriod, arrivalsPeriod, medianDaysToSell };
}

/** Shape v_daily_flow rows for the line chart (adds net). */
export function flowSeries(flowRows) {
  return flowRows.map((d) => ({
    date: d.observed_date,
    arrivals: d.arrivals ?? 0,
    departures: d.departures ?? 0,
    active: d.active ?? 0,
    net: (d.arrivals ?? 0) - (d.departures ?? 0),
    isSeedDay: d.is_seed_day === true,
  }));
}

const TOP_N = 12;

/**
 * One call the dashboard uses. Reads lifecycle (store-filtered in SQL) + daily flow,
 * applies the date window, and returns every panel's shaped data.
 * @param {object} opts {store?, sinceDays?, db?}
 */
export async function getInventoryInsights({ store = null, sinceDays = null, db = supabaseAdmin } = {}) {
  const since = sinceDays ? isoDaysAgo(sinceDays) : null;
  const allRows = await readLifecycle({ store, db });
  // gap_exit rows (backfill-only, gone before cold start) have no observable
  // dates at all — they'd corrupt every panel. Dropped once here, surfaced as
  // meta.gapExits (never silently).
  const observed = allRows.filter((r) => r.current_status !== "gap_exit");
  const rows = filterLifecycle(observed, { since });

  // Flow read: the date window is pushed into SQL (.gte) and rows come back
  // NEWEST-first. PostgREST caps unranged reads (hosted default max-rows =
  // 1000); ascending order would silently keep the OLDEST ~1000 days, so a
  // "Last 90 days" chart could render empty after ~2.7 years of ledger.
  // Newest-first degrades benignly instead (oldest days drop first — long
  // after the flagged rollup revisit); re-sorted ascending in JS for the chart.
  // NOTE: the flow series is GLOBAL (all stores) — v_daily_flow has no store
  // grain in v1. KPIs no longer read it; the page labels the flow panel
  // "(all stores)" whenever a store filter is active.
  let flowQuery = db
    .from("v_daily_flow")
    .select("observed_date, arrivals, departures, active, is_seed_day")
    .order("observed_date", { ascending: false });
  if (since) flowQuery = flowQuery.gte("observed_date", since);
  const { data: flowRaw, error: flowError } = await flowQuery;
  if (flowError) throw new Error(`daily-flow read failed: ${flowError.message}`);
  const flow = flowSeries(
    (flowRaw ?? [])
      .slice()
      .sort((a, b) => (a.observed_date < b.observed_date ? -1 : 1)),
  );

  return {
    kpis: computeKpis(rows, { since }),
    velocity: buildVelocityBuckets(rows),
    brandTurnover: rankTurnover(rows, "brand").slice(0, TOP_N),
    categoryTurnover: rankTurnover(rows, "category").slice(0, TOP_N),
    storeBreakdown: storeSummary(observed), // breakdown is always all-time, all-store
    flow,
    meta: {
      store, sinceDays,
      totalTracked: observed.length,
      gapExits: allRows.length - observed.length,
    },
  };
}

// 'YYYY-MM-DD' for N days before today (UTC). Kept tiny so tests stay deterministic
// by passing `since` directly into the pure functions.
function isoDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/__tests__/inventoryAnalytics.test.js`
Expected: PASS (15 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pre-existing suites + the new inventory-analytics suite pass.

- [ ] **Step 6: Commit**

```bash
git add app/lib/inventoryAnalytics.js app/lib/__tests__/inventoryAnalytics.test.js
git commit -m "feat(insights): KPIs, flow series, getInventoryInsights orchestrator"
```

---

## Task 6: Dashboard server page (shell + KPIs + per-store table + filters)

**Files:**
- Create: `app/admin/inventory/page.js`

A server component matching the existing admin aesthetic (inline styles, dark theme — see `app/admin/page.js`, `app/admin/layout.js`). It parses `searchParams` for the store + range filters, calls `getInventoryInsights`, renders the KPI cards and per-store table itself, and hands chart data to the client component (Task 7). The store dropdown is sourced from `getActiveStores()` (`app/lib/stores.js`). Filters use a plain `<form method="get">` — no client JS needed for navigation.

- [ ] **Step 1: Create the page**

Create `app/admin/inventory/page.js`:

```jsx
import { getActiveStores } from "../../lib/stores.js";
import { getInventoryInsights } from "../../lib/inventoryAnalytics.js";
import InventoryCharts from "./_components/InventoryCharts.js";

export const metadata = { robots: "noindex, nofollow" };
// Always read fresh prod data; never cache an admin analytics view.
export const dynamic = "force-dynamic";

const RANGES = [
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "7", label: "Last 7 days" },
  { key: "all", label: "All time" },
];

const card = { background: "#18181a", border: "1px solid #2a2a2c", borderRadius: 8, padding: 16 };
const muted = { color: "#8a8a80" };

export default async function InventoryInsightsPage({ searchParams }) {
  const sp = await searchParams; // Next 15: searchParams is async
  const store = sp?.store && sp.store !== "all" ? sp.store : null;
  const rangeKey = RANGES.some((r) => r.key === sp?.range) ? sp.range : "30";
  const sinceDays = rangeKey === "all" ? null : Number(rangeKey);

  let data, error;
  try {
    data = await getInventoryInsights({ store, sinceDays });
  } catch (e) {
    error = e.message;
  }
  const stores = await getActiveStores().catch(() => []);

  if (error) {
    return (
      <div style={{ maxWidth: 720 }}>
        <h1 style={{ fontSize: 22, fontWeight: 400 }}>Inventory insights</h1>
        <p style={{ color: "#c98b7a" }}>Could not load insights: {error}</p>
        <p style={muted}>If the views are missing, apply
          <code> scripts/sql/2026-06-08-inventory-insights.sql</code> in the SQL Editor.</p>
      </div>
    );
  }

  const { kpis, velocity, brandTurnover, categoryTurnover, storeBreakdown, flow, meta } = data;
  const empty = meta.totalTracked === 0;

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1 style={{ fontSize: 22, fontWeight: 400, marginBottom: 4 }}>Inventory insights</h1>
      <p style={{ ...muted, fontSize: 12, marginBottom: 20 }}>
        Forward-going history from daily snapshots. Velocity excludes left-censored
        (pre-deploy) items. {meta.totalTracked.toLocaleString()} products tracked.
        {meta.gapExits > 0 && ` ${meta.gapExits.toLocaleString()} pre-tracking exits excluded.`}
      </p>

      {/* Filters (plain GET form) */}
      <form method="get" style={{ display: "flex", gap: 12, marginBottom: 24, fontSize: 13 }}>
        <select name="store" defaultValue={store ?? "all"} style={selectStyle}>
          <option value="all">All stores</option>
          {stores.map((s) => (
            <option key={s.domain} value={s.domain}>{s.displayName ?? s.storeName ?? s.domain}</option>
          ))}
        </select>
        <select name="range" defaultValue={rangeKey} style={selectStyle}>
          {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <button type="submit" style={btnStyle}>Apply</button>
      </form>

      {empty && (
        <div style={{ ...card, marginBottom: 24, ...muted }}>
          No snapshots captured yet. Deploy Phase 1 and let the cron run; this page
          fills in as days accumulate.
        </div>
      )}

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 28 }}>
        <Kpi label="Active now" value={kpis.activeNow.toLocaleString()} />
        <Kpi label={`Sold / left · ${rangeKey === "all" ? "all" : rangeKey + "d"}`} value={kpis.exitedPeriod.toLocaleString()} />
        <Kpi label="Median days-to-sell" value={kpis.medianDaysToSell == null ? "—" : `${kpis.medianDaysToSell} d`} />
        <Kpi label={`New arrivals · ${rangeKey === "all" ? "all" : rangeKey + "d"}`} value={kpis.arrivalsPeriod.toLocaleString()} />
      </div>

      {/* Charts (client / Recharts) */}
      <InventoryCharts
        velocity={velocity}
        brandTurnover={brandTurnover}
        categoryTurnover={categoryTurnover}
        flow={flow}
        flowIsGlobal={Boolean(store)}
      />

      {/* Per-store breakdown (server-rendered table) */}
      <h2 style={{ fontSize: 14, fontWeight: 500, margin: "28px 0 10px" }}>Per-store breakdown</h2>
      <div style={card}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={muted}>
              {["Store", "Sold signal", "Active", "Exited", "Avg days-to-sell"].map((h, i) => (
                <th key={h} style={{ textAlign: i < 2 ? "left" : "right", padding: "6px 8px", borderBottom: "1px solid #2a2a2c" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {storeBreakdown.map((s) => (
              <tr key={s.store}>
                <td style={tdL}>{s.store}</td>
                <td style={tdL}>{s.signal}</td>
                <td style={tdR}>{s.active.toLocaleString()}</td>
                <td style={tdR}>{s.exited.toLocaleString()}</td>
                <td style={tdR}>{s.avgDaysToSell ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 11, color: "#8a8a80", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 500, marginTop: 6 }}>{value}</div>
    </div>
  );
}

const selectStyle = { background: "#18181a", color: "#e7e7e2", border: "1px solid #2a2a2c", borderRadius: 6, padding: "6px 10px" };
const btnStyle = { background: "#2a2a2c", color: "#e7e7e2", border: "1px solid #3a3a3c", borderRadius: 6, padding: "6px 14px", cursor: "pointer" };
const tdL = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #232325" };
const tdR = { textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #232325", fontVariantNumeric: "tabular-nums" };
```

> **Verify the field names** from `getActiveStores()` (`app/lib/stores.js` `mapStoreRow`) when wiring the `<option>` — the explore notes show `domain, store_name, display_name`; adjust `s.displayName ?? s.storeName` to the actual mapped keys.

- [ ] **Step 2: Commit (page compiles; charts added next)**

This step depends on Task 7's `InventoryCharts` existing to render. Implement Task 7, then:

```bash
git add app/admin/inventory/page.js
git commit -m "feat(insights): /admin/inventory server page — KPIs, filters, per-store table"
```

---

## Task 7: Recharts chart panels (client component)

**Files:**
- Create: `app/admin/inventory/_components/InventoryCharts.js`

A single `"use client"` module exporting the three Recharts panels, fed data as props. Kept presentational — no data fetching. Uses `ResponsiveContainer` so it fills the dark cards.

- [ ] **Step 1: Create the component**

Create `app/admin/inventory/_components/InventoryCharts.js`:

```jsx
"use client";

import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

const card = { background: "#18181a", border: "1px solid #2a2a2c", borderRadius: 8, padding: 16, marginBottom: 16 };
const title = { fontSize: 13, fontWeight: 500, marginBottom: 12 };
const axis = { fill: "#8a8a80", fontSize: 11 };
const ACCENT = "#c8b89a";
const ARRIVE = "#7d9b8a";
const DEPART = "#a8674f";
const tooltipStyle = { background: "#0f0f10", border: "1px solid #3a3a3c", borderRadius: 6, color: "#e7e7e2", fontSize: 12 };

export default function InventoryCharts({ velocity, brandTurnover, categoryTurnover, flow, flowIsGlobal = false }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <Panel title="Sell-through velocity — days to sell">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={velocity} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="#232325" vertical={false} />
            <XAxis dataKey="label" tick={axis} stroke="#2a2a2c" />
            <YAxis tick={axis} stroke="#2a2a2c" allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff10" }} />
            <Bar dataKey="count" fill={ACCENT} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      {/* v_daily_flow has no store grain in v1 — when a store filter is active this
          panel stays all-stores and SAYS so, instead of silently mixing scopes. */}
      <Panel title={`Inventory flow — arrivals vs departures${flowIsGlobal ? " (all stores)" : ""}`}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={flow} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="#232325" vertical={false} />
            <XAxis dataKey="date" tick={axis} stroke="#2a2a2c" minTickGap={24} />
            <YAxis tick={axis} stroke="#2a2a2c" allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11, color: "#8a8a80" }} />
            <Line type="monotone" dataKey="arrivals" stroke={ARRIVE} dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="departures" stroke={DEPART} dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Brand turnover — exited (demand proxy)">
        <TurnoverBars data={brandTurnover} />
      </Panel>
      <Panel title="Category turnover — exited">
        <TurnoverBars data={categoryTurnover} />
      </Panel>
    </div>
  );
}

function TurnoverBars({ data }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="#232325" horizontal={false} />
        <XAxis type="number" tick={axis} stroke="#2a2a2c" allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={axis} stroke="#2a2a2c" width={110} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff10" }} />
        <Bar dataKey="exited" fill={ARRIVE} radius={[0, 2, 2, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function Panel({ title: t, children }) {
  return (
    <div style={card}>
      <div style={title}>{t}</div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Verify the page renders locally (admin is dev-only)**

Run: `npm run dev`, then load `http://localhost:3000/admin/inventory`.
Use the preview MCP to confirm: `preview_console_logs` clean, `preview_snapshot` shows the KPI cards + four chart panels + per-store table, `preview_screenshot` for proof. (Renders empty-safe if no data yet.)

- [ ] **Step 3: Commit (page + charts together)**

```bash
git add app/admin/inventory/page.js app/admin/inventory/_components/InventoryCharts.js
git commit -m "feat(insights): Recharts panels (velocity, flow, brand/category turnover)"
```

---

## Task 8: Admin nav wiring

**Files:**
- Modify: `app/admin/layout.js` (add a header link)
- Modify: `app/admin/page.js` (add a landing card)

- [ ] **Step 1: Add the header link**

In `app/admin/layout.js`, after the "Today's Edit" link (the `/admin/homepage-edit` anchor), add:

```jsx
        <a href="/admin/inventory" style={{ color: "#b6b6ad", textDecoration: "none" }}>
          Inventory
        </a>
```

- [ ] **Step 2: Add the landing card**

In `app/admin/page.js`, add a third `<li>` after the "Today's Edit" card, mirroring the existing card markup:

```jsx
        <li>
          <a
            href="/admin/inventory"
            style={{
              display: "block",
              padding: 16,
              background: "#18181a",
              border: "1px solid #2a2a2c",
              borderRadius: 6,
              color: "#e7e7e2",
              textDecoration: "none",
            }}
          >
            <strong>Inventory insights</strong>
            <div style={{ fontSize: 12, color: "#8a8a80", marginTop: 4 }}>
              Sell-through velocity, brand/category turnover, inventory flow.
            </div>
          </a>
        </li>
```

- [ ] **Step 3: Lint + full test, then commit**

```bash
npm run lint && npm test
```
Expected: lint clean; all tests pass.

```bash
git add app/admin/layout.js app/admin/page.js
git commit -m "feat(insights): link inventory dashboard from admin nav + landing"
```

---

## Verification

Admin is dev-only (`middleware.js` 404s `/admin/*` in prod). Read-path checks hit the single prod Supabase, which is safe. **Never trigger `/api/cron` or `/api/enrich` locally** (they write prod rows + spend OpenAI). SQL runs via the Supabase SQL Editor or the read-only MCP.

- [ ] **1. Views applied + secured.** After Task 1, the guard query returns two integer columns. Confirm anon cannot read them: with the **anon** key, `GET /rest/v1/v_product_lifecycle?select=handle&limit=1` returns empty/403 (not data). With the service-role client it returns rows (once captured).
- [ ] **2. Unit suite green.** `npm test` — the inventory-analytics suite (15 tests) plus all pre-existing suites pass.
- [ ] **3. Dashboard renders (empty-safe).** `npm run dev` → `http://localhost:3000/admin/inventory`. Before any capture, the page shows the "No snapshots captured yet" notice, zeroed KPI cards, empty charts, and no crash — **including if the optional backfill has already been run** (the pre-ledger guard keeps `v_product_lifecycle` at 0 rows until the first real ledger day, so backfill-only data must NOT light up the KPI cards). `preview_console_logs` clean; `preview_screenshot` for proof.
- [ ] **4. Filters navigate.** Changing the store/range selects and clicking Apply updates the URL `?store=…&range=…` and re-renders. The store list comes from `getActiveStores()`.
- [ ] **5. With data (after Phase 1 has captured ≥2 days — may be deferred):**
  - KPI "Active now" ≈ `SELECT COUNT(*) FROM inventory_snapshots WHERE observed_date = (SELECT MAX(observed_date) FROM inventory_snapshot_days) AND available;`
  - Spot-check lifecycle sanity: `SELECT current_status, COUNT(*) FROM v_product_lifecycle GROUP BY 1;` returns plausible active/sold/departed splits.
  - Ledger-aware departures: confirm no day with a gap manufactures a mass departure — `SELECT observed_date, departures FROM v_daily_flow ORDER BY 1;` should not spike on a skipped-then-resumed boundary (departures attach to the next *ledger* day, not the calendar gap).
  - Censoring: `SELECT first_seen_censored, COUNT(*) FROM v_product_lifecycle GROUP BY 1;` — the cold-start backlog is flagged `true`; post-deploy arrivals `false`.
  - **No seed-day departure spike (only if the backfill was run):** `SELECT observed_date, departures FROM v_daily_flow ORDER BY 1 LIMIT 1;` — departures on the cold-start day must be ~0; backfill-only churn must NOT stack there. Cross-check `SELECT COUNT(*) FROM v_product_lifecycle WHERE current_status = 'gap_exit';` ≈ the number of 2026-05-21 backfill products absent from the first real capture, and the dashboard subtitle shows the same count as "pre-tracking exits excluded".
  - **Store-filter scope consistency:** load `?store=<domain>` — all four KPI cards reflect only that store (cross-check arrivals: `SELECT COUNT(*) FROM v_product_lifecycle WHERE store_domain = '<domain>' AND NOT first_seen_censored AND first_seen >= '<window start>';`), and the flow panel title gains "(all stores)".
- [ ] **6. Recharts panels.** With ≥1 captured day, `preview_screenshot` shows populated velocity bars, the flow line chart (seed day visually de-emphasised or excluded by the `since` window), and ranked turnover bars with hover tooltips.

---

## Spec coverage (design § → task)

| Design section (Phase 2) | Covered by |
| --- | --- |
| `v_product_lifecycle` (first/last seen, flip, departure, days-to-sell, censored flag, status) | Task 1 (view) — SQL validated on live schema |
| `v_brand_turnover` / `v_category_turnover` | Task 4 (`rankTurnover`) over the lifecycle view |
| `v_daily_flow` (arrivals/departures/net) | Task 1 (view) + Task 5 (`flowSeries`) |
| KPI cards (active · sold/left · median days-to-sell · arrivals) | Task 5 (`computeKpis`) + Task 6 |
| Sell-through velocity (distribution + fastest brands) | Task 4 (`buildVelocityBuckets`, `rankTurnover`) + Task 7 |
| Turnover ranked bars (brand + category) | Task 4 + Task 7 |
| Inventory flow over time + net | Task 5 + Task 7 |
| Date-range + store filter; per-store breakdown table | Task 6 (filters + table) + Task 5 (filter plumbing) |
| Charts via a small lib (Recharts) | Task 2 + Task 7 |
| Per-store-type sold signal (flip vs delist) | Invariant 3 — unified `days_to_sell`; `storeSummary` signal label (Task 4) |
| `first_seen` left-censored handling | Invariant 4 — `first_seen_censored`; velocity excludes censored (Task 4) |
| Deferred: price-behavior panel, era breakdown | **Out of scope** (per design) |

> **Per-store flow is global in v1.** The store filter narrows **all four KPIs** — arrivals are computed from store-filtered lifecycle `first_seen` (censored rows excluded), never from the global flow view, so a filtered view can't mix per-store cards with an all-store count. Only the inventory-flow **line chart** stays all-stores, and it is explicitly labeled "(all stores)" whenever a store filter is active — the global scope is visible, not silent. True per-store flow needs a `(day, store)`-grain `v_daily_flow` and is deferred.

> **Performance note.** `v_product_lifecycle` recomputes window functions over the whole snapshot history per query, and the default (all-stores) read pages up to ~21k rows into JS. Fine for the first months of sparse data; revisit with a materialized view / nightly rollup when the snapshot table reaches millions of rows (the design already flags a rollup revisit after a year).
>
> **2026-07-03 addendum — the revisit arrived early.** At 530k rows (24 ledger days) one page of the view took ~25.5s, past the 8s `statement_timeout` PostgREST's `authenticator` role imposes on every REST read (service_role included) — the dashboard failed with "canceling statement due to statement timeout". The multiplier wasn't table size alone: `readLifecycle` recomputes the entire view once per 1000-row page (~23×), and `v_daily_flow` re-ran it per ledger day. Fixed by materializing both views (`mv_product_lifecycle`, `mv_daily_flow`) with the `v_*` names kept as thin wrappers (zero app change), refreshed by a staleness-gated hourly pg_cron job. Refresh is **non-concurrent** — `REFRESH … CONCURRENTLY` can't run inside a plpgsql function — so the once-daily refresh holds a ~30–60s exclusive lock on the MVs; an admin read landing in that window times out once, reload. Plan + full root-cause: [`plan-inventory-insights-timeout-fix.md`](plan-inventory-insights-timeout-fix.md); DDL: [`../scripts/sql/2026-07-03-inventory-insights-mv.sql`](../scripts/sql/2026-07-03-inventory-insights-mv.sql).
