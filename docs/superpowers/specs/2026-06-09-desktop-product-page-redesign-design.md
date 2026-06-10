# Desktop product page redesign — reference-tight layout

## Context

The desktop product detail page currently floats a 70vh `object-contain` hero in
empty space, with a uniformly tiny (11–14px) divider-heavy info panel. The user
compared it against a reference (Lost Files NYC product page) and wants Dépôt to
adopt its spacing/cohesion: imagery dominating ~60% of the width with the photo
filling its frame edge-to-edge, arrows sitting **on** the image, a bold type
hierarchy in a snug right info column, and whitespace instead of stacked
hairlines. The design was iterated through 5 browser mockups (v3 composition
chosen, served from `/tmp/brainstorm-56277-1781034585/content/gallery-scale-v3-replay.html`)
and explicitly approved.

**Approved design decisions:**
- Fixed-height hero frame filling the viewport below the nav; store photo fills
  it edge-to-edge via `object-cover` (slight top/bottom crop accepted) — chosen
  over "fit on backdrop" (looked strange) and "natural height past the fold".
- Click-to-enlarge lightbox showing the full uncropped photo, with an expand
  icon in the hero corner like the reference.
- Thumbnails grow ~88px → ~110px; gaps tighten; content starts higher.
- Info column: underlined store label on top → large bold uppercase
  brand+title heading → price → **one** hairline divider → quiet size line →
  black BUY AT button → new ♡ Save / ↗ Share row → store + BROWSE STORE block.
- Back link + breadcrumb row stays as today (user rejected moving it).
- **Mobile is untouched.** Desktop (`lg:`) only.

