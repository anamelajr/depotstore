# Category Sub-category Granularity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the data match the granularity the UI promises — add a `subcategory` column populated by a leaf-emitting branch of the existing regex classifier, so leaf slugs (`tops_tees`, `jackets`, `bags`, etc.) return only their own subcategory instead of the entire parent bucket.

**Architecture:** Add `products.subcategory text NULL` with a CHECK constraint tying leaf to parent. Extend `assignCategory()` in `app/lib/stores.js` to return `{ category, subcategory }`, with three new helper functions (`classifyTopsLeaf`, `classifyJacketsCoatsLeaf`, `classifyBagsAccessoriesLeaf`) called on whichever pass produced the parent. Update read sites (`/api/products/route.js`, the two interleaved RPCs) and write sites (`/api/enrich/route.js` call sites + `enrich_product` RPC) to thread subcategory through. Dry-run backfill script produces a distribution report for human review; wet backfill is a generated SQL file pasted into the Supabase SQL Editor.

**Tech Stack:** Next.js App Router (no TypeScript), Supabase (Postgres), Vitest for unit tests, Node 20+ for the backfill script.

**Source spec:** `docs/superpowers/specs/2026-05-21-category-subcategory-granularity-design.md`

---

## ⚠️ Push gate — read this before executing any task

**Do NOT push the branch to the remote until Task 17, Step 1.** Every commit in Tasks 1–16 stays local.

Reasons (each independently fatal if violated):

1. **Task 5 changes `assignCategory()`'s return shape from string to object.** Before Task 13 lands the matching caller updates, the production `/api/enrich` cron path would pass an object where `p_category` expects text — Postgres would reject every call.
2. **Tasks 13 and 15 pass `p_subcategory` to RPCs.** Until Tasks 9–10 add that parameter (with `DEFAULT NULL` so old callers keep working), any call carrying `p_subcategory` errors with "function does not exist with this signature."
3. **Task 15 filters on the `subcategory` column.** Until Task 8 adds the column, the query errors with "column does not exist."
4. **Task 15 + Task 12 timing.** Even after the column and RPCs exist, leaf filter URLs like `/feed?category=tops_tees` will return empty until the wet backfill in Task 12 has populated rows.

The reordered phases below are designed so the **database** can advance through Tasks 8–12 without breaking the live `main` branch (new RPC parameters are `DEFAULT NULL`; the new column is nullable; old code on `main` never references either). Only the JS branch needs the no-push discipline.

**Phase summary** (full task list follows):

| Phase | Tasks | Where | Push-safe individually? |
|---|---|---|---|
| 1. Local setup + classifier (TDD) | 1–5 | Local repo | No (Task 5 breaks live enrich if pushed) |
| 2. Dry-run + human review | 6–7 | Local (reads prod DB read-only) | No |
| 3. DB schema + RPC + wet backfill | 8–12 | Supabase SQL Editor | **Yes** — DB only, `main` unaffected |
| 4. JS code that depends on DB state | 13–16 | Local repo | No (only safe in aggregate after Phase 3) |
| 5. Push, verify, PR | 17 | Remote / Vercel | Push happens here |

---

## File Structure

**Create:**
- `vitest.config.js` — minimal vitest config
- `app/lib/__tests__/stores.test.js` — leaf-classifier unit tests
- `scripts/backfillSubcategory.mjs` — dry-run report + SQL emitter
- `scripts/sql/2026-05-21-add-subcategory.sql` — schema change (column + CHECK)
- `scripts/sql/2026-05-21-enrich-product-rpc.sql` — RPC update
- `scripts/sql/2026-05-21-interleaved-rpcs.sql` — both interleaved RPCs updated
- `scripts/sql/2026-05-21-subcategory-backfill.sql` — generated wet-backfill (output of dry-run)

**Modify:**
- `app/lib/stores.js` — `assignCategory()` return shape, three new leaf helpers
- `app/lib/categories.js` — replace `CATEGORY_SLUG_TO_DB` with resolver
- `app/api/products/route.js` — leaf-aware filter in all three branches (RPC, price-sort, non-price)
- `app/api/enrich/route.js` — both `assignCategory()` call sites pass subcategory to RPC
- `package.json` — add vitest devDep and `test` script

**Touched but probably no-change:**
- `app/components/MoreFromStore.js`, PDP page, homepage — audit only; they should not filter by category directly

---

# Phase 1 — Local setup + classifier (TDD)

## Task 1: Set up Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`

- [ ] **Step 1: Add vitest as a devDependency**

Run:
```bash
npm install --save-dev vitest@^2.1.0
```

Expected: `package.json` gets a `"vitest": "^2.x.x"` entry under `devDependencies`. `package-lock.json` updates. No application code changes.

- [ ] **Step 2: Add the `test` script to `package.json`**

In `package.json`, in the `scripts` block, add `"test": "vitest run"` and `"test:watch": "vitest"`:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: Create `vitest.config.js` at the repo root**

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/__tests__/**/*.test.{js,mjs}"],
    globals: false,
  },
});
```

- [ ] **Step 4: Verify Vitest runs (no tests yet = 0 passed)**

Run:
```bash
npm test
```

Expected: Vitest reports "No test files found" or "0 passed". Exits clean.

- [ ] **Step 5: Commit (stay local — do not push)**

```bash
git add package.json package-lock.json vitest.config.js
git commit -m "chore(test): add vitest for unit testing"
```

---

## Task 2: Failing tests — Tops sub-pass

**Files:**
- Create: `app/lib/__tests__/stores.test.js`

These tests fail until Task 5 lands. They document the expected behaviour of the new `{ category, subcategory }` shape from `assignCategory()`.

- [ ] **Step 1: Create the test file with Tops cases**

`app/lib/__tests__/stores.test.js`:

```js
import { describe, it, expect } from "vitest";
import { assignCategory } from "../stores.js";

// Helper: classification only consults title/name/description/etc. on the
// product object. We pass just title; the broad-rule passes will pick it up.
const classify = (title) => assignCategory({ title });

