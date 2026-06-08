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
    // 1. Clean-run gate — skip if the run had errors OR any store returned zero
    //    products. A partial run leaves errored/empty stores' rows stale and
    //    un-reconciled in `products`; snapshotting would freeze contaminated
    //    data for the day. A count===0 store is a likely-failed fetch: the sync
    //    path itself treats it as failed and excludes it from stale cleanup
    //    (app/api/cron/route.js), but it never lands in summary.errors — so the
    //    error check alone misses it and we must inspect summary.stores too.
    if (summary.errors.length > 0) {
      summary.snapshot = { captured: false, skipped: "run-had-errors" };
      return;
    }
    if (Object.values(summary.stores ?? {}).some((count) => count === 0)) {
      summary.snapshot = { captured: false, skipped: "run-had-empty-store" };
      return;
    }

    // 2. Daily completeness gate — skip only when today was ALREADY FULLY
    //    captured. Completeness is tracked in the inventory_snapshot_days ledger
    //    (written only after the final batch lands), NOT by the mere existence
    //    of rows in inventory_snapshots: each .upsert() below is its own
    //    transaction, so a capture that fails mid-insert commits some batches
    //    but writes no ledger row. Gating on "any row exists for today" would
    //    then freeze that partial day forever. With the ledger, a missing marker
    //    => (re)capture, and the data insert's ON CONFLICT DO NOTHING backfills
    //    only the rows the partial run missed. Self-heals: a transient failure
    //    is retried each hour until one run lands every batch and marks the day.
    const today = utcDate(syncStart);
    const { data: completeDay, error: gateError } = await db
      .from("inventory_snapshot_days")
      .select("observed_date")
      .eq("observed_date", today)
      .limit(1);
    if (gateError) throw new Error(`daily-gate read failed: ${gateError.message}`);
    if (completeDay && completeDay.length > 0) {
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

    // 5. Mark the day complete — written ONLY after every batch landed, so a
    //    mid-insert failure leaves no ledger row and the next run retries (gate
    //    above). ON CONFLICT DO NOTHING keeps it idempotent across same-day
    //    retries that race to claim the day.
    const { error: markError } = await db
      .from("inventory_snapshot_days")
      .upsert(
        { observed_date: today, observed_at: syncStart, row_count: rows.length },
        { onConflict: "observed_date", ignoreDuplicates: true },
      );
    if (markError) {
      throw new Error(`snapshot completeness mark failed: ${markError.message}`);
    }

    // 6. Success — structured log + summary stash.
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
