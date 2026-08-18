# Landing→Feed Speed + Hover-Image Prefetch

## Context

After the last perf PR (#118), the site is faster but two things still drag:

1. **Landing → feed navigation.** Clicking "View All" / "Explore" waits on a live
   Supabase interleaved-RPC round-trip every single time: `/feed` is
   `force-dynamic` and `fetchProductsPage` is uncached (`app/feed/page.js:9,48`),
   so even though the skeleton streams, the grid itself takes 0.5–4s to arrive.
2. **Hover second-image swap.** The hover `<img>` mounts only on the first real
   `pointerenter` (`app/components/HoverSwapImage.js:62-68`), so the CDN fetch
   starts with **zero lead time** — the user is already hovering when the request
   begins. Cold Shopify derivatives make some cards visibly lag.

User decisions: (a) prefetch hover images **for visible cards only, during idle
time** — must stay meaningfully cheaper than the rejected all-cards-at-mount
design (~30 req/page, `docs/plans/feed-image-loading-perf.md:27`); (b) scope
this round to the landing→feed transition + hover swap. No INP refactors, no
virtualization, no homepage rendering changes.

Verified facts the plan relies on:
- `fetchProductsPage` reads no cookies/headers, returns plain serializable
  `{ products, total, hasMore }` → safe for `unstable_cache`. Established
  patterns in `app/lib/stores.js:101` and `app/lib/fx.js:47`, including the
  "never cache a degraded result" invariant (`stores.js:85-87`).
- Next 16.2: default `<Link>` prefetch on a dynamic route only prefetches to the
  nearest `loading.js`; `prefetch={true}` prefetches the full route + data
  (production only). Three landing→feed links exist, all default prefetch:
  `app/page.js:72-78` (keeps `replace`), `app/components/home/Hero.js:34-42`,
  `app/components/home/SearchBrowseRow.js:76-79`. No category-parameterized
  feed links on the landing page → caching the default view covers the complaint.
- `HoverSwapImage` gotcha: `loaded` initializes to `Boolean(priority)`
  (line 48) — true before any byte arrives for the 6 eager/2 high cards, so the
  prefetch gate needs a separate "primary actually finished" signal.

## Part A — Landing → feed

### A1. Cache the default first feed page (primary fix)

**`app/lib/fetchProductsPage.js`** (feed query composition stays here per CLAUDE.md):

- New export `fetchCachedDefaultFeedPage()`:
  - Inner fn: `fetchProductsPage({ store: null, categorySlugs: [], search: null,
    brand: null, sort: null, limit: LOAD_SIZE, offset: 0 })` — **no signal**
    (nothing live to abort; same rationale as `stores.js:115-119`).
  - Throw if `products.length === 0` (transient failure must not blank the feed
    for a whole cache window; `unstable_cache` won't cache a throw).
  - Wrap: `unstable_cache(inner, ["feed-default-page1-v1-ls30"], { revalidate: 120 })`.
    Key bakes in LOAD_SIZE. 120s staleness on hidden/sold flips is acceptable
    (PDP re-checks; SOLD renders as overlay).

**`app/feed/page.js`** — in `FeedLoader`, compute
`isDefaultFeed = store === ALL_STORES_VALUE && categorySlugs.length === 0 && !search && !brand && urlSort === "interleaved"`,
then inside the existing `Promise.all` swap the products call:
`isDefaultFeed ? fetchCachedDefaultFeedPage() : fetchProductsPage({ …, signal })`.
Keep the 4s abort race and try/catch → `initialData = null` → client-fetch
fallback unchanged. Do NOT cache filtered/sorted variants (combinatorial keys,
low hit rate).

### A2. Full prefetch on the three landing→feed links

Add `prefetch={true}` to the `<Link href="/feed">` in `app/page.js:73`,
`Hero.js:35`, `SearchBrowseRow.js:76`. Router dedupes identical URLs → ~1 full
RSC prefetch per landing view, cheap because of A1 (cached stores + cached feed
page). Only ship A2 together with A1. Skip `unstable_dynamicOnHover`.

### A3. No `loading.js` changes — skeleton already exists.

**Expected impact:** warm path becomes click → grid immediately (router cache);
prefetch-miss clicks still drop to ~RTT + streaming since the server answers
from `unstable_cache`. Cold cache (first hit per ~120s per region) = today's
behavior, bounded by the 4s race.

## Part B — Idle viewport prefetch of hover images

### B1. New module `app/lib/idleImagePrefetch.js` (client, no React)

Shared scheduler: `schedulePrefetch({ src, srcSet, sizes }) → cancelFn`.
- Module state: `done` Set keyed by `src`, FIFO queue, `inFlight` counter,
  `MAX_IN_FLIGHT = 3`.
- Skip entirely when `navigator.connection?.saveData` or `effectiveType`
  matches `/2g/`.
- Drain via `requestIdleCallback(cb, { timeout: 1500 })`, `setTimeout(cb, 300)`
  fallback (Safari).
- **Cache-hit guarantee:** off-DOM `new Image()`, `img.fetchPriority = "low"`,
  then assign `sizes` BEFORE `srcset`, then `src` — byte-identical strings to
  what the mounted hover `<img>` will carry, so the browser's candidate
  selection warms exactly the URL the real element will request.
- `load`/`error` both mark done (don't retry dead URLs; mounted img's `onError`
  display-none path already handles them). `cancelFn` dequeues if not started.

### B2. `HoverSwapImage.js` — observation + trigger

- Add `primaryDone` state: initialized `false` **even for priority cards**, set
  in `onLoad`, `onError`, and the `el.complete && naturalWidth > 0` branch of
  `primaryRef`. (Gating on `loaded` would let the top-row cards queue prefetches
  inside the LCP window — the line-48 gotcha.)
- New effect (deps `[hoverCapable, primaryDone, primed, imageUrl2]`): bail
  unless `hoverCapable && primaryDone && !primed && imageUrl2 && imageUrl2 !== imageUrl`
  and not already scheduled (local ref; module `done` set dedupes across
  remounts e.g. scroll restore). Create `IntersectionObserver` (threshold 0) on
  `hoverTargetRef.current` (the aspect wrapper — works under
  `content-visibility: auto` ancestors). On intersect →
  `schedulePrefetch({ src: shopifyImageUrl(imageUrl2, width), srcSet: srcSet2,
  sizes: srcSet2 ? sizes : undefined })`; on un-intersect before start → cancel
  (bounds fast-fling waste on 600-card restored grids); after start →
  unobserve/disconnect. Cleanup: cancel + disconnect.
- **Keep mount-on-pointerenter unchanged** (`primed`/`showSecond`/`loaded2`
  crossfade) — the prefetch only warms the HTTP cache; hover mount becomes a
  cache-hit decode. No neighbor-hover warm-up (viewport+idle already covers it).
- Update the header comment (lines 42-44) to describe the new lifecycle.

All HoverSwapImage surfaces (feed, archive grid, MoreFromStore, editorial rows)
inherit automatically; no-`sizes` callers prefetch the plain `width=800` URL —
matching what their hover img requests.

### B3. Amend `docs/plans/feed-image-loading-perf.md`

The line-27 prohibition barred priming ALL ~30 cards at mount; note the
superseding design (viewport-visible + post-primary + idle + save-data guard +
concurrency cap, budget ~6–9 requests per viewed screenful; touch devices zero
via `hoverCapable`).

## Verification

Unit (vitest): `app/lib/__tests__/idleImagePrefetch.test.js` — queue/cap/dedupe/
cancel/save-data with stubbed `Image`/`requestIdleCallback`/`navigator.connection`.
Also assert `fetchCachedDefaultFeedPage` throws on empty/error result.

Local (copy `.env.local` from main checkout — see memory note; read-path only,
never hit `/api/cron`//`api/enrich`):

**Part A** — needs `npm run build && npm start` (prefetch is production-only):
1. Load `/`; Network shows ~1 deduped `/feed?_rsc=…` prefetch as links enter viewport.
2. Click View All → grid paints with no new RSC request.
3. Restart server: first `/feed` hit live-RPC slow, second within 120s near-instant;
   filtered URLs (`?category=`, `?sort=`, `?search=`) still hit the live path.
4. Regression: client-fetch fallback still works (unreachable Supabase URL →
   initialData null → grid loads via `/api/products`).

**Part B** — observable in dev:
1. Desktop, cold cache, no mouse movement: imageUrl2 requests start only after
   visible primaries finish, count ≈ visible cards (~6–9, not 30), all low
   priority; LCP start time unchanged vs main under Fast-3G throttle.
2. Hover a prefetched card → request row shows "(memory/disk cache)", crossfade
   immediate.
3. Touch emulation: zero imageUrl2 requests. Save-Data on: zero prefetches.
4. Scroll-restore with several Load Mores → browser-back: imageUrl2 requests in
   single digits, fling keeps count proportional to dwell.
5. Spot-check an archive page.

Then verify on Vercel preview + Speed Insights after a few days of traffic.

## Commit order

A1 → A2 (measure between) → B1+B2 (one coherent change) → B3 docs.
Branch + PR; never push to main.

## Explicitly out of scope (candidates for a follow-up round)

- INP work: memoizing `ProductCard`, `startTransition` on filter state, unmemoized
  Currency/Language context values, the 4× sessionStorage writes in card onClick.
- Homepage `/` cold-load LCP: sequential awaits with no Suspense split, contentless
  `app/loading.js`, Leaflet hydration in the LCP window.
These are the next-biggest wins if this round lands well.