describe("assignCategory — Tops leaves", () => {
  const cases = [
    ["T-Shirt",                        "Tops", "tees"],
    ["Tee",                            "Tops", "tees"],
    ["Tee Shirt",                      "Tops", "tees"],
    ["Knit Tee",                       "Tops", "tees"],
    ["Knit Polo Sweater",              "Tops", "hoodies_sweaters"],
    ["Crewneck Sweatshirt",            "Tops", "hoodies_sweaters"],
    ["Sweater Vest",                   "Tops", "hoodies_sweaters"],
    ["Cardigan",                       "Tops", "hoodies_sweaters"],
    ["Cashmere Shirt",                 "Tops", "shirts_blouses"],
    ["Polo Shirt",                     "Tops", "shirts_blouses"],
    ["Knit Polo",                      "Tops", "shirts_blouses"],
    ["Button-Up Shirt",                "Tops", "shirts_blouses"],
    ["Blouse",                         "Tops", "shirts_blouses"],
    ["Tank Top",                       "Tops", "shirts_blouses"],
    ["Knit Turtleneck",                "Tops", "knitwear"],
    ["Turtleneck",                     "Tops", "knitwear"],
    ["Knit",                           "Tops", "knitwear"],
    ["Knitwear",                       "Tops", "knitwear"],
    ["Top",                            "Tops", null],
    ["Comme des Garçons Special Piece", null, null],
  ];
  it.each(cases)("%s → %s / %s", (title, category, subcategory) => {
    const result = classify(title);
    expect(result).toEqual({ category, subcategory });
  });
});
```

- [ ] **Step 2: Run the test — confirm failure**

```bash
npm test -- stores
```

Expected: every Tops case fails. Either `assignCategory` returns a string (current behaviour) instead of an object, or returns `null` where we expect Tops with a leaf. The failure messages confirm we're targeting the right contract.

- [ ] **Step 3: Commit (stay local — do not push)**

```bash
git add app/lib/__tests__/stores.test.js
git commit -m "test(stores): tops leaf classification (failing)"
```

---

## Task 3: Failing tests — Jackets & Coats sub-pass

**Files:**
- Modify: `app/lib/__tests__/stores.test.js`

- [ ] **Step 1: Append the J&C describe block**

Add inside the file:

```js
describe("assignCategory — Jackets & Coats leaves", () => {
  const cases = [
    ["Denim Jacket",       "Jackets & Coats", "jackets"],
    ["Bomber",             "Jackets & Coats", "jackets"],
    ["Bomber Coat",        "Jackets & Coats", "jackets"],
    ["Shearling Jacket",   "Jackets & Coats", "jackets"],
    ["Puffer Jacket",      "Jackets & Coats", "jackets"],
    ["Blazer",             "Jackets & Coats", "jackets"],
    ["Anorak",             "Jackets & Coats", "jackets"],
    ["Windbreaker",        "Jackets & Coats", "jackets"],
    ["Bolero",             "Jackets & Coats", "jackets"],
    ["Denim Coat",         "Jackets & Coats", "coats"],
    ["Trench",             "Jackets & Coats", "coats"],
    ["Trench Coat",        "Jackets & Coats", "coats"],
    ["Trench Jacket",      "Jackets & Coats", "coats"],
    ["Parka",              "Jackets & Coats", "coats"],
    ["Peacoat",            "Jackets & Coats", "coats"],
    ["Overcoat",           "Jackets & Coats", "coats"],
    ["Puffer Coat",        "Jackets & Coats", "coats"],
    ["Shearling Coat",     "Jackets & Coats", "coats"],
    ["Puffer",             "Jackets & Coats", null],
    ["Shearling",          "Jackets & Coats", null],
    ["Cape",               "Jackets & Coats", null],
    ["Caban",              "Jackets & Coats", null],
  ];
  it.each(cases)("%s → %s / %s", (title, category, subcategory) => {
    const result = classify(title);
    expect(result).toEqual({ category, subcategory });
  });
});
```

Note: the current broad rule includes `shearlings?`, `puffers?`, `capes?`, `cabans?` in the Jackets & Coats keyword list, so they DO classify as `Jackets & Coats` at the parent level. The leaf sub-pass is where they fall through to `null`.

- [ ] **Step 2: Run the test — confirm failure**

```bash
npm test -- stores
```

Expected: all J&C cases fail. Parent category may already be right for some titles, but the return shape is still a string, not an object.

- [ ] **Step 3: Commit (stay local — do not push)**

```bash
git add app/lib/__tests__/stores.test.js
git commit -m "test(stores): jackets & coats leaf classification (failing)"
```

---

## Task 4: Failing tests — Bags & Accessories sub-pass

**Files:**
- Modify: `app/lib/__tests__/stores.test.js`

- [ ] **Step 1: Append the B&A describe block**

```js
describe("assignCategory — Bags & Accessories leaves", () => {
  const cases = [
    ["Tote Bag",     "Bags & Accessories", "bags"],
    ["Belt Bag",     "Bags & Accessories", "bags"],
    ["Crossbody",    "Bags & Accessories", "bags"],
    ["Clutch",       "Bags & Accessories", "bags"],
    ["Backpack",     "Bags & Accessories", "bags"],
    ["Card Holder",  "Bags & Accessories", "bags"],
    ["Wallet",       "Bags & Accessories", "bags"],
    ["Belt",         "Bags & Accessories", "accessories"],
    ["Silk Scarf",   "Bags & Accessories", "accessories"],
    ["Sunglasses",   "Bags & Accessories", "accessories"],
    ["Beanie",       "Bags & Accessories", "accessories"],
    ["Tie",          "Bags & Accessories", "accessories"],
    ["Necktie",      "Bags & Accessories", "accessories"],
    ["Bracelet",     "Bags & Accessories", "accessories"],
    ["Watch",        "Bags & Accessories", "accessories"],
  ];
  it.each(cases)("%s → %s / %s", (title, category, subcategory) => {
    const result = classify(title);
    expect(result).toEqual({ category, subcategory });
  });
});
```

- [ ] **Step 2: Append non-grouped-bucket sanity tests**

These ensure the four flat buckets keep returning `subcategory: null` and don't accidentally pick up a leaf:

```js
describe("assignCategory — flat buckets (subcategory must be null)", () => {
  const cases = [
    ["Denim Jeans",   "Bottoms",          null],
    ["Cargo Pants",   "Bottoms",          null],
    ["Sneakers",      "Footwear",         null],
    ["Boots",         "Footwear",         null],
    ["Maxi Dress",    "Dresses & Skirts", null],
    ["Skirt",         "Dresses & Skirts", null],
    ["Wool Set",      "Sets",             null],
    ["Tracksuit",     "Sets",             null],
  ];
  it.each(cases)("%s → %s / %s", (title, category, subcategory) => {
    const result = classify(title);
    expect(result).toEqual({ category, subcategory });
  });
});

