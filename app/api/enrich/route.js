import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "../../lib/supabase.js";
import { cleanTitle } from "../../lib/cleanTitle.js";
import {
  assignCategory,
  normalizeBrand,
  BRAND_SET_NORMALIZED,
  FILTER_BY_BRAND,
} from "../../lib/stores.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_SIZE = 150;
const CYCLE_MS = 1200; // 50 RPM = one call every 1.2 s, measured from start
const MAX_DEPTH = 30;
// 150 × 1.2 s = 180 s baseline. Vercel maxDuration is 300 s. The ~120 s
// headroom absorbs Haiku-call latency that exceeds the 1.2 s sleep budget.
// If a batch is killed before reaching the final waitUntil, the chain breaks
// and only the next nightly cron resumes drain — keeping headroom matters.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const depth = parseInt(url.searchParams.get("depth") ?? "0", 10);

  const { data: rows, error: selErr } = await supabaseAdmin
    .from("products")
    .select("id, handle, store_domain, name, brand, title, category, description")
    .or("brand.is.null,title.is.null,category.is.null")
    .order("id", { ascending: false })
    .limit(BATCH_SIZE);

  if (selErr) {
    return Response.json({ error: selErr.message }, { status: 500 });
  }

  let succeeded = 0;
  let failed = 0;
  let rejected = 0; // Dolce Vita allowlist rejections

  for (const row of rows ?? []) {
    // Category-only fill: brand and title are already populated, only
    // category is missing. Skip Haiku entirely — assignCategory is
    // deterministic and code-only. Allowlist gate is N/A here; the
    // brand passed it on the row's first pass.
    if (row.brand && row.title) {
      const newCategory = assignCategory(row) ?? null;
      if (!newCategory) continue;
      const { error: rpcErr } = await supabaseAdmin.rpc("enrich_product", {
        p_handle: row.handle,
        p_store_domain: row.store_domain,
        p_brand: row.brand,
        p_title: row.title,
        p_category: newCategory,
      });
      if (rpcErr) failed++;
      else succeeded++;
      continue;
    }

    const t0 = Date.now();
    try {
      const result = await cleanTitle({
        name: row.name,
        rawDescription: row.description,
      });
      if (result) {
        const { brand: newBrand, title: newTitle } = result;
        // Allowlist gate for filtered stores. Sync passed this row through
        // its weakened filter (no Haiku at sync time), so we re-apply the
        // allowlist here against Haiku's extracted brand. If the brand
        // isn't in the allowlist, mirror sync's pre-Task-4 behavior:
        // delete the row so it doesn't surface in the feed. Sync will
        // re-add it next night and we'll re-reject; the cycle is bounded.
        if (FILTER_BY_BRAND.has(row.store_domain)) {
          const normalizedNewBrand = normalizeBrand(newBrand);
          const allowed =
            normalizedNewBrand &&
            BRAND_SET_NORMALIZED.has(normalizedNewBrand);
          if (!allowed) {
            await supabaseAdmin
              .from("products")
              .delete()
              .eq("handle", row.handle)
              .eq("store_domain", row.store_domain);
            rejected++;
            const elapsed = Date.now() - t0;
            await sleep(Math.max(0, CYCLE_MS - elapsed));
            continue;
          }
        }

        const newCategory =
          assignCategory({ ...row, brand: newBrand, title: newTitle }) ?? null;
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
        });
        if (rpcErr) failed++;
        else succeeded++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
    const elapsed = Date.now() - t0;
    await sleep(Math.max(0, CYCLE_MS - elapsed));
  }

  const { count: remaining } = await supabaseAdmin
    .from("products")
    .select("*", { count: "exact", head: true })
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

  return Response.json({
    processed: rows?.length ?? 0,
    succeeded,
    failed,
    rejected,
    remaining: remaining ?? 0,
    depth,
    chained,
  });
}
