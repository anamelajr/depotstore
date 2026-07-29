#!/usr/bin/env node
// One-off backfill for docs/plan-season-code-standardization.md.
//
// Converges existing product titles on the house season-code form — uppercase
// prefix, 2-digit year, split years on a slash, decade markers lowercase —
// by applying app/lib/seasonCodes.js to titles already in the table.
//
// SAFETY MODEL:
//   - This is a SANCTIONED EXCEPTION to CLAUDE.md's write-once editorial rule.
//     It is narrow by construction: the only value ever written is
//     normalizeSeasonCodes(existing title). Nothing is regenerated, no OpenAI
//     call is made, and a NULL title is never filled in.
//   - The transform is pure, deterministic and idempotent, so unlike
//     backfillTitleClean.mjs this needs no frozen snapshot: the dry-run table
//     IS the apply set, and re-running after drift is a no-op by definition.
//   - Each write is a compare-and-swap (.eq("title", oldTitle)) so a manual
//     fix or a concurrent enrich landing between the read and the write
//     updates zero rows instead of clobbering.
//   - Rows whose season token is malformed beyond deterministic repair
//     (SS19999, A2013, FW90s) are fixed points of the normalizer — the
//     `proposed !== current` guard means they can never be written. Pinned by
//     the zero-write contract tests in app/lib/__tests__/seasonCodes.test.js.
//
// Usage (run from the repo root, where .env.local lives):
//   node scripts/backfillSeasonCodes.mjs              # dry-run (default, no writes)
//   node scripts/backfillSeasonCodes.mjs --apply      # perform writes
//   node scripts/backfillSeasonCodes.mjs --env <path> # override .env.local location

import * as dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { normalizeSeasonCodes, manualReviewFlags } from "../app/lib/seasonCodes.js";

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

async function fetchAllRows() {
  const PAGE = 1000;
  let from = 0;
  const rows = [];
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("id, title, store_domain")
      .not("title", "is", null)
      // Stable key before paging: without ORDER BY, Postgres gives no
      // cross-page order guarantee, so a concurrent sync write between
      // .range() calls can shift a boundary row and the scan skips it.
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Fetch error: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// Which normalization a row is getting — report-only, so the operator can scan
// ~2,600 diffs by class instead of line by line.
function classify(oldTitle, newTitle) {
  const classes = [];
  if (/\b(?:FW|SS|AW)(?:19|20)\d{2}/i.test(oldTitle)) classes.push("year_4to2");
  if (/(^|[\s(])[FSA]\s*\/\s*[WS]/i.test(oldTitle)) classes.push("letter_slash");
  if (/\b(?:Fall|Autumn|Spring)\b/i.test(oldTitle)) classes.push("spelled_out");
  if (/\b(?:19|20)\d0S\b/.test(oldTitle)) classes.push("decade_S");
  if (/\b(?:FW|SS|AW)\s+\d{2,4}\b/i.test(oldTitle)) classes.push("spaced_code");
  if (/-\d{2,4}\b/.test(oldTitle) && /\//.test(newTitle)) classes.push("dash_to_slash");
  const oldPrefix = oldTitle.match(/\b([FfSsAa][WwSs])\d/);
  if (oldPrefix && oldPrefix[1] !== oldPrefix[1].toUpperCase()) classes.push("miscased");
  return classes.length ? classes.join("+") : "other";
}

(async () => {
  console.log(`Mode: ${APPLY ? "APPLY (writes enabled)" : "DRY-RUN (no writes)"}\n`);
  console.log("Paginating products...");
  const rows = await fetchAllRows();
  console.log(`Scanned ${rows.length} rows with a non-null title.\n`);

  const counts = { write: 0, unchanged: 0, cas_noop: 0, error: 0 };
  const byClass = new Map();
  const review = [];

  console.log(["id", "store_domain", "class", "old_title", "new_title"].join("\t"));
  for (const row of rows) {
    const flags = manualReviewFlags(row.title);
    if (flags.length) review.push({ ...row, flags });

    const proposed = normalizeSeasonCodes(row.title);
    if (proposed === row.title) {
      counts.unchanged++;
      continue;
    }

    const cls = classify(row.title, proposed);
    byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
    console.log(
      `${row.id}\t${row.store_domain}\t${cls}\t${JSON.stringify(row.title)}\t${JSON.stringify(proposed)}`,
    );

    if (!APPLY) {
      counts.write++;
      continue;
    }
    const { data, error } = await supabaseAdmin
      .from("products")
      .update({ title: proposed })
      .eq("id", row.id)
      .eq("title", row.title) // compare-and-swap: don't clobber a manual fix
      .select("id");
    if (error) {
      counts.error++;
      console.log(`  -> ERROR id=${row.id}: ${error.message}`);
    } else if (!data || data.length === 0) {
      counts.cas_noop++;
      console.log(`  -> CAS no-op id=${row.id} (title drifted; re-run picks it up)`);
    } else {
      counts.write++;
    }
  }

  console.log(`\n=== Manual review (${review.length}) — reported, never auto-repaired ===`);
  console.log(["id", "store_domain", "flags", "title"].join("\t"));
  for (const r of review) {
    console.log(`${r.id}\t${r.store_domain}\t${r.flags.join(",")}\t${JSON.stringify(r.title)}`);
  }
  console.log(
    "\nseason_not_first rows DO receive the in-place format fix above " +
      "(deterministic, word order untouched) and are listed here only so the " +
      "position can be judged by hand. The other classes are fixed points of " +
      "the normalizer — they are never written.",
  );

  console.log(`\n=== Changes by class ===`);
  for (const [cls, n] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(5)}  ${cls}`);
  }

  console.log(`\n=== Summary (${APPLY ? "APPLIED" : "DRY-RUN"}) ===`);
  console.log(`scanned       : ${rows.length}`);
  console.log(`${APPLY ? "written       " : "would write   "}: ${counts.write}`);
  console.log(`unchanged     : ${counts.unchanged}`);
  if (APPLY) console.log(`cas no-op     : ${counts.cas_noop}`);
  if (APPLY) console.log(`error         : ${counts.error}`);
  console.log(`manual review : ${review.length}`);
  if (!APPLY) {
    console.log(`\nDry-run only. Review the table above, then re-run with --apply to write.`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