describe("assignCategory — uncategorisable rows", () => {
  it("returns { category: null, subcategory: null } when nothing matches", () => {
    expect(classify("Comme des Garçons Special Piece")).toEqual({
      category: null,
      subcategory: null,
    });
  });
});
```

- [ ] **Step 3: Run the test — confirm failure**

```bash
npm test -- stores
```

Expected: every case still fails (return shape mismatch).

- [ ] **Step 4: Commit (stay local — do not push)**

```bash
git add app/lib/__tests__/stores.test.js
git commit -m "test(stores): bags/accessories + flat-bucket leaf tests (failing)"
```

---

## Task 5: Implement leaf classifiers in `stores.js`

**Files:**
- Modify: `app/lib/stores.js` (add three helper functions just above `assignCategory`, and change `assignCategory`'s return)

⚠️ **From this task forward, the branch is NOT push-safe.** Production `/api/enrich` on `main` calls `assignCategory` and uses the old string return — if this commit goes live, every enrich call breaks. Stay local through Task 16.

- [ ] **Step 1: Add the three leaf-classifier helpers above `assignCategory`**

Insert after the `isSwimwear` block (around line 391, before the `// Classify a product…` comment that opens `assignCategory`):

```js
// Leaf-classifier helpers. Each runs on the SAME text that the broad
// `tryClassify` accepted, so the parent and leaf decisions agree on
// which pass (title, stripped name, descHead, editorialHead) is
// authoritative. Rule order matters: garment nouns ("sweater", "shirt",
// "polo") win before material adjectives ("knit", "cashmere"); specific
// silhouettes ("bomber", "trench") win before generic words ("jacket",
// "coat"). Returns the leaf slug or null when no leaf rule fires — the
// row remains visible under the parent filter at `subcategory IS NULL`.

function classifyTopsLeaf(text) {
  if (!text) return null;
  if (/\b(t[\s-]?shirts?|tee[\s-]?shirts?|tees?)\b/.test(text)) return "tees";
  if (/\b(hoodies?|sweatshirts?|sweaters?|crewnecks?|cardigans?|pullovers?|fleeces?|half[\s-]?zips?)\b/.test(text)) return "hoodies_sweaters";
  if (/\b(shirts?|blouses?|polo[\s-]?shirts?|polos?|button[\s-]?ups?|button[\s-]?downs?|overshirts?|tunics?|tank[\s-]?tops?|tanks?|camisoles?|cami|bodysuits?|bras?|corsets?|bustiers?|vests?|waistcoats?|jerseys?)\b/.test(text)) return "shirts_blouses";
  if (/\b(knitwears?|knits?|turtlenecks?|roll[\s-]?necks?)\b/.test(text)) return "knitwear";
  return null;
}

function classifyJacketsCoatsLeaf(text) {
  if (!text) return null;
  // Specific jacket silhouettes — always jacket regardless of trailing "coat"
  if (/\b(bombers?|blazers?|anoraks?|windbreakers?|boleros?|perfectos?)\b/.test(text)) return "jackets";
  // Specific coat silhouettes — always coat regardless of trailing "jacket"
  if (/\b(trench(?:coats?|es)?|parkas?|peacoats?|overcoats?|raincoats?)\b/.test(text)) return "coats";
  // Generic words last
  if (/\bjackets?\b/.test(text)) return "jackets";
  if (/\bcoats?\b/.test(text)) return "coats";
  // Bare ambiguous tokens (puffer, shearling, cape, caban) fall through to null
  return null;
}

function classifyBagsAccessoriesLeaf(text) {
  if (!text) return null;
  if (/\b(bags?|totes?|clutch(?:es)?|purses?|handbags?|backpacks?|satchels?|pouch(?:es)?|wallets?|briefcases?|duffels?|crossbody|baguettes?|pouchettes?|card[\s-]?holders?)\b/.test(text)) return "bags";
  if (/\b(belts?|scarves|scarf|headscarves|headscarfs?|gloves?|sunglasses|eyeglasses|glasses|eyewear|beanies?|hats?|caps?|berets?|headbands?|necklaces?|chokers?|bracelets?|earrings?|rings?|brooch(?:es)?|jewelry|jewellery|watch(?:es)?|bowtie|bow[\s-]?tie|pendants?|dog[\s-]?tags?|bangles?|mittens?|neckpieces?|umbrellas?|compact[\s-]?mirrors?|chapkas?|neckties?|ties?)\b/.test(text)) return "accessories";
  return null;
}

function classifyLeaf(parent, text) {
  switch (parent) {
    case "Tops":               return classifyTopsLeaf(text);
    case "Jackets & Coats":    return classifyJacketsCoatsLeaf(text);
    case "Bags & Accessories": return classifyBagsAccessoriesLeaf(text);
    default:                   return null; // flat buckets carry no leaf
  }
}
```

- [ ] **Step 2: Change `assignCategory`'s return shape**

Replace the body of `assignCategory` (everything inside the function after the variable declarations at lines 425–454) with this exact code:

```js
  // Early swim guard.
  if (isSwimwear(rawType, rawTitle, strippedName)) {
    return { category: null, subcategory: null };
  }

  // Pass 1: cleaned title + productType.
  if (rawTitle.trim()) {
    const text = prepareText(rawTitle);
    const parent = tryClassify(text);
    if (parent !== null) {
      return { category: parent, subcategory: classifyLeaf(parent, text) };
    }
  }

  // Pass 2: brand/vendor-stripped name + productType.
  if (strippedName.trim()) {
    const text = prepareText(strippedName);
    const parent = tryClassify(text);
    if (parent !== null) {
      return { category: parent, subcategory: classifyLeaf(parent, text) };
    }
  }

  // Late swim guard.
  if (isSwimwear(descHead, editorialHead)) {
    return { category: null, subcategory: null };
  }

  // Pass 3: raw description head (strict).
  if (descHead) {
    const parent = tryClassify(descHead, { strict: true });
    if (parent !== null) {
      return { category: parent, subcategory: classifyLeaf(parent, descHead) };
    }
  }

  // Pass 4: editorial_description head (strict).
  if (editorialHead) {
    const parent = tryClassify(editorialHead, { strict: true });
    if (parent !== null) {
      return { category: parent, subcategory: classifyLeaf(parent, editorialHead) };
    }
  }

  return { category: null, subcategory: null };
}
```

- [ ] **Step 3: Run all tests — confirm pass**

```bash
npm test -- stores
```

Expected: all Tops, J&C, B&A, flat-bucket, and uncategorisable tests pass. Count should be ~75 passing.

