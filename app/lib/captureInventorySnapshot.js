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
