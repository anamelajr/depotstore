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
    brand: null, sort: null, limit: LOAD_SIZE, offset: 0, signal })` where
    `signal` comes from the inner fn's **own AbortController bounded at 8000ms**
    (aligned with the PostgREST statement-timeout cap). Deliberately NOT the
    FeedLoader's 4s race signal: the fill must be allowed to outlive the render
    race so an abandoned cold miss still populates the entry for the next
    visitor. The 8s inner bound only guards the network-black-hole case the DB
    statement timeout can't cover; clear the timer in `finally`.
  - Throw if `products.length === 0` (transient failure must not blank the feed
    for a whole cache window; `unstable_cache` won't cache a throw).
  - Wrap: `unstable_cache(inner, ["feed-default-page1-v1-ls30"], { revalidate: 120 })`.
    Key bakes in LOAD_SIZE.
  - **Staleness contract (documented residual, mirrors stores/fx/dailyRotation):**
    `unstable_cache` is stale-while-revalidate — under sustained refresh
    failure it serves the old entry indefinitely (the exact property
    `resolveProductDetail.js:114-130` documents and why the PDP allowlist gate
    does NOT use it). That is acceptable here because this is *render* data,
    not authorization: repo precedent accepts SWR-indefinite for render reads
    (`stores.js`, `fx.js`, `fetchDailyRotation.js`) and fails closed only on
    authorization. A product hidden or sold inside the window renders as an
    ordinary card (NOT a SOLD overlay — `withVisibility` excludes sold from
    the feed entirely, so the stale entry simply still contains it); the
    accuracy boundary is the PDP, which is deliberately uncached and returns
    404/fail-closed. Normal staleness ≤120s; during a sustained Supabase
    outage the stale grid keeps serving (clicks fail closed at the PDP),
    which beats the uncached alternative of an empty feed. State this in the
    wrapper's comment block.

**`app/feed/page.js`** — in `FeedLoader`, compute
`isDefaultFeed = store === ALL_STORES_VALUE && categorySlugs.length === 0 && !search && !brand && urlSort === "interleaved"`,
then inside the existing `Promise.all` swap the products call:
`isDefaultFeed ? fetchCachedDefaultFeedPage() : fetchProductsPage({ …, signal })`.
Keep the 4s abort race and try/catch → `initialData = null` → client-fetch
fallback unchanged. Do NOT cache filtered/sorted variants (combinatorial keys,
low hit rate).

**Load More dedupe (`app/feed/FeedClient.js`):** offset pagination against the
mutable catalog can already duplicate/skip rows across the page boundary today
(two reads at different times); the 120s cache widens that window. Fix the
visible symptom: when appending a Load More page, filter out products whose
`handle|storeDomain` identity (the MAPPED field names — `mapProductRow` emits
`storeDomain`, not `store_domain`) is already in `products` before `setProducts`.
**Offset invariant:** `handleLoadMore` currently derives the next offset from
`products.length` (`FeedClient.js:458`) — that breaks once rendered length ≠
server rows consumed. Track the next server offset explicitly (e.g. a
`serverOffsetRef`/state advanced by the RAW `data.products.length` of each
fetched page, pre-dedupe, seeded from the initial page's raw length) and have
`handleLoadMore` use it; otherwise a partially-duplicate page overlaps the next
request and an all-duplicate page sets an unchanged state value and stalls Load
More permanently while `hasMore` is still true. Skipped rows remain an accepted,
pre-existing property of offset pagination — do NOT redesign feed pagination
(cursor/keyset) in this round.

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
- **Keyed job map, not a bare done-set.** Key = **`` `${src}|${sizes ?? ""}` ``**
  — NOT bare `src`: with a srcSet, the fetched candidate is selected from
  viewport/DPR/`sizes`, so the same image on a surface with different `sizes`
  (feed 33vw vs MoreFromStore 25vw) needs a distinct prefetch; keying by bare
  `src` would suppress it and leave that surface's first hover cold. DPR/resize
  drift between prefetch and hover remains an accepted miss (falls back to
  today's behavior).
- Job lifecycle: `queued → running → done` (load OR error both → done). One
  module map from key → state. `schedulePrefetch` for a key that is already
  queued/running/done is a **no-op** returning an inert cancel — dedupe applies
  from the moment of scheduling, not completion, so two same-key cards can't
  double-queue. `cancelFn` is idempotent and only removes a *queued* job
  (deleting its key so a later re-entry can reschedule); a *running* fetch is
  never aborted — it finishes and marks done. `inFlight` counter with
  `MAX_IN_FLIGHT = 3` gates queued→running.
- **Page-load gate:** the scheduler must not start its first drain until the
  window `load` event has fired (`document.readyState === "complete"`, else a
  one-shot `load` listener). Per-card `primaryDone` only proves *one* primary
  finished — a small card can finish while the actual LCP image is still
  transferring, and `requestIdleCallback` measures CPU idleness, not network
  idleness. Web-Vitals LCP is only measured on hard loads, where the `load`
  gate holds the entire drain out of the LCP window; soft navs are already
  post-`load` and need no extra gate.
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
  unless `hoverCapable && primaryDone && !primed && imageUrl2 && imageUrl2 !== imageUrl`.
  Create `IntersectionObserver` (threshold 0) on `hoverTargetRef.current` (the
  aspect wrapper — works under `content-visibility: auto` ancestors). Observer
  logic is just **schedule on intersect, cancel on un-intersect**:
  `schedulePrefetch({ src: shopifyImageUrl(imageUrl2, width), srcSet: srcSet2,
  sizes: srcSet2 ? sizes : undefined })`. The scheduler's job map makes this
  race-free with no local bookkeeping: cancel only dequeues a still-queued job
  (bounding fast-fling waste on 600-card restored grids) and is a no-op once
  running; re-entry after a cancel reschedules because cancel cleared the key;
  re-entry after completion is a no-op via the done state — including across
  remounts (scroll restore). Cleanup: cancel + disconnect.
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
cancel/save-data with stubbed `Image`/`requestIdleCallback`/`navigator.connection`;
dedupe distinguishes same `src` with different `sizes`; nothing drains before the
stubbed `load` event fires; scheduling an already-queued/running/done key is a
no-op; cancel of a queued job allows reschedule, cancel of a running job doesn't
abort it. Also: Load More append drops rows whose `handle|storeDomain` already exists in
the grid; the next server offset advances by the raw fetched-page length even
when a page is partially or fully deduped (no stall on an all-duplicate page).
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
