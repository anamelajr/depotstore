import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "../../lib/supabase.js";
import { withVisibility } from "../../lib/productQueries.js";
import { cleanTitle } from "../../lib/cleanTitle.js";
import {
  assignCategory,
  isAllowedBrand,
  FILTER_BY_BRAND,
  SELF_BRANDED_STORES,
  isSelfBranded,
  brandFromHandle,
} from "../../lib/stores.js";
import {
  toTitleCase,
  sanitizeFallbackTitle,
  nameWithoutBrand,
} from "../../lib/handleFallback.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_SIZE = 80;
const CYCLE_MS = 300; // 200 RPM = one call every 300 ms, measured from start
const MAX_DEPTH = 30;
const MAX_ENRICH_ATTEMPTS = 3;
// Batch size is bounded by Vercel maxDuration (300 s), not by the LLM
// rate limits. With realistic gpt-5.4-mini latency around 1.5–2 s/call
// (sleep is no longer the floor at 300 ms), 80 × 2 s ≈ 160 s leaves
// comfortable headroom. Earlier BATCH_SIZE = 150 hit 150 × 2 s = 300 s
// timeouts that killed the function before it could dispatch the next
// chain hop, breaking the drain. cleanTitle.js caps each call at 8 s
// via AbortController so a single pathological request can't blow the
// whole batch's budget. Provider headroom (200 RPM, ~140k TPM at
// ~700 tok/call) sits well under the key's 500 RPM / 200k TPM ceilings.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function incrementAttempts(row) {
  const { error } = await supabaseAdmin.rpc("increment_enrich_attempts", {
    p_handle: row.handle,
    p_store_domain: row.store_domain,
  });
  if (error) {
    console.error(
      `incrementAttempts failed for ${row.store_domain}/${row.handle}:`,
      error.message
    );
    return false;
  }
  return true;
}

