# Feed product-image loading performance

## Context

After the last perf PR (merge `6f2308a`), the site is faster overall but feed product photos still lag. Investigation showed this is **not** an aggregation/middleman penalty — images come straight from Shopify's fast CDN — but a set of client-side loading gaps: every feed image is hardcoded `loading="lazy"` (including the above-the-fold LCP cards), the smallest srcSet candidate is 800w while mobile cards need ~400w, there's no preconnect to `cdn.shopify.com`, every desktop card mounts a second hover `<img>` at hydration (~30 extra requests), there's no loading placeholder (flat grey), and back-navigation scroll-restore re-renders up to 600 cards in one pass. The PDP already got the correct treatment (eager + `fetchPriority="high"` + preload) in the last PR; the feed did not.

User approved three packages: **(1) core loading fixes, (2) blur-up placeholders, (3) scroll-restore taming.** Explicitly rejected: routing images through the Next/Vercel image optimizer (metered cost, extra hop). Images stay direct from Shopify CDN via the existing `shopifyImageUrl` helper ([app/lib/shopifyImage.js](app/lib/shopifyImage.js) — idempotent, passthrough for non-Shopify hosts).

## Files to modify

- `app/components/HoverSwapImage.js` — the single funnel for all card images (core change)
- `app/components/ProductCard.js` — thread `priority` prop
- `app/feed/FeedClient.js` — priority for first cards, restore suppression, content-visibility toggle
- `app/layout.js` — preconnect
- `app/globals.css` — content-visibility utilities
- `app/components/archive/ArchiveProductsClient.js` — `priority={i < 4}`
- `app/editorial/_components/PiecesFeatured.js`, `MoreFromDesigner.js` — pass `sizes` (they currently get no srcSet)

## Package 1 — Core loading fixes

**1.1 Preconnect** (`app/layout.js`): in `RootLayout`, `import { preconnect } from "react-dom"` and call `preconnect("https://cdn.shopify.com")` (React 19 hoists into `<head>`; matches the existing `ReactDOM.preload` idiom in `app/product/[handle]/page.js:35`). No `crossOrigin` — product imgs are no-cors.

**1.2 HoverSwapImage rework** (`app/components/HoverSwapImage.js`):
- New prop: `priority = false`, accepting `false | "eager" | "high"`. **`"high"` is reserved for the plausible LCP candidates only** — marking many images high dilutes the real LCP's bandwidth share on constrained connections (six equal-priority derivatives race each other; the one that becomes LCP finishes later). `"eager"` opts out of lazy loading without touching fetch priority.
- `srcSetFor` candidates `[800, 1200, 1600]` → `[400, 600, 800, 1200, 1600]` (mobile 50vw card at 2× DPR wants ~400w, currently forced to 800w). Update the file's header comment. Extract the `url.startsWith("https://cdn.shopify.com/")` + `typeof` check into a shared `isShopifyCdnUrl(url)` predicate (module-local) used by both `srcSetFor` and the LQIP guard — a bare `.startsWith` on the LQIP path would drop the type-tolerance `shopifyImageUrl`/`srcSetFor` deliberately have.
- Primary `<img>`: `loading={priority ? "eager" : "lazy"}`, `fetchPriority={priority === "high" ? "high" : undefined}`, `decoding="async"` — the `"high"` tier mirrors `DesktopProductGallery.js:135-137`.
- **Defer hover image**: replace the mount-at-hydration behavior with a `primed` gate — a `useState(false)` flipped by a `{ once: true }` `pointerenter` listener on the primary img's `parentElement` (the aspect wrapper — captured via the primary img's ref callback, so no caller API change; listening on the parent means overlay layers can't steal the event). `showSecond = hoverCapable && primed && imageUrl2 && imageUrl2 !== imageUrl`. **No** `requestIdleCallback` prefetch fallback — that would reinstate the 30-request wave. Keep the hover img's existing `onError` display-none handler and `fetchPriority="low"`.
- **State-reset invariant**: feed cards are keyed by `productUrl + name`, so a product whose image URLs change in place does NOT remount — stale `loaded`/`loaded2`/`primed` would skip the fade/hover gates for the replacement images. In `ProductCard` (and any caller), key the component on its inputs: `<HoverSwapImage key={`${imageUrl}|${imageUrl2 ?? ""}`} …>` — URL change → clean remount, state resets by construction.

**1.3 ProductCard** (`app/components/ProductCard.js`): add `priority = false` prop, forward to `HoverSwapImage` (with the URL-pair `key` from 1.2).

