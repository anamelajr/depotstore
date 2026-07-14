# Desktop PDP Redesign — Saint Laurent-Style Stacked Gallery

## Context

The current desktop product page (3-column grid: bordered thumbnail rail | wheel-hijacked hero with overlay arrows | sticky info card) reads busy and the type feels cheap. The user wants the visual feel of Saint Laurent's PDP: imagery owning ~60% of the page, a faint vertical `2/6` counter, no visible navigation buttons, native smooth scrolling through full-height photos, a self-contained sticky info panel, and a click-to-zoom view with a left thumbnail rail and a thin black cross.

Mechanics were measured on the live ysl.com PDP: the gallery is a **plain vertical stack of 100vh sections with native scroll** (no hijack, no snap); the counter and info panel are **sticky full-height elements**; every image is a button opening the zoom view. Decisions confirmed with the user (via live mockups): **(A) images float "contained with air"** on the white page (no crops/upscaling — our archive photos have mixed backgrounds), **description moves into the sticky panel** (About band removed), **native scroll** (no Lenis).

Scope: **desktop (`lg:`) only — mobile PDP JSX/behavior untouched.**

## Layout spec (≥ lg)

Page: white, full-width 2-col grid `lg:grid-cols-[minmax(0,1fr)_420px]`, no gap; nav stays the existing sticky dark 56px bar (`--nav-height`).

**Gallery column (left):**
- One section per image: `height: calc(100vh - var(--nav-height))`, flex-centered; `<img>` `object-contain`, `max-height: 86%`, `max-width: 72%`, natural aspect, `shopifyImageUrl(src, 1600)`, `cursor: zoom-in`. First image eager, rest lazy.
- **Counter**, YSL-style: sticky (top = nav height, height 0 wrapper), digits absolutely placed at vertical center of viewport, ~40px from left edge: current index (11px, zinc-900, tabular-nums) over a 14px hairline (zinc-300) over total (11px, zinc-400). Index = `round(scrollTop/sectionH)+1` from a rAF-throttled scroll listener. Digit change animates odometer-style (old fades up out, new fades up in, ~220ms). Hidden when only 1 image.
- **Reveal**: each image fades in on first intersection (IntersectionObserver, threshold 0.2): opacity 0→1 + translateY 12px→0, 500ms `cubic-bezier(0.22,1,0.36,1)`, once. Disabled under `prefers-reduced-motion`.
- No thumbnails, no arrows, no borders on the main page.

**Info panel (right):**
- Sticky `top-[var(--nav-height)]`, `height: calc(100vh - var(--nav-height))`, `overflow-y-auto`, padding-x ~48px (content column ~320px). **Scroll-safe centering:** the outer sticky element is the scroll container (flex column); an inner content wrapper carries `margin-block: auto` (`my-auto`). Auto margins center the content when it fits and collapse to zero when it overflows, degrading to top-aligned scrolling — never `justify-content: center` on the scroll container itself, which distributes overflow above the top edge where it becomes unreachable.
- Content order (subtle-typography tokens — small tracked uppercase, per the nav-menu style; no display type): store label link (10px, tracking 0.22em, underline offset) → brand + title heading (13px semibold uppercase tracking 0.06em, title on its own line in zinc-500 if brand present) → price (13px) → hairline → `SIZE — FR 38` line (10px tracked) → **description** (13px, leading-1.7, zinc-600; `line-clamp` ~10 with a quiet "More" toggle if overflowing) → CTA (full-width black bar, 10-11px tracked uppercase, `hover:bg-zinc-800`) → SaveShareRow → store name · location + "Browse store →". Sold state: muted `SOLD` token above CTA; CTA becomes "View at retailer".
- Desktop utility row (back link + breadcrumb) is removed; a single quiet floating `← Back` (BackToFeedLink) sits top-left over the first section, fading out after the first scroll. `ProductBreadcrumb` no longer rendered on desktop.

**Below the gallery:** only `MoreFromStore` (unchanged component). `DesktopAboutSection` is deleted (description now lives in the panel; mobile keeps its Description accordion).

