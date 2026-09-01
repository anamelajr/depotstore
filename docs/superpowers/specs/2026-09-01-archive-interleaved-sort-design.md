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
`sortArchiveProducts`), and every row carries `store_domain` + `synced_at`, so this is a
pure-JS change — no RPC, query, or server changes.

## Decisions made with user

- **Store order rotates weekly, like the feed.** Implemented with a cheap deterministic
  string hash (FNV-1a) of `store_domain + weekSeed` instead of MD5 (not available in the
  browser without a dep). Same behavior class; byte-identical parity with the feed's
  weekly permutation is not observable and not required.
- Only the `"interleaved"` case changes; `"latest"`, price sorts, etc. stay as-is.

## Change

**File: [app/lib/archiveProductFilters.js](app/lib/archiveProductFilters.js)** (only file)

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

function interleaveByStore(products) {
  const weekSeed = Math.floor(Date.now() / 1000 / WEEK_SECONDS);
  // 1. bucket by store_domain, each bucket sorted newest synced_at first
  //    (same string-descending compare byNewest already uses; null/missing last)
  // 2. store position = fnv1a(store_domain + ":" + weekSeed), ascending
  //    (ties broken by store_domain for full determinism)
  // 3. emit ordered by (Math.floor(rankInStore / GROUP_SIZE), storePosition, rankInStore)
}
```

Notes:
- Keep it a pure function of the input array (plus the week seed) — it runs after
  `filterProductsByCategories`, so category filtering keeps working unchanged, and
  re-runs correctly when filters change.
- Products with missing `store_domain` go in a single fallback bucket (key `""`) rather
  than being dropped.
- Update the doc comment at the top of `sortArchiveProducts` (currently states
  `"interleaved"` is an alias for newest) and the case list.
- No changes to `ArchiveProductsClient`, `fetchArchiveProducts`, sort-option labels, or
  the RPCs. `fetchArchiveProducts`'s own `.sort()` (server-side newest-first) stays — it
  just provides a stable input order.
- Week seed uses `Date.now()` in the client; the SQL uses `CURRENT_DATE` (UTC midnight).
  Both floor to the same 604800s bucket except within the same UTC day's partial week —
  irrelevant, since parity with the feed's exact permutation is already non-goal.

## Tests

Follow the repo's existing test layout for `app/lib` helpers (check for an existing
`archiveProductFilters` test file first). Cases for `sortArchiveProducts(products, "interleaved")`:
- Two stores × 8 products each → output is blocks of 6: 6 from store X, 6 from store Y,
  then 2 + 2 remainder, with each store's block newest-first.
- Store order is deterministic for a fixed week seed (may need to expose the seed as an
  optional arg for testability, defaulting to the current week).
- Products lacking `store_domain` or `synced_at` are kept, not dropped.
- Other sort keys (`"latest"`, price) are untouched.

## Verification

1. `npm run dev` (worktree needs `.env.local` + `npm ci` per memory note), open
   `/archives/margiela-1988-2009` via the preview pane.
2. Confirm the top of the grid alternates stores in groups of ≤6 instead of one long
   Dolce Vita Hub run; apply a category filter and confirm the interleave re-applies.
3. Switch to another sort and back; confirm non-interleaved sorts unchanged.
4. Run the test suite / the new test file.
