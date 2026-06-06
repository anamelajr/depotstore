# Mobile filter/sort bar — faint black band below the button

## Context

After PR #79 (unify filter/sort + region menu on frosted tone), the user
noticed a very faint black "extension" directly below the mobile FILTERS/SORT
bar — as if the button were slightly taller, with a faint dark strip on its
bottom edge.

## Root cause (diagnosed, evidence-backed)

The faint black band is the bar's own drop shadow:

```
shadow-[0_10px_30px_rgba(0,0,0,0.45)]
```

= offset 0 x / **10px down** / 30px blur / **black at 45%**. Offset downward,
it paints a soft dark band just below the bar's bottom edge — exactly the
described "extension."

**It is necessarily the box-shadow** — nothing else here can paint *below* the
bottom edge:
- `backdrop-blur` (backdrop-filter) is clipped to the element's own box; it
  physically cannot render below the bottom edge.
- The `border` sits *on* the edge and is `zinc-800/40` (grey), not black.
- `box-shadow` is the only property that paints *outside* the border box, and
  it is `rgba(0,0,0,…)` — black, matching the description.

**PR #79 did NOT introduce or change this shadow.** Evidence:
- The shadow string is identical on both the `-` and `+` lines of the PR 79
  diff. The *only* mobile change was dropping `rounded-sm` (square corners).
- `git log -L` on that line: the shadow has been present since the bar was
  first created in commit `9c1da57` on **2026-05-17** — ~3 weeks before PR 79
  (2026-06-05).
- The shadow band across the bar's full width is corner-radius-independent
  (rounding only affects 2–4px at the corners), so removing `rounded-sm` left
  the bottom band pixel-identical.

**Why it's noticed now (hypothesis, not mechanism):** the frosted/square
restyle drew the eye to the bar. The desktop bar is *also* square and carries
an even stronger shadow (`0_8px_28px_rgba(0,0,0,0.6)`) without complaint —
which argues against any "square corners made the shadow conspicuous" theory.

**File:** [app/components/MobileFeedActionBar.js:12](app/components/MobileFeedActionBar.js#L12)

## Fix levers

The only real levers are on the shadow itself (reduce offset-y / alpha / blur,
or remove it). Re-adding `rounded-sm` is a **non-fix** — the band is
corner-independent.

## Chosen fix: remove the shadow

Delete `shadow-[0_10px_30px_rgba(0,0,0,0.45)]` from the bar's className in
[app/components/MobileFeedActionBar.js:12](app/components/MobileFeedActionBar.js#L12).
The bar keeps its frosted translucent tone (`bg-zinc-950/85` + `backdrop-blur`),
square corners, and `border-zinc-800/40` — it simply sits flat on the feed with
no dark band below.

Single-line change:

```diff
- <div className="md:hidden fixed bottom-4 left-4 right-4 z-30 grid grid-cols-2 h-11 bg-zinc-950/85 backdrop-blur shadow-[0_10px_30px_rgba(0,0,0,0.45)] border border-zinc-800/40">
+ <div className="md:hidden fixed bottom-4 left-4 right-4 z-30 grid grid-cols-2 h-11 bg-zinc-950/85 backdrop-blur border border-zinc-800/40">
```

Scope notes:
- **Mobile only.** Desktop (`DesktopFeedBar.js`) keeps its
  `0_8px_28px_rgba(0,0,0,0.6)` shadow — it was not part of the complaint and
  sits in a different layout context.
- Visual-only; no markup, props, logic, or sizing change.

## Verification

1. On a Vercel preview (per repo workflow — not localhost), open `/feed` at a
   mobile width.
2. Confirm the faint black band directly below the FILTERS/SORT bar is gone and
   the bar still reads as a clean frosted bar over the feed.
3. Check at the bar's resting `bottom-4` position over both image and dark-gap
   areas of the product grid (the band was most visible over light product
   imagery).
4. Confirm desktop `/feed` bar is unchanged.
