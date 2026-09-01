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
  hash (FNV-1a + murmur3 fmix32 finalizer — see Change) instead of MD5 (not available in
  the browser without a dep). Same behavior class; byte-identical parity with the feed's
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

// Deterministic, dependency-free stand-in for the RPC's MD5 store shuffle.
// FNV-1a ALONE IS NOT ENOUGH: hashing `domain + ":" + seed` leaves adjacent
// week seeds producing identical store orders for ~10 weeks straight
// (verified empirically against the FALLBACK_STORES domains). The murmur3
// fmix32 finalizer over fnv1a(domain) XOR (seed * golden-ratio constant)
// gives full avalanche — verified: 16 distinct orders for 16 consecutive
// seeds on the same domain set.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function fmix32(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16; return h >>> 0;
}
const storePosition = (domain, weekSeed) =>
  fmix32(fnv1a(domain) ^ Math.imul(weekSeed, 0x9e3779b1));

function interleaveByStore(products, weekSeed) {
  // 1. bucket by product.storeDomain, each bucket sorted by the existing
  //    byNewest comparator PLUS the existing identity tie-break:
  //    syncedAt DESC (nulls last) || code-unit compare of identity strings.
  //    The tie-break is REQUIRED: rule queries have no ORDER BY and same-batch
  //    rows share timestamps (cron stamps one syncStart per run), so
  //    timestamp-only ordering is nondeterministic across cache refreshes.
  //    Reuse the existing identity() helper (storeDomain::handle) for the KEY,
  //    but compare with a locale-INDEPENDENT code-unit comparator
  //    (a < b ? -1 : a > b ? 1 : 0), NOT localeCompare: default-locale
  //    localeCompare varies by runtime/ICU, so server and browser could break
  //    ties differently — reintroducing the hydration reshuffle the
  //    server-passed seed exists to prevent. While here, switch the shared
  //    `tie` helper in sortArchiveProducts to the same code-unit compare
  //    (both orders are arbitrary; only determinism matters).
  // 2. store position = storePosition(storeDomain, weekSeed), ascending
  //    (hash ties broken by code-unit compare of storeDomain for determinism)
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
  third parameter, but the default is the FIXED constant `0` — never a clock read.
  A missing/unthreaded seed then degrades to a deterministic, hydration-safe (merely
  non-rotating) order instead of silently reopening the server/client clock-divergence
  path. The ONLY `Date.now()` in the feature lives in the server page.
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
- Rotation actually rotates: with ≥3 stores, assert that a run of **consecutive** seeds
  (e.g. 5 adjacent week numbers around the current one) produces multiple distinct store
  orders — NOT two cherry-picked seeds, which would pass even under the weak
  FNV-suffix scheme this spec explicitly rejects. Also assert exact order for one fixed
  seed (determinism).
- Tie-break is locale-independent: include handles with punctuation/mixed case whose
  ordering differs between localeCompare and code-unit compare; assert code-unit order.
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
5. Code check: confirm `weekSeed` is passed page → `ArchiveProductsClient` →
   `sortArchiveProducts` and appears in the `visible` useMemo dependency array (an
   unthreaded prop silently falls back to the client-computed default, resurrecting the
   hydration-divergence risk).
