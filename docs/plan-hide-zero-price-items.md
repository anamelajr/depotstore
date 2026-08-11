# Hide zero-priced ("not for sale" / rental) items from the feed

## Context

Grain de Sell (and Numero 13) publish archive pieces on Shopify with `price: 0.00`; their descriptions say "NOT FOR SALE" / rental. 54 such rows are currently `available = true, hidden = false`, so they render as "€0" cards in the feed (e.g. `miu-miu-fw1999-leather-long-coat`). Investigation confirmed zero price is the reliable signal (metadata markers miss 1 item; no priced item ever carries a marker). User decision: **hide these items entirely for now** — reversible later if they want them back.

Approach: a **read-time visibility filter** ("available for sale" = `available AND NOT hidden AND price is not exactly €0`). No data mutation, no `hidden` writes (that column belongs to enrich), and removing the filter later restores the items instantly. The sync keeps mirroring `€0.00` faithfully.

The mapper (`shopifyFetch.js:100`) always formats as `€X.toFixed(2)`, so the zero literal is exactly `'€0.00'` — a single-value exclusion is safe.

## Changes

### 1. `app/lib/productQueries.js` — `withVisibility`

Append a null-tolerant zero-price exclusion (PostgREST `.neq` silently drops NULL rows — the CLAUDE.md NULL-drift trap; mapper can emit null price):

```js
export function withVisibility(query) {
  return query
    .eq("available", true)
    .eq("hidden", false)
    .or('price.is.null,price.neq."€0.00"'); // value double-quoted: contains dots
}
```

This automatically covers every direct-query surface: `fetchProductsPage.js` (both branches, incl. the price-sort fetch-all), `MoreFromStore.js`, `fetchHomepagePicks.js`, admin search, enrich batch select + remaining count (both share `withVisibility`, so the batch/remaining-count parity invariant holds).

Leave `withCuratedVisibility` untouched (editorial picks are hand-curated; sold/zero pieces there are intentional).

### 2. Interleaved RPCs (Supabase, not git) — new migration

New file `scripts/sql/2026-08-11-exclude-zero-price.sql` re-declaring `get_interleaved_products` and `count_interleaved_products`, based on the current source of truth `scripts/sql/2026-05-28-add-image-url-2.sql`, adding to **all three** visibility WHERE sites (`store_order` CTE + `ranked` CTE in the get function, and the count function):

```sql
AND (p.price IS NULL OR p.price <> '€0.00')
```

(`store_order` uses the unaliased table — match its existing column style.)

Per workflow invariant, this SQL must be applied in the **Supabase SQL Editor before the code merges** (MCP is read-only). Hand the file to the user to run; verify with the read-only MCP afterwards.

### 3. Tests

- `app/lib/__tests__/productQueries.test.js`: extend the `withVisibility` assertions (nth-call `.eq` order test tolerates an appended call; add an assertion for the `.or` zero-price clause, including the double-quoted value).
- Optionally add a mapper-level regression note is NOT needed — mapper behavior is unchanged by design.

### 4. No other surfaces change

- Sync/cron: untouched (still mirrors `€0.00`; `hidden` not in upsert payload).
- Inventory snapshot/analytics: deliberately capture hidden/zero rows — untouched (snapshot test asserts zero `.eq()` calls; we add nothing there).
- `searchAliases.js` bare `.eq("hidden", false)`: alias-expansion counting only, not a product-display surface — untouched.

## Verification

1. `npm test` (vitest) — productQueries tests pass.
2. After the user applies the SQL in Supabase: read-only MCP check
   `SELECT count(*) FROM get_interleaved_products(null,null,null,null,null,60,0) g JOIN products p ON p.handle=g.handle AND p.store_domain=g.store_domain WHERE p.price='€0.00';` → 0.
3. `npm run dev`, open the feed via the preview browser: search "miu miu" / filter GRAIN DE SELL — the FW99 Leather Long Coat no longer appears; price-sort ascending no longer starts with €0 items.
4. Confirm product-detail deep link for a zero-priced handle still resolves (detail page doesn't use withVisibility — acceptable; feed/search no longer link to it).

## Rollback

Remove the `.or` clause and re-apply the previous RPC definitions (`2026-05-28-add-image-url-2.sql`). No data was mutated.
