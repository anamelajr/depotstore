# Site Performance Optimization

## Context

The site feels slow on first load, while browsing the feed, and when clicking into products. Exploration traced this to a stack of compounding causes rather than one problem:

- **Every request pays a fixed tax:** `app/layout.js` sequentially awaits two uncached Supabase queries (`getActiveStores`, `getFxRates`) before anything renders; `getActiveStores` is unmemoized and re-queried by `/feed` and the homepage (2–3 identical queries per request). No `loading.js` exists anywhere, so navigation shows nothing until the full server render completes.
- **Homepage:** with `content/homepage-edit.json` empty, every request fans out 13 self-HTTP fetches to its own `/api/products` → 26 Supabase queries (13 with discarded exact counts) → 260 rows to render 8 cards.
- **Product click:** the PDP is fully dynamic/uncached; a serial `stores` gate query → Shopify+row fetch → **an inline OpenAI completion when `editorial_description` is NULL** (live DB check: **7,951 of 8,009 visible products = 99% missing**) → a DB write → `MoreFromStore` with no Suspense blocking the whole document.
- **Feed DB work:** the interleaved RPC's `store_order` CTE aggregates all visible rows every call; the count RPC repeats the full scan on every Load More; no index supports the visibility predicate gating every read.
- **Price sort is broken, not just slow:** it fetches with no `.range()`, so PostgREST caps at 1,000 rows while the catalog has 8,009 visible — "cheapest first" sorts an arbitrary eighth of the catalog, and it re-fetches everything per Load More.
- **Images:** PDP renders both mobile (width=1400, all eager — no `loading` attr) and desktop (width=1600) galleries in one HTML; every device downloads both sets. Desktop LCP image is `opacity:0` until hydration. 8 font files (~189KB) all preload.

### User decisions (confirmed)
1. **Descriptions: gradual backfill via cron** — stream on demand (page renders instantly, description fades in 1–3s for first viewer) AND the hourly cron generates ~100/run newest-first until the backlog clears (~3–4 days).
2. **DB work approved** — partial indexes + RPC `store_order` change; SQL applied in Supabase SQL Editor **before** dependent code merges (project workflow).
3. **Price sort: proper fix** — derived `price_cents INT` column (like `era_year`: DERIVED, overwritten by every writer; TEXT `price` stays canonical), indexed, DB-side sort+pagination.
4. Images stay raw `<img>` + Shopify CDN (no `next/image`/Vercel image billing); we fix the hints instead.

---

## Phase 1 — App-level (no schema dependencies, ship first)

### 1.1 Cache + dedupe `stores` and `fx_rates`
**Files:** `app/lib/stores.js`, `app/lib/fx.js`, `app/layout.js`

Three-layer pattern (matches `app/archives/[slug]/page.js` precedent):
- Inner fetch **throws** on error/empty (never cache a fallback — the partial-cache invariant).
- Wrap in `unstable_cache(..., ["active-stores-v1"], { revalidate: 600 })` (same for `fx-rates-v1`; cron refreshes fx hourly, 10-min staleness is presentational).
- Exported fn wraps the cached call in `React.cache` (per-request dedup) and catches → existing fallbacks (`FALLBACK_STORES`, `{ rates: FALLBACK_RATES, source: "fallback" }`), preserving today's degradation contract.
- `getActiveStores`'s `signal` param: cached variant ignores it; the feed's 4s `Promise.race` still unblocks render on a cold miss.
- `app/layout.js:51-64`: replace four sequential awaits with `Promise.all` of the two DB reads + cookie reads. **Keep `cookies()` — dynamic rendering is deliberate (no currency/language flash).** `/feed` and homepage `getActiveStores` calls now dedupe for free.

### 1.2 `loading.js` boundaries (instant click feedback)
**New files:** `app/product/[handle]/loading.js` (gallery-block + text-bar skeleton matching the two-column/stacked shell — the fix for "clicking products feels laggy"), `app/feed/loading.js` (card-grid skeleton), `app/loading.js` (minimal). Do **not** add `prefetch={true}` to feed card links (would trigger hundreds of dynamic renders); default prefetch + boundary is the right trade.

### 1.3 Homepage: kill the 13-fetch fan-out
**Files:** `app/page.js`, `app/editorial/_lib/fetchHomepagePicks.js`, new `app/lib/fetchDailyRotation.js`

