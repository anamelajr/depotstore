# Archive "interleaved" sort: real store interleaving

## Context

On archive pages (e.g. `/archives/margiela-1988-2009`), the default sort is labelled
`"interleaved"` but is a documented no-op alias for newest-`synced_at`-first
([archiveProductFilters.js:130-153](app/lib/archiveProductFilters.js)). Because the hourly
Shopify sync writes each store's rows in a batch, one store's products share
near-identical `synced_at` values and clump into a contiguous block — hence ~30
Dolce Vita Hub products leading the Margiela archive grid.

The regular feed avoids this via `get_interleaved_products`
([scripts/sql/2026-05-21-interleaved-rpcs.sql](scripts/sql/2026-05-21-interleaved-rpcs.sql)):
within-store rank by `synced_at` DESC, store order = `ROW_NUMBER() OVER (ORDER BY
MD5(store_domain || weekly_seed))` where `weekly_seed = FLOOR(EPOCH(CURRENT_DATE)/604800)`,
final order = `(FLOOR((store_rank-1)/6), store_position, store_rank)` — i.e. blocks of 6
per store, round-robined, store order rotating weekly.

Goal: make the archive's `"interleaved"` sort reproduce that pattern. The archive ships
its full product set to the client and sorts in JS (`ArchiveProductsClient` →
`sortArchiveProducts`), and every row carries the fields needed, so this is a pure-JS
change — no RPC or query changes.

**Field-name contract (invariant):** `fetchArchiveProducts` returns rows mapped through
`mapProductRow` — the helper sees **`storeDomain`** and **`syncedAt`** (camelCase), NOT
the DB's `store_domain`/`synced_at`. All bucketing/sorting below uses the camelCase
names; a test must assert that two distinct `storeDomain` values produce two buckets.

## Decisions made with user

- **Store order rotates weekly, like the feed.** Implemented with a cheap deterministic
  string hash (FNV-1a) of `store_domain + weekSeed` instead of MD5 (not available in the
  browser without a dep). Same behavior class; byte-identical parity with the feed's
  weekly permutation is not observable and not required.
- Only the `"interleaved"` case changes; `"latest"`, price sorts, etc. stay as-is.

## Change

**Files:** [app/lib/archiveProductFilters.js](app/lib/archiveProductFilters.js) (the
interleave), plus a small seed-plumbing prop through
[app/archives/[slug]/page.js](app/archives/[slug]/page.js) and
[app/components/archive/ArchiveProductsClient.js](app/components/archive/ArchiveProductsClient.js)
(see week-seed note below).

In `sortArchiveProducts`, replace the fall-through `"interleaved" → byNewest` case with a
real interleave:

```js
const GROUP_SIZE = 6;
const WEEK_SECONDS = 604800;

// FNV-1a — deterministic, dependency-free stand-in for the RPC's MD5 store shuffle.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function interleaveByStore(products, weekSeed) {
  // 1. bucket by product.storeDomain, each bucket sorted by the existing
  //    byNewest comparator PLUS the existing identity tie-break:
  //    syncedAt DESC (nulls last) || identity(a).localeCompare(identity(b)).
  //    The tie-break is REQUIRED: rule queries have no ORDER BY and same-batch
  //    rows share timestamps, so timestamp-only ordering is nondeterministic
  //    across cache refreshes. Reuse the existing identity() helper
  //    (storeDomain::handle) — do not invent a new key.
  // 2. store position = fnv1a(storeDomain + ":" + weekSeed), ascending
  //    (hash ties broken by storeDomain for full determinism)
  // 3. emit ordered by (Math.floor(rankInStore / GROUP_SIZE), storePosition, rankInStore)
}
```

Notes:
- Keep it a pure function of the input array (plus the week seed) — it runs after
  `filterProductsByCategories`, so category filtering keeps working unchanged, and
  re-runs correctly when filters change.
- Products with missing `storeDomain` go in a single fallback bucket (key `""`) rather
  than being dropped.
- **Week seed is computed ONCE, server-side, and passed down** — never from `Date.now()`
  inside the client component. `ArchiveProductsClient` is SSR'd + hydrated; independent
  server/client clock reads can land in different weekly buckets (boundary crossing or
  client clock skew), producing a hydration-order mismatch and a visible grid reshuffle.
  Instead: `app/archives/[slug]/page.js` computes
  `weekSeed = Math.floor(Date.now() / 1000 / WEEK_SECONDS)` and passes it as a prop;
  `ArchiveProductsClient` threads it into `sortArchiveProducts(list, sort, weekSeed)` and
  includes it in the `visible` useMemo deps. `sortArchiveProducts` keeps a defaulted
  third parameter (compute-current-week fallback) so other callers/tests don't break.
  **Non-goal:** live rotation on a page left open across a week boundary — the new seed
  applies on next navigation/revalidate; no boundary timer.
- Update the doc comment at the top of `sortArchiveProducts` (currently states
  `"interleaved"` is an alias for newest) and the case list.
- No changes to `fetchArchiveProducts`, sort-option labels, or the RPCs.
  `fetchArchiveProducts`'s own `.sort()` (server-side newest-first) stays, but the
  interleave must NOT rely on input order — its own comparator (with tie-break) is the
  sole source of determinism.

## Tests

Extend the existing `app/lib/__tests__/archiveProductFilters.test.js`. Cases for
`sortArchiveProducts(products, "interleaved", weekSeed)` — build fixtures with the
**mapped shape** (`storeDomain`, `syncedAt`, `handle`), the shape `fetchArchiveProducts`
actually returns:
- Two stores × 8 products each → output is blocks of 6: 6 from store X, 6 from store Y,
  then 2 + 2 remainder, with each store's block newest-first; assert two distinct
  `storeDomain` values yield two interleaved buckets (guards the camelCase contract).
- Store order is deterministic for a fixed explicit week seed.
- Determinism under input shuffling: shuffle/reverse an input containing identical
  `syncedAt` values → output identical (exercises the identity tie-break).
- Products lacking `storeDomain` or `syncedAt` are kept, not dropped.
- Other sort keys (`"latest"`, price) are untouched.

## Verification

1. `npm run dev` (worktree needs `.env.local` + `npm ci` per memory note), open
   `/archives/margiela-1988-2009` via the preview pane.
2. Confirm the top of the grid alternates stores in groups of ≤6 instead of one long
   Dolce Vita Hub run; apply a category filter and confirm the interleave re-applies.
3. Switch to another sort and back; confirm non-interleaved sorts unchanged.
4. Run the test suite / the new test file.
