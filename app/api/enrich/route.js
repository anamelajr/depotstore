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

// Token-aware title case for the handle-fallback. Preserves canonical
// casing for season codes (FW1998, SS99, AW2000) and decade markers
// (2000s, 1990s) per cleanTitle's prompt examples. Other tokens get
// standard title case (first letter upper, rest lower). Only used by
// the handle-fallback path — no other call sites.
export function toTitleCase(s) {
  return s
    .split(/\s+/)
    .map((token) => {
      if (!token) return token;
      if (/^(FW|SS|AW)\d{2,4}$/i.test(token)) return token.toUpperCase();
      if (/^\d{4}s$/i.test(token)) return token.toLowerCase();
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(" ");
}

// Mirror cleanTitle's prompt rule "remove collection names in quotes,
// parentheticals" so the deterministic fallback writes a title that
// meets the same editorial bar. Stripping is delimiter-class greedy
// (each class runs once over the string); collapse whitespace and
// trim afterward. No-op on titles without quotes/parens.
export function sanitizeFallbackTitle(s) {
  return s
    .replace(/«[^»]*»/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Removes the brand from the raw name before title-casing, so a row whose
// Shopify name *does* include the brand (e.g. "HELMUT LANG DRESS") doesn't
// produce a redundant title that echoes the brand line on the product card —
// the same failure mode cleanTitle's `brandInTitle` guard exists to prevent.
// Match is whole-word, case-insensitive, and accent-insensitive against the
// full brand phrase; if no match, original name is returned untouched.
export function nameWithoutBrand(name, brand) {
  const accentStrip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const tokens = accentStrip(brand).split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return name;
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(
    `(^|[^A-Za-z0-9])${escaped.join("[^A-Za-z0-9]+")}([^A-Za-z0-9]|$)`,
    "gi"
  );
  const stripped = accentStrip(name);
  const after = stripped.replace(re, "$1$2");
  if (after === stripped) return name;
  // Strip leading/trailing non-alphanumerics so a name like "FENDI - WOOL"
  // doesn't leave a dangling delimiter ("- Wool") in the resulting title.
  return after
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}

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
        // Self-brand null-branch gate: only hide once the row has burned
        // every retry. cleanTitle() returns null on transient OpenAI 5xx,
        // rate limits, and 8 s timeouts as well as on genuinely
        // unidentifiable rows, so an early hide would permanently kill
        // legitimate-brand rows on a single OpenAI hiccup. Defer until
        // attempts is about to reach MAX, at which point the row is
        // genuinely un-enrichable and the store's policy treats it as
        // self-branded/unbranded.
        if (
          SELF_BRANDED_STORES.has(row.store_domain) &&
          row.enrich_attempts + 1 >= MAX_ENRICH_ATTEMPTS
        ) {
          await supabaseAdmin
            .from("products")
            .update({ hidden: true })
            .eq("id", row.id);
          rejected++;
        }

        // FILTER_BY_BRAND null-branch terminal hide. Mirrors the success-
        // branch allowlist gate above: if no brand resolved from either
        // cleanTitle or brandFromHandle by MAX retries, there's no allowlist
        // check the row could pass, so it doesn't belong in the curated feed.
        if (
          FILTER_BY_BRAND.has(row.store_domain) &&
          row.enrich_attempts + 1 >= MAX_ENRICH_ATTEMPTS
        ) {
          await supabaseAdmin
            .from("products")
            .update({ hidden: true })
            .eq("id", row.id);
          rejected++;
        }

        // Generic title-null terminal hide. The homepage invariant is that
        // we never surface a row whose editorial title is NULL — ProductCard
        // falls back to row.name and leaks the raw uppercase Shopify string.
        // If we exhausted attempts and still have no title, hide. Subsumes
        // the two policy hides above in their common case; kept separate so
        // the per-store policy intent stays explicit. Also covers stores in
        // NEITHER policy list (e.g. seyswardrobe.fr's HYSTERIC GLAMOUR row).
        if (
          row.title === null &&
          row.enrich_attempts + 1 >= MAX_ENRICH_ATTEMPTS
        ) {
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
