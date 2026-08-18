# Feed→Product click speed + site-wide perf wins

## Context

Recent PRs made the landing→feed path and hover images fast; clicking a product is now the slow spot. Audit findings: (1) the product page (PDP) requests the hero image at a bare `width=1600` URL the feed never fetched, so **every click is a guaranteed browser-cache miss** on a photo the user was just looking at; (2) nothing prefetches the product route — hover warms only the loading skeleton, and the click then waits on store-gate → (Shopify fetch ∥ Supabase row); (3) the Shopify fetch has **no timeout** (worst tail-latency risk on the site); (4) ~99% of products stream their description from a live OpenAI call. Elsewhere: homepage has a needless sequential await chain, no Suspense, and eagerly loads Leaflet below the fold; editorial pages ship ~1.4MB of raw unoptimized `<img>`; `/stores` runs a duplicate uncached full-table read; a 1.1MB archive portrait; missing loading skeletons.

**User decisions:** scope = PDP + cheap wins (no pg_trgm index, no layout `cookies()` restructure); **full prefetch on hover** (route data + hero image), gated on a tunable cursor-rest delay, understanding the ~3–4× product-page render multiplier.

**Verified against installed `next@16.2.0` / `react-dom@19.2.4`** (in the main repo's node_modules; the worktree's is empty — run `npm install` first):
- `router.prefetch(href, { kind: "full" })` is public API; routes through the Segment Cache with full fetch strategy; no config flag needed.
- Prefetched dynamic entries survive **≥30s** (server stale-time header clamped to min 30s in `segment-cache/cache.js`); the `staleTimes.dynamic: 0` default does NOT evict prefetch entries. Confirm at runtime in Commit 1 verification.
- `ReactDOM.preload` supports `imageSrcSet`/`imageSizes`.
- `?available=` is written in 4 places (ProductCard.js:43, MoreFromStore.js:53, editorial `PiecesFeatured.js:8`, `MoreFromDesigner.js:8`) and read nowhere → safe to drop.

**Flagged trade-off (accepted, surface to user):** a full prefetch runs the real page render, so hover-prefetching a never-described product fires one OpenAI description generation (~≤500 tokens, gpt-5.6-sol low effort) plus the guarded only-if-NULL cache-back. Each product generates **at most once ever** — this front-loads spend the description backfill would do anyway; total spend stays bounded by catalog size. The rest-delay dial throttles it.

## Invariants that constrain this work (CLAUDE.md)

- PDP is the accuracy boundary: **no `unstable_cache` anywhere on its data path**; store-gate module-Map stays exactly as-is (fail-closed auth).
- Never static-import `content/homepage-edit.json`; keep `loadHomepagePicks` fs try/catch degradation.
- Don't touch `withCuratedVisibility` or any visibility predicate.
- Never trigger `/api/cron` or `/api/enrich` locally. Verify reads on localhost against prod Supabase (safe).

## Commits (order: 1 → 2 → 3 → 4 → 5 → 6; commit 1 lands the helpers commit 2's callers need — see note)

Build/verify with `npm run build && npm start` — dev mode loosens prefetch behavior.

### Commit 1 — Slide-1 image contract (`shopifyImage.js` + galleries + preload)

Shared helpers in [app/lib/shopifyImage.js](app/lib/shopifyImage.js) (pure, client+server safe):

```js
export const SHOPIFY_SRCSET_LADDER = [400, 600, 800, 1200, 1600];
export function shopifySrcSet(url) { /* ladder → "url&width=w ww" joined; undefined for non-CDN urls (same guard as HoverSwapImage.isShopifyCdnUrl) */ }
// PDP slide-1 contract — ONE source of truth for src/srcSet/sizes across both
// galleries, the document preload, and the feed's hover warm (Commit 2).
export const PDP_SLIDE1_SIZES = "(min-width: 1024px) 40vw, 100vw";
export function pdpSlide1SrcSet(url) { return shopifySrcSet(url); }
export function pdpSlide1Src(url) { return shopifyImageUrl(url, 1200); } // no-srcset fallback
```

- [HoverSwapImage.js](app/components/HoverSwapImage.js): replace its private srcSet builder (line ~31) with shared `shopifySrcSet` — ladder identity becomes enforced, not coincidental.
- [ProductGallery.js:162-177](app/components/ProductGallery.js) (slide 1) and [DesktopProductGallery.js:132-139](app/components/DesktopProductGallery.js): replace bare `width=1600` with `src={pdpSlide1Src(src)}`, `srcSet={pdpSlide1SrcSet(src)}`, `sizes={PDP_SLIDE1_SIZES}`. Identical `sizes` on both galleries is the **new dedup mechanism** replacing bare-1600 (both evaluate the same media condition → same candidate → one fetch). Rewrite the load-bearing dedup comments in both files.
- [app/product/[handle]/page.js:37-42](app/product/[handle]/page.js): `ReactDOM.preload(pdpSlide1Src(images[0]), { as: "image", fetchPriority: "high", imageSrcSet: pdpSlide1SrcSet(images[0]), imageSizes: PDP_SLIDE1_SIZES })`.