export async function POST(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const batchStartMs = Date.now();
  const url = new URL(request.url);
  const depth = parseInt(url.searchParams.get("depth") ?? "0", 10);

  const { data: rows, error: selErr } = await withVisibility(
    supabaseAdmin
      .from("products")
      .select("id, handle, store_domain, name, brand, title, category, description, editorial_description, enrich_attempts"),
  )
    .lt("enrich_attempts", MAX_ENRICH_ATTEMPTS)
    .or("brand.is.null,title.is.null,category.is.null")
    .order("id", { ascending: false })
    .limit(BATCH_SIZE);

  if (selErr) {
    return Response.json({ error: selErr.message }, { status: 500 });
  }

  let succeeded = 0;
  let failed = 0;
  let rejected = 0; // Dolce Vita allowlist rejections
  let attemptIncrementFailures = 0;

  // Logging counters for enrich_runs
  let fastPathCount = 0;
  let openaiCalls = 0;
  let openaiSucceeded = 0;
  let openaiReturnedNull = 0;
  let openaiNoCall = 0;
  let categoryAssigned = 0;
  let categoryFailed = 0;
  const perStoreOpenaiCalls = {};

  async function tally(row) {
    const ok = await incrementAttempts(row);
    if (!ok) attemptIncrementFailures++;
  }

  for (const row of rows ?? []) {
    // Category-only fill: brand and title are already populated, only
    // category is missing. Skip Haiku entirely — assignCategory is
    // deterministic and code-only. Allowlist gate is N/A here; the
    // brand passed it on the row's first pass.
    if (row.brand && row.title) {
      fastPathCount++;
      const { category: newCategory, subcategory: newSubcategory } = assignCategory(row);
      if (!newCategory) {
        categoryFailed++;
        failed++;
        await tally(row);
        continue;
      }
      categoryAssigned++;
      const { error: rpcErr } = await supabaseAdmin.rpc("enrich_product", {
        p_handle: row.handle,
        p_store_domain: row.store_domain,
        p_brand: row.brand,
        p_title: row.title,
        p_category: newCategory,
        p_subcategory: newSubcategory,
      });
      if (rpcErr) {
        failed++;
        await tally(row);
      } else {
        succeeded++;
      }
      continue;
    }

    // Pre-call short-circuit: row.name being empty means cleanTitle would
    // return null immediately without making any API request. Count it
    // separately so the reconciliation math (openai_calls × 750 ≈ dashboard
    // input tokens) stays clean — this row consumed zero tokens.
    if (!row.name) {
      openaiNoCall++;
      failed++;
      await tally(row);
      continue;
    }

    const t0 = Date.now();
    try {
      // Increment BEFORE the await so the count is robust even if cleanTitle
      // is later refactored in a way that lets exceptions propagate here.
      openaiCalls++;
      perStoreOpenaiCalls[row.store_domain] =
        (perStoreOpenaiCalls[row.store_domain] ?? 0) + 1;
      const cleanTitleResult = await cleanTitle({
        name: row.name,
        rawDescription: row.description,
      });
      let result = cleanTitleResult;
      let isHandleFallback = false;
      if (!cleanTitleResult) {
        openaiReturnedNull++;
        // Deterministic fallback: cleanTitle couldn't extract a brand from
        // the name/description, but the handle slug may still carry one.
        // Catches stores that strip the brand from the Shopify name while
        // keeping it in the URL (e.g. At Dawn Paris: handle `fendi-jacket`,
        // name "WOOL BLAZER"). No OpenAI call — match is against the
        // curated allowlist via hyphen-bounded boundaries, so a non-archive
        // word fragment cannot impersonate a brand.
        const handleBrand = brandFromHandle(row.handle);
        if (handleBrand) {
          // Bound the OUTPUT title's word count, not the input name's. The
          // brand is stripped first, so a wordy brand prefix shouldn't
          // block recovery of a short title. Sanitize quotes/parens before
          // counting so the deterministic path mirrors cleanTitle's rule
          // "remove collection names in quotes, parentheticals". The
          // titleWords >= 1 lower bound also rules out the name-equals-brand
          // case (stripping "FENDI" from "FENDI" yields empty → 0 words).
          const fallbackTitle = sanitizeFallbackTitle(
            toTitleCase(nameWithoutBrand(row.name, handleBrand))
          );
          const titleWords = fallbackTitle.split(/\s+/).filter(Boolean).length;
          if (titleWords >= 1 && titleWords <= 7) {
            result = {
              brand: handleBrand.toUpperCase(),
              title: fallbackTitle,
            };
            isHandleFallback = true;
            console.log(
              `[enrich] handle-fallback recovered ${row.store_domain}/${row.handle} → ${result.brand}`
            );
          }
        }
      }
      if (result) {
        if (!isHandleFallback) openaiSucceeded++;
        const { brand: newBrand, title: newTitle } = result;
        // Allowlist gate for filtered stores. Hide the row instead of
        // deleting it. A delete would be re-created on the next sync
        // (Shopify still sells the item), then re-enriched, re-rejected,
        // re-deleted — the loop that drove ~99% of our token spend.
        // Hiding persists the rejection: subsequent syncs refresh
        // synced_at (so stale-delete leaves it alone) but the enrich
        // SELECT skips it via .eq("hidden", false). enrich_attempts is
        // also capped as a second guard — cron's content-churn reset
        // would otherwise zero it out and re-queue the row.
        // Scoped to row.id (PK) rather than (handle, store_domain);
        // the pair is unique in production but using the PK we already
        // selected makes the call independent of that invariant.
        if (FILTER_BY_BRAND.has(row.store_domain)) {
          if (!isAllowedBrand(newBrand)) {
            await supabaseAdmin
              .from("products")
              .update({ hidden: true, enrich_attempts: MAX_ENRICH_ATTEMPTS })
              .eq("id", row.id);
            rejected++;
            const elapsed = Date.now() - t0;
            await sleep(Math.max(0, CYCLE_MS - elapsed));
            continue;
          }
        }

        // Self-brand gate for stores like nuovo-paris.com. Positive evidence
        // (cleanTitle or the handle fallback resolved to the store's own
        // house line), so hide immediately — no retry budget needed.
        if (isSelfBranded(row.store_domain, newBrand)) {
          await supabaseAdmin
            .from("products")
            .update({ hidden: true, enrich_attempts: MAX_ENRICH_ATTEMPTS })
            .eq("id", row.id);
          rejected++;
          const elapsed = Date.now() - t0;
          await sleep(Math.max(0, CYCLE_MS - elapsed));
          continue;
        }

        const { category: newCategory, subcategory: newSubcategory } =
          assignCategory({ ...row, brand: newBrand, title: newTitle });
        if (newCategory) categoryAssigned++;
        else categoryFailed++;
        // Atomic null-only write via RPC — COALESCE evaluates against the
        // row's current state inside the UPDATE, so a concurrent enrich
        // run that filled brand/title between our SELECT and now cannot
        // be clobbered by our stale snapshot. Application-side
        // `row.brand ?? newBrand` would have that race.
        const { error: rpcErr } = await supabaseAdmin.rpc("enrich_product", {
          p_handle: row.handle,
          p_store_domain: row.store_domain,
          p_brand: newBrand,
          p_title: newTitle,
          p_category: newCategory,
          p_subcategory: newSubcategory,
        });
        if (rpcErr) {
          failed++;
          await tally(row);
        } else {
          succeeded++;
        }
      } else {
        failed++;
        await tally(row);
        // Null-branch terminal hides. cleanTitle() returns null on transient
        // OpenAI 5xx, rate limits, and 8 s timeouts as well as on genuinely
        // unidentifiable rows, so we defer hiding until attempts is about to
        // reach MAX — an early hide would permanently kill legitimate-brand
        // rows on a single OpenAI hiccup. Chained with `else if` so each row
        // counts at most once toward `rejected`; the subsequent UPDATE would
        // be a no-op on `hidden = true` anyway but the metric double-count
        // would pollute enrich_runs.allowlist_rejected.
        //
        // Order matters: store-policy hides come first so their intent
        // shows up in logs/telemetry distinctly from the generic catch-all.
        if (
          row.enrich_attempts + 1 >= MAX_ENRICH_ATTEMPTS &&
          SELF_BRANDED_STORES.has(row.store_domain)
        ) {
          // Store opted in to "don't surface house-line inventory."
          await supabaseAdmin
            .from("products")
            .update({ hidden: true })
            .eq("id", row.id);
          rejected++;
        } else if (
          row.enrich_attempts + 1 >= MAX_ENRICH_ATTEMPTS &&
          FILTER_BY_BRAND.has(row.store_domain)
        ) {
          // Store opted in to "only surface allowlisted brands." Mirrors
          // the success-branch allowlist gate above: no brand resolved from
          // either cleanTitle or brandFromHandle means no allowlist check
          // could pass, so the row doesn't belong in the curated feed.
          await supabaseAdmin
            .from("products")
            .update({ hidden: true })
            .eq("id", row.id);
          rejected++;
        } else if (
          row.enrich_attempts + 1 >= MAX_ENRICH_ATTEMPTS &&
          row.title === null
        ) {
          // Homepage invariant: never surface a row whose editorial title is
          // NULL — ProductCard falls back to row.name and leaks the raw
          // uppercase Shopify string. Covers stores in NEITHER policy list
          // (e.g. seyswardrobe.fr's HYSTERIC GLAMOUR row).
          await supabaseAdmin
            .from("products")
            .update({ hidden: true })
            .eq("id", row.id);
          rejected++;
        }
      }
    } catch {
      failed++;
      await tally(row);
    }
    const elapsed = Date.now() - t0;
    await sleep(Math.max(0, CYCLE_MS - elapsed));
  }

  const { count: remaining } = await withVisibility(
    supabaseAdmin
      .from("products")
      .select("*", { count: "exact", head: true }),
  )
    .lt("enrich_attempts", MAX_ENRICH_ATTEMPTS)
    .or("brand.is.null,title.is.null,category.is.null");

  let chained = false;
  if ((remaining ?? 0) > 0 && depth < MAX_DEPTH) {
    const nextUrl = `${url.origin}/api/enrich?depth=${depth + 1}`;
    const headers = { Authorization: `Bearer ${process.env.CRON_SECRET}` };
    // Vercel SSO blocks self-fetches to a deployment URL when Deployment
    // Protection is on. The bypass secret is auto-injected by Vercel when
    // a project-level Protection Bypass for Automation is configured.
    // Harmless when unset (no SSO) or unmatched (production custom domain).
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
      headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    }
    waitUntil(
      fetch(nextUrl, { method: "POST", headers }).catch(() => {})
    );
    chained = true;
  }

  try {
    await supabaseAdmin.from("enrich_runs").insert({
      run_type: "enrich",
      duration_ms: Date.now() - batchStartMs,
      depth,
      queue_size: rows?.length ?? 0,
      fast_path_count: fastPathCount,
      openai_calls: openaiCalls,
      openai_succeeded: openaiSucceeded,
      openai_returned_null: openaiReturnedNull,
      openai_no_call: openaiNoCall,
      category_assigned: categoryAssigned,
      category_failed: categoryFailed,
      allowlist_rejected: rejected,
      attempts_increment_failures: attemptIncrementFailures,
      per_store_openai_calls: perStoreOpenaiCalls,
      remaining_after: remaining ?? 0,
      chained,
    });
  } catch (e) {
    console.error("enrich_runs enrich log failed:", e?.message ?? e);
  }

  return Response.json({
    processed: rows?.length ?? 0,
    succeeded,
    failed,
    rejected,
    attemptIncrementFailures,
    remaining: remaining ?? 0,
    depth,
    chained,
  });
}