If any case fails, the regex needs adjusting. Common pitfalls:
- "Tee Shirt" (with space) requires `tee[\s-]?shirts?` to allow a separator.
- "Card Holder" requires `card[\s-]?holders?`.
- "Knit Polo" must NOT hit `knitwear` first — the `polo` rule (in shirts_blouses) runs earlier; verify by tracing the order.

- [ ] **Step 4: Commit (stay local — do not push)**

```bash
git add app/lib/stores.js
git commit -m "feat(stores): classify leaf subcategory in assignCategory"
```

---

# Phase 2 — Dry-run + human review

The dry-run script imports `assignCategory` from local source, so it can run as soon as Task 5 is committed. No DB changes yet — fully read-only.

## Task 6: Write the dry-run backfill script

**Files:**
- Create: `scripts/backfillSubcategory.mjs`

- [ ] **Step 1: Create the script**

`scripts/backfillSubcategory.mjs`:

```js
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

// Page through every matching row. PostgREST caps at 1000 per request.
// Note: `subcategory` is selected only if the column already exists on
// the DB. Before Task 8, it doesn't — guard with COALESCE-style select.
async function fetchAll() {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  // Try selecting subcategory; fall back to no-subcategory select if column
  // doesn't exist yet. This lets the dry-run run BEFORE Task 8's schema add.
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
        // Column doesn't exist yet — re-try without it
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
  for (const d of detail) {
    if (!d.proposed_subcategory) continue;
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
  console.log(`\nWet-backfill SQL written to ${path} (${detail.length} rows considered, ${Object.values(groups).flat().length} UPDATEs across ${Object.keys(groups).length} leaves).`);
}

const rows = await fetchAll();
console.log(`Fetched ${rows.length} rows.`);
const { dist, byStore, detail } = bucket(rows);
printDistribution(dist);
printPerStore(byStore);
printSamples(detail);
if (sqlOutPath) emitSql(detail, sqlOutPath);
```

- [ ] **Step 2: Sanity-check (parse only)**

```bash
node --check scripts/backfillSubcategory.mjs
```

Expected: no syntax errors.

- [ ] **Step 3: Commit (stay local — do not push)**

```bash
git add scripts/backfillSubcategory.mjs
git commit -m "feat(scripts): dry-run subcategory backfill with distribution report"
```

---

## Task 7: Run dry-run, generate report, PAUSE for user review

**Files:**
- No code changes. Gathers data and pauses.

- [ ] **Step 1: Run the dry-run**

```bash
node scripts/backfillSubcategory.mjs 2>&1 | tee /tmp/subcategory-dryrun-$(date +%Y%m%d).log
```

Expected output:
- "Fetched ~4775 rows." (number from the investigation; may drift slightly between runs)
- Distribution table per parent and per leaf
- Per-store breakdown
- ~80–100 lines of random samples

- [ ] **Step 2: Report the distribution back to the user**

Summarise in the PR / chat:
- Per parent: count per leaf, including NULL
- Outliers per store (e.g. "dolcevitahub has 200 Tops with NULL subcategory")
- 5–10 example titles per leaf that the user can quickly judge
- 10 example titles of NULL-subcategory rows so the user can see what's slipping through

**PAUSE.** The user reviews. If they flag patterns ("X should be classified as Y", "the NULL rate on knitwear is too high"), iterate: tweak the leaf regex in Task 5's helpers, re-run tests, re-run dry-run.

- [ ] **Step 3: Once approved, proceed to Phase 3**

No commit here — the script and dry-run output don't change the repo.

---

# Phase 3 — DB schema + RPC + wet backfill (push-safe in isolation)

These four tasks happen in the Supabase SQL Editor. They DO NOT touch the JS repo. Production `main` continues serving with its old code; the new column is nullable and the new RPC parameters default to NULL, so old callers keep working.

**Why this phase is safe to advance through fully before any JS pushes:** the new RPC signatures are strictly additive (`p_subcategory text DEFAULT NULL`), the new column is nullable, and no `main` code reads it. The DB is "ready" but production `main` doesn't know yet — and doesn't care.

## Task 8: Apply schema change in Supabase (column + CHECK)

**Files:**
- Create: `scripts/sql/2026-05-21-add-subcategory.sql`

MCP is read-only — apply via the SQL Editor. Commit the SQL file for audit trail.

- [ ] **Step 1: Write the SQL file**

`scripts/sql/2026-05-21-add-subcategory.sql`:

```sql
-- Add subcategory column + CHECK constraint enforcing leaf-parent agreement.
-- Apply via Supabase SQL Editor (MCP is read-only).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS subcategory text NULL;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_subcategory_matches_category;

ALTER TABLE public.products
  ADD CONSTRAINT products_subcategory_matches_category
  CHECK (
    subcategory IS NULL
    OR (category = 'Tops' AND subcategory IN ('tees','hoodies_sweaters','shirts_blouses','knitwear'))
    OR (category = 'Jackets & Coats' AND subcategory IN ('jackets','coats'))
    OR (category = 'Bags & Accessories' AND subcategory IN ('bags','accessories'))
  );
```

- [ ] **Step 2: Snapshot before applying**

In the Supabase SQL Editor:
```sql
CREATE TABLE IF NOT EXISTS products_pre_subcategory_snapshot AS
  SELECT * FROM products;
```

Per CLAUDE.md "Snapshot before destructive runs."

- [ ] **Step 3: Apply the SQL file in the Supabase SQL Editor**

Open Supabase dashboard → SQL Editor → paste contents of `scripts/sql/2026-05-21-add-subcategory.sql` → Run.

Expected: "Success. No rows returned."

- [ ] **Step 4: Verify**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='products' AND column_name='subcategory';

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.products'::regclass
  AND conname = 'products_subcategory_matches_category';
```

Expected: column exists, type `text`, nullable. CHECK constraint present.

- [ ] **Step 5: Commit the SQL file (stay local — do not push)**

```bash
git add scripts/sql/2026-05-21-add-subcategory.sql
git commit -m "ops(supabase): add subcategory column + CHECK constraint"
```

---

## Task 9: Update `enrich_product` RPC in Supabase

**Files:**
- Create: `scripts/sql/2026-05-21-enrich-product-rpc.sql`

- [ ] **Step 1: Write the SQL file**

`scripts/sql/2026-05-21-enrich-product-rpc.sql`:

```sql
-- Update enrich_product to COALESCE-write subcategory alongside category.
-- p_subcategory DEFAULT NULL keeps old callers (on main) working unchanged.
-- Apply via Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.enrich_product(
  p_handle        text,
  p_store_domain  text,
  p_brand         text,
  p_title         text,
  p_category      text,
  p_subcategory   text DEFAULT NULL
) RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.products SET
    brand       = COALESCE(brand,       p_brand),
    title       = COALESCE(title,       p_title),
    category    = COALESCE(category,    p_category),
    subcategory = COALESCE(subcategory, p_subcategory)
  WHERE handle = p_handle AND store_domain = p_store_domain;