**Zoom view** (replaces the current lightbox; per the user's YSL screenshots):
- Opens on image click: `fixed inset-0` white, `z-[9999]`, `role="dialog" aria-modal`, body scroll locked.
- Left thumbnail rail (~64px wide images, vertical, gap 10, vertically centered; active thumb marked with a 1.5px black bar on its left edge). Click a thumb → container smooth-scrolls to that image.
- Main area: internal scroll container, one image per `100vh` section, `object-contain` at ~88vh, `shopifyImageUrl(src, 2048)`; native wheel scrolling, active index synced back to the rail via scroll position.
- Thin black cross top-right (1px strokes, 44px hit target) closes; **Escape** closes; ArrowUp/Down move one image. On close, the main page scrolls (instant) to the section of the last-viewed image, and focus returns to it.
- **Keyboard containment (hard requirement):** on open, focus moves to the close button; Tab/Shift+Tab are trapped within the overlay's focusable controls (close button + thumbnail buttons); the page content behind the overlay is made `inert` (attribute on the page wrapper) for the dialog's lifetime. Every close path — cross, Escape, rapid open/close — removes `inert` and returns focus to the last-viewed image's section button. Listeners and the trap live in a single effect keyed on the open state so stale handlers can't survive quick toggles.
- Enter: overlay fades in 300ms with image scale 0.985→1; thumbs stagger-fade. Exit: 200ms fade. Both skipped under `prefers-reduced-motion`.
- Opens at the clicked image's index.

## Files

- `app/product/[handle]/page.js` — new desktop grid; render new gallery + panel; drop desktop utility row and `DesktopAboutSection`; **mobile blocks unchanged**.
- **NEW** `app/components/DesktopProductGallery.js` (client) — sections, counter, reveal, floating back link, zoom overlay. Desktop-only (`hidden lg:block` internally).
- `app/components/ProductInfoPanel.js` — restyle to full-height centered panel; add description block (new `More` toggle needs a client boundary — make the description clamp its own tiny client component or make the panel client; prefer a small `ClampedDescription` client child, panel stays server). Keep `T` keys for CTA/size/browse-store; any **new** user-visible strings go into `app/lib/i18n/messages.js` (en+fr — parity test enforces).
- `app/components/ProductGallery.js` — strip all desktop-only code (thumb rail, hero, wheel handler, lightbox, arrow keys, expand button); keep the mobile swipe gallery exactly as-is; component becomes mobile-only (keeps its `lg:hidden` wrappers).
- Delete `app/components/DesktopAboutSection.js`.

Reuse: `shopifyImageUrl` (`app/lib/shopifyImage.js`), `Price`, `SaveShareRow`, `BackToFeedLink`, `buildFreshFeedUrl`, `T`/messages. No data-layer changes (`resolveProductDetail` untouched — CLAUDE.md product-read invariants not in play).

Sharp edges to respect: don't introduce `overflow-x-hidden` on wrappers (breaks sticky — use `overflow-x-clip` if needed); `--nav-height: 56px` coupling; fonts via existing `--font-*` variables.

## Edge cases

- 1 image → no counter, zoom still works; 0 images → single 100vh placeholder section, no zoom.
- 11+ images (e.g. dolcevitahub Armani biker jacket) → rail scrolls internally in zoom.
- Panel content taller than viewport (long description) → clamp keeps it inside; the `my-auto` inner wrapper collapses its auto margins so the panel becomes a normal top-aligned scroll with all content reachable.
- Image load failure → white section remains, alt text; no layout shift (reserve via max-h box).
- Rapid open/close of zoom; scroll-restoration on Next.js navigation (existing `window.scrollTo(0,0)` on mount stays, moved into the new gallery).

## Verification (end-to-end)

1. `preview_start` the dev server (read-path only — **never** hit `/api/cron` or `/api/enrich`).
2. Test products: `lobscur.com` McQueen skirt `new-arrival-alexander-mcqueen` (6 mixed model/packshot images), `dolcevitahub.com` Armani jacket `2000s-armani-collezioni-grey-geommetrical-biker-leather-jacket-1` (11 images), plus a 1-image and a sold product from the feed.
3. Verify in browser at 1280 / 1440 / 1680 widths: scroll rhythm and seamlessness, counter ticks + odometer animation, panel stays fixed with centered content, description + More toggle, floating back link fade, zoom open (correct index) / thumb click smooth-scroll / active-thumb bar / wheel + arrows / X + Escape close / focus return / main-page position sync, sold state, reveal animations, `prefers-reduced-motion` (emulate), no horizontal scrollbar, sticky unbroken.
   - **Keyboard containment:** with zoom open, Tab repeatedly — focus must cycle only through overlay controls (verify background is `inert`); Escape and rapid open/close must restore `inert` removal + focus return every time.
   - **Short viewport:** at ~1280×620 with the description expanded, every panel element (store label through Browse store) must be reachable by scrolling the panel; nothing clipped above the top edge.
4. Mobile viewport (375px): swipe gallery, accordions, CTA — identical to today.
5. `npm run lint` + existing test suite (messages parity test guards new strings).
6. Screenshots of every state as proof.
