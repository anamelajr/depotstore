# Filter/Sort + Region menu visual refresh

## Context

The filter/sort controls don't look the same across breakpoints, and the
language/region menu is tied to the older desktop look:

- **Mobile** filter/sort bar already uses a frosted translucent-black tone
  (`bg-zinc-950/85` + `backdrop-blur` + faint `border-zinc-800/40`), but it
  has small **rounded** corners the user wants squared off.
- **Desktop** filter/sort bar uses a flat **solid** tone
  (`bg-zinc-900` + solid `border-zinc-800`) — different from mobile. The user
  wants it to adopt mobile's frosted transparency/colour.
- The **language/region toggle menu** was built to match the *old* solid
  desktop look. To stay consistent it should be refreshed to the same frosted
  tone as the new desktop bar.

This is a **visual-only** change — purely Tailwind class swaps. No behaviour,
markup structure, props, or logic changes. Layout, sizing, fonts, text colours,
hover states, and shadows all stay exactly as they are.

The shared "frosted" tone (taken verbatim from the existing mobile bar):
`bg-zinc-950/85 backdrop-blur border-zinc-800/40`.

## Changes

### 1. Mobile bar — square corners only
[`app/components/MobileFeedActionBar.js`](../../../app/components/MobileFeedActionBar.js) line 9 —
remove `rounded-sm` from the container `className` (square corners). Everything
else (transparency, blur, border, shadow) is already correct and stays.

### 2. Desktop filter/sort bar — adopt the frosted tone
[`app/components/feed/DesktopFeedBar.js`](../../../app/components/feed/DesktopFeedBar.js)
- Line 10 container: `bg-zinc-900 border border-zinc-800` →
  `bg-zinc-950/85 backdrop-blur border border-zinc-800/40`
  (keep `flex w-[360px] h-12 … shadow-[0_8px_28px_rgba(0,0,0,0.6)]`).
- Line 22 inner divider between the Filters/Sort buttons:
  `border-l border-zinc-800` → `border-l border-zinc-800/40` (so the divider
  matches the softened border — mobile already uses `/40` for its divider).
- Corners are already square here; no radius change needed.

### 3. Desktop Sort dropdown — adopt the frosted tone (confirmed in scope)
[`app/components/feed/DesktopSortMenu.js`](../../../app/components/feed/DesktopSortMenu.js)
line 43 container: `bg-zinc-900 border border-zinc-800` →
`bg-zinc-950/85 backdrop-blur border border-zinc-800/40` (keep the rest of the
class string). Keeps the Sort popover consistent with the bar it drops out of.

### 4. Language/region menu — adopt the frosted tone
[`app/components/nav/RegionPanel.js`](../../../app/components/nav/RegionPanel.js)
- Line 19 container: `bg-zinc-900 border border-zinc-800` →
  `bg-zinc-950/85 backdrop-blur border border-zinc-800/40`.
- Line 67 footer divider: `border-t border-zinc-800` →
  `border-t border-zinc-800/40` (matches the softened border).

The existing comment on line 6 ("matching DesktopSortMenu") stays accurate
since both panels change together.

## Explicitly out of scope

- Mobile filter/sort full-screen sheets (`MobileFilterPanel` etc.) — the user
  asked only for the small action bar's corners on mobile.
- Shadows, text colours, hover/active states, fonts, widths, positions — all
  unchanged.

## Verification

Visual change → verify in the browser preview.

1. `preview_start` (or use the Vercel preview deploy per project workflow).
2. **Desktop view**: load the feed. Confirm the bottom filter/sort bar is now
   translucent/blurred (matches mobile), corners square. Click **Sort** →
   confirm the dropdown is frosted too. Open the **language/region** selector in
   the nav → confirm that menu is frosted. `preview_screenshot` for proof.
3. **Mobile view** (`preview_resize` to ~390px wide): confirm the bottom
   filter/sort bar now has **square** corners and retains its translucent black
   look. `preview_screenshot` for proof.
4. Sanity-check there are no `bg-zinc-900` remnants left on these four
   containers.