$$;
```

- [ ] **Step 2: Apply in the Supabase SQL Editor**

Paste contents → Run.

- [ ] **Step 3: Verify**

```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'enrich_product' AND pronamespace = 'public'::regnamespace;
```

Expected: definition includes `p_subcategory text DEFAULT NULL` parameter and `subcategory = COALESCE(subcategory, p_subcategory)` line.

- [ ] **Step 4: Smoke-test against one row**

```sql
SELECT id, handle, store_domain, brand, title, category, subcategory
FROM products
WHERE category = 'Tops' AND brand IS NOT NULL AND title IS NOT NULL
LIMIT 1;

SELECT enrich_product(
  '<that-handle>',
  '<that-store-domain>',
  'WRONG_BRAND',
  'WRONG_TITLE',
  'WRONG_CATEGORY',
  'tees'
);

SELECT id, handle, store_domain, brand, title, category, subcategory
FROM products
WHERE handle = '<that-handle>' AND store_domain = '<that-store-domain>';
```

Expected: brand/title/category unchanged; subcategory now `'tees'`. Roll back: `UPDATE products SET subcategory = NULL WHERE id = X;`.

- [ ] **Step 5: Verify old-style calls still work (backwards compat)**

```sql
-- 5-argument call (no p_subcategory) should still resolve — DEFAULT NULL covers it
SELECT enrich_product('<some-handle>', '<some-domain>', 'X', 'Y', 'Z');
```

Expected: succeeds (no "function does not exist" error). Production `main` still uses 5-arg calls — this must work or main breaks.

- [ ] **Step 6: Commit (stay local — do not push)**

```bash
git add scripts/sql/2026-05-21-enrich-product-rpc.sql
git commit -m "ops(supabase): enrich_product RPC writes subcategory via COALESCE"
```

---

## Task 10: Update the two interleaved RPCs in Supabase

**Files:**
- Create: `scripts/sql/2026-05-21-interleaved-rpcs.sql`

The interleaved RPCs are not in git. Pull live definitions, add `p_subcategory text DEFAULT NULL`, commit updated DDL.

- [ ] **Step 1: Pull current RPC bodies**

In the Supabase SQL Editor:
```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname IN ('get_interleaved_products', 'count_interleaved_products')
  AND pronamespace = 'public'::regnamespace;
```

Copy both definitions to a local scratch file.

- [ ] **Step 2: Modify both definitions**

For each function, add the parameter `p_subcategory text DEFAULT NULL` right after `p_category text`. Inside the function body, add the same kind of `string_to_array` filter that the existing `p_category` handler uses:

```sql
AND (
  p_subcategory IS NULL
  OR subcategory = ANY(string_to_array(p_subcategory, ','))
)
```

Mirror the placement of the existing `p_category` filter. **Preserve all other logic** — interleaving, brand `unaccent` + ILIKE, parameter positions for non-modified params.

- [ ] **Step 3: Write the SQL file**

`scripts/sql/2026-05-21-interleaved-rpcs.sql`: paste both updated `CREATE OR REPLACE FUNCTION` statements (full bodies).

- [ ] **Step 4: Apply in the SQL Editor**

Paste contents → Run.

- [ ] **Step 5: Smoke-test backwards compat AND new behaviour**

```sql
-- Old-style call (no p_subcategory) must still work for production main
SELECT COUNT(*) FROM get_interleaved_products(NULL, 'Tops', NULL, NULL, 10000, 0);

-- New-style call with p_subcategory
SELECT COUNT(*) FROM get_interleaved_products(NULL, 'Tops', NULL, NULL, NULL, 10000, 0);

-- Leaf filter — should return 0 (no rows have subcategory populated yet)
SELECT COUNT(*) FROM get_interleaved_products(NULL, 'Tops', 'tees', NULL, NULL, 10000, 0);
```

Expected: first count matches pre-deploy Tops count, second matches (NULL subcategory acts as no-filter), third is 0 until Task 12 wet backfill runs.

**Note on parameter order:** the new `p_subcategory` is positional argument #3. If existing callers use positional 5-arg form, the `DEFAULT NULL` on the new parameter only helps if it's the LAST parameter or named. **Verify the current call sites on `main` use named-argument form** (`p_category := …`); if they use positional 4-arg or 5-arg form, the addition shifts positions and breaks main. The Supabase JS client uses named-arg form by default — this is the safe case. Confirm before pasting.

- [ ] **Step 6: Commit (stay local — do not push)**

```bash
git add scripts/sql/2026-05-21-interleaved-rpcs.sql
git commit -m "ops(supabase): interleaved RPCs accept p_subcategory filter"
```

---

## Task 11: Generate the wet-backfill SQL

**Files:**
- Create: `scripts/sql/2026-05-21-subcategory-backfill.sql`

- [ ] **Step 1: Regenerate with `--emit-sql`**

```bash
node scripts/backfillSubcategory.mjs --emit-sql scripts/sql/2026-05-21-subcategory-backfill.sql
```

Expected: distribution report prints (same as Task 7) plus a SQL file is written.

- [ ] **Step 2: Spot-check the SQL file**

```bash
head -20 scripts/sql/2026-05-21-subcategory-backfill.sql
wc -l scripts/sql/2026-05-21-subcategory-backfill.sql
grep -c "^UPDATE" scripts/sql/2026-05-21-subcategory-backfill.sql
```

Expected:
- Starts with `-- Wet backfill: …` and `BEGIN;`
- Includes `CREATE TABLE IF NOT EXISTS products_subcategory_backfill_snapshot AS …`
- Ends with `COMMIT;`
- ~20–40 UPDATE statements

- [ ] **Step 3: Commit (stay local — do not push)**

```bash
git add scripts/sql/2026-05-21-subcategory-backfill.sql
git commit -m "ops(supabase): wet-backfill SQL generated from dry-run"
```

---

## Task 12: Apply wet backfill in Supabase SQL Editor

**Files:**
- No code changes. Applies the SQL from Task 11.

- [ ] **Step 1: Confirm snapshot from Task 8 still exists**

```sql
SELECT COUNT(*) FROM products_pre_subcategory_snapshot;
```

Expected: row count matches `products`. If missing, recreate:
```sql
CREATE TABLE products_pre_subcategory_snapshot_v2 AS SELECT * FROM products;
```

- [ ] **Step 2: Paste `scripts/sql/2026-05-21-subcategory-backfill.sql` into the SQL Editor**

Wrapped in `BEGIN; … COMMIT;` already.

- [ ] **Step 3: Run**

Expected: "Success. No rows returned." Runtime ~5–30 seconds.

If the CHECK constraint rejects an UPDATE, the whole transaction rolls back — investigate which leaf disagreed with which parent. Fix the source data or the leaf assignment, regenerate SQL, retry.

- [ ] **Step 4: Verify distribution matches the dry-run report**

```sql
SELECT category, subcategory, COUNT(*)
FROM products
WHERE available = true AND hidden = false
GROUP BY category, subcategory
ORDER BY category, subcategory NULLS LAST;
```

Expected: per-leaf counts match the dry-run.

- [ ] **Step 5: Verify production `main` still works**

Hit the live site (production, not preview):
- `/feed?category=tops` — should still return the same rows as before (parent slug unaffected by backfill).
- `/feed` (no filter) — should still return rows.

The `enrich_runs` table's latest row should show `succeeded > 0` on the next cron tick (proves the live enrich is still calling `enrich_product` successfully despite the new optional parameter).

- [ ] **Step 6: No commit (DB-side change, no repo change)**

---

# Phase 4 — JS code that depends on DB state

The DB now has the column, the RPCs accept the parameter, and the rows are populated. The JS code in this phase calls into that state — once these commits land in a deploy, the leaf filters Just Work.

## Task 13: Update enrich route to thread subcategory through

**Files:**
- Modify: `app/api/enrich/route.js` (both `assignCategory` call sites)

- [ ] **Step 1: Update the fast-path call site (around lines 131–147)**

Replace:
```js
if (row.brand && row.title) {
  fastPathCount++;
  const newCategory = assignCategory(row) ?? null;
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
  });
