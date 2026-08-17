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
2. **DB work approved** — partial indexes (+ any follow-on RPC work); SQL applied in Supabase SQL Editor **before** dependent code merges (project workflow). (Adversarial review later replaced the RPC `store_order` rewrite with index-only reliance — see 2.3.)
3. **Price sort: proper fix** — derived `price_cents INT` column (TEXT `price` stays canonical), indexed, DB-side sort+pagination. (Adversarial review hardened this to a STORED GENERATED column — see 2.2.)
4. Images stay raw `<img>` + Shopify CDN (no `next/image`/Vercel image billing); we fix the hints instead.

---

## Phase 1 — App-level (no schema dependencies, ship first)

### 1.1 Cache + dedupe `stores` and `fx_rates`
**Files:** `app/lib/stores.js`, `app/lib/fx.js`, `app/layout.js`

Three-layer pattern (matches `app/archives/[slug]/page.js` precedent):
- Inner fetch **throws** on error/empty (never cache a fallback — the partial-cache invariant).
- Wrap in `unstable_cache(..., ["active-stores-v1"], { revalidate: 600 })` (same for `fx-rates-v1`; cron refreshes fx hourly, 10-min staleness is presentational).
- Exported fn wraps the cached call in `React.cache` (per-request dedup) and catches → existing fallbacks (`FALLBACK_STORES`, `{ rates: FALLBACK_RATES, source: "fallback" }`), preserving today's degradation contract — **for presentational callers only; the PDP authorization gate must stay fail-closed (see 1.4)**.
- `getActiveStores`'s `signal` param: cached variant ignores it; the feed's 4s `Promise.race` still unblocks render on a cold miss.
- **Caller split — the cached wrapper is for render-path callers ONLY** (`app/layout.js`, `app/feed/page.js`, `app/page.js`). Write-path/authoritative callers — `app/api/cron/route.js:33` (chooses which stores sync and scope the stale-delete) and the local-only admin routes (`app/admin/inventory/page.js`, `app/api/admin/backfill-sizes/route.js`) — **keep today's fresh, uncached query exactly as-is** (export it under a distinct name, e.g. `fetchActiveStoresFresh`, and point them at it). Injecting a ≤600s-stale or stale-while-revalidate list into cron would let a deactivated store keep syncing and shift the stale-delete scope; cron's existing fallback-and-abort-on-empty semantics stay byte-identical.
- `app/layout.js:51-64`: replace four sequential awaits with `Promise.all` of the two DB reads + cookie reads. **Keep `cookies()` — dynamic rendering is deliberate (no currency/language flash).** `/feed` and homepage `getActiveStores` calls now dedupe for free.

### 1.2 `loading.js` boundaries (instant click feedback)
**New files:** `app/product/[handle]/loading.js` (gallery-block + text-bar skeleton matching the two-column/stacked shell — the fix for "clicking products feels laggy"), `app/feed/loading.js` (card-grid skeleton), `app/loading.js` (minimal). Do **not** add `prefetch={true}` to feed card links (would trigger hundreds of dynamic renders); default prefetch + boundary is the right trade.

### 1.3 Homepage: kill the 13-fetch fan-out
**Files:** `app/page.js`, `app/editorial/_lib/fetchHomepagePicks.js`, new `app/lib/fetchDailyRotation.js`

- Replace the self-HTTP `Promise.all` (`app/page.js:41-56`) with a direct Supabase fn: per store `withVisibility(select(PRODUCT_ROW_SELECT))` `.eq("store_domain", d).order("synced_at", desc).order("id", desc).limit(20)` — **no `count: "exact"`** — all stores in one `Promise.all`; pick `seed % rows.length` per store, flatten, slice(0,8), `mapProductRow`. Throws on any per-store error; wrapped in `unstable_cache` keyed by daily seed + sorted domains, `revalidate: 3600`. Caller keeps try/catch → empty section. Delete the `baseUrl` line (also fixes the silent-empty bug when `NEXT_PUBLIC_BASE_URL` is unset in prod).
- `fetchHomepagePicks`: sequential `for...of` → `Promise.all` over (store, chunk) pairs; use shared `supabase` client (the `{ client }` test param exists); wrap call site in `unstable_cache` keyed by picks JSON, `revalidate: 3600`.

