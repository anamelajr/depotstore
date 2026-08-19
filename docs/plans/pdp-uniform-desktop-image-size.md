# Fix: uniform product-page image size on desktop (post-PR #120 regression)

## Context

PR #120 (perf work) changed slide 1 of the PDP galleries from a bare `src` at
`width=1600` to a responsive `srcSet` ladder + `sizes="(min-width:1024px) 40vw, 100vw"`
(helpers in `app/lib/shopifyImage.js`). That was correct for performance, but it
exposed a latent layout bug: the desktop gallery image has **no definite box** —
[DesktopProductGallery.js:151](app/components/DesktopProductGallery.js) styles it
`max-h-[86%] max-w-[72%] object-contain`, which are only *maxima*. The rendered
size is therefore the image's **intrinsic** size, clamped.

Before the PR every product fetched a 1600px image, whose intrinsic size always
exceeded the caps, so every product rendered at exactly 86% of the section
height → uniform. After the PR the browser picks smaller srcSet candidates
(density-corrected intrinsic size), and Shopify's CDN never upscales small
originals — so intrinsic size now varies per product and per viewport/DPR, and
products render at visibly different sizes (user's screenshots: Dolce Vita Hub
blazer small, At Dawn Paris knit large).

Decision (user-confirmed): **fix forward**, keep all of PR #120's perf wins
(srcSet contract, preload dedup, mobile ~4× smaller LCP image). The fix makes
the rendered size **layout-driven, not intrinsic-driven**.

Mobile is NOT affected: `ProductGallery.js` slides already have a fixed
`aspect-[3/4]` box with `h-full w-full object-cover`.

## The change

All in `app/components/DesktopProductGallery.js`. Do **not** touch
`PDP_SLIDE1_SIZES`, the ladder, `pdpSlide1Src/SrcSet`, or the preload in
`app/product/[handle]/page.js` — the four-place sizes/srcSet dedup contract
stays byte-identical.

1. **Slide image (line ~151)** — make height definite:
   - `className="max-h-[86%] max-w-[72%] object-contain"`
     → `className="h-[86%] max-w-[72%] object-contain"`
   - With a definite height, width follows the aspect ratio (pre-PR behavior:
     uniform 86%-height, width varies only with photo aspect). If the 72%
     width cap bites (very wide photo), `object-contain` letterboxes inside the
     img box, still centered by the flex parent — visually identical to before.
   - Small originals now browser-upscale to the frame instead of rendering
     tiny. That is exactly the pre-PR visual (they were upscaled-by-request at
     the CDN then… actually they hit the caps; either way: uniform frame).

2. **Zoom overlay image (line ~368)** — same fix for consistency:
   - `max-h-[88vh] max-w-[86%] object-contain` → `h-[88vh] max-w-[86%] object-contain`
   - Guards against the same small-original shrink (it uses bare `width=2048`,
     which never upscales either).

3. **Update the load-bearing comment** above the slide img (lines ~132–142):
   add one line noting the img's height is definite so rendered size is
   layout-owned — srcSet candidate choice and original-photo resolution must
   never affect layout.

4. **Thumbnail rail (line ~343)**: unchanged — its `w-16`/intrinsic-height
   behavior predates PR #120 and is not part of this regression.

## Doc touch-ups (small, same PR)

- `app/lib/shopifyImage.js` lines ~44–46: the "40vw is the honest measure"
  comment says `max-h-86vh`; correct it to the definite `h-[86%]` of
  `100vh − nav` and note the box is layout-owned.
- `docs/plans/pdp-click-speed-and-route-wins.md`: append a short "follow-up"
  note (regression found: intrinsic-sized desktop slide; fixed by definite
  height). Do not rewrite the plan body.

## What NOT to do

- Do not change `sizes`/`srcSet`/preload anywhere — changing any one of the
  four places (both galleries, preload, hover warm) without the others
  reinstates the double download (contract comments in both galleries).
- Do not add an `aspect-[3/4]` crop box on desktop — desktop deliberately
  shows the full photo (`object-contain`, YSL-style); mobile crops, desktop
  doesn't.
- Do not revert PR #120 or the slide-1 contract.

## Verification

1. `npm run build` (or `npm run lint` + existing tests) — no gallery tests
   exist, so this is a compile/lint check.
2. Run dev server (worktree needs `.env.local` copied from the main checkout —
   known gotcha) and open the two products from the user's screenshots
   (Dolce Vita Hub D&G blazer, At Dawn Paris Y's knit) at desktop width:
   both slide-1 images must render at the same height (86% of viewport−nav).
3. DevTools Network check: exactly **one** fetch of the slide-1 image per PDP
   load (dedup contract intact), and the chosen candidate unchanged from
   before this fix.
4. Check a third product from another store + the zoom overlay + narrow
   desktop window (~1024px) for the width-cap/letterbox path.
5. Push branch, verify on the Vercel preview (per CLAUDE.md workflow: no
   direct push to main; merge only on explicit user instruction).
