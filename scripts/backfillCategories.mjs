/**
 * scripts/backfillCategories.mjs
 *
 * One-time backfill that deliberately overrides the cron's NULL-only write
 * guard for the `products.category` column. Reads every product, re-runs
 * assignCategory() against its current name/title/brand, and writes any row
 * where the computed value disagrees with the stored value.
 *
 * The cron's NULL-only invariant (app/api/cron/route.js) is NOT touched —
 * this is a one-off historical data correction, not a behaviour change for
 * ongoing syncs.
 *
 * Safety:
 *   - Defaults to dry-run. You must pass --write to actually mutate the DB.
 *   - Prints a summary of every old → new transition plus counts.
 *   - Use --verbose to dump every row that would change.
 *
 * Scoped repair mode (--only-null):
 *   The full-table mode above is a rewrite: it re-classifies WITHOUT
 *   productType (the cron had it at sync time) and overwrites any
 *   disagreement, so it can flip currently-valid categories to a different
 *   value or to NULL. `--only-null` is the repair the formatting audit needs:
 *   it scans only rows whose category IS NULL and carries a compare-and-set
 *   predicate (`.is("category", null)`) on every UPDATE, so a row another
 *   process changed mid-run is never clobbered. Rollback is then trivial —
 *   every touched row's prior value was NULL, and the id list is printed.
 *
 * Usage:
 *   node scripts/backfillCategories.mjs                   # dry-run (default)
 *   node scripts/backfillCategories.mjs --only-null       # dry-run, NULL rows only
 *   node scripts/backfillCategories.mjs --only-null --write
 *   node scripts/backfillCategories.mjs --limit=500       # scan 500 rows only
 *   node scripts/backfillCategories.mjs --verbose         # print every row
 *   node scripts/backfillCategories.mjs --write           # commit to DB
 *   node scripts/backfillCategories.mjs --write --verbose
 *
 * Env resolution: the script searches for .env.local in (1) the script's
 * project root, (2) the main repo root when running from a git worktree
 * (resolved via `git rev-parse --git-common-dir`), and (3) the current
 * working directory. Override explicitly with:
 *   node scripts/backfillCategories.mjs --env-file=/abs/path/to/.env.local
 *
 * Note: `product_type` is not stored in the products table, so the backfill
 * runs assignCategory() with productType absent. The new classifier tolerates
 * this and relies on title + brand-stripped name. Any row whose category was
 * originally derived from a productType token that isn't present in the
 * title/name today will likely transition to a different category or null —
 * that is the intended correction.
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ────────────────────────────────────────────────────────────────
// Parsed before env-file resolution so --env-file= can override discovery.
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const WRITE = args.has("--write");
const ONLY_NULL = args.has("--only-null");
const VERBOSE = args.has("--verbose");
const limitArg = rawArgs.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.slice("--limit=".length), 10) : null;
const envFileArg = rawArgs.find((a) => a.startsWith("--env-file="));
const ENV_FILE_OVERRIDE = envFileArg ? envFileArg.slice("--env-file=".length) : null;

if (limitArg && (Number.isNaN(LIMIT) || LIMIT <= 0)) {
  console.error(`Invalid --limit value: ${limitArg}`);
  process.exit(1);
}

// ── Env-file discovery ──────────────────────────────────────────────────────
// Git worktrees don't copy gitignored files, so when this script runs from
// .claude/worktrees/<name>/ the worktree has no .env.local of its own. Walk
// out to the main repo (via `git rev-parse --git-common-dir`) and look there.
// Operator can always override with --env-file=/abs/path.
function resolveEnvFile() {
  if (ENV_FILE_OVERRIDE) {
    if (!existsSync(ENV_FILE_OVERRIDE)) {
      console.error(`--env-file path does not exist: ${ENV_FILE_OVERRIDE}`);
      process.exit(1);
    }
    return ENV_FILE_OVERRIDE;
  }

  const candidates = [];

  // 1) The project root that owns this script (works for main checkout).
  candidates.push(join(__dirname, "../.env.local"));

  // 2) Main repo root when running from a git worktree. --git-common-dir
  //    points to the shared .git; its parent is the primary working tree.
  try {
    const commonDir = execSync("git rev-parse --git-common-dir", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (commonDir) {
      const absCommon = commonDir.startsWith("/") ? commonDir : join(__dirname, commonDir);
      candidates.push(join(dirname(absCommon), ".env.local"));
    }
  } catch {
    // Not a git checkout — skip.
  }

  // 3) Current working directory, in case the operator cd'd into the main repo.
  candidates.push(join(process.cwd(), ".env.local"));

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }

  console.error("Could not find .env.local. Searched:");
  for (const c of candidates) console.error(`  - ${c}`);
  console.error("\nFixes:");
  console.error("  - Pass --env-file=/absolute/path/to/.env.local");
  console.error("  - Or run this script from the main repo:");
  console.error("      cd ~/archiveapp && node .claude/worktrees/<name>/scripts/backfillCategories.mjs");
  process.exit(1);
}

const ENV_FILE = resolveEnvFile();
dotenv.config({ path: ENV_FILE });
console.log(`Loaded env from: ${ENV_FILE}\n`);

// Sanity-check the keys we actually need. Fail fast with a clear message
// instead of bubbling "supabaseUrl is required" from inside createClient().
for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key} (looked in ${ENV_FILE})`);
    process.exit(1);
  }
}

// Dynamic imports AFTER dotenv.config() — app/lib/supabase.js reads env vars
// at module init, so it must be loaded once process.env is populated.
const { assignCategory } = await import("../app/lib/stores.js");
const { supabaseAdmin } = await import("../app/lib/supabase.js");

const PAGE = 1000;
const BATCH_UPDATE = 200;

// Normalise labels so "Bottoms" vs null vs undefined vs "" compare cleanly.
const norm = (v) => (v == null || v === "" ? null : String(v));
const label = (v) => v ?? "∅ (null)";
const transitionKey = (oldCat, newCat) => `${label(oldCat)}  →  ${label(newCat)}`;

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("──────────────────────────────────────────────");
  console.log("  backfillCategories.mjs");
  console.log("──────────────────────────────────────────────");
  console.log(`  mode:    ${WRITE ? "\x1b[33mWRITE\x1b[0m (will update DB)" : "\x1b[32mdry-run\x1b[0m (no writes)"}`);
  console.log(`  limit:   ${LIMIT ?? "(no limit — full table)"}`);
  console.log(`  verbose: ${VERBOSE}`);
  console.log(`  scope:   ${ONLY_NULL ? "--only-null (rows with category IS NULL)" : "\x1b[33mFULL TABLE\x1b[0m (can rewrite valid categories)"}`);
  console.log("──────────────────────────────────────────────\n");

  if (!WRITE) {
    console.log("Dry-run — no changes will be written. Re-run with --write to commit.\n");
  }

  // Phase 1: scan + classify ────────────────────────────────────────────────
  const transitions = new Map(); // "old → new" → count
  const changes = [];

  let scanned = 0;
  let from = 0;

  while (true) {
    const remaining = LIMIT == null ? PAGE : LIMIT - scanned;
    if (remaining <= 0) break;
    const rangeSize = Math.min(PAGE, remaining);

    let query = supabaseAdmin
      .from("products")
      .select("id, handle, store_domain, name, title, brand, category, description, editorial_description")
      .order("id", { ascending: true })
      .range(from, from + rangeSize - 1);
    if (ONLY_NULL) query = query.is("category", null);

    const { data, error } = await query;

    if (error) {
      console.error("Fetch error:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      const oldCat = norm(row.category);
      // assignCategory now returns { category, subcategory }; this script
      // only updates the parent category column, so we destructure category.
      const { category } = assignCategory({
        // productType is deliberately omitted — not stored in the DB.
        name: row.name,
        title: row.title,
        brand: row.brand,
        description: row.description,
        editorial_description: row.editorial_description,
      });
      const newCat = norm(category);

      if (oldCat !== newCat) {
        changes.push({
          id: row.id,
          handle: row.handle,
          store_domain: row.store_domain,
          name: row.name,
          title: row.title,
          oldCat,
          newCat,
        });
        const key = transitionKey(oldCat, newCat);
        transitions.set(key, (transitions.get(key) ?? 0) + 1);
      }
    }

    scanned += data.length;
    from += data.length;
    console.log(`Scanned ${scanned} rows, ${changes.length} would change…`);

    if (data.length < rangeSize) break;
  }

  // Phase 2: report ─────────────────────────────────────────────────────────
  console.log("\n──────────────────────────────────────────────");
  console.log("  Scan complete");
  console.log("──────────────────────────────────────────────");
  console.log(`  Rows scanned:   ${scanned}`);
  console.log(`  Rows to change: ${changes.length}`);
  console.log(`  No-change rows: ${scanned - changes.length}`);
  console.log("──────────────────────────────────────────────\n");

  if (transitions.size > 0) {
    console.log("Transitions (sorted by frequency):");
    const sorted = [...transitions.entries()].sort((a, b) => b[1] - a[1]);
    for (const [key, count] of sorted) {
      console.log(`  ${String(count).padStart(6)}  ${key}`);
    }
    console.log();
  }

  if (changes.length > 0) {
    if (VERBOSE) {
      console.log(`All ${changes.length} row-level changes:`);
      for (const c of changes) {
        const display = c.title || c.name || "(no title/name)";
        console.log(
          `  [${c.store_domain}/${c.handle}] ${JSON.stringify(display)} :: ${label(c.oldCat)} → ${label(c.newCat)}`,
        );
      }
      console.log();
    } else {
      console.log("Sample of first 15 changes (use --verbose to see all):");
      for (const c of changes.slice(0, 15)) {
        const display = c.title || c.name || "(no title/name)";
        console.log(
          `  [${c.store_domain}/${c.handle}] ${JSON.stringify(display)} :: ${label(c.oldCat)} → ${label(c.newCat)}`,
        );
      }
      if (changes.length > 15) {
        console.log(`  … and ${changes.length - 15} more.`);
      }
      console.log();
    }
  }

  // Phase 3: write (only when --write is set) ───────────────────────────────
  if (!WRITE) {
    console.log("\x1b[32mDry-run complete. No rows were modified.\x1b[0m");
    console.log("Re-run with --write to apply these changes.");
    return;
  }

  if (changes.length === 0) {
    console.log("Nothing to write.");
    return;
  }

  console.log(`\nWriting ${changes.length} updates…`);

  // Group by target category so each UPDATE sets a single value across many ids.
  const byNewCat = new Map();
  for (const c of changes) {
    const key = c.newCat; // may be null
    if (!byNewCat.has(key)) byNewCat.set(key, []);
    byNewCat.get(key).push(c.id);
  }

  let written = 0;
  const writtenIds = [];

  for (const [newCat, ids] of byNewCat) {
    let groupWritten = 0;
    for (let i = 0; i < ids.length; i += BATCH_UPDATE) {
      const slice = ids.slice(i, i + BATCH_UPDATE);
      // Compare-and-set in --only-null mode: the row must STILL be NULL for
      // the write to land. Without it a row enriched between the scan and the
      // write would be silently overwritten by a stale classification.
      let update = supabaseAdmin
        .from("products")
        .update({ category: newCat })
        .in("id", slice);
      if (ONLY_NULL) update = update.is("category", null);

      // .select("id") returns the rows the UPDATE actually touched. A CAS-
      // skipped row (enriched between scan and write) matches zero rows but
      // still reports error: null — counting the requested slice would put
      // never-written ids into the rollback list, and rolling those back to
      // NULL would erase a concurrently written category.
      const { data: updated, error } = await update.select("id");

      if (error) {
        // Abort rather than continue: a partial write across category groups
        // leaves the table in a state neither the report nor the printed id
        // list describes, and the operator cannot tell what to roll back.
        console.error(`Update failed (category=${label(newCat)}, ${slice.length} ids):`, error.message);
        console.error(`Aborting after ${written} successful writes. Ids written so far:`);
        console.error(JSON.stringify(writtenIds));
        process.exit(1);
      }
      const landedIds = (updated ?? []).map((r) => r.id);
      written += landedIds.length;
      groupWritten += landedIds.length;
      writtenIds.push(...landedIds);
      if (landedIds.length < slice.length) {
        console.log(
          `  (${slice.length - landedIds.length} of ${slice.length} skipped by compare-and-set — concurrently populated)`,
        );
      }
    }
    console.log(`  ${label(newCat).padEnd(22)}  wrote ${groupWritten}/${ids.length}`);
  }

  console.log("\n──────────────────────────────────────────────");
  console.log("  Write complete");
  console.log("──────────────────────────────────────────────");
  console.log(`  Written: ${written}`);
  console.log("──────────────────────────────────────────────");
  // Rollback input. In --only-null mode every one of these rows was NULL
  // before the run, so the undo is a single scoped UPDATE back to NULL.
  console.log("\nIds written (rollback input):");
  console.log(JSON.stringify(writtenIds));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