**Revision (2026-06-10):** the full-column-width hero frame computed to
~1.07:1 (near-square) at 1512×860 while store photos are mostly 2:3/3:4
portrait, so `object-cover` cropped ~38% of the photo vertically and forced
retina upscaling past typical store masters (~1280–1400px) — visibly soft.
The hero frame now keeps its fixed height but derives width from a 4:5
aspect (`lg:aspect-[4/5]`, centered, `max-w-full` guard), the squarest ratio
that both caps the crop (~17% on 2:3 photos, 0% on dot COMME's native 4:5)
and keeps retina demand under the masters. Lightbox/arrows/info column
unchanged.

## Files to change

### 1. `app/product/[handle]/page.js` (desktop wrapper only)
- Tighten top spacing: `lg:pt-8` → `lg:pt-5` on the container; utility row
  `mb-6` → `mb-4`.
- Grid: `lg:grid-cols-[88px_1fr_340px] lg:gap-16` →
  `lg:grid-cols-[110px_minmax(0,1fr)_400px] lg:gap-8`.
- Pass `productUrl` (already computed) into `ProductInfoPanel` for the
  share/save row.
- Mobile block (`order-2 lg:hidden`) unchanged.

### 2. `app/components/ProductGallery.js` (desktop branches only)
- **Hero frame** (line ~242): replace
  `lg:h-[70vh] lg:items-start lg:justify-center` + `h-full w-auto object-contain`
  with a fixed frame `relative w-full lg:h-[calc(100vh-var(--nav-height)-110px)] lg:min-h-[560px] overflow-hidden`
  and `h-full w-full object-cover object-center` on the `<img>`
  (110px ≈ pt-5 + utility row + mb-4; fine-tune at verification so the frame
  bottom lands at the viewport bottom edge).
- **Thumbnail column** (line ~214): width comes from the grid (110px); set its
  sticky height to match the new hero height; keep `aspect-[3/4]` crops,
  `gap-2` and active-border behavior.
- **Arrows** (lines ~250–279): restyle from translucent circles to small white
  squares sitting on the image like the reference — `h-9 w-9 bg-white/90
  text-zinc-900 hover:bg-white` (no rounded-full), keep positions/handlers.
- **Expand affordance + lightbox** (desktop only):
  - Expand icon button (`⤢` SVG, white square like the arrows) at the hero's
    bottom-right; clicking the hero image itself also opens the lightbox.
  - Lightbox: component-local state; normal-flow `fixed inset-0 z-[60]
    bg-black/90` overlay rendering `shopifyImageUrl(activeSrc, 1400)` with
    `max-h-[92vh] max-w-[90vw] object-contain`; closes on overlay click and
    Escape; lock body scroll while open (`document.body.style.overflow`,
    restored in cleanup). Existing arrow-key handler keeps working inside it.
- Wheel navigation, thumbnail click/scroll-into-view, and the entire mobile
  branch (lines ~284–358) unchanged.

### 3. `app/components/ProductInfoPanel.js` (rewrite of internals, same props + `productUrl`)
New order/styling (sticky wrapper stays):
1. Store label: `storeName` as a `Link` to `buildFreshFeedUrl({ store: storeDomain })`
   (already imported) — `font-mono text-[11px] uppercase tracking-[0.22em]
   underline underline-offset-[6px] decoration-[0.5px] text-zinc-600
   hover:text-zinc-900`.
2. Heading: brand + title combined —
   `{brand ? `${brand} — ${title}` : title}` (keep the existing
   brand-falls-back pattern in mind: when brand is null the store label above
   already carries the store, so heading is just `title`) —
   `mt-5 font-sans text-[20px] font-semibold uppercase tracking-[0.04em] leading-[1.35]`.
3. Price: `mt-4`, `font-mono text-[15px] text-zinc-800` (still `Price` component).
4. Single divider: `border-b border-zinc-200 mt-6 mb-5` — the only hairline
   above the store block.
5. Size: one quiet line `font-mono text-[11px] tracking-[0.14em] uppercase
   text-zinc-600` — keep `<T k="product.size(s)">` label inline: `SIZE M`.
6. CTA: unchanged black button, `mt-7`.
7. Save/share: `<SaveShareRow productUrl={productUrl} title={title}
   className="mt-3 flex gap-6" />` (see #4).
8. Store block: keep current markup but drop its `border-t` (whitespace
   separates): `mt-8`.

### 4. `app/components/SaveShareRow.js` (additive prop)
Add `className` prop defaulting to the current `"mt-5 px-6 flex gap-6"` so the
mobile call sites render byte-identical; desktop passes its own spacing.
No behavior change (v1 visual-only save stays as-is).

### Untouched
`DesktopAboutSection.js`, `MoreFromStore.js`, `ProductBreadcrumb.js`,
`BackToFeedLink.js`, all mobile markup, i18n messages (no new keys).

## Verification

1. `preview_start`, open a product with several images and a long title, e.g.
   `/product/new-arrival-yohji-yamamoto-y-s-thick-cotton-pleated-dress-coat-with-layered-collar?store=lobscur.com`
   (read-path only — safe against prod Supabase; never hit `/api/cron`/`/api/enrich`).
2. `preview_resize` to 1512×860 and screenshot: hero frame flush to viewport
   bottom, photo edge-to-edge (no backdrop bars), arrows + expand icon on the
   image, info column matching the approved hierarchy (one divider only).
3. Interactions: thumbnail click, wheel + arrow keys, prev/next buttons,
   expand icon and image click → lightbox shows full uncropped photo, Escape +
   overlay click close it, body scroll locked while open.
4. Save/Share row toggles and copies link.
5. Scroll down: info column + thumbnails stay sticky; About + MoreFromStore
   render as before.
6. Regression: resize to 390px — mobile layout byte-identical to current
   (gallery swipe, accordions, SaveShareRow spacing unchanged).
7. Sweep 3–4 other stores' products (square cutouts from seyswardrobe.fr, a
   one-image product, a no-image product) for crop sanity and the
   no-image fallback (`lg:h-[70vh]` fallback block in ProductGallery should get
   the same new frame height).
8. After implementation: commit the design spec to
   `docs/superpowers/specs/2026-06-09-desktop-product-page-redesign-design.md`
   per brainstorming workflow, then branch-PR per repo workflow (no direct
   push to main).
