# Spec: restore interleaving for leaf-filtered feeds

## Context

The unfiltered main feed at `/feed` calls `get_interleaved_products`, which
spreads products across stores so no one store dominates (weekly
MD5-seeded store ordering, chunks of 6 products per store, then rotates).

When a subcategory ("leaf") filter is applied — e.g. category slug
`tops_hoodies_sweaters` — [app/api/products/route.js:84-85](../../../app/api/products/route.js)
bypasses the RPC and falls back to a plain `synced_at DESC` direct query.
Whichever store has the most recently synced rows for that subcategory
monopolises the first N pages until its inventory is exhausted. Dolce
Vita dominates the hoodies filter today; the same will happen for any
leaf where one store has deep recent inventory.

Goal: filtered feeds use the same 6-per-store rotation the unfiltered
feed already uses. Match today's pattern, no new behavior.

## Root cause

`route.js:84-85`:
```js
const hasLeafFilters = leafFilters.length > 0;
const useInterleavedRpc = (!sort || sort === "interleaved") && !hasLeafFilters;
```

The bypass exists because the RPC's WHERE ANDs `p_category` and
`p_subcategory` independently, which silently drops parent rows when a
request mixes parent-only entries with leaf pairs. But the guard is
broader than the bug — it fires on **any** leaf filter, including
pure-leaf and multi-leaf requests where the RPC works correctly. The
`products_subcategory_matches_category` CHECK constraint binds each
subcategory value to exactly one category, so AND'd `ANY()` lists across
both axes still return the right rows for every non-mixed shape.

## Decision

Narrow the bypass to the genuinely broken shape: `parentCategories.length
> 0 AND leafFilters.length > 0`. Code-only change in
`app/api/products/route.js`. No SQL change, no Supabase migration, no
follow-up PR.

## Changes

### `app/api/products/route.js`

Replace lines 84–104 (bypass condition + RPC call block). New shape:

```js
// The RPC's WHERE ANDs category and subcategory; that only drops rows when
// a request mixes parent-only entries with leaf pairs. Pure-leaf and
// multi-leaf shapes work because the products_subcategory_matches_category
// CHECK constraint binds each subcategory to one category, so AND'd ANY()
// lists across both axes still return the right rows.
const hasMixedShape = parentCategories.length > 0 && leafFilters.length > 0;
const useInterleavedRpc = (!sort || sort === "interleaved") && !hasMixedShape;

if (useInterleavedRpc) {
  // Backfill leaves' parent categories into p_category so the row set is
  // constrained on category before subcategory matching. Dedup keeps the
  // CSV tidy; ANY() handles repeats either way.
  const categoryParts = [
    ...parentCategories,
    ...leafFilters.map((lf) => lf.category),
  ];
  const subcategoryParts = leafFilters.map((lf) => lf.subcategory);
  const categoryDbParam = categoryParts.length
    ? [...new Set(categoryParts)].join(",")
    : null;
  const subcategoryDbParam = subcategoryParts.length
    ? subcategoryParts.join(",")
    : null;

  const [{ data, error }, { data: countData, error: countError }] =
    await Promise.all([
      fetchInterleavedProducts({
        store: store || null,
        category: categoryDbParam,
        subcategory: subcategoryDbParam,
        search: search || null,
        brand: brand || null,
        limit,
        offset,
      }),
      countInterleavedProducts({
        store: store || null,
        category: categoryDbParam,
        subcategory: subcategoryDbParam,
        search: search || null,
        brand: brand || null,
      }),
    ]);

  if (error || countError) {
    const msg = error?.message || countError?.message;
    console.error("RPC error:", msg);
    return Response.json(
      { error: "Failed to fetch products", detail: msg },
      { status: 500 },
    );
  }

  const products = (data || []).map(mapProductRow);
  return Response.json({ products, total: Number(countData), page, limit });
}
```

Update the inline comment block above the bypass (currently lines 78–83)
to match the narrower guard.

### No other files change

