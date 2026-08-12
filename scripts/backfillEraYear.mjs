#!/usr/bin/env node
// One-off backfill for the Featured Archives system
// (docs/superpowers/specs/2026-08-11-featured-archives-hedi-slimane-design.md).
//
// Populates products.era_year by applying app/lib/parseEra.js to the titles and
// names already in the table. Nothing is regenerated and no OpenAI call is made.
//
// SAFETY MODEL:
//   - era_year is DERIVED, not editorial. It is a deterministic, pure function
//     of (title, name) with no judgment in it, so CLAUDE.md's write-once rule
//     does not apply and every writer — cron Step 2, /api/enrich, this script —
//     performs a plain overwrite. Re-running is a no-op by definition.
//   - Rows are scanned in full, including hidden and sold ones: era_year is a
//     property of the garment, and a sold row can come back.
//   - CONVERGENCE, not compare-and-swap. All three writers compute the same
//     function but possibly from different input snapshots: a concurrent enrich
//     can land a title (and its title-derived era_year) after this script read
//     its page, and the stale name-derived value would overwrite it. Per-row CAS
//     would break the grouped batch updates that keep this script to a handful
//     of round-trips, so instead --apply re-scans after every pass and applies
//     again until a scan reports zero pending. A stale overwrite shows up as a
//     fresh diff on the next scan, so the loop converges — the collision window
//     is a few minutes of script against an hourly enrich batch, and the hourly
//     cron recompute repairs any residue regardless.
//
// Usage (run from the repo root, where .env.local lives):
//   node scripts/backfillEraYear.mjs              # dry-run (default, no writes)
//   node scripts/backfillEraYear.mjs --apply      # perform writes
//   node scripts/backfillEraYear.mjs --env <path> # override .env.local location

import * as dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseEraYear } from "../app/lib/parseEra.js";
import { chunkArray } from "../app/lib/chunk.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const envIdx = argv.indexOf("--env");
const ENV_PATH = envIdx !== -1 ? argv[envIdx + 1] : join(__dirname, "../.env.local");

dotenv.config({ path: ENV_PATH });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    `Missing Supabase env in ${ENV_PATH} (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)`,
  );
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

const PAGE = 1000;
const ID_CHUNK = 100; // PostgREST URL limit — same cap as everywhere else.
const MAX_PASSES = 5;

async function scan() {
  let from = 0;
  let scanned = 0;
  let covered = 0; // rows that end up with a non-null era_year
  const pending = [];

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("id, store_domain, handle, title, name, era_year")
      // Stable key before paging: without ORDER BY, Postgres gives no
      // cross-page order guarantee, so a concurrent sync write between
      // .range() calls can shift a boundary row and the scan skips it.
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Fetch error: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      scanned++;
      const proposed = parseEraYear(row.title, row.name);
      if (proposed != null) covered++;
      if (proposed !== (row.era_year ?? null)) pending.push({ ...row, proposed });
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  return { scanned, covered, pending };
}

// Group by computed value so the whole pass is a handful of `.in("id", …)`
// updates rather than one round-trip per row.
async function applyPending(pending) {
  const byYear = new Map();
  for (const row of pending) {
    const key = row.proposed ?? "null";
    if (!byYear.has(key)) byYear.set(key, []);
    byYear.get(key).push(row.id);
  }

  let written = 0;
  for (const [key, ids] of byYear.entries()) {
    const value = key === "null" ? null : Number(key);
    for (const chunk of chunkArray(ids, ID_CHUNK)) {
      const { error } = await supabaseAdmin
        .from("products")
        .update({ era_year: value })
        .in("id", chunk);
      if (error) throw new Error(`Update error (era_year=${key}): ${error.message}`);
      written += chunk.length;
    }
  }
  return written;
}

function report({ scanned, covered, pending }) {
  console.log(`scanned       : ${scanned}`);
  console.log(
    `era coverage  : ${covered} (${scanned ? ((covered / scanned) * 100).toFixed(1) : "0.0"}%)`,
  );
  console.log(`pending write : ${pending.length}`);

  const byYear = new Map();
  for (const row of pending) {
    const key = row.proposed ?? "null";
    byYear.set(key, (byYear.get(key) ?? 0) + 1);
  }
  const top = [...byYear.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (top.length) {
    console.log("\n=== Pending by computed era_year (top 20) ===");
    for (const [year, n] of top) console.log(`${String(n).padStart(6)}  ${year}`);
  }
}

(async () => {
  console.log(`Mode: ${APPLY ? "APPLY (writes enabled)" : "DRY-RUN (no writes)"}\n`);

  if (!APPLY) {
    const result = await scan();
    console.log(
      ["id", "store_domain", "handle", "from", "to", "title", "name"].join("\t"),
    );
    for (const row of result.pending.slice(0, 200)) {
      console.log(
        [
          row.id,
          row.store_domain,
          row.handle,
          row.era_year ?? "null",
          row.proposed ?? "null",
          JSON.stringify(row.title),
          JSON.stringify(row.name),
        ].join("\t"),
      );
    }
    if (result.pending.length > 200) {
      console.log(`… ${result.pending.length - 200} more rows not printed.`);
    }
    console.log(`\n=== Summary (DRY-RUN) ===`);
    report(result);
    console.log(`\nDry-run only. Review the table above, then re-run with --apply to write.`);
    return;
  }

  let pass = 0;
  let totalWritten = 0;
  let last;
  while (pass < MAX_PASSES) {
    pass++;
    last = await scan();
    console.log(
      `pass ${pass}: scanned ${last.scanned}, pending ${last.pending.length}`,
    );
    if (last.pending.length === 0) break;
    totalWritten += await applyPending(last.pending);
  }

  // The loop above exits on the pass cap holding a PRE-apply scan; confirm the
  // final pass's writes landed before declaring anything.
  if (last.pending.length > 0) {
    last = await scan();
    console.log(`final scan: pending ${last.pending.length}`);
  }

  console.log(`\n=== Summary (APPLIED) ===`);
  console.log(`passes        : ${pass}`);
  console.log(`rows written  : ${totalWritten}`);
  report(last);

  if (last.pending.length > 0) {
    console.error(
      `\nStill ${last.pending.length} pending after ${MAX_PASSES} passes — a writer is ` +
        `racing this script faster than it converges. Re-run; if it persists, ` +
        `investigate before trusting archive membership.`,
    );
    process.exit(1);
  }
  console.log("\nConverged: a final scan found nothing pending.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
