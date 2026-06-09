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
