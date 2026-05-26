# Mobile feed — uniform card baseline (reserve 2 title lines)

## Context

The mobile feed renders `ProductCard`s in a 2-column grid. Each card's text block flows top-down: optional brand chip → title → price/store row. The mobile title uses `line-clamp-2` but no reserved vertical space, so a 1-line title and a 2-line title produce different total heights — and the price/store row beneath them lands at different Y positions across neighboring cards.

The user spotted this on the live feed: in the screenshot, "FW2004 Embellished Velvet Heels" wraps to two lines and pushes its price/store row down, breaking the visual baseline with the single-line card next to it ("SS08 Fairy Leather Heels"). The result reads as inconsistent and visually noisy.

The fix is to reserve the height of two lines on the mobile title regardless of how many lines the title actually fills. Short titles get a small blank second line; long titles still clamp at two. Price/store then sits at the same Y on every card.

Scope is **mobile feed only**. Desktop has the same latent vulnerability but wasn't reported and is out of scope. Editorial cards (`MoreFromStore`, `EditorialProductCard`) share the same flaw and are explicitly deferred per the user's "feed only for now" decision.

## Change

Single file edit: [app/components/ProductCard.js:74](../../../app/components/ProductCard.js#L74).

Add `min-h-[2lh]` to the mobile title's class string so the title element always reserves two line-heights, regardless of content length. `lh` is a CSS unit equal to the element's computed `line-height` — paired with the existing `text-[13px]` + `leading-snug`, this evaluates to exactly two lines of the title's own typography, so future type-scale changes won't drift the reservation.

Concretely, the existing line:

```jsx
<div className={`font-sans text-[13px] leading-snug text-zinc-400 line-clamp-2${brand ? " mt-0.5" : ""}`}>
```

becomes:

```jsx
<div className={`font-sans text-[13px] leading-snug text-zinc-400 line-clamp-2 min-h-[2lh]${brand ? " mt-0.5" : ""}`}>
```

That is the only change. No new components, no markup restructure, no CSS file edits, no Tailwind config changes.

### Why `min-h-[2lh]` (not `h-[2lh]`, not pixel values)

- `min-h` over `h`: `line-clamp-2` already caps the visible content at 2 lines via `-webkit-line-clamp`, so the element will never need to grow past 2 lines. `min-h` gives the same final geometry as `h` while being defensively kinder if line-clamp ever fails to apply (e.g., a future browser quirk) — the element grows instead of overflowing.
- `2lh` over pixel/rem math: stays correct if `text-[13px]` or `leading-snug` is later retuned. Browser support is Baseline as of mid-2023 (Chrome 99+, Safari 16.4+, Firefox 120+), well within the project's existing Tailwind v4 + modern-Next.js floor.

### Known follow-ups not addressed here

- **No-brand cards** still vary vertically: a card without a brand chip starts the title row ~14px higher than a card with a brand chip, so the price/store row will still land at a different Y between a branded and an unbranded card. The user's screenshot shows all cards branded, so this isn't visible today; if it surfaces, the answer is Option C (full-card flex with price pinned to bottom) from brainstorming. Leave for a follow-up.
- **Desktop layout** has the same `line-clamp-2`-without-`min-h` issue at the title. Out of scope per user's mobile-focused report.
- **Editorial cards** (`MoreFromStore`, `EditorialProductCard`) carry the same flaw. Out of scope per "feed only for now."

## Critical files

- [app/components/ProductCard.js:74](../../../app/components/ProductCard.js#L74) — the only line that changes.

## Verification

Run the dev server via the `run` skill (or `preview_start`), then load `/feed` at a mobile viewport.

1. **Set viewport to ~390px** (`preview_resize` to iPhone-class width) so the `md:hidden` mobile block is active.
2. **Find a pair of adjacent cards where one title fits on one line and its row-neighbor wraps to two.** The Prada heels pair from the user's screenshot ("SS08 Fairy Leather Heels" vs "FW2004 Embellished Velvet Heels") is the canonical test case — and is real production data, so it should reappear naturally on the feed.
3. **Take a `preview_screenshot`** and visually confirm the two cards' price rows sit at the same Y. Before the fix, the longer-title card's price is one line lower; after, both should align.
4. **Check a card with a 1-line title in isolation** (e.g. scroll to find one) and confirm the gap between the title and the price row is visibly larger than before by ~one line-height — that blank space is the reservation working as intended, not a bug.
5. **`preview_console_logs`** to confirm no Tailwind/CSS warnings from the `min-h-[2lh]` arbitrary value (Tailwind v4 should accept it silently; any warning would suggest the unit isn't being recognized and we'd fall back to `min-h-[calc(2*0.8125rem*1.375)]`).
6. **Skim the homepage and a product-detail page** (both render `ProductCard` per Explore findings) at mobile width to confirm no regression — same min-height applies and no clipping appears.

No automated tests touch `ProductCard`'s visual layout, so verification is screenshot-based.
