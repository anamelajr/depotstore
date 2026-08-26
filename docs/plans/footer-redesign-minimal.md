# Footer redesign — minimal newsletter + link row

## Context

The user wants the site footer redesigned in the style of a reference screenshot (Paly Hollywood): a stripped-down block with a NEWSLETTER heading, a sentence of copy, a wide flat gray email input, and a single horizontal row of uppercase links. Design was brainstormed and approved with these decisions:

- **No product ticker** (the strip in the reference is out of scope).
- **Fully minimal**: drop the DÉPÔT wordmark, tagline, Explore/Connect columns, and the © bar entirely.
- **Link row includes every existing public page**: FEED · STORES · DESIGNERS · EDITORIAL · ABOUT · SAVED · CONTACT (Contact stays `mailto:hello@depot.paris`). No new legal pages.
- **Enter-only submit**: flat input, no visible button (hidden submit button kept for a11y/form semantics).

## Changes

### 1. `app/components/Footer.js` — rewrite

Keep it a server component. New structure inside `<footer className="bg-white text-zinc-950 px-6 py-16 sm:px-10 sm:py-20">` with `mx-auto max-w-4xl` container:

1. **Newsletter block** (keep `id="newsletter"` and `scroll-mt-[80px]` so existing anchors work):
   - Eyebrow: `NEWSLETTER` via `<T k="footer.newsletter" />`, styled `font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500`.
   - Copy line: `<T k="newsletter.label" />` in `text-sm text-zinc-600` (moves here from inside NewsletterForm).
   - `<NewsletterForm />` (restyled, see below). Input goes full container width (no `max-w-sm` cap — the reference input is wide; cap at something like `max-w-2xl` if full-bleed looks too much, decide visually).
2. **Link row**: a `<ul>` with `flex flex-wrap gap-x-6 gap-y-3` (or similar), links styled `font-mono text-[12px] uppercase tracking-widest text-zinc-800 hover:text-zinc-500 transition-colors`:
   - `/feed` → `footer.feed`, `/stores` → `footer.stores`, `/designers` → `footer.designers` (new key), `/editorial` → `footer.editorial` (new key), `/about` → `footer.about` (new key), `/saved` → `footer.saved`, `mailto:hello@depot.paris` → `footer.contact`.

Removed: wordmark, tagline, two-column Explore/Connect grid, bottom © bar.

### 2. `app/components/NewsletterForm.js` — restyle

- Remove the visible label (copy moves to Footer) and the visible SIGN UP button.
- Input: flat gray reference style — `w-full bg-zinc-100 px-4 py-3 font-mono text-sm text-zinc-950 placeholder:text-zinc-400 placeholder:uppercase placeholder:tracking-widest`. **A clearly visible keyboard focus indicator is required** (a subtle background shift alone is not acceptable): `outline-none focus:ring-1 focus:ring-zinc-500` (or keep the default outline). Placeholder key changes meaning: reuse `newsletter.placeholder` but update its value to `Email` / `E-mail` (uppercased via CSS).
- Add `aria-label` from `newsletter.label` (or `footer.newsletter`) so the label-less input stays accessible.
- Keep a submit button in the DOM (`sr-only`) so Enter submits and screen readers get an action, **but it must become visible when it receives keyboard focus** — `sr-only focus:not-sr-only` plus visible focused styling (e.g. the small bordered-button style the current form uses), with its localized `newsletter.signUp` label. A permanently invisible tab stop is not acceptable. (This means `newsletter.signUp` stays in messages.js — remove it from the "Remove" list in §3.)
- Keep `disabled` during loading and dim the input (`disabled:opacity-50` on input via `status === "loading"`).
- Success/error states unchanged: success replaces form with `newsletter.success` line; error shows the small red `newsletter.error` line.
- No changes to the fetch/`/api/subscribe` logic.

### 3. `app/lib/i18n/messages.js` — key changes (both en ~line 135 and fr ~line 287 blocks, parity test enforces both)

Add:
- `footer.designers`: en "Designers" / fr "Créateurs"
- `footer.editorial`: en "Editorial" / fr "Éditorial"
- `footer.about`: en "About" / fr "À propos"

Update:
- `newsletter.placeholder`: en "Email" / fr "E-mail" (was your@email.com)

Remove (only used by the code being deleted — verified by grep):
- `footer.tagline`, `footer.explore`, `footer.connect`

Keep: `footer.newsletter`, `footer.feed`, `footer.stores`, `footer.saved`, `footer.contact`, `newsletter.label`, `newsletter.placeholder`, `newsletter.signUp` (used by the focus-revealed submit button), `newsletter.success`, `newsletter.error`.

## Not touched

- `/api/subscribe` (Beehiiv) — unchanged.
- No new pages; no legal routes.
- `layout.js` footer placement — unchanged.

## Verification

1. `npm test` (or the project's test runner) — the i18n parity test (`app/lib/i18n/__tests__/messages.test.js`) must pass with the added/removed keys.
2. Run the dev server via preview_start (needs `.env.local` in the worktree — copy from main checkout if missing, per memory note). **Before starting the server, remove or comment out `BEEHIIV_API_KEY` and `BEEHIIV_PUBLICATION_ID` in the worktree's `.env.local`** — `/api/subscribe` forwards every submit to the live Beehiiv API with `send_welcome_email: true`, so a form test with production credentials creates a real subscriber and sends a welcome email. With the vars absent, Beehiiv rejects the upstream call, the route returns 500, and the form's error state renders — which verifies the full client wiring with zero production mutation. Never verify the submit path against production credentials. Then check:
   - Footer renders on `/` and `/feed`: NEWSLETTER eyebrow + copy + flat gray input + single uppercase link row, nothing else.
   - All 7 links navigate correctly; Contact opens mailto.
   - Language toggle: all footer strings swap to French (new keys threaded through `<T>`).
   - Type an email and press Enter → POST `/api/subscribe` fires (network tab) and, with Beehiiv creds absent per above, the error line renders. Also Tab from the input: the input shows a visible focus ring, and the next Tab reveals the submit button (`focus:not-sr-only`) — no invisible tab stop.
   - Mobile viewport (`resize_window` mobile preset): links wrap cleanly, input full width.
3. Screenshot the result for the user.

## Addendum: site-wide ground unification (2026-08-26)

After the initial implementation, the footer's `bg-white` visibly seamed against the
homepage's warm ground (`#faf9f7`, `app/components/home/tokens.js`). Approved follow-up,
same PR, own commit:

- `--background` in `globals.css` becomes `#faf9f7` — the single site ground.
- Footer drops `bg-white` (transparent, sits on body).
- Page wrappers on feed/about/stores/product drop their explicit `bg-white` and inherit
  the body ground. Saved/designers already inherited. Editorial keeps its deliberate
  `#f5f2ed`. Component-level whites (nav, filter panels, sort menus, cards, overlays)
  are untouched.
- Newsletter input widened: footer container `max-w-4xl` → `max-w-5xl`, input's
  `max-w-2xl` cap removed — input spans the full container (~71% of a 1440px viewport,
  centered), matching the reference proportions.

## Workflow

Branch is already `claude/footer-redesign-68e7e2` in this worktree. Commit there; do not push to main. Merge only on explicit user instruction.
