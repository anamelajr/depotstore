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