Why this works: desktop feed cards (`33vw`, ladder 400–1600) and PDP slide-1 (`40vw`) select the **same rung** at common viewport×DPR combos → browser-cache hit on click even without hover. Honest residuals (state in comments): ~1024–1150px @1× selects 400 vs 600 (miss, covered by Commit 2's hover warm); mobile feed (50vw→400/600) vs PDP (100vw→800/1200) can't reuse without a blurry hero — mobile's win is slide-1 dropping from forced 1600 to ~800 (≈4× fewer pixels for LCP) plus the existing preload head start.

**Verify:** resize matrix (1280/1440/1920 × DPR 1/2): exactly one slide-1 fetch per PDP load (galleries + preload agree). 2× desktop: feed→click → slide-1 served from cache. Mobile emulation: slide-1 fetches ~800, not 1600.

### Commit 2 — Full PDP prefetch on hover

**New [app/components/PrefetchLink.js](app/components/PrefetchLink.js)** (client) — one shared owner for product links; `HoverSwapImage`'s pointer handlers stay untouched (different concern):

```js
"use client";
// ── THE TUNABLE DIAL ── raise toward 250–300 if Vercel invocations/OpenAI
// spend look high; lower toward 150 for snappier prefetch.
export const HOVER_PREFETCH_REST_MS = 200;
const REPREFETCH_AFTER_MS = 25_000; // segment-cache entries live ≥30s

// module state: prefetchedAt Map (href→ts), warmedImages Set (src key)

// onPointerEnter: skip pointerType==="touch" and saveDataDisabled();
//   setTimeout(REST_MS) → router.prefetch(href, { kind: "full" }) (deduped by
//   REPREFETCH_AFTER_MS window) + warmHeroImage({src,srcSet,sizes}) via
//   new Image() with sizes→srcset→src assignment order (hover intent is
//   strong: no idle queue).
// onPointerLeave: clearTimeout.
```

- [app/lib/idleImagePrefetch.js:42](app/lib/idleImagePrefetch.js): `export` the existing `saveDataDisabled`.
- [ProductCard.js](app/components/ProductCard.js): `Link` → `PrefetchLink`; **drop `&available=${!isSold}`** from `internalUrl` (line 43 — dead param, fragments prefetch keys); pass `heroImage={{ src: pdpSlide1Src(imageUrl), srcSet: pdpSlide1SrcSet(imageUrl), sizes: PDP_SLIDE1_SIZES }}` — must be byte-identical to the PDP `<img>` attrs or the warm is wasted.
- [MoreFromStore.js](app/components/MoreFromStore.js): same swap + heroImage; drop `&available=` (line 53). (Server component passing serializable props to PrefetchLink — fine.)
- [PiecesFeatured.js](app/editorial/_components/PiecesFeatured.js), [MoreFromDesigner.js](app/editorial/_components/MoreFromDesigner.js): drop `&available=`; swap to PrefetchLink for URL-key consistency.

Rejected alternatives: `<Link prefetch={true}>` fires full dynamic prefetch on viewport entry for 30+ cards/page (unacceptable cost); hover-mounted-Link hack couples to Link's internal observer timing.

**Verify (prod build):** hover+rest 200ms → one `_rsc` fetch of `/product/<handle>?store=<domain>` + one CDN image fetch; click within ~25s → **no new RSC request**, near-instant paint (description may still stream). Fast cursor sweep → no prefetch storm. Touch emulation → no prefetch. Confirm click during in-flight prefetch doesn't duplicate the RSC request. No server-side caching added anywhere.

### Commit 3 — Bounded Shopify fetch + PDP error boundary

- [resolveProductDetail.js:96-108](app/lib/resolveProductDetail.js) `fetchShopifyProduct`: add `signal: AbortSignal.timeout(5000)`. Behavior split: `!res.ok` → `null` (unchanged 404 path); **timeout** (`err.name === "TimeoutError"||"AbortError"`) → **throw** tagged error — transient slowness must not render "Product not found" for a real product; other network errors → keep returning `null` (today's contract).
- **New [app/product/[handle]/error.js](app/product/[handle]/error.js)** — client component: brief message, `reset()` retry button, Link back to `/feed`. (DB-row-only degrade isn't viable — Shopify is the only image source.)
- Hardening: in `resolveDescription`, pass `AbortSignal.timeout(15_000)` to `generateDescription` (param exists) so a hung OpenAI call can't pin the streamed slot open; timeout → null → existing fallback.

**Verify:** wrap fetch with 1ms timeout locally → error boundary renders, retry works; normal PDP renders; bad handle still 404s ("Product not found"). Store gate untouched.

### Commit 4 — Homepage: parallelize, stream, defer the map

[app/page.js](app/page.js):
- Static-import `getActiveStores` (delete the inline `await import` at line 24).
- Extract two async server components in-file, each Suspense-wrapped so Hero/SearchBrowseRow/FeaturedArchives stream immediately:
  - `<CuratedSection />`: `Promise.all([getActiveStores(), loadHomepagePicks()])` (independent — the parallelization win), then existing picks→cached-picks→daily-rotation logic verbatim, raced against a 4s timer (reuse the shape from [app/feed/page.js:54-102](app/feed/page.js); cached fetchers ignore signals — the race just unblocks render); timeout → empty row (today's catch-all behavior). Keep `loadHomepagePicks` degradation exactly as-is.
  - `<AcrossParis />`: `await getActiveStores()` (React.cache-deduped) → `<ParisMap stores={stores}/>`. Fallback: fixed-height placeholder matching the map box (no CLS).
- [ParisMap.js:18-37](app/components/ParisMap.js): gate the leaflet `import()` behind a one-shot `IntersectionObserver` on `mapRef` (`rootMargin: "400px"`), disconnect after first intersect, keep `mapInstanceRef` guard.

**Verify:** on throttled Slow 4G, hero paints before product row; no leaflet chunk / cartocdn requests until scrolling near the map; temporarily corrupt `content/homepage-edit.json` → rotation fallback renders (restore).

### Commit 5 — /stores, /api/products timeout, loading skeletons

- [app/stores/page.js:8-9](app/stores/page.js): `getAllStores()` → `getActiveStores()` (drop the `.filter(s => s.active)`); render `store.displayName ?? store.storeName` (FALLBACK_STORES rows lack displayName). Removes the only uncached stores read; layout already warmed this cache per-request.
- [app/api/products/route.js](app/api/products/route.js): mirror the feed's 4s AbortController — pass `signal` into `fetchProductsPage`, on timeout return 504 JSON. **Check `FeedClient`'s Load-More catch branch tolerates a non-200 before relying on it.** No Cache-Control (default first page already served from server cache).
- Add `app/stores/loading.js`, `app/archives/[slug]/loading.js`, `app/editorial/[slug]/loading.js` — dumb skeletons; archives/editorial use the `GROUND`-tinted full-height shell so navigation doesn't flash white. Root `app/loading.js` stays as-is.

**Verify:** `/stores` renders identically; feed Load More still works; navigating to `/archives/hedi-slimane`, `/editorial/rick-owens` shows tinted shell.

### Commit 6 — Editorial next/image + AVIF + portrait re-encode

- [next.config.mjs](next.config.mjs): `images: { formats: ["image/avif", "image/webp"] }` (affects only next/image call sites; Shopify `<img>`s untouched; first-hit AVIF encode is slower, cached after).
- [EditorialHero.js:12-17](app/editorial/_components/EditorialHero.js): → `<Image fill sizes … priority className="object-cover">` inside the existing aspect wrapper; thread `sizes` per layout (`"(min-width: 768px) 50vw, 100vw"` for image-right/left/pair, `"100vw"` for image-below).
- [EditorialIndexCard.js:21-26](app/editorial/_components/EditorialIndexCard.js): → `fill` + sizes read off the index grid's breakpoints (check `app/editorial/page.js` first).
- [Block.js](app/editorial/_components/Block.js) `ImagePairBlock` (80-85): → `fill` + sizes (~`"(min-width: 768px) 384px, 50vw"`; verify against max-w-3xl grid). `ImageBlock` (46-50, the real CLS+bytes offender): extend block schema with **optional `w`/`h`**; when present render `<Image width={w} height={h} className="block w-full h-auto" sizes={by width token} loading="lazy">`; when absent keep today's `<img>` verbatim (zero regression for dimension-less future content). Backfill `content/editorial/rick-owens.js` image blocks with measured dims (03.webp 2560×1856, 04.jpg 1000×818). Additive schema — admin's fs+`new Function` reads unaffected.
- Re-encode `public/archives/hedi-slimane/portrait.png` (1.1MB, 1233×1365) → `portrait.webp` (~`cwebp -q 85`, expect ~150–250KB); update [archives.js:31](app/lib/archives.js); delete the PNG.

**Verify:** clean build; editorial article layout-identical (aspect wrappers unchanged); Network shows `/_next/image` AVIF/WebP; article CLS ≈ 0; archives hero still `priority`.

## Out of scope (reported, deliberately deferred)

- **pg_trgm GIN index** for `/feed?search=` + `?brand=` ILIKE seq-scans (Supabase-side SQL; all 147 `/designers` links funnel into it) — biggest remaining structural win.
- **layout.js `cookies()`** forcing every route dynamic (blocks true static/ISR site-wide).
- Description backfill pace (the real fix for slow descriptions; prefetch merely front-loads per-product generation).

## Verification wrap-up

`npm install` in the worktree first. Full pass on `npm run build && npm start` against prod Supabase (reads safe; never hit `/api/cron` / `/api/enrich`). Run existing tests (`npm test`) — i18n parity and any gallery/link component tests must stay green. Browser-pane walkthrough: landing → feed → hover → click (instant) → back → mobile emulation → editorial article → archives page → /stores.