- `app/lib/productQueries.js` — `fetchInterleavedProducts` /
  `countInterleavedProducts` already accept `subcategory` and pass it as
  `p_subcategory`. No change.
- `app/lib/categories.js` — `resolveCategoryFilter` already returns the
  right `{parentCategories, leafFilters}` shape. No change.
- Supabase RPCs — `get_interleaved_products` and
  `count_interleaved_products` already accept `p_subcategory` (since the
  2026-05-21 migration). No SQL change.
- `app/editorial/_lib/fetchEditorialProducts.js` — second RPC consumer;
  passes brand-only, no categories. Unaffected.

## Behavior matrix

| User picks | parents | leaves | mixed? | Path today | Path after | Outcome |
|---|---|---|---|---|---|---|
| Nothing | `[]` | `[]` | no | RPC | RPC | unchanged |
| "All Tops" | `[Tops]` | `[]` | no | RPC | RPC | unchanged |
| "Hoodies" (single leaf) | `[]` | `[(Tops,h)]` | no | direct | **RPC** | **fixed** |
| "Hoodies"+"Knitwear" (same parent) | `[]` | `[(Tops,h),(Tops,k)]` | no | direct | **RPC** | **fixed** |
| "Hoodies"+"Coats" (cross-parent) | `[]` | `[(Tops,h),(J&C,c)]` | no | direct | **RPC** | **fixed** |
| "All Tops"+"Coats" (mixed) | `[Tops]` | `[(J&C,c)]` | yes | direct | direct | unchanged (residual) |
| "All Tops"+"Hoodies" (mixed redundant) | `[Tops]` | `[(Tops,h)]` | yes | direct | direct | unchanged (residual) |
| Any filter + `sort=price_asc/desc` | * | * | * | direct | direct | unchanged |
| Any filter + `sort=oldest` | * | * | * | direct | direct | unchanged |

The two "residual" rows are mixed parent+leaf — rare combinations in the
UI. They stay on the direct-query path with newest-first ordering, same
as today. No regression.

## Verification

End-to-end check on Vercel preview (per CLAUDE.md workflow — verify on
preview, not localhost):

1. `/feed?category=tops_hoodies_sweaters` — first ~30 cards span ≥3
   distinct stores, in chunks of up to 6 per store before rotating.
2. `/feed?category=tops_hoodies_sweaters,tops_knitwear` — multi-leaf same
   parent; same store-spread.
3. `/feed?category=tops_hoodies_sweaters,coats` — multi-leaf cross-parent;
   same store-spread.
4. `/feed?category=tops` (parent-only) — unchanged from today.
5. `/feed` (unfiltered) — unchanged from today.
6. `/feed?category=tops,coats` (mixed parent+leaf) — stays on newest-first
   direct query (unchanged from today; residual case).
7. `/feed?category=tops_hoodies_sweaters&sort=price_asc` — stays on
   JS-sort path (unchanged from today).
8. Load More on each of the above paginates correctly (no duplicate or
   missing cards across the page boundary).

Existing test in `app/lib/__tests__/productQueries.test.js` covers the RPC
wrapper shape and continues to pass unchanged. No new test file is
strictly required for a guard-narrowing change of this size.

## Risks

- **~3%**: an unusual slug combination produces an unexpected CSV in the
  backfill. Caught on preview by clicking the affected URL.
- **~0%** deploy risk. Function-local code change behind the existing
  entry point. Vercel preview → merge → ship.
- **0%** SQL/Supabase risk. No database change.

## Out of scope

- Mixed parent+leaf interleaving (residual rows in the table above). A
  future PR with a v2 RPC could close that gap; not done now because the
  user-facing complaint is single-leaf dominance, mixed-shape combinations
  are rare in the UI, and there is no regression vs. today.
- Changing chunk granularity (still 6 per store, per user direction).
- Sort-bypass behavior (price/oldest still bypass interleaving — by
  design today).

## Deliverables

- One PR against `main`, branch `claude/angry-swartz-89fa4e`.
- This spec file, committed to the branch.
- One code change in `app/api/products/route.js`.
- Verification on Vercel preview before merge.
