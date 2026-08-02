#!/usr/bin/env node
// One-off backfill for docs/plan-title-brand-formatting-repair.md, Phase B2.
//
// Repairs the two MECHANICAL title classes the 2026-08-01 audit found — the
// ones whose correct output is derivable from the existing title alone:
//
//   season_not_first     "Top - FW10"      -> "FW10 Top"
//                        "Silk Dress - SS07" -> "SS07 Silk Dress"
//   lowercase_after_slash "Wool/silk Coat" -> "Wool/Silk Coat"
//
// Everything else the audit flagged (brand leaks, sub-line dashes, trailing
// "By", free-form junk) is NOT repairable from the title — it needs the raw
// name and the model — and is handled by B3's NULL-out + re-enrich instead.
//
// SAFETY MODEL — same as scripts/backfillSeasonCodes.mjs:
//   - SANCTIONED EXCEPTION to CLAUDE.md's write-once editorial rule, narrow by
//     construction: the only value ever written is a pure function of the
//     title already in the row. No OpenAI call, no NULL title ever filled in.
//   - The transform composes the SAME helpers the enrich fallback path uses
//     (app/lib/handleFallback.js) — no second source of truth.
//   - Pure, deterministic, idempotent: the dry-run table IS the apply set, and
//     re-running is a no-op by definition (Phase C step 2 asserts exactly that).
//   - Every write is a compare-and-swap (.eq("title", oldTitle)) so a manual
//     fix or a concurrent enrich landing between read and write updates zero
//     rows instead of clobbering.
//   - Titles that leak a brand name are SKIPPED, not repaired: reordering a
//     season code inside "Ysl Logo Bag" would only make junk look canonical.
//     They are reported for B3.
//
// Usage (run from the repo root, where .env.local lives):
//   node scripts/backfillTitleRepairs.mjs              # dry-run (default, no writes)
//   node scripts/backfillTitleRepairs.mjs --apply      # perform writes
//   node scripts/backfillTitleRepairs.mjs --env <path> # override .env.local location

import * as dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { seasonToFront, toTitleCase } from "../app/lib/handleFallback.js";
import { titleLeaksAllowedBrandStrict } from "../app/lib/brand.js";

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

// Rows Phase B3 resets (title -> NULL, re-enrich) or holds for manual review,
// per scripts/sql/2026-08-01-b3-title-resets.sql. They are excluded HERE, not
// there, because B2 runs first: a mechanical repair would rewrite the title
// that B3's compare-and-swap keys on, and B3 would then correctly refuse to
// touch the row — leaving junk in place and reporting a phantom drift. Several
// of these ARE season_not_first or lowercase_after_slash, so without this list
// the overlap is silent. The brand-leak skip below cannot cover them: junk like
// "Christian SS02 …", "Boutique FW96 …" or "Shorts - Red" leaks no allowlisted
// brand at all.
const B3_RESERVED_IDS = new Set([
  196847, 831252, 833406, 5858170, 12744024, 13346293, 13971162, 13993204,
  14020121, 14174538, 14372804, 14534806, 14880839, 14880893, 14881061,
  14937632, 14940924, 14940972, 14941022, 14941257, 14941258, 14941259,
  14941262, 14941264, 14941265, 14941266, 14941267, 14941270, 14941271,
  14941964, 14941965, 14942261, 14943013, 14943586, 14948244, 14953917,
  15239796, 15462611, 15481896, 15897474, 15898105, 15960225, 15982546,
  15982547, 15982548, 15987259, 15987261, 16231010, 16459500,
]);

// Token-local slash casing. toTitleCase on the WHOLE title would re-case
// everything — "MM6" → "Mm6", "B23" → "B23" but "iPhone"-style tokens too — so
// only tokens that actually exhibit the lowercase-after-slash defect are
// rewritten, and each is run through the same toTitleCase the fallback uses
// (which returns early for every season-code shape, so "FW02/03" is untouched).
const LOWER_AFTER_SLASH = /[A-Za-z]\/[a-z]/;

function fixSlashCasing(title) {
  return title
    .split(/(\s+)/)
    .map((token) => (LOWER_AFTER_SLASH.test(token) ? toTitleCase(token) : token))
    .join("");
}

// The full B2 transform. Order matters only in that seasonToFront may move a
// token whose casing fixSlashCasing then normalizes; both are idempotent.
function repairTitle(title) {
  return fixSlashCasing(seasonToFront(title));
}

async function fetchAllRows() {
  const PAGE = 1000;
  let from = 0;
  const rows = [];
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("id, brand, title, store_domain")
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

function classify(oldTitle) {
  const classes = [];
  if (seasonToFront(oldTitle) !== oldTitle) classes.push("season_to_front");
  if (fixSlashCasing(oldTitle) !== oldTitle) classes.push("slash_casing");
  return classes.length ? classes.join("+") : "other";
}

(async () => {
  console.log(`Mode: ${APPLY ? "APPLY (writes enabled)" : "DRY-RUN (no writes)"}\n`);
  console.log("Paginating products...");
  const rows = await fetchAllRows();
  console.log(`Scanned ${rows.length} rows with a non-null title.\n`);

  const counts = {
    write: 0,
    unchanged: 0,
    cas_noop: 0,
    error: 0,
    skipped_leak: 0,
    skipped_b3: 0,
  };
  const byClass = new Map();
  const skipped = [];

  console.log(["id", "store_domain", "class", "old_title", "new_title"].join("\t"));
  for (const row of rows) {
    const proposed = repairTitle(row.title);
    if (proposed === row.title) {
      counts.unchanged++;
      continue;
    }

    if (B3_RESERVED_IDS.has(row.id)) {
      counts.skipped_b3++;
      skipped.push({ ...row, why: "b3_reserved" });
      continue;
    }

    // Brand-leak rows belong to B3, not here.
    if (titleLeaksAllowedBrandStrict(row.title)) {
      counts.skipped_leak++;
      skipped.push({ ...row, why: "brand_leak" });
      continue;
    }

    const cls = classify(row.title);
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

  console.log(
    `\n=== Skipped (${skipped.length}) — reserved for B3's NULL-out + re-enrich, never repaired here ===`,
  );
  console.log(["id", "store_domain", "why", "brand", "title"].join("\t"));
  for (const r of skipped) {
    console.log(`${r.id}\t${r.store_domain}\t${r.why}\t${r.brand}\t${JSON.stringify(r.title)}`);
  }

  console.log(`\n=== Changes by class ===`);
  for (const [cls, n] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(5)}  ${cls}`);
  }

  console.log(`\n=== Summary (${APPLY ? "APPLIED" : "DRY-RUN"}) ===`);
  console.log(`scanned       : ${rows.length}`);
  console.log(`${APPLY ? "written       " : "would write   "}: ${counts.write}`);
  console.log(`unchanged     : ${counts.unchanged}`);
  console.log(`skipped (leak): ${counts.skipped_leak}`);
  console.log(`skipped (B3)  : ${counts.skipped_b3}`);
  if (APPLY) console.log(`cas no-op     : ${counts.cas_noop}`);
  if (APPLY) console.log(`error         : ${counts.error}`);
  if (!APPLY) {
    console.log(`\nDry-run only. Review the table above, then re-run with --apply to write.`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
