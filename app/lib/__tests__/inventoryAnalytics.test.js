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
