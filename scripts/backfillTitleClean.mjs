#!/usr/bin/env node
// One-off Track-2 backfill for docs/plan-title-cleaning-fix.md.
//
// Re-cleans the over-compressed product titles (single-word title from a
// >=4-word source name) that the tightened cleanTitle prompt can now enrich
// with a distinguishing detail. Title-only writes — brand / category /
// enrich_attempts are never touched.
//
// SAFETY MODEL (mirrors /api/enrich's service-role write path):
//   - Blast radius is the FROZEN snapshot in
//     docs/snapshots/2026-06-01-title-backfill-targets.json. The write set is
//     `frozen snapshot ids ∩ current bucket-2 predicate` — never the live
//     predicate alone. Drift ADDITIONS (predicate match absent from the
//     snapshot) are logged and NOT written; REMOVALS just fall out.
//   - Each write is a compare-and-swap: .eq("title", oldTitle) guards a manual
//     fix, .eq("name", oldName) guards a mid-run Shopify re-sync landing a
//     title computed from a stale name. Either mismatch updates zero rows.
//   - newTitle binds as a JS-client parameter, never interpolated into SQL.
//   - The dry-run and the apply iterate the SAME frozen id list, so the review
//     table is exactly what the apply can write (no TOCTOU window).
//
// Usage (run from the repo root, where .env.local lives):
//   node scripts/backfillTitleClean.mjs                 # dry-run (default, no writes)
//   node scripts/backfillTitleClean.mjs --apply         # perform writes
//   node scripts/backfillTitleClean.mjs --validate      # prompt spot-check, no DB writes
//   node scripts/backfillTitleClean.mjs --env <path>    # override .env.local location

import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const VALIDATE = argv.includes("--validate");
const envIdx = argv.indexOf("--env");
const ENV_PATH = envIdx !== -1 ? argv[envIdx + 1] : join(__dirname, "../.env.local");

dotenv.config({ path: ENV_PATH });

// Import AFTER dotenv so cleanTitle reads OPENAI_API_KEY at call time.
const { cleanTitle } = await import("../app/lib/cleanTitle.js");
const { titleContainsAllowedBrand } = await import("../app/lib/brand.js");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(`Missing Supabase env in ${ENV_PATH} (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)`);
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error(`Missing OPENAI_API_KEY in ${ENV_PATH} — every cleanTitle would return null (silent all-skip).`);
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

const SNAPSHOT_PATH = join(__dirname, "../docs/snapshots/2026-06-01-title-backfill-targets.json");
const CALL_DELAY_MS = 300; // pace sequential OpenAI calls to avoid 429s eating the run as skips

const wordCount = (s) => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bucket-2 predicate (mirror of the diagnostic SQL), evaluated in JS:
//   available AND NOT hidden AND title IS NOT NULL
//   AND single-word title AND >=4-word source name.
function matchesBucket2(row) {
  return (
    row.available === true &&
    row.hidden === false &&
    row.title != null &&
    wordCount(row.title) === 1 &&
    wordCount(row.name) >= 4
  );
}

