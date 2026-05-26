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

Narrow the bypass to the genuinely broken shape. Two parts:

1. **Normalize away redundant leaf pairs.** A leaf whose category is
   already in `parentCategories` is subsumed by the parent (e.g.
   `?category=tops,tops_tees` — "All Tops" + "Tees" — "All Tops"
   already covers Tees). The `categories.test.js` suite documents this
   shape at lines 53–61 as a supported UI selection, so we cannot let
   it slip through to the newest-first fallback.
2. **Treat only true cross-group mixes as broken.** After
   normalization, `hasMixedShape` is true only when at least one leaf
   pair remains in a parent that's *not* selected (e.g.
   `?category=tops,jackets` — "All Tops" + "Jackets" leaf in
   J&C group). That genuinely cannot be expressed by the current RPC's
   AND'd WHERE and stays on the direct-query fallback.

Code-only change in `app/api/products/route.js`. No SQL change, no
Supabase migration, no follow-up PR.

## Changes

### `app/api/products/route.js`

Replace lines 84–104 (bypass condition + RPC call block). New shape:

```js
// Drop leaf filters whose category is already covered by a parent
// selection — they're redundant (the parent subsumes them) and must
// not push this request onto the newest-first fallback. UI lets users
// toggle "All <Group>" and a child of the same group independently;
// categories.test.js:53-61 documents `?category=tops,tops_tees` as a
// supported shape.
const effectiveLeafFilters = leafFilters.filter(
  (lf) => !parentCategories.includes(lf.category),
);

// The RPC's WHERE ANDs category and subcategory; that only drops rows
// when a request mixes parent-only entries with leaf pairs IN A
// DIFFERENT PARENT. Pure-leaf, multi-leaf, and same-parent parent+leaf
// (post-normalization) all work because the
// products_subcategory_matches_category CHECK constraint binds each
// subcategory to one category, so AND'd ANY() lists across both axes
// still return the right rows.
const hasMixedShape =
  parentCategories.length > 0 && effectiveLeafFilters.length > 0;
const useInterleavedRpc = (!sort || sort === "interleaved") && !hasMixedShape;

if (useInterleavedRpc) {
  // Backfill effective leaves' parent categories into p_category so the
  // row set is constrained on category before subcategory matching.
  // Dedup keeps the CSV tidy; ANY() handles repeats either way.
  const categoryParts = [
    ...parentCategories,
    ...effectiveLeafFilters.map((lf) => lf.category),
  ];
  const subcategoryParts = effectiveLeafFilters.map((lf) => lf.subcategory);
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

| User picks | parents | leaves | effective leaves | mixed? | Path today | Path after | Outcome |
|---|---|---|---|---|---|---|---|
| Nothing | `[]` | `[]` | `[]` | no | RPC | RPC | unchanged |
| "All Tops" | `[Tops]` | `[]` | `[]` | no | RPC | RPC | unchanged |
| "Hoodies" (single leaf) | `[]` | `[(Tops,h)]` | `[(Tops,h)]` | no | direct | **RPC** | **fixed** |
| "Hoodies"+"Knitwear" (same parent) | `[]` | `[(Tops,h),(Tops,k)]` | `[(Tops,h),(Tops,k)]` | no | direct | **RPC** | **fixed** |
| "Hoodies"+"Coats" (cross-parent leaves) | `[]` | `[(Tops,h),(J&C,c)]` | `[(Tops,h),(J&C,c)]` | no | direct | **RPC** | **fixed** |
| "All Tops"+"Hoodies" (redundant same-parent) | `[Tops]` | `[(Tops,h)]` | `[]` | no (normalized) | direct | **RPC** | **fixed** |
| "All Tops"+"Tees" (redundant same-parent) | `[Tops]` | `[(Tops,tees)]` | `[]` | no (normalized) | direct | **RPC** | **fixed** |
| "All Tops"+"Jackets" (true cross-group mix) | `[Tops]` | `[(J&C,jackets)]` | `[(J&C,jackets)]` | yes | direct | direct | unchanged (residual) |
| Any filter + `sort=price_asc/desc` | * | * | * | * | direct | direct | unchanged |
| Any filter + `sort=oldest` | * | * | * | * | direct | direct | unchanged |

Only true cross-group mixes (a parent selected plus a leaf in a
*different* parent) remain on the direct-query newest-first path. That
shape requires OR-aware SQL the current RPC cannot express; closing it
needs a v2 RPC and is deliberately out of scope.

## Verification

End-to-end check on Vercel preview (per CLAUDE.md workflow — verify on
preview, not localhost):

1. `/feed?category=tops_hoodies_sweaters` — first ~30 cards span ≥3
   distinct stores, in chunks of up to 6 per store before rotating.
2. `/feed?category=tops_hoodies_sweaters,tops_knitwear` — multi-leaf same
   parent; same store-spread.
3. `/feed?category=tops_hoodies_sweaters,coats` — multi-leaf cross-parent;
   same store-spread.
4. `/feed?category=tops,tops_tees` — **redundant same-parent mix
   (Codex-flagged case)**: must now interleave, not fall to newest-first.
   The normalized leaf list is empty, so this should match `/feed?category=tops`
   card-for-card.
5. `/feed?category=tops` (parent-only) — unchanged from today.
6. `/feed` (unfiltered) — unchanged from today.
7. `/feed?category=tops,jackets` — **true cross-group mix**: stays on
   newest-first direct query. Document, do not regress. If product later
   wants this interleaved, that's a separate v2-RPC PR.
8. `/feed?category=tops_hoodies_sweaters&sort=price_asc` — stays on
   JS-sort path (unchanged from today).
9. Load More on each of the above paginates correctly (no duplicate or
   missing cards across the page boundary).

Existing tests:
- [app/lib/__tests__/categories.test.js:53-61](app/lib/__tests__/categories.test.js)
  documents the redundant-mix shape that step 4 verifies. The resolver
  output is unchanged; the route's normalization is the new behavior.
- [app/lib/__tests__/productQueries.test.js](app/lib/__tests__/productQueries.test.js)
  covers the RPC wrapper shape and continues to pass unchanged.

A small route-level test asserting RPC vs direct routing decisions for
the four shapes (pure leaf, multi-leaf, redundant same-parent mix, true
cross-group mix) would tighten the safety net but is optional given the
preview-URL verification list above.

## Risks

- **~3%**: an unusual slug combination produces an unexpected CSV in the
  backfill. Caught on preview by clicking the affected URL.
- **~0%** deploy risk. Function-local code change behind the existing
  entry point. Vercel preview → merge → ship.
- **0%** SQL/Supabase risk. No database change.

## Out of scope

- **True cross-group mixed interleaving** — i.e. parent selected plus a
  leaf in a *different* parent (`?category=tops,jackets`). Requires an
  OR-aware v2 RPC; deferred to a separate PR if it becomes a real
  complaint. Same-parent redundant mixes are handled by the
  normalization step above and not residual.
- Changing chunk granularity (still 6 per store, per user direction).
- Sort-bypass behavior (price/oldest still bypass interleaving — by
  design today).

## Deliverables

- One PR against `main`, branch `claude/angry-swartz-89fa4e`.
- This spec file, committed to the branch.
- One code change in `app/api/products/route.js`.
- Verification on Vercel preview before merge.