```

With:
```js
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
```

- [ ] **Step 2: Update the full-enrichment call site (around lines 254–269)**

Replace:
```js
const newCategory =
  assignCategory({ ...row, brand: newBrand, title: newTitle }) ?? null;
if (newCategory) categoryAssigned++;
else categoryFailed++;
const { error: rpcErr } = await supabaseAdmin.rpc("enrich_product", {
  p_handle: row.handle,
  p_store_domain: row.store_domain,
  p_brand: newBrand,
  p_title: newTitle,
  p_category: newCategory,
});
```

With:
```js
const { category: newCategory, subcategory: newSubcategory } =
  assignCategory({ ...row, brand: newBrand, title: newTitle });
if (newCategory) categoryAssigned++;
else categoryFailed++;
const { error: rpcErr } = await supabaseAdmin.rpc("enrich_product", {
  p_handle: row.handle,
  p_store_domain: row.store_domain,
  p_brand: newBrand,
  p_title: newTitle,
  p_category: newCategory,
  p_subcategory: newSubcategory,
});
```

- [ ] **Step 3: Sanity-check**

```bash
npm run lint && npm test
```

Expected: lint clean, all tests still pass.

- [ ] **Step 4: Commit (stay local — do not push)**

```bash
git add app/api/enrich/route.js
git commit -m "feat(enrich): pass subcategory through to enrich_product RPC"
```

---

## Task 14: Replace `CATEGORY_SLUG_TO_DB` with a leaf-aware resolver

**Files:**
- Modify: `app/lib/categories.js`

- [ ] **Step 1: Extend the leaf data in `CATEGORIES`**

Replace `CATEGORIES` (lines 14–51) with:

```js
export const CATEGORIES = [
  {
    slug: "tops",
    label: "Tops",
    dbName: "Tops",
    shortKey: "tops",
    children: [
      { slug: "tops_hoodies_sweaters", label: "Hoodies & Sweaters", subcategory: "hoodies_sweaters" },
      { slug: "tops_shirts_blouses",   label: "Shirts & Blouses",   subcategory: "shirts_blouses"   },
      { slug: "tops_tees",             label: "Tees",               subcategory: "tees"             },
      { slug: "tops_knitwear",         label: "Knitwear",           subcategory: "knitwear"         },
    ],
  },
  { slug: "bottoms",        label: "Bottoms",          dbName: "Bottoms" },
  { slug: "dresses_skirts", label: "Dresses & Skirts", dbName: "Dresses & Skirts" },
  {
    slug: "jackets_coats",
    label: "Jackets & Coats",
    dbName: "Jackets & Coats",
    shortKey: "jackets",
    children: [
      { slug: "jackets", label: "Jackets", subcategory: "jackets" },
      { slug: "coats",   label: "Coats",   subcategory: "coats"   },
    ],
  },
  { slug: "footwear", label: "Footwear", dbName: "Footwear" },
  {
    slug: "bags_accessories",
    label: "Bags & Accessories",
    dbName: "Bags & Accessories",
    shortKey: "bags",
    children: [
      { slug: "bags",        label: "Bags",        subcategory: "bags"        },
      { slug: "accessories", label: "Accessories", subcategory: "accessories" },
    ],
  },
  { slug: "sets", label: "Sets", dbName: "Sets" },
];
```

- [ ] **Step 2: Add the resolver below `CATEGORY_SLUG_TO_DB`**

After the existing `CATEGORY_SLUG_TO_DB` block (lines 56–61), add:

```js
// Leaf-aware slug → DB filter shape. Parent slugs resolve to a category
// filter with no subcategory; leaf slugs resolve to BOTH (category +
// subcategory). Unknown slugs return { category: slug, subcategory: null }
// — preserves the legacy `|| s` fallback in /api/products/route.js.
const SLUG_TO_FILTER = (() => {
  const map = {};
  for (const c of CATEGORIES) {
    map[c.slug] = { category: c.dbName, subcategory: null };
    for (const child of c.children || []) {
      map[child.slug] = { category: c.dbName, subcategory: child.subcategory };
    }
  }
  return map;
})();

