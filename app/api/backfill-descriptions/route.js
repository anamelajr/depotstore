import { supabaseAdmin } from "../../lib/supabase.js";
import { generateDescription } from "../../lib/generateDescription.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Gradual backfill of `editorial_description`.
//
// ~99% of visible products have no stored description, so the PDP was calling
// OpenAI inline on almost every product click. That call is now streamed
// behind Suspense (app/components/ProductDescription.js), and this route
// drains the backlog newest-first so the streaming path becomes a rare
// fallback rather than the norm. At ~100/run hourly, ~7,950 rows clear in
// three to four days; after that it just tops up new arrivals.
//
// Deliberately NOT a step inside /api/cron: the sync already claims 240s of
// cron's 300s budget (SYNC_DEADLINE_MS), with the tail reserved for the
// stale-delete → snapshot → enrich dispatch. There is no headroom there for a
// hundred OpenAI calls. Cron dispatches this fire-and-forget instead, exactly
// like the existing enrich trigger, so no new Vercel cron entry is needed.

const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;
const CONCURRENCY = 5;
// Measured from THIS request's start, not cron's: this route is dispatched
// asynchronously and has its own independent 300s budget.
const DEADLINE_MS = 240_000;
const OPENAI_TIMEOUT_MS = 30_000;

const ZERO_PRICE = "€0.00";

async function generateOne(row) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    return await generateDescription(
      {
        name: row.name,
        vendor: row.brand ?? null,
        rawDescription: row.description ?? null,
        tags: [],
        price: row.price,
        storeName: row.store_name,
      },
      { signal: controller.signal },
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Simple fixed-size worker pool. Keeps OpenAI concurrency bounded without
// pulling in a dependency; each worker pulls the next index until the queue or
// the deadline is exhausted. Returns the Set of row ids actually handed to a
// worker — rows stranded past the deadline are absent, so the caller can
// release their claims (exported for tests).
export async function runPool(rows, worker, startMs) {
  let next = 0;
  const attempted = new Set();
  const workers = Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= rows.length) return;
      if (Date.now() - startMs > DEADLINE_MS) return;
      attempted.add(rows[i].id);
      await worker(rows[i]);
    }
  });
  await Promise.all(workers);
  return attempted;
}