**1.4 FeedClient priority** (`app/feed/FeedClient.js`):
- `const EAGER_COUNT = 6;` (2 desktop rows at 3-col / 3 mobile rows at 2-col), `const HIGH_COUNT = 2;` (the first row's cards on mobile — the plausible LCP candidates; cards 3–6 are eager but normal-priority so they never race the LCP), and `const suppressPriorityRef = useRef(false);`
- In the mount-restore `useLayoutEffect` (~line 104), inside `if (count > 0)`: `suppressPriorityRef.current = true;` — restored grids land mid-scroll, so index-based priority would eager the wrong (top) cards. The restored grid only renders after the restore fetch settles, so the ref is read strictly after it's set (same ordering guarantee `restoreCountRef` relies on).
- In the apply-server-data `useEffect` (~line 136), after the restore-pending early return: `suppressPriorityRef.current = false;` — soft-nav filter changes render fresh from the top.
- Grid map (~line 498): add index param, pass `priority={suppressPriorityRef.current ? false : i < HIGH_COUNT ? "high" : i < EAGER_COUNT ? "eager" : false}`.
- Fresh SSR load: ref is false on server and client → hydration match, first 6 eager (first 2 high) in SSR HTML (the main win — preload scanner fires pre-hydration). Load More appends have `i >= 30` → lazy. Accepted caveat: on back-nav the seeded grid exists for one pre-paint frame; any eager fetches it kicks off are HTTP-cache hits from the prior visit.

**1.5 Other surfaces**: Archive grid: same tiering, `i < 2 ? "high" : i < 4 ? "eager" : false` (4-col desktop). Homepage/MoreFromStore/editorial: no priority (below the fold). Editorial `PiecesFeatured.js` + `MoreFromDesigner.js`: pass `sizes="(min-width: 1024px) 25vw, 50vw"` so they get a srcSet at all. Existing `sizes` strings on feed/homepage/archive/MoreFromStore were audited against their grids — all correct, leave as is.

## Package 2 — Placeholders (all inside HoverSwapImage)

**Approach**: blur-up LQIP on **non-priority** cards using a `width=20` Shopify derivative (~0.5–2KB each), rendered as a **lazy `<img>` underlay, NOT a CSS background** — backgrounds aren't lazy-loaded and would fetch for all ~600 restored cards; as a lazy img the LQIP rides the same viewport-driven fetch machinery (and is skipped inside Package 3's `content-visibility` cards). Non-Shopify hosts get no underlay → callers' existing `bg-zinc-100` shows through (today's behavior).

**Invariant: LQIPs must never contend with the LCP.** Priority cards get **no LQIP at all** — an eager LQIP per priority card would add 6 extra requests in the LCP-critical window, and a Shopify derivative cache miss on a `width=20` variant could stall connection slots the real LCP image needs. Priority images are eager + `fetchPriority="high"` and start at `opacity-100` (2.2), so their placeholder value is negligible. All LQIPs that do render carry `fetchPriority="low"` so they can never outrank a primary image in the request queue.

**2.1 LQIP underlay** (first child, under primary img): only when `!priority && isShopifyCdnUrl(imageUrl)` (the shared predicate from 1.2 — never a bare `.startsWith`, which would throw on truthy non-string input the rest of the image helpers tolerate):
```jsx
<img src={shopifyImageUrl(imageUrl, 20)} alt="" aria-hidden="true"
     loading="lazy" decoding="async" fetchPriority="low"
     className="absolute inset-0 h-full w-full scale-110 object-cover blur-md" />
```
(`scale-110` hides the blur edge halo; wrapper `overflow-hidden` clips.) The LQIP may lose the race to the primary on fast connections — harmless: the primary sits above it and fades in over it; the LQIP only matters when the primary is slow, which is exactly when it wins.

