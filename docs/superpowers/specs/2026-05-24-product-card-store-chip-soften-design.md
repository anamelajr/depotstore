# Soften the store-name chip on product cards

## Context

The product-card grid currently shows each store as a small uppercase
mono label with a thin border (e.g. `SEYS WARDROBE`). Compared with
minimalist references like Gucci, the outlined chip reads as a tag/badge
and adds visual noise when many cards are visible at once. We want the
store attribution to recede a bit — still legible, but quiet enough that
the eye lands on the product image, brand, and price first.

There is already a borderless, smaller mono caption used elsewhere in
the codebase (`PiecesFeatured` editorial component) — adopting the same
style on the product card harmonizes an existing pattern rather than
introducing a new one.

## Decision

Apply the **Option B** treatment from brainstorming: drop the border
and padding, drop the chip-style affordances, and shrink the text +
tracking to match the existing editorial caption pattern.

## Change

One file: [app/components/ProductCard.js](app/components/ProductCard.js)

Two identical replacements — the store-name `<span>` appears once for
mobile ([line 82](app/components/ProductCard.js:82)) and once for
desktop ([line 106](app/components/ProductCard.js:106)).

**Before:**

```jsx
<span className="inline-flex items-center rounded border border-zinc-800/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-500 whitespace-nowrap">
  {badgeName}
</span>
```

**After (matches the existing `PiecesFeatured` caption exactly):**

```jsx
<span className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500 whitespace-nowrap">
  {badgeName}
</span>
```

What's removed: `inline-flex items-center rounded border
border-zinc-800/70 px-2 py-0.5`. What changes: `text-[10px]` →
`text-[9px]`, `tracking-widest` → `tracking-[0.12em]`. What stays:
mono font, uppercase, `text-zinc-500`, `whitespace-nowrap`.

## What stays the same

- **Layout / positioning unchanged.** The chip still sits in the
  bottom-right of the card. On mobile (`flex items-baseline
  justify-between`) the price and caption align cleanly on their text
  baselines — removing the border actually improves baseline alignment
  versus a bordered chip whose visual baseline is offset by padding.
  On desktop the right column's `justify-between` keeps the price at
  top and the caption at bottom of the column height defined by the
  brand+title block on the left. No structural change needed.
- **All other chip-style components are untouched.**
  `app/components/feed/FilterChip.js` is a different component with its
  own `bg-zinc-900 border border-zinc-800` styling for filter pills —
  not affected.
- **`badgeName` short-name mapping** (`Les Archives Paris` →
  `Les Archives`, etc.) is preserved.
- **No new shared utility, no Tailwind config change.** The class
  string is copied verbatim from the existing `PiecesFeatured`
  caption, so there is a precedent in the codebase to point at if
  consistency questions come up later.

## Verification

The change has no behavioral surface — only typography — so verification
is purely visual.

1. **Local dev server** — run `npm run dev` and load `/feed`.
   Confirm: cards show the store name as a quiet uppercase caption with
   no border or padding, sitting opposite the price on each card.
2. **Mobile + desktop breakpoints** — resize the browser past the `md`
   breakpoint (768px). Both layouts should look the same: no chip
   outline, baseline-aligned with the price, no layout shift.
3. **Spot-check long store names** — load `/feed?store=seys-wardrobe`
   (and any other store with a longer name like `Les Archives`) to
   confirm `whitespace-nowrap` still prevents wrapping. Card height
   should not change.
4. **Editorial PiecesFeatured consistency** — open an editorial entry
   that uses `PiecesFeatured` and confirm the product-card caption now
   matches the editorial caption visually.
5. **Deploy to Vercel preview** (per CLAUDE.md: verify on Vercel, not
   localhost) and review on a real device before merging to main.

No tests, no schema changes, no DB work. Single-file CSS-class swap.
