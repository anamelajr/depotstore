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

Goal: every filter shape **except parent + cross-group leaf** uses the
same 6-per-store rotation the unfiltered feed already uses. Specifically
in scope: pure-leaf filters, multi-leaf filters (same parent or across
parents), and redundant same-parent mixes (`?category=tops,tops_tees`).
Explicitly out of scope: `?category=tops,jackets` and other parent +
cross-group-leaf shapes — they stay on the existing newest-first
direct-query path and may still exhibit store dominance until a future
OR-aware v2 RPC. Acceptance criteria match this scope, not the broader
"all filters interleave" framing.

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

### Required new test coverage

Route-level routing-decision test is a **required** deliverable, not
optional. The guard condition is the load-bearing part of this change;
a small mistake (off-by-one in `hasMixedShape`, wrong dedup,
`leafFilters` leaking into the RPC path instead of `effectiveLeafFilters`)
silently degrades to newest-first or drops rows, neither of which
preview spot-checks reliably catch.

Add tests covering each routing decision and the params passed:

| Input slug list | Expected path | Expected `p_category` | Expected `p_subcategory` |
|---|---|---|---|
| `[]` (unfiltered) | RPC | `null` | `null` |
| `["tops"]` (parent only) | RPC | `"Tops"` | `null` |
| `["tops_hoodies_sweaters"]` (pure leaf) | RPC | `"Tops"` | `"hoodies_sweaters"` |
| `["tops_hoodies_sweaters","tops_knitwear"]` (multi-leaf same parent) | RPC | `"Tops"` | `"hoodies_sweaters,knitwear"` |
| `["tops_hoodies_sweaters","coats"]` (multi-leaf cross-parent) | RPC | `"Tops,Jackets & Coats"` | `"hoodies_sweaters,coats"` |
| `["tops","tops_tees"]` (redundant same-parent) | RPC | `"Tops"` | `null` (leaf normalized away) |
| `["tops","jackets"]` (true cross-group mix) | direct fallback | n/a | n/a |
| `["tops_hoodies_sweaters"]` + `sort=price_asc` | direct fallback | n/a | n/a |

Stub `fetchInterleavedProducts` / `countInterleavedProducts` (or
`supabase.from`) and assert which one is called and with which params,
mirroring the mocking pattern in `productQueries.test.js`. Preview
verification supplements these tests; it does not replace them.

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

Two-phase delivery on branch `claude/angry-swartz-89fa4e`:

**Phase 1 — spec (this commit and the prior `1a6f599`/`378e9f2`):**
- This spec file, committed.

**Phase 2 — implementation (next commit, not yet present on branch):**
- Code change in `app/api/products/route.js` matching the snippet in
  the [Changes](#changes) section.
- Route-level routing-decision test per the
  [Required new test coverage](#required-new-test-coverage) section.
- Verification on Vercel preview against every URL in
  [Verification](#verification) before opening the PR for merge.

A reviewer of the branch at any commit between Phase 1 and Phase 2 will
see only the spec. The feed fix is not live until Phase 2 lands.
