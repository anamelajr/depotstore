# Desktop feed grid — near-full-width YSL-style layout

## Context

The desktop product feed currently sits in a centered `max-w-7xl` (1280px) container with 40px gaps, so on typical desktop screens the product images feel small and the page has wide dead margins. The user wants the feed to fill the screen the way YSL's collection grid does — much larger tiles, cleaner presentation.

Decisions made during brainstorming (with live HTML mockups of three directions):
- **Direction B — near-full width**: grid spans the viewport minus small side margins (24px), *not* true edge-to-edge (their mixed seller photography benefits from a white frame; YSL's edge-to-edge works because of uniform studio packshots).
- **3 columns always** on desktop (no 4-col step on wide monitors) — the YSL look.
- **Column gap 14px, row gap 64px** — tight horizontal gaps, generous vertical white band between rows.
- **Feed only** — homepage "Today's Edit" grid stays as-is.
- **Card text layout unchanged** — keep the brand/title left, price/store right split.
- **Mobile unchanged** — 2-col `gap-10` look stays identical (removing the 1280px cap has no effect below 1280px).

## Changes

All changes are Tailwind class edits in two files; no logic changes.

### 1. `app/feed/FeedClient.js`

- **`<main>` container (line ~346)**: currently
  `mx-auto max-w-7xl px-4 pb-32 md:pb-32 pt-3 md:pt-8`
  → remove `mx-auto max-w-7xl`, make desktop side padding 24px:
  `px-4 md:px-6 pb-32 md:pb-32 pt-3 md:pt-8`
- **Grid (line ~387)**: currently
  `grid grid-cols-2 gap-10 lg:grid-cols-3`
  → keep mobile identical, add desktop gap overrides:
  `grid grid-cols-2 gap-10 lg:grid-cols-3 lg:gap-x-3.5 lg:gap-y-16`
  (`gap-x-3.5` = 14px, `gap-y-16` = 64px)

### 2. Responsive image delivery (Codex adversarial-review finding)

`HoverSwapImage` requests a fixed `width=800` Shopify derivative, sized for the
old ~400px card at 2× DPR. The new grid makes cards ~455px at 1440px and ~830px
on a 27″ monitor, so retina displays would upscale (blur) the 800px image —
defeating the redesign. Fix additively, opt-in, so no other consumer changes:

- **`app/components/HoverSwapImage.js`**: accept an optional `sizes` prop. When
  set **and** the URL is a canonical `cdn.shopify.com` URL, render
  `srcSet={[800, 1200, 1600].map(w => shopifyImageUrl(url, w) + " " + w + "w")}`
  plus the `sizes` attribute (both imgs). When absent (default), behavior is
  byte-identical to today.
- **`app/components/ProductCard.js`**: accept optional `imageSizes` prop,
  thread it to `HoverSwapImage` as `sizes`.
- **`app/feed/FeedClient.js`**: pass
  `imageSizes="(min-width: 1024px) 33vw, 50vw"` to feed `ProductCard`s.
- Homepage / MoreFromStore / other consumers pass nothing → unchanged.

### 3. `app/feed/page.js`

- **Loading fallback (line ~19)** mirrors the main container
  (`mx-auto max-w-7xl px-4 pb-24 pt-3 md:pb-32 md:pt-8`) — update it with the
  same container change so the skeleton doesn't jump on hydrate:
  `px-4 md:px-6 pb-24 pt-3 md:pb-32 md:pt-8`

### Explicitly untouched

- `overflow-x-clip` on the feed wrapper (FeedClient.js:320) — required for sticky nav (CLAUDE.md invariant).
- Fixed bottom filter/sort bar (`DesktopFeedBar`, `DesktopSortMenu`) — position-fixed, independent of grid width.
- Card markup, 4:5 aspect, typography all stay (only the additive `sizes`/`imageSizes` props above touch `ProductCard.js` / `HoverSwapImage.js`).
- Homepage grid (`app/page.js:111`).
- Desktop active-filter chips row (FeedClient.js:354) — lives inside `<main>`, inherits the new width naturally.

## Verification

1. `npm run dev` (via the launch.json/preview flow) and open `/feed` in the browser pane at desktop width (1280–1440px):
   - grid spans viewport minus 24px each side, 3 columns, 14px column gaps, 64px row gaps;
   - scroll — sticky desktop nav and fixed bottom FILTERS/SORT bar behave as before;
   - no horizontal scrollbar.
2. Resize to mobile (375px): feed identical to today (2 cols, `gap-10`, 16px side padding).
3. Check tablet `md` (768–1024): 2 columns with 24px side padding — acceptable intermediate state.
4. Confirm the loading skeleton (`app/feed/page.js`) matches the loaded layout (no width jump).
5. Homepage unchanged — including its image requests (still plain `width=800` src, no srcset).
6. In the network panel, feed card images carry `srcset` with 800/1200/1600 derivatives and the browser picks ≥1200 on a 2× display at desktop width.

Read-path UI only — safe against prod Supabase; do not touch `/api/cron` / `/api/enrich`.