### 1.4 PDP: everything off the render path
**Files:** `app/lib/resolveProductDetail.js`, `app/product/[handle]/page.js`, `app/components/MoreFromStore.js`

- **Stores gate (fail-closed, hard-bounded staleness):** replace the serial `stores` query (`resolveProductDetail.js:125-131`) with a **dedicated module-scope TTL cache** for authorization — NOT `unstable_cache` (its stale-while-revalidate serves old entries indefinitely when refreshes fail, so it cannot bound an authorization window) and **never the `FALLBACK_STORES`-catching wrapper**. Shape: `{ data, fetchedAt }` at module scope; age < 600s → serve; expired → refetch; refetch failure → serve stale only while age < 3600s hard cap, beyond that return null (404). Authorization is thus fresh within 600s under a healthy DB and fails closed within 1h under a sustained outage; the gate still runs before any Shopify fetch. Presentational callers keep the 1.1 `unstable_cache` + fallback path. Accepted residual (documented in code): a deactivated store stays resolvable ≤600s normally, ≤1h worst-case.
- **Description streaming:** split into `resolveProductDetailCore` (everything through `description = dbRow?.editorial_description || null`; what the page awaits) and a description resolver used by a small async server component per description slot (mobile Accordion + `ProductInfoPanel`), sharing one `React.cache`'d promise so OpenAI is called once, wrapped in `<Suspense fallback={placeholder}>`. When `editorial_description` exists (steady state), pass the string directly — no fallback flash. Move the cache-back `supabaseAdmin.update` into `after()` from `next/server`, and guard it with `.is("editorial_description", null)` so it never clobbers a concurrent cron-generated description (mirrors the editorial only-if-NULL invariant).
- **MoreFromStore:** wrap in `<Suspense fallback={null}>` in `page.js` (currently blocks the whole document); keep its direct-Supabase read (CLAUDE.md sharp edge); pass `sizes="(min-width:1024px) 25vw, 50vw"` into `HoverSwapImage` (srcSet plumbing already exists).

### 1.5 Images: keep Shopify CDN, fix the hints
**Files:** `app/components/ProductGallery.js`, `app/components/DesktopProductGallery.js`, `app/product/[handle]/page.js`, `app/feed/FeedClient.js`

- Mobile gallery (`ProductGallery.js:152-156`): `loading={i===0 ? "eager" : "lazy"}`, `fetchPriority` high on first, `decoding="async"`; slides 2+ get srcSet 800/1200/1400 + `sizes="100vw"`. Lazy images inside the CSS-hidden container never intersect → desktop stops downloading the mobile set.
- **First slide: plain `src` at width=1600, NO srcSet, in BOTH galleries.** Browsers select from srcSet when present, so a srcSet'd first image would pick 800–1400 on mobile while the preload fetches 1600 — preserving the double download. A bare identical-URL src on both galleries + the preload collapses every viewport to exactly one 1600 first-image fetch (slight over-download on small phones, accepted for guaranteed dedup).
- Desktop LCP (`DesktopProductGallery.js:77-131`): first `GallerySection` starts `revealed=true` so SSR paints immediately (sections 2+ keep the reveal animation); add `fetchPriority="high"`.
- PDP server component: `ReactDOM.preload(shopifyImageUrl(images[0], 1600), { as: "image", fetchPriority: "high" })` so the LCP fetch starts with the document.
- Verify feed cards pass `imageSizes` through to `HoverSwapImage`; add where missing.

### 1.6 Feed: stop re-counting on Load More (server-derived `hasMore`, never a client-echoed total)
**Files:** `app/feed/FeedClient.js`, `app/api/products/route.js`, `app/lib/fetchProductsPage.js`

When `offset > 0`, skip `countInterleavedProducts` and instead fetch `limit + 1` rows: `hasMore = rows.length > limit`, return `limit` rows + `hasMore`. Do **not** echo a client-provided total as pagination state — the catalog mutates hourly, so a stale client total would either hide Load More early or cause repeated empty loads. The UI keeps displaying the `offset=0` total (which still runs the count); `FeedClient.js:415`'s `products.length < total` check switches to the server's `hasMore` for appended pages. Halves DB work per Load More; no RPC signature change; visibility invariant untouched.

