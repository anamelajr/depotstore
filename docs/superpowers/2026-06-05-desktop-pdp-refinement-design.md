# Desktop Product Page — Visual Refinement

## Context
The desktop product detail page (`/product/[handle]`) reads as empty. Causes, confirmed
against the code and the live catalog (7,286 visible products):

- The hero image is sized to ~full viewport height (`calc(100vh − nav − 4rem)` ≈ 85–88vh)
  while the right info column's content ends after ~250px — leaving a tall white band
  beside the lower image. **This is the dominant cause.**
- There is **no related-products section on desktop** — `MoreFromStore` renders only inside
  the mobile-only block.
- The info column carries a redundant green "Available" dot/line.

We brainstormed with live browser mockups (visual companion) using the real "Rouge Crush
Two Piece" piece. The user picked a minimal, proportion-led direction. The reference site
(Lost Files NYC) looks "full" only because of Shopify checkout machinery (cart, quantity,
Buy-with-Shop, stock count, pickup) and condition metadata — none of which apply to Dépôt
(external-redirect aggregator) or exist in its data. So fullness comes from **rebalanced
proportions + below-the-fold browsing, using only existing data.** No DB changes.

## Decisions (locked with the user)
1. **Cap the hero image height** (~70vh) so the photo sits beside the info column instead of
   towering over it. Image stays `object-contain` on clean white — **no backdrop**.
2. **Remove the availability indicator entirely** on desktop (green dot + "Available"/"Sold").
   Sold pieces are signalled only by the CTA reading "VIEW ON {store}" vs "BUY AT {store}"
   (existing behavior).
3. **Add a store-info line** to the info column: `store name · location`, with a
   "Browse store →" link.
4. **Bring "More From Store" to desktop** as a 4-across grid below the image (currently
   mobile-only, 2-across).
5. **No category/details block. No Save/Share.** Keep the column minimal.
6. **About section stays — and renders on ~every desktop PDP.** `resolveProductDetail`
   generates a description at request time via `generateDescription` (`name: product.title`,
   always present) and caches it back to `editorial_description`, so `DesktopAboutSection` is
   effectively always present — not the rare empty case first assumed (the DB column is ~1%
   filled, but the section is populated live). No change to About itself. **Deliberate
   below-hero order, confirmed with the user after an adversarial review: grid → About →
   MoreFromStore** (conventional PDP flow; description by the piece, browsing at the bottom).

## Changes

### 1. Cap hero height — `app/components/ProductGallery.js`
Three desktop height tokens currently read `lg:h-[calc(100vh-var(--nav-height)-4rem)]`:
- thumbnail column (~line 214)
- desktop hero container (~line 242)
- no-image placeholder (~line 190)

Replace all three with a capped height — start at `lg:h-[70vh]` (optionally add
`lg:max-h-[800px]`). **All three must use the same value** so the sticky thumbnail rail stays
aligned with the hero. Fine-tune on the Vercel preview, being ready to drop to **~55–60vh**.

> Note: capping *reduces* the empty band beside the lower image but cannot erase it given a
> deliberately-minimal info column — at ~850px viewport, 70vh ≈ 595px image vs a ~300px
> column. That residual whitespace is intentional; **`MoreFromStore` below the fold + the
> clean white are what carry the "not empty" feeling.** Tune the cap so the band reads as
> deliberate, not broken — don't chase erasing it by shrinking the photo.

### 2. Info column — `app/components/ProductInfoPanel.js`
- **Delete the availability block** (the `mt-3 flex items-center gap-2 …` dot + label,
  ~lines 69–79). **Keep the `available` prop** — it still drives `ctaText` (BUY vs VIEW).
- **Add a store-info section** after the CTA: a hairline-divided block (`mt-… pt-… border-t
  border-zinc-200`) with `{storeName}` + `{storeLocation}` on one line, and a "Browse store →"
  link to the store feed. Mirror the mobile store-profile styling in
  `app/product/[handle]/page.js` (~lines 103–117). Href: `buildFreshFeedUrl({ store: storeDomain })`
  — **verified**: `feed-utils.js:28` sets any key as a query param → `/feed?store=…`. Render
  `location` only when present (defensive), though it's populated for **all 11 active stores**.
- **Add `storeLocation` to the component's props**, and **add two imports** (the file
  currently imports only `Price`): `Link` from `next/link` and `buildFreshFeedUrl` from
  `../lib/feed-utils.js`.

### 3. Page wiring — `app/product/[handle]/page.js`
- Pass `storeLocation={storeLocation}` to `<ProductInfoPanel>` (already destructured from
  `detail` at line 23).
- **Move `<MoreFromStore>` (remove + add, not duplicate):** delete the instance currently
  inside the `order-2 lg:hidden` mobile block (~lines 122–126) **and** add a single sibling
  instance **after `<DesktopAboutSection>`** (deliberate order — see Decision 6). Leaving both
  renders it twice on mobile (double Supabase fetch) — the classic failure here. One instance
  now serves both breakpoints. Keep
  props (`storeDomain`, `currentHandle`, `storeName`). On mobile it lands in the same visual
  position as today (after the mobile info block; `DesktopAboutSection` is `hidden lg:grid`).

### 4. Responsive grid — `app/components/MoreFromStore.js`
- Make the section full-width at both breakpoints: `px-6 lg:px-0` (the page wrapper already
  adds `lg:px-10`), `grid-cols-2 lg:grid-cols-4`, `gap-5 lg:gap-6`. Keep the 4-item limit
  (fills one desktop row / two mobile rows). **No query change** — keeps the direct Supabase
  fetch via `PRODUCT_ROW_SELECT` + `withVisibility` + `mapProductRow`.

## Invariants respected
- Presentational only — **no product-read query changes**; `MoreFromStore` keeps its direct
  Supabase fetch (no HTTP consolidation) per CLAUDE.md.
- `storeLocation` is already fetched in `resolveProductDetail` (`storeRow.location`, line 212);
  no new data, columns, or RPCs.
- Nav-height token unchanged.

## Verification
Branch + Vercel preview (do **not** push to main; verify on Vercel, per CLAUDE.md). This is a
visual change — **render it and look with your own eyes (screenshot); a green build is not
evidence the proportions read right.** The bar is the user's goal: *does the page read as
intentional, not empty/broken?* — not merely "image is shorter."

- **Desktop, multi-image:** `/product/comme-des-garcons-rouge-crush-two-piece?store=www.dotcomme.net`
  — screenshot and confirm: capped image sits beside (not towering over) the info column and
  the residual whitespace reads as deliberate; thumbnail rail aligns with the hero; info
  column shows brand / title / price / (size if present) / BUY / store line; **no green dot**;
  "More from dot COMME" renders as a 4-up grid below. Tune the cap (~55–70vh) until the
  balance looks right.
- **Below-hero order (desktop):** "About this piece" appears first, then "More from {store}"
  — assert this ordering on a product that has a description (i.e. ~all of them).
- **Sold product:** CTA reads "VIEW ON {store}"; no availability text anywhere.
- **Single-image and no-image products:** layout holds at the capped height.
- **Mobile:** unchanged, except `MoreFromStore` still appears once at the end (not twice);
  2-up grid intact.
- **Sparse store** (store with only this item): `MoreFromStore` returns null — no empty section.

## Cleanup
The brainstorm visual-companion server (port 53022) auto-exits after 30 min idle; the mockup
files live in the gitignored `.superpowers/brainstorm/` and can be left or removed.
