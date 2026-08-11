# Hide zero-priced ("not for sale" / rental) items everywhere on the site

## Context

Grain de Sell (and Numero 13) publish archive pieces on Shopify with `price: 0.00`; their
descriptions say "NOT FOR SALE" / rental. Those rows sync faithfully into `products.price`
as `'€0.00'` and render as "€0" cards (e.g. `miu-miu-fw1999-leather-long-coat`).

**Requirement:** a product priced at zero must not be visible anywhere on the site — not in
the feed, not on editorial surfaces, and not on its own detail page via a direct link.

Approach: a **read-time exclusion**, applied at every product-read surface. No data mutation
and no `hidden` writes (that column belongs to enrich), so removing the filter later restores
every item instantly. The sync keeps mirroring `€0.00` faithfully.

### Verified facts this plan depends on

- **The zero literal is exactly `'€0.00'`.** Confirmed against production: all 408 zero rows
  use that identical spelling; there are no `'€0'` / `'€0,00'` / blank / NULL price rows.
  The mapper (`shopifyFetch.js:100`) always formats `€${n.toFixed(2)}`, so an exact-match
  exclusion is safe. NULL price stays *allowed* — null means "unknown", not "not for sale".
- **All 408 zero rows have `hidden = false`**, so `withCuratedVisibility` (hidden-only) does
  not filter them today — editorial surfaces need the rule too.
- **Chained `.or()` calls are ANDed by PostgREST** (documented at `fetchProductsPage.js:49`),
  so adding a third `.or()` composes safely with the existing category and search `.or()`s.
- **The detail page does not use `withVisibility` at all** — `resolveProductDetail` fetches by
  handle + store_domain only, and computes price from the **live Shopify fetch**, not the DB
  (`resolveProductDetail.js:151-156`). So the detail gate must key off that computed value.

## Changes

### 1. `app/lib/productQueries.js` — both visibility helpers

Add one shared exclusion used by both helpers, so the rule has a single definition:

```js
const ZERO_PRICE = "€0.00";

// Stores publish "not for sale" / rental archive pieces at 0.00; those must not
// surface anywhere. NULL price stays visible — null means unknown, not unsellable.
// The .or() value is double-quoted per the PostgREST escaping rule (contains dots).
function excludeZeroPrice(query) {
  return query.or(`price.is.null,price.neq."${ZERO_PRICE}"`);
}

export function withVisibility(query) {
  return excludeZeroPrice(query.eq("available", true).eq("hidden", false));
}

export function withCuratedVisibility(query) {
  return excludeZeroPrice(query.eq("hidden", false));
}
```

This covers every direct-query surface at once: `fetchProductsPage.js` (both branches,
including the fetch-all price sort), `MoreFromStore.js`, `fetchHomepagePicks.js`,
`fetchEditorialProducts.js`, admin search, and the enrich batch select + remaining count
(both share `withVisibility`, so the batch/remaining-count parity invariant holds).

### 2. `app/lib/resolveProductDetail.js` — gate the detail page

Immediately after `price` is computed (currently line 156), before any description
generation or cache-back write:

```js
// Zero-priced pieces are the stores' "not for sale" / rental archive; the feed
// excludes them, so a direct link must 404 rather than render a €0 product page.
if (minPrice === 0) return null;
```

`ProductPage` already renders "Product not found." when `resolveProductDetail` returns null,
so no page-level change is needed. Placing the gate before `generateDescription` also stops
OpenAI spend on pages that will never render.

Note this keys off the live Shopify price, which is the value that would otherwise be
displayed — so it stays correct even if the DB row is stale between hourly syncs.

### 3. Interleaved RPCs (Supabase, not git) — new migration

New file `scripts/sql/2026-08-11-exclude-zero-price.sql` redefining **both** RPCs. Base each
body on its current source of truth:

- `get_interleaved_products` → `scripts/sql/2026-05-28-add-image-url-2.sql` (adds `image_url_2`)
- `count_interleaved_products` → `scripts/sql/2026-05-21-interleaved-rpcs.sql` (never
  redefined since; the 05-28 file states at line 15 that it deliberately leaves it untouched)

Add to **all three** visibility WHERE sites — the `store_order` CTE and the `ranked` CTE in
the get function, plus the count function:

