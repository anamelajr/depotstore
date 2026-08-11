# Landing Page Redesign (archives as visual placeholders)

## Context

Redesign the homepage ([app/page.js](app/page.js)) to match the user's reference layout: generous spacing, hairline section dividers, small tracked-out uppercase labels. The page gains a **Featured Archives strip — visual placeholders only for now**: five designer-era cards that do not link anywhere; the real archives system (era parsing, DB columns, `/archives` routes — designed during brainstorming and confirmed feasible against production data) is explicitly deferred to a later phase.

### User-confirmed decisions

- **Nav ("Option 1B")**: keep the existing menu-panel model. Top bar = DÉPÔT + MENU as a left cluster (Alaïa-style), SEARCH + language on the right. No account/bag, no renames. (Archives does NOT join the menu yet — there is no page to link to.)
- **Landing structure (top→bottom)**: hero → search + browse-by row → Featured Archives strip (placeholders) → Curated Selection (existing Today's Edit) → Across Paris map (stays) → footer.
- **Hero**: split layout; left = "Paris. Archive. One feed." + short description + EXPLORE ARCHIVES → CTA; right = **one static image, no caption, no rotation**. User will supply the image; use a neutral placeholder file until then.
- **Featured Archives placeholder cards** (exact set and year formatting):
  1. MARTIN MARGIELA — 1999–2008
  2. HEDI SLIMANE — 2000–07 · 2012–16 (Dior Homme + Saint Laurent)
  3. RICK OWENS — 2011–2015
  4. COMME DES GARÇONS — 1999–2005
  5. HELMUT LANG — 1996–2005
  Cards are **not clickable** (no href, default cursor). "VIEW ALL →" is likewise inert or omitted for now.
- **Spacing/visual feel** must follow the reference image; user expects to iterate on screenshots.

## Implementation

### 1. Top bar — [app/components/nav/TopBar.js](app/components/nav/TopBar.js)

Rearrange desktop bar: DÉPÔT wordmark + MENU button as the left cluster, SEARCH + language selector right. Keep heights untouched (`--nav-height: 56px` desktop / `h-[50px]` mobile coupling per CLAUDE.md). Menu panel content unchanged.

### 2. Homepage — rebuild [app/page.js](app/page.js), extracting `app/components/home/` components

- **Hero** — split grid (copy left / image right). Copy: existing "Paris. Archive. One feed." headline (i18n keys `home.*` already exist for headline/tagline), short description, EXPLORE ARCHIVES → CTA pointing to `/feed` for now (real `/archives` later). Right: `public/home/hero.webp` placeholder via `next/image` (swap when user sends theirs).
- **SearchBrowseRow** — search input reusing `app/components/HeroSearchInput.js` behavior (submits to `/feed?search=`), plus "BROWSE BY DESIGNER · YEAR · CATEGORY": Designer → `/designers`, Category → `/feed`, Year → inert placeholder (no era browsing exists yet).
- **FeaturedArchives** — static strip rendering the five placeholder cards above from a small local constant (no `app/lib/archives.js` config yet — YAGNI until real archives). Non-interactive.
- **Curated Selection** — keep the existing Today's Edit data flow exactly (`loadHomepagePicks` → `fetchHomepagePicks` → date-seeded fallback in `app/page.js`); restyle the section heading/spacing to the reference ("CURATED SELECTION" label treatment).
- **Across Paris** — keep `app/components/ParisMap.js` as the closing section, restyled heading to match.
- Preserve `export const dynamic = 'force-dynamic'`. Any wrapper needing horizontal clipping uses `overflow-x-clip`, never `overflow-x-hidden` (sticky-breakage rule in CLAUDE.md).

### 3. Visual language

Match the reference: generous vertical rhythm, 1px hairline dividers between sections, small uppercase letter-spaced labels, existing font system (Satoshi / General Sans via `next/font` variables — no new fonts). Iterate with the user via preview screenshots; the brainstorming visual-companion mockups in the scratchpad capture the agreed look.

### 4. i18n

All new user-facing strings (description copy, EXPLORE ARCHIVES, BROWSE BY labels, FEATURED ARCHIVES, CURATED SELECTION) go into [app/lib/i18n/messages.js](app/lib/i18n/messages.js) with en + fr parity (enforced by `app/lib/i18n/__tests__/messages.test.js`). Designer names/years stay literal. Accessors default to `"en"` — remember to thread the active language.

## Deferred to a later phase (designed, not built now)

Era columns + deterministic `parseEra` from name/title (~69% coverage verified in prod), backfill script, cron sync write, `app/lib/archives.js` config, `/archives` + `/archives/[slug]` feed-style pages, Archives entry in the nav menu. When that lands, the placeholder cards become links and the Year browse target goes live.

## Verification

- `npm test` — messages parity passes with new keys.
- Preview server (`npm run dev` via launch config): homepage section order and spacing vs the reference image; top-bar arrangement desktop + mobile; search submit lands on `/feed?search=…`; archive cards render the five entries with exact year formats and are not clickable; Today's Edit still renders 8 products (fallback rotation since `content/homepage-edit.json` is `[]`); map renders; language toggle shows French for every new string; responsive pass at mobile width.
- Safety: never trigger `/api/cron` or `/api/enrich` locally. No DB or schema changes in this phase.
