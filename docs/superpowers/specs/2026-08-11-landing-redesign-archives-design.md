# Landing Page Redesign (archives as visual placeholders)

> **For implementers without session context:** this spec is self-contained. All visual
> authority lives in [assets/2026-08-11-landing-redesign/](assets/2026-08-11-landing-redesign/)
> (see "Design references" below) plus the measurable description in §Visual language.
> Read the project CLAUDE.md before touching anything — it carries hard invariants
> (visibility filters, i18n parity, overflow rules, nav-height coupling, prod-DB safety).

## Context

Redesign the homepage ([app/page.js](../../../app/page.js)) to match the user's reference layout: generous spacing, hairline section dividers, small tracked-out uppercase labels. The page gains a **Featured Archives strip — visual placeholders only for now**: five designer-era entries that do not link anywhere; the real archives system (era parsing, DB columns, `/archives` routes — designed during brainstorming and confirmed feasible against production data) is explicitly deferred to a later phase.

## Design references (authoritative, in priority order)

Directory: `docs/superpowers/specs/assets/2026-08-11-landing-redesign/`

1. **`reference-landing.png`** — the user's reference screenshot for spacing and feel.
   *If this file is not yet present, ask the user for it before starting visual work* —
   they have it and intend to supply it. The measurable description in §Visual language
   below was transcribed from it and is the fallback authority.
   **Adopt from it:** proportions, whitespace, hairlines, label treatment, section rhythm.
   **Do NOT adopt from it:** the centered link nav (ARCHIVES/DESIGNERS/STORIES/COLLECTIONS),
   ACCOUNT, BAG — those were explicitly rejected. Nav follows `mockup-nav-option-1b.html`.
2. **`hero-placeholder.jpg`** — the user-supplied placeholder hero image (an empty
   industrial warehouse interior, cool grey tones, symmetrical one-point perspective).
   Same deal: if absent, ask the user; until it lands, use a flat `#e5e0d5` block of the
   correct aspect so layout work is not blocked. It is a placeholder — build the hero so
   the image file can be swapped without layout changes.
3. **`mockup-nav-option-1b.html`** — the approved top-bar arrangement (user picked
   "Option 1B" over an inline link bar). Open in a browser; the top card is the approved one.
4. **`mockup-landing-structure.html`** — the approved section order (user picked
   variant A: map kept as the closing section).

## User-confirmed decisions