// Given an array of URL slugs (parent or leaf), return the deduplicated
// arrays of DB category values and subcategory slugs to filter on.
// Either array may be empty.
export function resolveCategoryFilter(slugs) {
  if (!Array.isArray(slugs) || slugs.length === 0) {
    return { categoryDbValues: [], subcategorySlugs: [] };
  }
  const cats = new Set();
  const subs = new Set();
  for (const slug of slugs) {
    const entry = SLUG_TO_FILTER[slug];
    if (!entry) {
      cats.add(slug);
      continue;
    }
    cats.add(entry.category);
    if (entry.subcategory) subs.add(entry.subcategory);
  }
  return {
    categoryDbValues: [...cats],
    subcategorySlugs: [...subs],
  };
}
```

- [ ] **Step 3: Commit (stay local — do not push)**

```bash
git add app/lib/categories.js
git commit -m "feat(categories): add resolveCategoryFilter for leaf-aware slugs"
```

---

## Task 15: Update `/api/products/route.js` to use the resolver

**Files:**
- Modify: `app/api/products/route.js`

Three places filter on category. All three need to apply both `category` and (optionally) `subcategory`. RPC path also passes `p_subcategory`.

- [ ] **Step 1: Swap the import and resolver call**

Top of file — replace:
```js
import { CATEGORY_SLUG_TO_DB } from "../../lib/categories.js";
```

With:
```js
import { resolveCategoryFilter } from "../../lib/categories.js";
```

Replace the category-resolution block (around lines 26–29):
```js
const categoryRaw = searchParams.get("category");
const categorySlugs = categoryRaw ? categoryRaw.split(",").filter(Boolean) : [];
// Map slugs to DB display names and deduplicate
const categories = [...new Set(categorySlugs.map((s) => CATEGORY_SLUG_TO_DB[s] || s))];
```

With:
```js
const categoryRaw = searchParams.get("category");
const categorySlugs = categoryRaw ? categoryRaw.split(",").filter(Boolean) : [];
const { categoryDbValues, subcategorySlugs } = resolveCategoryFilter(categorySlugs);
const categories = categoryDbValues;
```

- [ ] **Step 2: Pass `p_subcategory` to the interleaved RPCs**

Around line 35–36, replace:
```js
const categoryDbParam = categories.length > 0 ? categories.join(",") : null;
```

With:
```js
const categoryDbParam = categories.length > 0 ? categories.join(",") : null;
const subcategoryParam = subcategorySlugs.length > 0 ? subcategorySlugs.join(",") : null;
```

Around lines 41–48 and 49–54, add `p_subcategory: subcategoryParam` to both `supabase.rpc` calls:

```js
supabase.rpc("get_interleaved_products", {
  p_store: store || null,
  p_category: categoryDbParam,
  p_subcategory: subcategoryParam,
  p_search: search || null,
  p_brand: brand || null,
  p_limit: limit,
  p_offset: offset,
}),
supabase.rpc("count_interleaved_products", {
  p_store: store || null,
  p_category: categoryDbParam,
  p_subcategory: subcategoryParam,
  p_search: search || null,
  p_brand: brand || null,
}),
```

- [ ] **Step 3: Add subcategory to the price-sort branch**

Around lines 89–99, replace:

```js
if (store) priceQuery = priceQuery.eq("store_domain", store);
if (categories.length === 1) priceQuery = priceQuery.eq("category", categories[0]);
else if (categories.length > 1) priceQuery = priceQuery.in("category", categories);
if (brand) priceQuery = priceQuery.ilike("brand", `%${brand}%`);
priceQuery = applySearchFilter(priceQuery, search);
```

With:

```js
if (store) priceQuery = priceQuery.eq("store_domain", store);
if (categories.length === 1) priceQuery = priceQuery.eq("category", categories[0]);
else if (categories.length > 1) priceQuery = priceQuery.in("category", categories);
if (subcategorySlugs.length === 1) priceQuery = priceQuery.eq("subcategory", subcategorySlugs[0]);
else if (subcategorySlugs.length > 1) priceQuery = priceQuery.in("subcategory", subcategorySlugs);
if (brand) priceQuery = priceQuery.ilike("brand", `%${brand}%`);
priceQuery = applySearchFilter(priceQuery, search);
```

- [ ] **Step 4: Add subcategory to the non-price-sort branch**

Around lines 134–146, mirror the same change. Replace:

```js
if (store) query = query.eq("store_domain", store);
if (categories.length === 1) query = query.eq("category", categories[0]);
else if (categories.length > 1) query = query.in("category", categories);
if (brand) query = query.ilike("brand", `%${brand}%`);
query = applySearchFilter(query, search);
```

With:

```js
if (store) query = query.eq("store_domain", store);
if (categories.length === 1) query = query.eq("category", categories[0]);
else if (categories.length > 1) query = query.in("category", categories);
if (subcategorySlugs.length === 1) query = query.eq("subcategory", subcategorySlugs[0]);
else if (subcategorySlugs.length > 1) query = query.in("subcategory", subcategorySlugs);
if (brand) query = query.ilike("brand", `%${brand}%`);
query = applySearchFilter(query, search);
```

- [ ] **Step 5: Sanity-check**

```bash
npm run lint && npm test
```

Expected: lint clean. Tests still pass.

- [ ] **Step 6: Commit (stay local — do not push)**

```bash
git add app/api/products/route.js
git commit -m "feat(products): filter feed by subcategory when leaf slug is selected"
```

---

## Task 16: Audit MoreFromStore, PDP, homepage for category filters

**Files:**
- Read-only audit: `app/components/MoreFromStore.js`, the PDP page, `app/page.js`

- [ ] **Step 1: Search the codebase for direct category filters**

```bash
grep -rn 'eq("category"\|\.in("category"' app/ --include="*.js"
```

Expected: hits in `app/api/products/route.js` (already updated). If hits appear in MoreFromStore / PDP / homepage / anywhere unexpected, apply the same `subcategory` filter pattern as Task 15.

- [ ] **Step 2: Document findings**

If no extra hits → note in PR body: "Audited MoreFromStore/PDP/homepage — none filter by category; no further changes."

If hits → add tasks here mirroring Task 15's filter pattern.

- [ ] **Step 3: Commit (only if any file was changed; stay local — do not push)**

```bash
git add <files>
git commit -m "feat(reads): thread subcategory filter through direct Supabase readers"
```

---

# Phase 5 — Push, verify, PR

## Task 17: End-to-end verification on Vercel preview

**Files:**
- No code changes. Final verification.

- [ ] **Step 1: Push the branch (now safe — DB is ready, code is complete)**

```bash
git push -u origin claude/friendly-cerf-47658a
```

Wait for Vercel to build the preview.

- [ ] **Step 2: Verify the leaf filters narrow correctly**

In the Vercel preview, open:
- `/feed?category=tops_tees` — count should match the dry-run "tees" count. Every visible title tee-shaped.
- `/feed?category=tops_hoodies_sweaters` — matches dry-run; hoodies/sweatshirts/sweaters/crewnecks/cardigans only.
- `/feed?category=tops_shirts_blouses` — shirts/blouses/polos/tanks only.
- `/feed?category=tops_knitwear` — knits/turtlenecks only.
- `/feed?category=jackets` — jacket-shaped pieces only.
- `/feed?category=coats` — coat-shaped pieces only.
- `/feed?category=bags` — bag-shaped pieces only.
- `/feed?category=accessories` — wearable accessories only.

- [ ] **Step 3: Verify parent filters unchanged**

- `/feed?category=tops` — count = `tees + hoodies_sweaters + shirts_blouses + knitwear + Tops-NULL`. Visually indistinguishable from pre-deploy.
- `/feed?category=jackets_coats` — same logic.
- `/feed?category=bags_accessories` — same logic.

- [ ] **Step 4: Verify NULL-subcategory rows appear under parent**

- `/feed?category=jackets_coats` should include "Puffer" / "Shearling" / "Cape" / "Caban" rows.
- `/feed?category=jackets` and `/feed?category=coats` must EXCLUDE them.

In the SQL Editor:
```sql
SELECT id, store_domain, handle, title
FROM products
WHERE category = 'Jackets & Coats' AND subcategory IS NULL
  AND available = true AND hidden = false
