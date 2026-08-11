# Mobile landing: blend hero image into page background

## Context

On mobile, the landing page's warehouse hero image has hard edges — its top butts
against the greige copy block (`#eceae4`) and its bottom against the `#faf9f7`
search row across a 1px hairline. The user finds this amateurish and wants it to
match their reference screenshot: one continuous cream background where the image
dissolves softly at top and bottom, no divider. **User decision:** fully seamless
on mobile; desktop untouched; must be trivially reversible.

## Approach (chosen)

Use a **CSS `mask-image` linear-gradient on the image wrapper, mobile-only**,
plus background unification. A mask lets the real page background show through
the faded regions (no color-matched overlay divs to keep in sync — the rejected
alternative). All changes scoped below `md:`; desktop keeps its current look,
including its existing left-edge fade.

## Changes

### 1. `app/components/home/Hero.js`

- **Section background** (currently `style={{ backgroundColor: HERO_GROUND }}`):
  make it GROUND on mobile, HERO_GROUND on desktop. Inline styles can't be
  responsive, so switch to literal Tailwind arbitrary classes
  `bg-[#faf9f7] md:bg-[#eceae4]` with a comment noting they mirror
  `GROUND`/`HERO_GROUND` in `tokens.js` (dynamic `bg-[${GROUND}]` won't compile
  under Tailwind JIT).
- **Image wrapper** (`relative min-h-[320px] md:min-h-full`): add a mobile-only
  vertical mask via arbitrary properties, reset at `md:`. Starting point:
  `[mask-image:linear-gradient(to_bottom,transparent,black_22%,black_78%,transparent)] md:[mask-image:none]`.
  Exact stops are tuned during visual iteration against the reference.
  **Mask declarations and their `md:` resets are always added as matched
  pairs, prefixed and unprefixed alike:** if a hand-written
  `[-webkit-mask-image:…]` twin turns out to be needed for Safari, it ships
  with its own `md:[-webkit-mask-image:none]` reset in the same edit — a
  prefixed declaration without its prefixed reset would leave the mobile fade
  active on desktop Safari, violating the desktop-untouched invariant. (Only
  the unprefixed property degrades gracefully on old Safari: no mask, hard
  edges, no desktop leak. Tailwind v4's Lightning CSS pipeline prefixes the
  declaration and reset uniformly; the risk is exclusively hand-written
  pairs.) Verify desktop in Safari as well as Chromium.
- Desktop-only left-fade overlay div: untouched.

### 2. `app/components/home/SearchBrowseRow.js`

- Hairline: `border-t` → `md:border-t` so the divider disappears on mobile only
  (keep `borderColor` style; it's inert without the border class).

Nothing else changes. No new components, no image edits — revert is deleting
these classes (or one `git revert`).

## Verification (visual iteration — user asked for surgical precision)

1. `preview_start` the dev server (create `.claude/launch.json` entry `dev` →
   `npm run dev` if absent). **Never hit `/api/cron` or `/api/enrich`.**
2. `resize_window` to mobile preset (375×812), load `/`.
3. Screenshot; compare against the user's reference. Mobile order top→bottom is
   copy block → image → search/browse row, so: the image emerges softly below
   the copy block (the gradient's **top** stops control this edge) and
   dissolves into the cream above the search/browse row (the **bottom** stops
   control this edge) — no visible seam, no divider line, uniform background
   tone throughout.
4. Iterate on gradient stops / fade heights until the blend matches on a fine
   level; re-screenshot each round.
5. Resize to desktop (1280×800) and screenshot to confirm zero visual change:
   greige hero ground, hairline present, left-edge fade intact.
6. Share final mobile + desktop screenshots as proof.