async function fetchAllRows() {
  const PAGE = 1000;
  let from = 0;
  const rows = [];
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("id, name, title, description, store_domain, available, hidden")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Fetch error: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function runValidate() {
  // Prompt spot-check (advisor's gate): positive controls + sparse + good
  // multi-word titles. No DB writes. Confirms the tightened prompt RETAINS a
  // real detail, does NOT INVENT one, and does NOT regress good titles.
  const sparseControls = [
    { name: "ACNE STUDIOS - Sweater", description: "", expect: "sparse → stays ~1 word, no invented detail" },
  ];
  console.log("=== Prompt validation: positive controls (over-compressed, expect richer) ===");
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  const sampleIds = snapshot.bucket2_ids.slice(0, 12);
  const { data: sampleRows, error } = await supabaseAdmin
    .from("products")
    .select("id, name, title, description, store_domain")
    .in("id", sampleIds);
  if (error) throw new Error(error.message);
  for (const r of sampleRows) {
    const out = await cleanTitle({ name: r.name, rawDescription: r.description });
    console.log(
      `id=${r.id} [${r.store_domain}]\n  name : ${r.name}\n  old  : ${JSON.stringify(r.title)}\n  new  : ${out ? JSON.stringify(out.title) : "NULL"}`
    );
    await sleep(CALL_DELAY_MS);
  }
  console.log("\n=== Sparse controls (expect ~1 word, NO invented detail) ===");
  for (const c of sparseControls) {
    const out = await cleanTitle({ name: c.name, rawDescription: c.description });
    console.log(`  name : ${c.name}\n  new  : ${out ? JSON.stringify(out.title) : "NULL"}   (${c.expect})`);
    await sleep(CALL_DELAY_MS);
  }
  console.log("\n=== Good multi-word titles (regression: expect unchanged / no invention) ===");
  const { data: goodRows, error: goodErr } = await supabaseAdmin
    .from("products")
    .select("id, name, title, description, store_domain")
    .eq("available", true)
    .eq("hidden", false)
    .not("title", "is", null)
    .limit(400);
  if (goodErr) throw new Error(goodErr.message);
  const goodSample = goodRows.filter((r) => wordCount(r.title) >= 2 && wordCount(r.title) <= 7).slice(0, 8);
  for (const r of goodSample) {
    const out = await cleanTitle({ name: r.name, rawDescription: r.description });
    console.log(
      `id=${r.id} [${r.store_domain}]\n  name : ${r.name}\n  old  : ${JSON.stringify(r.title)}\n  new  : ${out ? JSON.stringify(out.title) : "NULL"}`
    );
    await sleep(CALL_DELAY_MS);
  }
}

async function runBackfill() {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  const frozenIds = new Set(snapshot.bucket2_ids);
  console.log(`Frozen snapshot: ${frozenIds.size} bucket-2 ids (${snapshot.snapshot_date}).`);
  console.log(`Mode: ${APPLY ? "APPLY (writes enabled)" : "DRY-RUN (no writes)"}\n`);

  console.log("Paginating products to re-derive the live bucket-2 predicate...");
  const allRows = await fetchAllRows();
  const byId = new Map(allRows.map((r) => [r.id, r]));
  const livePredicateIds = new Set(allRows.filter(matchesBucket2).map((r) => r.id));
  console.log(`Scanned ${allRows.length} rows; ${livePredicateIds.size} match the live predicate.`);

  // Bound the write set to frozen ∩ live-predicate. Report drift.
  const writeSetIds = [...frozenIds].filter((id) => livePredicateIds.has(id)).sort((a, b) => a - b);
  const additions = [...livePredicateIds].filter((id) => !frozenIds.has(id)).sort((a, b) => a - b);
  const removals = [...frozenIds].filter((id) => !livePredicateIds.has(id)).sort((a, b) => a - b);

  console.log(`\nWrite set (frozen ∩ predicate): ${writeSetIds.length}`);
  console.log(`Drift — additions (predicate match NOT in snapshot, LOGGED not written): ${additions.length}`);
  if (additions.length) console.log(`  ${JSON.stringify(additions)}`);
  console.log(`Drift — removals (snapshot id no longer matching — fixed/hidden/sold): ${removals.length}`);
  if (removals.length) console.log(`  ${JSON.stringify(removals)}\n`);

  const reasons = { write: 0, openai_null: 0, le1_word: 0, gt7_word: 0, unchanged: 0, brand_in_title: 0, missing_row: 0, cas_noop: 0, error: 0 };
  const header = ["id", "store_domain", "old_title", "proposed_title", "decision"];
  console.log(header.join("\t"));

  for (const id of writeSetIds) {
    const row = byId.get(id);
    if (!row) { reasons.missing_row++; console.log(`${id}\t?\t?\t?\tSKIP:missing_row`); continue; }

    let proposed;
    try {
      const out = await cleanTitle({ name: row.name, rawDescription: row.description });
      proposed = out?.title ?? null;
    } catch (e) {
      reasons.error++;
      console.log(`${id}\t${row.store_domain}\t${JSON.stringify(row.title)}\t-\tSKIP:error:${e.message}`);
      await sleep(CALL_DELAY_MS);
      continue;
    }

    let decision;
    if (proposed == null) decision = "SKIP:openai_null";        // transient failure OR echo/brand-leak guard reject
    else if (wordCount(proposed) <= 1) decision = "SKIP:le1_word"; // legitimately-sparse re-resolves to one word
    else if (wordCount(proposed) > 7) decision = "SKIP:gt7_word";  // cleanTitle caps at 7, defensive
    else if (proposed === row.title) decision = "SKIP:unchanged";
    // Anti-duplication guard: cleanTitle's brandInTitle check only compares the
    // RETURNED brand against the title, so a brand that isn't the one it
    // extracted (a collab partner, an era-designer like "Tom Ford" under a
    // "GUCCI" chip) can still leak into the title and duplicate the brand chip
    // on the card. titleContainsAllowedBrand checks the title against the whole
    // curated allowlist. Skipping keeps the row's existing valid 1-word title;
    // it falls to the recurring audit rather than getting a leaked rewrite.
    else if (titleContainsAllowedBrand(proposed)) decision = "SKIP:brand_in_title";
    else decision = "WRITE";

    console.log(`${id}\t${row.store_domain}\t${JSON.stringify(row.title)}\t${JSON.stringify(proposed ?? "")}\t${decision}`);

    if (decision === "WRITE") {
      if (APPLY) {
        const { data, error } = await supabaseAdmin
          .from("products")
          .update({ title: proposed })
          .eq("id", id)
          .eq("title", row.title) // compare-and-swap: don't clobber a manual fix
          .eq("name", row.name)   // stale-source guard: a mid-run re-sync no-ops
          .select("id, title");
        if (error) { reasons.error++; console.log(`  -> ERROR id=${id}: ${error.message}`); }
        else if (!data || data.length === 0) { reasons.cas_noop++; console.log(`  -> CAS no-op id=${id} (title/name drifted; re-run picks it up)`); }
        else { reasons.write++; }
      } else {
        reasons.write++;
      }
    } else {
      reasons[decision.split(":")[1]]++;
    }
    await sleep(CALL_DELAY_MS);
  }

  console.log(`\n=== Summary (${APPLY ? "APPLIED" : "DRY-RUN"}) ===`);
  console.log(`write           : ${reasons.write}${APPLY ? " (rows updated)" : " (would write)"}`);
  console.log(`skip openai_null: ${reasons.openai_null}`);
  console.log(`skip <=1 word   : ${reasons.le1_word}`);
  console.log(`skip >7 word    : ${reasons.gt7_word}`);
  console.log(`skip unchanged  : ${reasons.unchanged}`);
  console.log(`skip brand-leak : ${reasons.brand_in_title}`);
  if (APPLY) console.log(`cas no-op       : ${reasons.cas_noop}`);
  console.log(`missing row     : ${reasons.missing_row}`);
  console.log(`error           : ${reasons.error}`);
  if (!APPLY) console.log(`\nDry-run only. Review the table above, then re-run with --apply to write.`);
  if (reasons.openai_null > 0)
    console.log(`\nNOTE: ${reasons.openai_null} openai_null skips. If this is unexpectedly high, OpenAI may be failing wholesale (key/429/timeout) — every failure looks like a legitimate skip. Verify positive controls produced richer titles before trusting a low write count.`);
}

(async () => {
  try {
    if (VALIDATE) await runValidate();
    else await runBackfill();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