export async function POST(request) {
  const authHeader = request.headers.get("authorization");
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startMs = Date.now();

  // Visibility predicate matches `withVisibility` (available + hidden + the
  // '€0.00' NOT-FOR-SALE carve-out): never spend tokens on a product the feed
  // will not show. NULL price stays eligible — unknown, not unsellable.
  //
  // ORDER BY attempts FIRST. This is what turns the increment below into an
  // effective claim: a run that overlaps this one sorts the rows we just
  // bumped to attempts=1 BEHIND the untouched attempts=0 backlog, so
  // concurrent runs diverge onto disjoint batches whenever more than one
  // batch of work remains. Ordering by synced_at alone would hand every
  // overlapping run the identical newest-100 set (attempts=1 still passes
  // `< 3`). Side effect, also wanted: never-tried rows drain before failed
  // rows retry. Within an attempt tier, newest first.
  const { data: candidates, error: selectError } = await supabaseAdmin
    .from("products")
    .select("id, handle, store_domain, store_name, name, brand, price, description")
    .eq("available", true)
    .eq("hidden", false)
    .or(`price.is.null,price.neq."${ZERO_PRICE}"`)
    .is("editorial_description", null)
    .lt("description_attempts", MAX_ATTEMPTS)
    .order("description_attempts", { ascending: true })
    .order("synced_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(BATCH_SIZE);

  if (selectError) {
    console.error(
      JSON.stringify({
        event: "description_backfill_error",
        stage: "select",
        reason: selectError.message,
      }),
    );
    return Response.json({ error: selectError.message }, { status: 500 });
  }

  const rows = candidates ?? [];
  if (rows.length === 0) {
    console.log(
      JSON.stringify({
        event: "description_backfill",
        claimed: 0,
        generated: 0,
        failed: 0,
        remaining: 0,
        ms: Date.now() - startMs,
      }),
    );
    return Response.json({ ok: true, claimed: 0, generated: 0, remaining: 0 });
  }

  // CLAIM BEFORE SPENDING. Increment the attempt counter on the selected ids
  // before any OpenAI call. The increment does NOT exclude the rows from a
  // later SELECT's predicate (attempts=1 still passes `< 3`); it deprioritizes
  // them via the attempts-first ordering above, which is what steers an
  // overlapping run onto a different batch. The write-side only-if-NULL guard
  // below prevents duplicate WRITES; it does nothing about duplicate CALLS,
  // which are the actual cost. A failed claim aborts the run rather than
  // generating unclaimed.
  //
  // Accepted residual: the deprioritization is soft. A run overlapping this
  // one anywhere in its ~240s window duplicates work in two cases — (a) it
  // starts between our SELECT and this RPC committing, or (b) fewer than
  // BATCH_SIZE attempts=0 rows remain, so its batch partially overlaps ours.
  // (a) is a sub-second window; (b) only occurs in the drained steady state,
  // where the duplicated set is small. The route's only dispatcher is the
  // hourly cron, fire-and-forget, no retry. True in-flight exclusion needs a
  // lease column or claim-and-return RPC — deliberately not built for a
  // once-an-hour, single-dispatcher route.
  const ids = rows.map((r) => r.id);
  const { error: claimError } = await supabaseAdmin.rpc(
    "increment_description_attempts",
    { p_ids: ids },
  );
  if (claimError) {
    console.error(
      JSON.stringify({
        event: "description_backfill_error",
        stage: "claim",
        reason: claimError.message,
      }),
    );
    return Response.json({ error: claimError.message }, { status: 500 });
  }

  let generated = 0;
  let failed = 0;

  const attempted = await runPool(
    rows,
    async (row) => {
      const text = await generateOne(row);
      if (!text) {
        failed++;
        return;
      }
      // Only-if-NULL, mirroring the editorial write protection: a PDP visitor
      // may have generated and cached one for this row while the batch was in
      // flight, and that write must not be clobbered.
      const { error } = await supabaseAdmin
        .from("products")
        .update({ editorial_description: text })
        .eq("id", row.id)
        .is("editorial_description", null);
      if (error) failed++;
      else generated++;
    },
    startMs,
  );

  // RELEASE WHAT WAS NEVER TRIED. The claim above covers the whole batch, but
  // a slow run (OpenAI near the 30s timeout) can hit DEADLINE_MS with rows
  // still queued. Those rows burned an attempt without a single OpenAI call;
  // left alone, three degraded runs would exhaust them permanently. Rows whose
  // call was at least STARTED keep their attempt — that spend was real.
  // A failed release is logged and accepted: the row loses one attempt, and
  // the cron source-change reset restores exhausted rows when listings change.
  const stranded = ids.filter((id) => !attempted.has(id));
  if (stranded.length > 0) {
    const { error: releaseError } = await supabaseAdmin.rpc(
      "decrement_description_attempts",
      { p_ids: stranded },
    );
    if (releaseError) {
      console.error(
        JSON.stringify({
          event: "description_backfill_error",
          stage: "release",
          stranded: stranded.length,
          reason: releaseError.message,
        }),
      );
    }
  }

  const { count: remaining } = await supabaseAdmin
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("available", true)
    .eq("hidden", false)
    .or(`price.is.null,price.neq."${ZERO_PRICE}"`)
    .is("editorial_description", null)
    .lt("description_attempts", MAX_ATTEMPTS);

  console.log(
    JSON.stringify({
      event: "description_backfill",
      claimed: rows.length,
      generated,
      failed,
      stranded: stranded.length,
      remaining: remaining ?? null,
      ms: Date.now() - startMs,
    }),
  );

  return Response.json({
    ok: true,
    claimed: rows.length,
    generated,
    failed,
    stranded: stranded.length,
    remaining: remaining ?? null,
  });
}