**2.2 Primary fade-in**: `const [loaded, setLoaded] = useState(Boolean(priority))` — priority (eager/high) images start visible (SSR LCP must not wait on hydration; same lesson as `DesktopProductGallery.js:79-82`). Primary img: `onLoad`/`onError` → `setLoaded(true)` (error path degrades to today's broken-img-over-grey, never stuck on blur), plus ref callback `if (el && el.complete && el.naturalWidth > 0) setLoaded(true)` for images cached before hydration (same ref callback also captures `parentElement` for 1.2). Class: `transition-opacity duration-300 ease-out ${loaded ? "opacity-100" : "opacity-0"}`.

**2.2c Hover crossfade gated on load** (fixes 1.2's first-hover pop-in): `loaded2` state via `onLoad` + same `complete` ref check; the `group-hover:opacity-100` variant only applies when `loaded2` — first hover mounts at opacity-0, loads, then the existing 350ms fade engages.

Layer order: LQIP → primary → hover.

## Package 3 — Scroll-restore taming (feed only)

Restore mechanism (verified): card click writes `depot_feed_scroll/count/filter_key/url` to sessionStorage; mount `useLayoutEffect` hides the seeded grid and refetches `limit=restoreCount` (≤600); a second `useLayoutEffect` (~line 150) jumps `window.scrollTo(0, y)` pre-paint. Exactness comes from jumping against a fully laid-out grid.

**Design**: always-on `contain-intrinsic-size` + two-phase `content-visibility` — pay today's one full layout on the restore frame (keeps the jump exact), then enable `content-visibility: auto` after first paint, when every card has a browser-recorded "last remembered size" (recording requires the `auto` keyword in `contain-intrinsic-size` to be present during rendered frames, hence always-on). Fresh loads get it from the first frame, where the fallback estimate only shapes the scrollbar.

**3.1 `app/globals.css`**:
```css
.feed-card-cv { contain-intrinsic-size: auto 290px; }          /* 2-col mobile: ~160px card → 200px img + caption */
@media (min-width: 1024px) { .feed-card-cv { contain-intrinsic-size: auto 500px; } } /* 3-col: ~330-470px card → 410-590px img + caption */
.feed-card-cv--on { content-visibility: auto; }
```
Unsupported browsers ignore both → today's behavior.

Estimate accuracy note: the fallback lengths only matter for never-rendered cards on **fresh** loads (restore pre-records real sizes). They shape total document height — i.e. the scrollbar — not visible content: browser scroll anchoring holds the viewport stable while estimates below it correct to real sizes, and cards above the viewport were already rendered (real sizes recorded) when the user scrolled past them. So an off estimate costs scrollbar drift, not content jumps. The values above are derived from card width × 5/4 + caption (~90px mobile, ~60px desktop) at each breakpoint's typical grid width; keep them within ~20% of real card height if the grid geometry changes.

**3.2 FeedClient**: `const [cvEnabled, setCvEnabled] = useState(true)`; in mount-restore effect's `if (count > 0)`: `setCvEnabled(false)`; in the scroll-jump layout effect after `window.scrollTo`: `requestAnimationFrame(() => requestAnimationFrame(() => setCvEnabled(true)))` (double rAF = after one painted frame, when sizes are recorded). Grid item wrapper: `` className={`feed-card-cv${cvEnabled ? " feed-card-cv--on" : ""}`} ``. Both writes idempotent (StrictMode-safe).

**Accepted limitation (deliberate, user-approved):** the restore frame itself still reconciles, builds, and lays out all ≤600 cards in one pass before first paint — `content-visibility` cannot skip React reconciliation or DOM creation, and enabling it only after that frame is what keeps the scroll jump pixel-exact. This is **no worse than today**; the package improves every frame *after* the restore, not the restore itself. Do not "fix" this by enabling `content-visibility` during the restore frame (estimate-based heights would land the jump off-target). If the measurement below shows the restore long-task is genuinely bad on mobile, the follow-up is a chunked/windowed rebuild behind a height spacer — a separate change, not this one.

Out of scope (follow-up ticket if wanted): the restore still issues one `/api/products?limit=≤600` request, and the chunked-rebuild redesign above if measurement warrants it.

## Commit order

1. Preconnect (1.1) — standalone.
2. HoverSwapImage rework (1.2 + Package 2) — one coherent change; `priority` defaults false so all surfaces benefit immediately.
3. Priority threading (1.3–1.5).
4. Package 3 (3.1–3.2).

## Verification (dev server + browser tools; read-path only, safe against prod Supabase)

Note: worktree needs `.env.local` copied from the main checkout or the build fails with "supabaseUrl is required".

**Package 1**: view-source `/feed` — exactly first 6 imgs have `loading="eager"`, and of those exactly the first 2 have `fetchpriority="high"`; rest `loading="lazy"`, all `decoding="async"`; head has the preconnect link. srcSet includes `width=400 400w` / `width=600 600w`; at 375px viewport + DPR 2 emulation, network shows `width=400/600` requests, not 800. Fresh desktop load with no mouse movement: zero `imageUrl2` requests; pointerenter one card → exactly one hover request, crossfade only after it loads. Load More appends: all lazy.

**Package 2**: near-viewport **non-priority** cards issue one `width=20` request each, trailing the viewport (lazy); the 6 priority cards issue **zero** LQIP requests and every LQIP request shows `fetchpriority=low`. Cold-cache check (devtools, disable cache, Fast-3G throttle): the first-card primary image request starts no later than it does on `main` — LQIPs must not push the LCP fetch back. Slow-3G throttle: blur→sharp fade looks intentional. Full-cache reload: no card stuck transparent (check cards 7–30 especially — they SSR at `opacity-0`). Blocked image URL: degrades to broken-img-over-grey, not stuck-on-blur.

**Package 3**: scroll deep (3–4 Load Mores), click product, browser-back: lands within ~1px of saved Y, no flash/settle-shift. After restore: grid items have `feed-card-cv--on`; network shows image requests only near restored viewport (tens, not hundreds). Scrolling up from restored position: no layout jumps. Fresh-load stability: at ~1024px and ~390px widths, scroll a fresh feed top→bottom — visible content never shifts (scrollbar drift from estimate correction is acceptable). Regression check: restore with changed filter key still cleans sessionStorage and renders normally. **Restore-cost measurement** (documents the accepted limitation, not a gate): with ~600 cards saved, record a devtools Performance trace of the back-navigation on 4× CPU throttle, before and after this change — note the restore long-task duration in the PR description; it should be unchanged (the package targets post-restore frames), and scroll frames after restore should show skipped work on offscreen cards.

**i18n**: no user-visible strings added — nothing to mirror in `messages.js`.