- Replace the self-HTTP `Promise.all` (`app/page.js:41-56`) with a direct Supabase fn: per store `withVisibility(select(PRODUCT_ROW_SELECT))` `.eq("store_domain", d).order("synced_at", desc).order("id", desc).limit(20)` — **no `count: "exact"`** — all stores in one `Promise.all`; pick `seed % rows.length` per store, flatten, slice(0,8), `mapProductRow`. Throws on any per-store error; wrapped in `unstable_cache` keyed by daily seed + sorted domains, `revalidate: 3600`. Caller keeps try/catch → empty section. Delete the `baseUrl` line (also fixes the silent-empty bug when `NEXT_PUBLIC_BASE_URL` is unset in prod).
- `fetchHomepagePicks`: sequential `for...of` → `Promise.all` over (store, chunk) pairs; use shared `supabase` client (the `{ client }` test param exists); wrap call site in `unstable_cache` keyed by picks JSON, `revalidate: 3600`.

### 1.4 PDP: everything off the render path
**Files:** `app/lib/resolveProductDetail.js`, `app/product/[handle]/page.js`, `app/components/MoreFromStore.js`

- **Stores gate:** replace the serial `stores` query (`resolveProductDetail.js:125-131`) with an in-memory lookup against cached `getActiveStores()` (1.1). Security gate preserved (still runs before the Shopify fetch), now ~0ms.
- **Description streaming:** split into `resolveProductDetailCore` (everything through `description = dbRow?.editorial_description || null`; what the page awaits) and a description resolver used by a small async server component per description slot (mobile Accordion + `ProductInfoPanel`), sharing one `React.cache`'d promise so OpenAI is called once, wrapped in `<Suspense fallback={placeholder}>`. When `editorial_description` exists (steady state), pass the string directly — no fallback flash. Move the cache-back `supabaseAdmin.update` into `after()` from `next/server`, and guard it with `.is("editorial_description", null)` so it never clobbers a concurrent cron-generated description (mirrors the editorial only-if-NULL invariant).
- **MoreFromStore:** wrap in `<Suspense fallback={null}>` in `page.js` (currently blocks the whole document); keep its direct-Supabase read (CLAUDE.md sharp edge); pass `sizes="(min-width:1024px) 25vw, 50vw"` into `HoverSwapImage` (srcSet plumbing already exists).

### 1.5 Images: keep Shopify CDN, fix the hints
**Files:** `app/components/ProductGallery.js`, `app/components/DesktopProductGallery.js`, `app/product/[handle]/page.js`, `app/feed/FeedClient.js`

- Mobile gallery (`ProductGallery.js:152-156`): `loading={i===0 ? "eager" : "lazy"}`, `fetchPriority` high on first, `decoding="async"`, srcSet 800/1200/1400 + `sizes="100vw"`. Lazy images inside the CSS-hidden container never intersect → desktop stops downloading the mobile set.
- Unify first-image width to 1600 across both galleries so the two `src` URLs are byte-identical (HTTP cache dedupes the double eager download).
- Desktop LCP (`DesktopProductGallery.js:77-131`): first `GallerySection` starts `revealed=true` so SSR paints immediately (sections 2+ keep the reveal animation); add `fetchPriority="high"`.
- PDP server component: `ReactDOM.preload(shopifyImageUrl(images[0], 1600), { as: "image", fetchPriority: "high" })` so the LCP fetch starts with the document.
- Verify feed cards pass `imageSizes` through to `HoverSwapImage`; add where missing.

### 1.6 Feed: stop re-counting on Load More
**Files:** `app/feed/FeedClient.js`, `app/api/products/route.js`, `app/lib/fetchProductsPage.js`

Thread an optional `skipCount`/`knownTotal` param: when `offset > 0` and the client holds `total` for the current `filterKey`, skip `countInterleavedProducts` and echo the known total. Halves DB work per Load More; no RPC signature change; visibility invariant untouched.

---

## Phase 2 — DB work (SQL in Supabase SQL Editor FIRST, then dependent code; new files under `scripts/sql/`)

### 2.1 Visibility partial indexes — `scripts/sql/2026-08-XX-feed-indexes.sql`
Each as its own `CREATE INDEX CONCURRENTLY` statement (cannot run in a transaction — no BEGIN/COMMIT, unlike the RPC migration style):
- `idx_products_visible_store_synced ON products (store_domain, synced_at DESC, id DESC) WHERE available = true AND hidden = false AND (price IS NULL OR price <> '€0.00')`
- `idx_products_visible_synced ON products (synced_at DESC, id DESC)` same WHERE
- `idx_products_visible_category ON products (category, subcategory)` same WHERE
- Predicate text must match `withVisibility` + both RPCs exactly (it does). After verifying with `EXPLAIN`, drop the near-useless `idx_products_available`.

