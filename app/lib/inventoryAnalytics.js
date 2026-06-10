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
    // The seed day's "arrivals" are the entire censored backlog (~the catalog),
    // not real arrivals — plotted as-is it dwarfs every true daily count and
    // rescales the whole chart. The arrivals line plots plotArrivals (null =>
    // Recharts skips the point); raw arrivals stays for tooltips/inspection.
    plotArrivals: d.is_seed_day === true ? null : (d.arrivals ?? 0),
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