- **Nav ("Option 1B")**: keep the existing full-screen menu-panel model. Top bar = DÉPÔT wordmark + MENU as a left cluster (Alaïa-style), SEARCH + language selector on the right. **No** account/bag UI, no nav renames, no inline link bar. Archives does NOT join the menu yet — there is no page to link to.
- **Landing structure (top→bottom)**: hero → search + browse-by row → Featured Archives strip (placeholders) → Curated Selection (existing Today's Edit) → Across Paris map (stays) → footer.
- **Hero**: split layout; left = "Paris. Archive. One feed." headline + short description + EXPLORE ARCHIVES → CTA; right = **one static full-bleed image (`hero-placeholder.jpg`), no caption, no rotation, no dots**.
- **Featured Archives placeholder entries** (exact set, order, and year formatting — designer names and years are literal strings, not translated):
  1. MARTIN MARGIELA — 1999–2008
  2. HEDI SLIMANE — 2000–07 · 2012–16
  3. RICK OWENS — 2011–2015
  4. COMME DES GARÇONS — 1999–2005
  5. HELMUT LANG — 1996–2005
  Entries are **not clickable**: no `href`, no hover state, `cursor: default`. "VIEW ALL →" is likewise inert or omitted for now.
- **Spacing/visual feel** must follow `reference-landing.png`; the user reviews screenshots and expects iteration until it feels right.
- **Desktop only.** The reference and every measurement in this spec are desktop; no mobile design decisions have been made. Mobile gets a minimal, unbroken fallback (see §Mobile scope) — do not invent a mobile art direction; a tailored mobile redesign is a separate later phase the user will brainstorm.

## Implementation

### 1. Top bar — [app/components/nav/TopBar.js](../../../app/components/nav/TopBar.js)

Rearrange the desktop bar: DÉPÔT wordmark + MENU button as the left cluster, SEARCH + language selector right. Keep heights untouched: `--nav-height: 56px` in `globals.css` must continue to match the desktop bar's `h-[56px]`, mobile stays `h-[50px]` (CLAUDE.md invariant). Menu panel content and behavior unchanged.

### 2. Homepage — rebuild [app/page.js](../../../app/page.js), extracting components into `app/components/home/`

- **Hero** — split grid (copy left / image right). Headline reuses existing i18n keys (`home.*` in [app/lib/i18n/messages.js](../../../app/lib/i18n/messages.js) — note the FR tagline already reads "Paris. Archives. Un fil."). Short description + EXPLORE ARCHIVES → CTA pointing to `/feed` for now (retargeted to `/archives` in the later phase). Image side: `next/image` loading `public/home/hero.jpg` — copy `hero-placeholder.jpg` there when it exists, flat `#e5e0d5` block until then.
- **SearchBrowseRow** — search input reusing [app/components/HeroSearchInput.js](../../../app/components/HeroSearchInput.js) behavior (form GET to `/feed`, i.e. `/feed?search=…`), plus "BROWSE BY DESIGNER · YEAR · CATEGORY": Designer → `/designers`, Category → `/feed`, Year → inert (no era browsing exists yet; style it like the others but non-interactive).
- **FeaturedArchives** — static strip rendering the five placeholder entries from a local constant inside the component (deliberately no `app/lib/archives.js` yet — that module arrives with the real archives phase).
- **Curated Selection** — keep the existing Today's Edit data flow **exactly** ([app/lib/loadHomepagePicks.js](../../../app/lib/loadHomepagePicks.js) → `fetchHomepagePicks` → the date-seeded per-store fallback currently inline in `app/page.js`); only the presentation changes ("CURATED SELECTION" label treatment per reference, existing [ProductCard](../../../app/components/ProductCard.js)).
- **Across Paris** — keep [app/components/ParisMap.js](../../../app/components/ParisMap.js) as the closing section, heading restyled to match the new label system.
- Preserve `export const dynamic = 'force-dynamic'`. Any wrapper needing horizontal clipping uses `overflow-x-clip`, never `overflow-x-hidden` (CLAUDE.md: `overflow-x-hidden` breaks `position: sticky` descendants).

### 3. Visual language — measurable description of `reference-landing.png`

Reference frame is 1449px wide; percentages below are of viewport width. Treat these as targets to hit within a few px at ~1440, scaling proportionally at other widths. The reference's palette: warm off-white page ground `#f5f2ed`-family, near-black text, hairlines in the `#e5e0d8` range. Use the existing font stack (Satoshi / General Sans via the `next/font` CSS variables — **no new fonts**).

- **Top bar**: white, ~80px tall, generous side padding (~48px). Wordmark ~28px. Utility text ~11px uppercase, letter-spacing ~0.12em. Hairline bottom border. (Arrangement per Option 1B, not the reference's centered links.)
- **Hero**: full-width, ~560–640px tall. Left copy column starts at the global content margin (~8% / ~120px at 1440); headline is three stacked lines ("Paris." / "Archive." / "One feed."), ~64px, normal weight, tight leading (~1.05), near-black. Description ~14px/1.6, muted (#555-ish), max-width ~260px, sits ~24px under the headline. CTA ~32px below: ~11px uppercase, tracked ~0.14em, arrow glyph, thin underline. Image occupies the right ~60–62% of the hero, full-bleed to the top, right, and bottom edges of the section; copy background and image meet with no divider.
- **Search + browse-by row**: white band, ~90px tall, hairline top and bottom. Left: search input as an underline-only field (no box), placeholder "Search archives", ~18px text, width ~50% of the container, magnifier icon at its right end. Right: "BROWSE BY" in muted ~10px uppercase, then DESIGNER / YEAR / CATEGORY as ~11px uppercase tracked items with chevrons, separated by thin vertical hairlines, ~28px gaps.
- **Featured Archives strip**: ~110px tall band, hairline bottom. "FEATURED ARCHIVES" label left, ~13px uppercase, tracking ~0.12em, full-black. The five entries spread evenly across the remaining width, each a centered two-line stack: designer name ~11px uppercase tracked, year range ~10px muted below; thin vertical hairlines between entries. "VIEW ALL →" right-aligned, same small-caps treatment.
- **Curated Selection**: section top padding ~64px. "CURATED SELECTION" heading ~20px uppercase, letter-spacing ~0.15em, medium weight, left; "VIEW ALL →" right, small caps. Grid below with ~24px gutters; product cards on very light grey grounds. The reference shows 5 columns; keep the existing responsive grid (2 / 3 / 4 cols) unless 5-at-wide looks right in review — user judges by screenshot.
- **General rhythm**: sections separated by 1px hairlines rather than heavy color blocks; vertical padding generous (~64–96px); one shared max-width container with equal side margins throughout.

The user will iterate on this by looking at preview screenshots — treat the numbers as the starting point and their feedback as the tiebreaker.

### 3b. Mobile scope — minimal fallback only

This phase designs desktop. On small screens the only requirement is *unbroken and legible*, achieved by plain stacking with default responsive utilities — spend no effort art-directing it:

- Hero: copy block above, image below (or image hidden if stacking looks bad), full-width.
- Search + browse-by: search input full-width; the BROWSE BY items may wrap below it or be omitted on the smallest widths.
- Featured Archives: entries as a simple stacked list or two-column wrap — no horizontal scroll work.
- Curated Selection / map: keep the existing mobile grid and map behavior.
- Mobile nav (`MobileNavMenu.js`, `h-[50px]` bar) stays functionally and visually unchanged.

A tailored mobile redesign (its own reference, its own decisions) is a later phase; do not pre-build for it.

### 4. i18n

All new user-facing strings (hero description, EXPLORE ARCHIVES, search placeholder, BROWSE BY / DESIGNER / YEAR / CATEGORY, FEATURED ARCHIVES, VIEW ALL, CURATED SELECTION) go into [app/lib/i18n/messages.js](../../../app/lib/i18n/messages.js) with en + fr parity — the parity test (`app/lib/i18n/__tests__/messages.test.js`) enforces matching keys, but **not** that consumers thread the language: accessors default to `"en"` silently, so pass the active language explicitly everywhere. Designer names and year strings stay literal.

## Deferred to a later phase (designed, not built now)

Era columns + deterministic `parseEra` from name/title (~69% of live products carry an era signal — verified in prod), backfill script, cron sync write, `app/lib/archives.js` config, `/archives` + `/archives/[slug]` feed-style pages, Archives entry in the nav menu. When that lands, the placeholder entries become links and the Year browse item goes live.

Also deferred: the **tailored mobile redesign** of this landing page (see §Mobile scope).

## Verification

- `npm test` — i18n parity passes with the new keys.
- Preview server (`npm run dev` via launch config — never a raw background shell):
  - Homepage section order and spacing vs `reference-landing.png` at desktop width (~1440). Mobile width is checked only against §Mobile scope: everything stacks, nothing overflows or breaks — no pixel-matching there.
  - Top bar: DÉPÔT + MENU left / SEARCH + language right on desktop; mobile bar unchanged in height; menu panel still opens and works.
  - Search submits to `/feed?search=…`.
  - Featured Archives renders the five entries with the exact year formats above and nothing is clickable (no cursor change, no navigation).
  - **Curated Selection renders up to 8 products — one per active store, sliced to 8.** With 13 active stores (production count on 2026-08-11) the expected steady state is 8, but the fallback silently drops failed or empty store fetches, and the whole loader is wrapped in a swallow-all `try/catch`, so fewer — or zero — is possible under degradation. That is **inherited behavior, kept deliberately**: an empty grid is the accepted degraded state for this phase; do not add new data-loading logic to force a count.
  - Map renders; language toggle shows French for every new string.
- Safety (CLAUDE.md): never trigger `/api/cron` or `/api/enrich` locally — they write production rows and spend OpenAI budget. No DB or schema changes in this phase. The site has **one** Supabase (production) — read-path UI checks are safe, writes are not.
