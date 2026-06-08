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
    // Failure isolation (non-negotiable) — never rethrow. A broken/missing
    // table or a failed insert degrades to a logged no-op, never a blocked or
    // corrupted sync. Structured log so a persistent failure is alertable
    // (mirrors the FX-refresh precedent: history is data, not throwaway
    // telemetry).
    const error = e?.message ?? String(e);
    summary.snapshot = { captured: false, error };
    console.error(JSON.stringify({ event: "inventory_snapshot_fail", error }));
  }
}