### 2.2 `price_cents` derived column
- **SQL:** `ALTER TABLE products ADD COLUMN price_cents INT` + backfill `UPDATE ... SET price_cents = (regexp-parse of price)` + partial index `(price_cents, id)` under the visibility predicate.
- **Writers (derived like `era_year` — kept OUT of `editorialRows`/COALESCE surfaces, plainly overwritten):** new deterministic `parsePriceCents` helper in `app/lib/`; cron Step-1 `syncRows` sets it from the price it writes; any other price writer does the same.
- **Read path:** `fetchProductsPage.js:160-191` price branch becomes a normal `.order("price_cents", { ascending, nullsFirst: false }).order("id").range(from, to)` query with a standard count — deleting the fetch-all-sort-in-JS branch entirely. Fixes both the 1,000-row truncation (wrong results today) and the per-Load-More full-catalog refetch. NULL price → NULL price_cents → sorts last, stays visible per the invariant.
- Note in CLAUDE.md terms: TEXT `price` remains canonical; `price_cents` is presentational/derived, never authored.

### 2.3 Interleaved RPC: cheapen `store_order` — new migration redefining `get_interleaved_products`
- First verify (read-only MCP): every distinct visible `products.store_domain` exists in active `stores`. If yes, replace the full-table `GROUP BY store_domain` CTE with `SELECT domain, ROW_NUMBER() OVER (ORDER BY MD5(domain || seed)) FROM stores WHERE active = true`. If not guaranteed, keep the products-based CTE (2.1's index makes it an index-only scan) and skip this item.
- This CTE exists only in `get`; the change does **not** touch the shared filter predicates, so no parallel `count` edit — state that explicitly in the migration header, and re-apply `get`'s GRANTs on DROP+CREATE.

### 2.4 Description backfill step in `/api/cron`
- New step **after** the daily-snapshot logic: select up to **100** visible products with `editorial_description IS NULL`, newest `synced_at` first. Cron already holds each store's `/products.json` payload (has `body_html`, `tags`) — reuse it in-memory where possible; otherwise read the needed fields.
- Generate via existing `generateDescription`; write with `.is("editorial_description", null)` guard (only-if-NULL, same race protection as 1.4). Time-box the step (e.g. stop at 200s elapsed) to respect `maxDuration = 300`; concurrency ~5. Log a JSON event with generated/remaining counts so progress is visible in Vercel logs. Backlog of ~7,950 clears in ~3–4 days; thereafter it only tops up new arrivals.

---

## Phase 3 — Deferred (documented, not in this round)
Font-weight trimming (`preload: false` on rare weights), back-nav restore cap (currently refetches up to 600 rows in one request), pg_trgm search indexes + RPC search rewrite, interleave-rank precompute (MV pattern exists), per-language `messages.js` splitting.

---

## Order of work
1. Phase 1 (app-only) — branch, implement, verify, PR.
2. Phase 2 SQL files prepared + EXPLAIN-checked → **user applies in SQL Editor** → dependent code (2.2 read/write paths, 2.3 nothing app-side, 2.4 cron step) merges after.

## Verification (single prod DB — reads safe; NEVER trigger `/api/cron` or `/api/enrich` locally)
- `npm run build` clean; route table unchanged (all dynamic).
- Layout/caching: dev server logs — one `stores` + one `fx_rates` query on cold request, zero on warm; homepage renders 8 cards with no `/api/products` self-fetches.
- PDP (throttled Fast 3G): click a feed card → skeleton paints immediately; LCP preload fires before hydration; desktop viewport downloads no mobile slides 2+; pick ONE `editorial_description IS NULL` product (find via read-only MCP) and confirm the shell streams before the description resolves (spends one OpenAI call, acceptable).
- Feed: Load More shows no count RPC in network tab; price sort returns correct ascending/descending results past row 1,000 and totals match `count_interleaved_products` via MCP.
- SQL: before/after `EXPLAIN ANALYZE` on the RPC + newest direct query via read-only MCP; after RPC redefinition, call `get`+`count` with identical filter tuples (none/store/category/search/brand) and assert pagination reaches the tail.
- Cron description step: verified by code review + observing the next hourly prod run's log event (never triggered manually).
- Lighthouse/Speed Insights before/after on `/`, `/feed`, one PDP.

## Critical files
`app/layout.js`, `app/lib/stores.js`, `app/lib/fx.js`, `app/page.js`, `app/editorial/_lib/fetchHomepagePicks.js`, `app/lib/resolveProductDetail.js`, `app/product/[handle]/page.js`, `app/components/MoreFromStore.js`, `app/components/ProductGallery.js`, `app/components/DesktopProductGallery.js`, `app/feed/FeedClient.js`, `app/api/products/route.js`, `app/lib/fetchProductsPage.js`, `app/api/cron/route.js`, new `scripts/sql/2026-08-XX-*.sql`, new `loading.js` ×3.