```sql
AND (price IS NULL OR price <> '€0.00')
```

(use `p.price` in the sites that alias the table; `store_order` references it unaliased).

Preserve the existing DROP+CREATE / grant handling from the 05-28 file for the get function.
Per the workflow invariant this SQL applies in the **Supabase SQL Editor before the code
merges** (MCP is read-only) — hand the file over to run, then verify with read-only MCP.

### 4. Tests

`app/lib/__tests__/productQueries.test.js`: extend both helper tests. The existing nth-call
`.eq` assertions tolerate an appended call, so add coverage that each helper issues the
`.or()` with the double-quoted `"€0.00"` value and the `price.is.null` disjunct, and that
`withCuratedVisibility` still does not touch `available`.

Add a `resolveProductDetail` case asserting a product whose Shopify variants are all `0.00`
resolves to `null` (and that `generateDescription` is not called for it).

### 5. Surfaces deliberately unchanged

- **Sync / cron** — still mirrors `€0.00`; `hidden` is not in the upsert payload.
- **Inventory snapshot / analytics / archive** — intentionally capture hidden and sold rows so
  history stays complete. The snapshot test asserts zero `.eq()` calls; add nothing there.
- **`searchAliases.js`** — alias-expansion counting, not a display surface.

## Verification

1. `npm test` (vitest) — productQueries + resolveProductDetail tests pass.
2. After the SQL is applied, read-only MCP checks. **Use named arguments only** — the get
   RPC's positional order is `(p_store, p_category, p_search, p_brand, p_limit, p_offset,
   p_subcategory)` (`p_subcategory` was appended after the paging params in the 05-28
   migration), so positional calls silently misroute the limit/offset and can return an
   empty set, making the checks pass vacuously. The RPC returns `price` directly, so no
   join is needed.

   ```sql
   -- a) independent whole-population check straight off the table: rows the new
   --    predicate should expose (the RPC output can never exceed this set)
   SELECT count(*) FROM products
   WHERE available = true AND hidden = false
     AND (price IS NULL OR price <> '€0.00');                -- expected feed size N

   -- b) get RPC: full-set fetch (p_limit above N), no zero-priced row, and
   --    cardinality matches both the count RPC and the independent count (a)
   WITH g AS (
     SELECT * FROM get_interleaved_products(p_limit => 50000, p_offset => 0)
   )
   SELECT
     (SELECT count(*) FROM g WHERE price = '€0.00')  AS zero_rows,     -- expect 0
     (SELECT count(*) FROM g)                        AS get_total,     -- expect N
     count_interleaved_products()                    AS count_total;   -- expect N

   -- c) filtered paths, incl. the worst-offender store
   SELECT count(*) FROM get_interleaved_products(
     p_store => 'graindesell.shop', p_limit => 50000, p_offset => 0)
   WHERE price = '€0.00';                                    -- expect 0
   ```
   Repeat (c) with `p_category` and `p_search` to exercise the other filter branches.
   Sanity-check that (b)'s `get_total` is below the `p_limit` used — if it ever equals the
   limit, raise the limit; a truncated fetch proves nothing.
3. `npm run dev`, then via the preview browser: search "miu miu" and filter to GRAIN DE SELL —
   the FW99 Leather Long Coat no longer appears; price-sort ascending no longer starts with €0
   cards; the homepage editorial rows show no €0 items.
4. Direct-link check: `/product/miu-miu-fw1999-leather-long-coat?store=graindesell.shop`
   must render "Product not found."
5. Sanity check that nothing over-filtered: feed total should drop by roughly the 54
   available zero-priced rows, not by hundreds.

## Rollback

No data was mutated, so rollback is code + SQL only:

1. Remove `excludeZeroPrice` from both helpers in `productQueries.js`.
2. Remove the `minPrice === 0` gate in `resolveProductDetail.js`.
3. Restore **both** RPCs — they live in different files, and restoring only one leaves the
   feed and its total count disagreeing (get would return zero-priced rows the count omits,
   understating totals and stranding the tail of the feed beyond reachable pages):
   - `get_interleaved_products` from `scripts/sql/2026-05-28-add-image-url-2.sql`
   - `count_interleaved_products` from `scripts/sql/2026-05-21-interleaved-rpcs.sql`

   Re-run the get/count parity check (step 2b) afterwards.
