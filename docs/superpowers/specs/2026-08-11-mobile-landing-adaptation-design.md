# Mobile landing page adaptation

## Context

PR #106 revamped the **desktop** landing page (hero, search/browse band, Featured Archives band) but deliberately shipped only a minimal mobile fallback — the spec scoped a tailored mobile pass as a later phase. That phase is now. The goal: adapt the new layout to mobile while keeping the visual hierarchy and feel of the desktop design. The user's reference image is directional only; decisions below were confirmed one-by-one with mockups.

**Approved design decisions:**
1. **Hero** — refined stack (copy above, photo below). No overlay, no side-by-side, no garment caption, no carousel.
2. **Search + Browse-by band** — search full-width; below it, `DESIGNER | YEAR | CATEGORY` on **one row** with thin vertical hairline dividers (desktop band compressed). No boxes. **The "BROWSE BY" label is dropped on mobile** (desktop unchanged): measured with the real General Sans face, label + items cannot fit one line at 375px in either language (EN 344px / FR 386px vs 327px available — Codex adversarial-review finding, confirmed), while items alone fit both languages even at 320px (FR 265px vs 272px available).
3. **Featured Archives** — header row (`FEATURED` label left, `VIEW ALL` right), then a **horizontal swipe row** of the five entries with vertical hairline dividers between them only — no horizontal rules around the row. Scroll hint is "peek only" (next entry cut off at screen edge); no progress bars, hidden scrollbar. Entries stay inert (no archives routes yet). Section-level `border-b` stays (matches desktop's band edge).
4. **Curated Selection ("Today's Curation")** — on mobile, the 8 products become a **single horizontal swipe row** (page too long as a 4-row grid); desktop grid unchanged.
5. **Light polish** on lower sections: mobile-appropriate section-heading size and vertical rhythm for Curated Selection and Across Paris. Map itself untouched.

**Invariants to preserve** (CLAUDE.md + PR #106 spec): mobile nav untouched (`h-[50px]`); `md` (768px) stays the mobile/desktop split except FeaturedArchives' deliberate `lg`; `overflow-x-clip` (never `overflow-x-hidden`); desktop rendering byte-identical at ≥768px (≥1024px for FeaturedArchives); all strings via existing i18n keys — **no new keys needed**; en/fr parity test untouched.

## Files to modify

All changes are Tailwind-class/JSX-structure only — no data flow, no API, no DB.

### 1. `app/components/home/tokens.js`
- `SECTION_LABEL`: `text-[18px]` → `text-[15px] md:text-[18px]` (single source keeps both Curated Selection and Across Paris headings in sync).
- Other tokens unchanged.

### 2. `app/components/home/Hero.js` (mobile-only polish)
- Copy block: `py-16` → `py-12 md:py-24` (tighter mobile rhythm).
- Description `<p>`: `max-w-[260px]` → `max-w-[320px] md:max-w-[260px]` (wider line on mobile; desktop untouched).
- Image wrapper: `min-h-[320px]` → `min-h-[360px]` at mobile only if it verifies well visually — judgment call during browser check; otherwise leave.
- Headline clamp, fonts, CTA unchanged.

### 3. `app/components/home/SearchBrowseRow.js`
- Band container: `py-8 gap-6` → `py-6 gap-5` on mobile (`md:` values unchanged).
- "BROWSE BY" `<span>` and its trailing divider: `hidden md:flex` / stay desktop-only. The three items and their two separating dividers show on both breakpoints.
- Browse row: dividers between items visible on mobile (drop `hidden md:` from those `w-px` spans), `flex-wrap … gap-x-7` → `flex-nowrap gap-x-2.5 md:gap-x-7`.
- Measured budget (real font, canvas): items row EN 250px / FR 257–265px vs 272px available at 320px and 327px at 375px — fits one line in both languages with margin; verify `scrollWidth <= clientWidth` in EN and FR during browser check.

### 4. `app/components/home/FeaturedArchives.js` (structural — dual blocks, ProductCard convention)
Desktop block (`hidden lg:flex …`) keeps today's markup exactly. New mobile block (`lg:hidden`):
- Header row: `flex items-baseline justify-between` with `BAND_LABEL` label (`<T k="home.featured" />`) and the inert `UTILITY_CAPS` `VIEW ALL` span.
- Swipe row: full-bleed scroll container `-mx-6 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`, inner `flex w-max`; each entry `shrink-0 px-5 py-4 text-center` with `border-l` + `HAIRLINE` on all but the first (same name/years type as desktop: `font-mono text-[10px] … tracking-[0.15em]` / `text-[9px] tracking-[0.06em] text-zinc-500`). No top/bottom rules on the row.
- Keep `ENTRIES` as the single data source shared by both blocks; entries remain `cursor-default` inert.
- Section keeps `border-b`; container padding on mobile ~`py-7`.
- Note: horizontal scroll container inside the page's `overflow-x-clip` wrapper is fine (scrolling is internal to the container).

### 5. `app/page.js` (Curated Selection + Across Paris)
- Curated Selection product list — single DOM, responsive container (avoids double-rendering 8 ProductCards/images):
  - Container: `grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4` → `-mx-6 flex gap-4 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:grid md:grid-cols-3 md:gap-6 md:overflow-visible md:px-0 lg:grid-cols-4`.
  - Each `ProductCard` wrapped in `<div className="w-[45vw] max-w-[220px] shrink-0 md:w-auto md:max-w-none">` so mobile shows ~2 cards + a peek.
  - ProductCard itself is untouched (its internal `md:hidden`/`hidden md:flex` blocks already handle both breakpoints).
- Section rhythm: both sections `py-16` → `py-10 md:py-16`; heading margins `mb-10` → `mb-6 md:mb-10`.
- Data loading and ParisMap untouched.

## Reused utilities / patterns
- `ProductCard` dual-block convention (`app/components/ProductCard.js:74,96`) for FeaturedArchives' diverging mobile DOM.
- All colors/type from `app/components/home/tokens.js` — no new constants.
- Existing i18n keys only (`home.featured`, `home.viewAll`, `home.browseBy`, etc.).

## Verification
1. `npm run dev` via preview (`preview_start`), open `/`.
2. `resize_window` to mobile (375×812): screenshot each band. Check — hero stack rhythm; browse row fits on one line with dividers, no page horizontal scroll; Featured Archives swipe row peeks and scrolls, no scrollbar, no top/bottom rules; Curated row swipes with ~2.2 cards visible; section headings at 15px; tightened paddings.
3. Also check 320px width for overflow (page must not scroll horizontally).
4. `resize_window` desktop (1280×800): confirm desktop is visually unchanged (hero, 90px bands, 4-col grid).
5. Toggle language to FR (`CRÉATEUR | ANNÉE | CATÉGORIE`) and confirm the browse row's `scrollWidth <= clientWidth` at 375px and 320px (pre-measured to fit, but confirm on the rendered row).
6. `npm test` (i18n parity test) — should pass untouched.
7. Read browser console for errors.

Read-path UI only — safe against prod Supabase; never trigger `/api/cron` or `/api/enrich`.

## Out of scope
- Archives routes / making Featured entries or VIEW ALL tappable (later phase).
- Hero carousel, captions, image swap.
- Mobile nav, feed pages, ParisMap internals.
