import { describe, it, expect } from "vitest";
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