LIMIT 10;
```
Confirm these visible under parent, invisible under leaves.

- [ ] **Step 5: Verify CHECK constraint blocks bad writes**

```sql
UPDATE products SET subcategory = 'jackets' WHERE category = 'Tops' LIMIT 1;
```
Expected: `ERROR: new row for relation "products" violates check constraint "products_subcategory_matches_category"`.

- [ ] **Step 6: Verify enrich pipeline still works**

```bash
curl -X GET "$VERCEL_PREVIEW_URL/api/cron" -H "Authorization: Bearer $CRON_SECRET"
```

Or wait for next hourly tick. Check `enrich_runs`:
```sql
SELECT * FROM enrich_runs ORDER BY created_at DESC LIMIT 1;
```
Expected: `succeeded > 0`, no new error patterns. Existing subcategory values not clobbered (COALESCE protection).

- [ ] **Step 7: Open the PR**

```bash
gh pr create --title "feat(category): leaf-grained subcategory column for accurate filtering" --body "$(cat <<'EOF'
## Summary

- Add `products.subcategory` column with CHECK constraint enforcing leaf-belongs-to-parent.
- Extend `assignCategory()` to return `{ category, subcategory }` with three leaf helpers (`classifyTopsLeaf`, `classifyJacketsCoatsLeaf`, `classifyBagsAccessoriesLeaf`).
- Update `/api/products/route.js`, the two interleaved RPCs, and `enrich_product` RPC to filter and write subcategory.
- Backfill ~4,775 existing rows via SQL Editor (auditable wet-backfill file in `scripts/sql/`).

## Sequencing notes

Phases 1–2 ran locally. Phase 3 (schema + RPCs + wet backfill) was applied to production Supabase before any JS code was pushed — new RPC params default to NULL so `main` stayed live throughout. Phase 4 JS code was committed locally during Phase 3 then pushed as one branch in Phase 5.

## Test plan

- [ ] Vitest unit tests pass (`npm test`) — Tops, J&C, B&A leaf assignments + flat-bucket sanity
- [ ] Vercel preview: `/feed?category=tops_tees` returns only tee-shaped rows
- [ ] Vercel preview: `/feed?category=tops` count = sum of leaf counts + NULL count
- [ ] Vercel preview: parent slug includes NULL-subcategory rows; leaf slugs exclude them
- [ ] DB CHECK constraint rejects mismatched leaf/parent updates
- [ ] Enrich cron tick succeeds; existing subcategory values not clobbered (COALESCE protection)

Spec: `docs/superpowers/specs/2026-05-21-category-subcategory-granularity-design.md`
Plan: `docs/superpowers/plans/2026-05-21-category-subcategory-granularity-plan.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8: Merge only on explicit user instruction**

Per CLAUDE.md: "Do not push directly to `main`. Branch + Vercel preview every change. Merge only after explicit user instruction."

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| Schema change (column + CHECK) | Task 8 |
| Classifier rule decomposition (Tops/J&C/B&A) | Task 5 + tests in Tasks 2–4 |
| Test cases written FIRST | Tasks 2–4 precede Task 5 |
| enrich_product RPC update | Task 9 + caller updates in Task 13 (after RPC lands) |
| Dry-run backfill with review gate | Tasks 6–7 |
| Wet backfill via SQL file | Tasks 11–12 |
| Read-site updates (route + RPCs + direct reads) | Task 14 (categories.js), Task 15 (route.js), Task 16 (audit), Task 10 (RPCs) |
| Sequencing per CLAUDE.md | Phase 3 (DB) before Phase 4 (JS code that depends on DB); Phase 5 push gated until everything ready |
| Verification | Task 17 |

**Codex adversarial findings (2026-05-21):**
- Deployment-order hazard between Task 8 (was: route.js) and Task 16 (was: wet backfill) — FIXED by reordering into 5 phases. Phase 3 (DB) completes fully before Phase 4 (JS) starts, and explicit no-push gate spans Phase 1–4.
- Spec/plan ordering contradiction — FIXED. Plan now matches spec's "DB before code-that-depends-on-DB" sequencing.
- Two adjacent hazards Codex understated (RPC parameter mismatch in `/api/enrich`, column-missing error in route filter) — also FIXED by the same reorder + the explicit "production main stays working throughout" note in Phase 3.

**Placeholder scan:** No "TBD" / "TODO" / "fill in later" / "similar to". Every step has actual code or commands.

**Type consistency:** `assignCategory` returns `{ category, subcategory }` everywhere. `resolveCategoryFilter` returns `{ categoryDbValues, subcategorySlugs }` consistently. Helper names (`classifyTopsLeaf` / `classifyJacketsCoatsLeaf` / `classifyBagsAccessoriesLeaf` / `classifyLeaf`) consistent across plan.

**Scope:** 17 tasks across 5 phases for one feature. Each phase is internally cohesive; phase boundaries are natural pause/review points.
