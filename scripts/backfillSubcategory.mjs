#!/usr/bin/env node
// Dry-run subcategory backfill. Reads every Tops / Jackets & Coats /
// Bags & Accessories row from Supabase, runs the new assignCategory()
// against the row's existing fields, and prints a distribution report.
//
// Usage:
//   node scripts/backfillSubcategory.mjs                  # report only
//   node scripts/backfillSubcategory.mjs --emit-sql FILE  # write wet-backfill SQL

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { assignCategory } from "../app/lib/stores.js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const args = process.argv.slice(2);
const emitSqlIdx = args.indexOf("--emit-sql");
const sqlOutPath = emitSqlIdx >= 0 ? args[emitSqlIdx + 1] : null;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

const TARGET_CATEGORIES = ["Tops", "Jackets & Coats", "Bags & Accessories"];

async function fetchAll() {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  const colsWithSub = "id, store_domain, handle, name, title, brand, category, description, editorial_description, subcategory";
  const colsNoSub   = "id, store_domain, handle, name, title, brand, category, description, editorial_description";
  let selectCols = colsWithSub;
  while (true) {
    const { data, error } = await supabase
      .from("products")
      .select(selectCols)
      .eq("available", true)
      .eq("hidden", false)
      .in("category", TARGET_CATEGORIES)
      .range(from, from + pageSize - 1)
      .order("id", { ascending: true });
    if (error) {
      if (error.message?.includes("subcategory") && selectCols === colsWithSub) {
        selectCols = colsNoSub;
        continue;
      }
      console.error("Supabase error:", error.message);
      process.exit(1);
    }
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function classifyRow(row) {
  return assignCategory({
    title: row.title,
    name: row.name,
    brand: row.brand,
    description: row.description,
    editorial_description: row.editorial_description,
  });
}

function bucket(rows) {
  const dist = {};
  const byStore = {};
  const detail = [];

  for (const row of rows) {
    const { category, subcategory } = classifyRow(row);
    const reportedParent = category ?? "(null)";
    const leaf = subcategory ?? null;
    dist[reportedParent] ??= {};
    dist[reportedParent][leaf ?? "null"] = (dist[reportedParent][leaf ?? "null"] ?? 0) + 1;
    byStore[row.store_domain] ??= {};
    byStore[row.store_domain][reportedParent] ??= {};
    byStore[row.store_domain][reportedParent][leaf ?? "null"] =
      (byStore[row.store_domain][reportedParent][leaf ?? "null"] ?? 0) + 1;
    detail.push({
      id: row.id,
      store_domain: row.store_domain,
      handle: row.handle,
      name: row.name,
      title: row.title,
      current_category: row.category,
      current_subcategory: row.subcategory ?? null,
      proposed_parent: category,
      proposed_subcategory: subcategory,
    });
  }
  return { dist, byStore, detail };
}

function printDistribution(dist) {
  console.log("\n=== Distribution by proposed parent / leaf ===");
  for (const parent of Object.keys(dist).sort()) {
    const sub = dist[parent];
    const total = Object.values(sub).reduce((a, b) => a + b, 0);
    console.log(`\n${parent}  (n=${total})`);
    for (const leaf of Object.keys(sub).sort()) {
      console.log(`  ${leaf.padEnd(24)}  ${sub[leaf]}`);
    }
  }
}

function printPerStore(byStore) {
  console.log("\n=== Distribution by store ===");
  for (const store of Object.keys(byStore).sort()) {
    console.log(`\n${store}`);
    const parents = byStore[store];
    for (const parent of Object.keys(parents).sort()) {
      const total = Object.values(parents[parent]).reduce((a, b) => a + b, 0);
      console.log(`  ${parent}  (n=${total})`);
      for (const leaf of Object.keys(parents[parent]).sort()) {
        console.log(`    ${leaf.padEnd(22)}  ${parents[parent][leaf]}`);
      }
    }
  }
}

function printSamples(detail) {
  const byLeaf = {};
  for (const d of detail) {
    const k = `${d.proposed_parent ?? "(null)"}::${d.proposed_subcategory ?? "null"}`;
    byLeaf[k] ??= [];
    byLeaf[k].push(d);
  }
  console.log("\n=== Random samples ===");
  for (const key of Object.keys(byLeaf).sort()) {
    const rows = byLeaf[key];
    const isNullLeaf = key.endsWith("::null");
    const n = isNullLeaf ? 20 : 10;
    const sample = [...rows].sort(() => Math.random() - 0.5).slice(0, n);
    console.log(`\n  ${key}  (showing ${sample.length} of ${rows.length})`);
    for (const r of sample) {
      console.log(`    ${r.store_domain.padEnd(28)} ${r.handle.slice(0, 50).padEnd(52)} title="${r.title ?? ""}"`);
    }
  }
}

function emitSql(detail, path) {
  const groups = {};
  const crossCategory = [];
  for (const d of detail) {
    if (!d.proposed_subcategory) continue;
    // The CHECK constraint requires subcategory to match current category's leaves.
    // Skip cross-category re-classifications — they signal a wrong existing parent
    // (e.g. a Scarf currently in Tops). Those need separate review, not a silent reparent.
    if (d.proposed_parent !== d.current_category) {
      crossCategory.push(d);
      continue;
    }
    groups[d.proposed_subcategory] ??= [];
    groups[d.proposed_subcategory].push(d.id);
  }
  const lines = [
    "-- Wet backfill: subcategory assignments computed " + new Date().toISOString(),
    "BEGIN;",
    "",
    "-- Snapshot for rollback",
    "CREATE TABLE IF NOT EXISTS products_subcategory_backfill_snapshot AS",
    "  SELECT id, category, subcategory FROM products",
    "  WHERE category IN ('Tops','Jackets & Coats','Bags & Accessories');",
    "",
  ];
  for (const leaf of Object.keys(groups).sort()) {
    const ids = groups[leaf];
    const chunkSize = 500;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      lines.push(`UPDATE products SET subcategory = '${leaf}' WHERE id IN (${chunk.join(",")});`);
    }
  }
  lines.push("", "COMMIT;");
  writeFileSync(path, lines.join("\n") + "\n");
  const updated = Object.values(groups).flat().length;
  console.log(`\nWet-backfill SQL written to ${path}`);
  console.log(`  rows considered:      ${detail.length}`);
  console.log(`  rows updated:         ${updated} across ${Object.keys(groups).length} leaves`);
  console.log(`  cross-category skip:  ${crossCategory.length} (proposed parent disagrees with current category — see below)`);
  if (crossCategory.length) {
    console.log("\n=== Cross-category skips (review manually if you want them re-parented) ===");
    for (const d of crossCategory) {
      console.log(`  id=${String(d.id).padEnd(10)} ${d.store_domain.padEnd(24)} ${d.current_category} → ${d.proposed_parent}/${d.proposed_subcategory}  "${d.title ?? d.name ?? ""}"`);
    }
  }
}

const rows = await fetchAll();
console.log(`Fetched ${rows.length} rows.`);
const { dist, byStore, detail } = bucket(rows);
printDistribution(dist);
printPerStore(byStore);
printSamples(detail);
if (sqlOutPath) emitSql(detail, sqlOutPath);
