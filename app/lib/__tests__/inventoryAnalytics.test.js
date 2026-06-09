import { describe, it, expect } from "vitest";
import {
  PAGE_SIZE,
  LIFECYCLE_COLUMNS,
  readLifecycle,
  filterLifecycle,
  buildVelocityBuckets,
  rankTurnover,
  storeSummary,
  BUCKET_LABELS,
  computeKpis,
  flowSeries,
  getInventoryInsights,
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