---

## Phase 2 — DB work (SQL in Supabase SQL Editor FIRST, then dependent code; new files under `scripts/sql/`)

### 2.1 Visibility partial indexes — `scripts/sql/2026-08-XX-feed-indexes.sql`
Each as its own `CREATE INDEX CONCURRENTLY` statement (cannot run in a transaction — no BEGIN/COMMIT, unlike the RPC migration style):
- `idx_products_visible_store_synced ON products (store_domain, synced_at DESC, id DESC) WHERE available = true AND hidden = false AND (price IS NULL OR price <> '€0.00')`
- `idx_products_visible_synced ON products (synced_at DESC, id DESC)` same WHERE
- `idx_products_visible_category ON products (category, subcategory)` same WHERE
- Predicate text must match `withVisibility` + both RPCs exactly (it does). After verifying with `EXPLAIN`, drop the near-useless `idx_products_available`.

### 2.2 `price_cents` — STORED GENERATED column (divergence impossible by construction)
- **SQL:** `ALTER TABLE products ADD COLUMN price_cents INT GENERATED ALWAYS AS (<immutable regexp parse of price, NULL on unparseable>) STORED` + partial index `(price_cents, id)` under the visibility predicate. A generated column needs **no backfill UPDATE, no writer changes, and no dual-write window** — Postgres computes it on every write, so `price` and `price_cents` cannot drift, and rollback of app code cannot corrupt it. Parse expression must use only IMMUTABLE functions (`substring`/`regexp_replace`/casts qualify); verify with a `SELECT` over distinct price formats before applying.
- **Writers:** none touched. Cron upserts must simply not include `price_cents` in their payloads (they don't; Postgres rejects direct writes to generated columns — which is itself the guard).
- **Read path:** `fetchProductsPage.js:160-191` price branch becomes a normal `.order("price_cents", { ascending, nullsFirst: false }).order("id").range(from, to)` query with a standard count — deleting the fetch-all-sort-in-JS branch entirely. Fixes both the 1,000-row truncation (wrong results today) and the per-Load-More full-catalog refetch. NULL price → NULL price_cents → sorts last, stays visible per the invariant. Read-path code merges only after the column exists in prod (standard schema-first ordering).
- Note in CLAUDE.md terms: TEXT `price` remains canonical; `price_cents` is DB-derived, never authored, never written by app code.

### 2.3 Interleaved RPC `store_order`: keep the products-derived CTE, make it cheap via the index
- **Do NOT switch the CTE to the `stores` table.** That variant joins `get`'s rows through active stores while `count` keeps counting them — if a store is deactivated while its products remain visible (cron's stale-delete is scoped to successful domains, so rows linger), totals and pages diverge and the tail becomes unreachable. A one-time "every visible domain is active" check is a snapshot, not an invariant.
- Instead, rely on 2.1's `idx_products_visible_store_synced`: the existing `GROUP BY store_domain` over visible rows becomes an index-only scan — the CTE's cost collapses without touching semantics. No RPC redefinition needed for this item; if `EXPLAIN ANALYZE` after 2.1 shows the CTE still dominating, revisit with a design that changes `get` and `count` visibility semantics **together**.

### 2.4 Description backfill: separate route, dispatched fire-and-forget from cron
- **Not a step inside `/api/cron`** — sync already claims 240s of the 300s `maxDuration` (`SYNC_DEADLINE_MS`, `route.js:19`) with the tail reserved for stale-delete → snapshot → enrich dispatch; there is no headroom for ~100 OpenAI calls.
- New route `app/api/backfill-descriptions/route.js`: bearer-`CRON_SECRET`, own `maxDuration = 300`, time-boxed **from its own request start** (stop dispatching new generations at ~240s). Cron triggers it exactly like the existing enrich dispatch (`waitUntil(fetch(origin + path, { headers: bearer + x-vercel-protection-bypass })).catch(() => {})`, `cron/route.js:372-380`) — no new Vercel cron entry needed.
- **Attempt state (prevents head-of-line starvation AND duplicate spend):** add `description_attempts INT NOT NULL DEFAULT 0` to the Phase 2 SQL (mirrors `enrich_attempts` precedent). Select up to 100 visible products `WHERE editorial_description IS NULL AND description_attempts < 3 ORDER BY synced_at DESC`, then **increment `description_attempts` at claim time — one UPDATE on the selected ids BEFORE any OpenAI call** — so an overlapping or retried invocation cannot re-select the same rows and duplicate the spend (the only-if-NULL write guard stops duplicate writes, not duplicate OpenAI calls). No row-lock/lease machinery: the route has exactly one hourly dispatcher, claim-by-increment covers the realistic overlap. Per-call OpenAI timeout; concurrency ~5.
- **Attempt reset on source change:** cron already resets `enrich_attempts` to 0 when a product's Shopify name/description changes (`cron/route.js:149-179`); add `description_attempts: 0` to that same reset UPDATE so rows exhausted on incomplete source data become generatable again when their listing changes.
- Write with `.is("editorial_description", null)` guard (only-if-NULL, same race protection as 1.4). Log a JSON event with generated/failed/remaining counts for Vercel logs. Backlog of ~7,950 clears in ~3–4 days; thereafter it only tops up new arrivals.

---

## Phase 3 — Deferred (documented, not in this round)
Font-weight trimming (`preload: false` on rare weights), back-nav restore cap (currently refetches up to 600 rows in one request), pg_trgm search indexes + RPC search rewrite, interleave-rank precompute (MV pattern exists), per-language `messages.js` splitting.

---

## Order of work
1. Phase 1 (app-only) — branch, implement, verify, PR.
2. Phase 2 SQL files prepared + EXPLAIN-checked → **user applies in SQL Editor** → dependent code (2.2 read path, 2.4 backfill route + cron dispatch line) merges after. 2.3 is SQL-free (index-driven) unless post-index EXPLAIN says otherwise.

## Verification (single prod DB — reads safe; NEVER trigger `/api/cron` or `/api/enrich` locally)
- `npm run build` clean; route table unchanged (all dynamic).
- Layout/caching: dev server logs — one `stores` + one `fx_rates` query on cold request, zero on warm; homepage renders 8 cards with no `/api/products` self-fetches.
- PDP (throttled Fast 3G): click a feed card → skeleton paints immediately; LCP preload fires before hydration; **record the exact image URLs requested at mobile/desktop viewports and 1x/2x DPR — each viewport must fetch exactly one first-image URL (the 1600) and no hidden-gallery slides**; pick ONE `editorial_description IS NULL` product (find via read-only MCP) and confirm the shell streams before the description resolves (spends one OpenAI call, acceptable).
- Feed: Load More shows no count RPC in network tab and `hasMore` comes from the limit+1 probe; price sort returns correct ascending/descending results past row 1,000 and totals match `count_interleaved_products` via MCP.
- SQL: before/after `EXPLAIN ANALYZE` on the RPC + newest direct query via read-only MCP (confirm the `store_order` CTE goes index-only after 2.1); verify the `price_cents` generated-column expression against a `SELECT DISTINCT` sample of price formats before applying, and spot-check parity (`price_cents` matches a JS parse) after.
- Description backfill route: verified by code review + observing the next hourly prod run's log event (never triggered manually); confirm `description_attempts` increments on failures via read-only MCP.
- Lighthouse/Speed Insights before/after on `/`, `/feed`, one PDP.

## Critical files
`app/layout.js`, `app/lib/stores.js`, `app/lib/fx.js`, `app/page.js`, `app/editorial/_lib/fetchHomepagePicks.js`, `app/lib/resolveProductDetail.js`, `app/product/[handle]/page.js`, `app/components/MoreFromStore.js`, `app/components/ProductGallery.js`, `app/components/DesktopProductGallery.js`, `app/feed/FeedClient.js`, `app/api/products/route.js`, `app/lib/fetchProductsPage.js`, `app/api/cron/route.js` (dispatch line only), new `app/api/backfill-descriptions/route.js`, new `scripts/sql/2026-08-XX-*.sql`, new `loading.js` ×3.
