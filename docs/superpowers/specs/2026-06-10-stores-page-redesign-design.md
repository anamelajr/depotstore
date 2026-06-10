# Stores page redesign — "Monumental names"

## Context

The `/stores` page (linked from the footer's Explore column) is visually inconsistent
with the rest of Dépôt: a generic numbered list with "Directory / Partner Stores"
headings, a back link, and per-store piece counts. The user wants a total redesign
that feels like the rest of the site (dark, typographic, luxury) and the piece
counts removed.

Design was brainstormed with mockups and approved by the user:

- **Direction C — "Monumental names":** the store names themselves are the page's
  typography. No index numbers, no piece counts, no dividers, no big heading, no
  back link.
- **Resting state:** all names full white. **Desktop hover:** hovered name stays
  white, sibling names dim (pure CSS spotlight). Touch devices: no dimming.
- **Header:** only a small tracked-uppercase label — "STORES — PARIS" (en) /
  "BOUTIQUES — PARIS" (fr) — via the site's i18n pattern.

## Changes

### 1. `app/lib/i18n/messages.js` — add one key pair

Add `"stores.label"` to **both** the `en` block (`"Stores — Paris"`) and the `fr`
block (`"Boutiques — Paris"`), near the existing `footer.*` keys. The parity test
(`app/lib/i18n/__tests__/messages.test.js`) enforces en/fr key parity — adding both
sides keeps it green.

### 2. `app/stores/page.js` — full rewrite

Keep:
- `export const dynamic = 'force-dynamic'`
- Data: `getAllStores()` from `app/lib/stores.js`, filtered to `s.active`,
  current (alphabetical) order.
- Each store renders as a `next/link` to `/feed?store=${encodeURIComponent(store.domain)}`.

Remove:
- `getPieceCounts()` and the `count_products_by_store` RPC call entirely (the
  `supabase` import goes with it).
- Index numbers, "← Back to feed" link, "Directory" label, "Partner Stores" h1,
  piece counts, divider borders.

New markup (dark `bg-[#0a0a0a]`, consistent with feed/about/footer):
- Container: `mx-auto max-w-5xl px-6 py-16` (room for big type).
- Header label = the page `<h1>` for a11y, styled as the site's micro-label idiom:
  `text-[11px] font-medium uppercase tracking-[0.24em] text-zinc-500`, content
  `<T k="stores.label" />` (the `T` client component, same as `Footer.js` uses).
  Generous margin below (~`mb-12`).
- Store list: stacked `<Link>` blocks, one per store —
  - Name: General Sans (`style={{ fontFamily: "var(--font-general-sans), sans-serif" }}`),
    `text-[clamp(36px,7vw,72px)] font-medium tracking-tight leading-[1.15]`,
    `text-zinc-50`, `transition-colors`.
  - Neighborhood: superscript-style `<sup>` (or top-aligned `<span>`) right after the
    name: `text-[10px] font-normal uppercase tracking-[0.2em] text-zinc-500 ml-2`
    rendering `store.location` (DB proper noun — not translated). Omit gracefully
    when `location` is null.
- **Hover spotlight (pure CSS, hover-capable devices only):** on the list container,
  an arbitrary-selector Tailwind variant gated to hover devices, e.g.
  `[@media(hover:hover){&:hover_a:not(:hover)}]:text-zinc-700` (with
  `transition-colors` on each link) so when one name is hovered the others recede
  and the hovered one stays `text-zinc-50`. If the arbitrary variant proves
  unwieldy, an equivalent few-line rule scoped under a `.stores-spotlight` class in
  `app/globals.css` wrapped in `@media (hover: hover)` is acceptable — but try the
  Tailwind-only route first to keep styling colocated.

No new components needed — the page stays self-contained like today. Nav and footer
already come from `RootLayout`/`LayoutClient`; nothing to add.

### 3. Design doc (superpowers workflow)

Save the approved design as `docs/superpowers/specs/2026-06-10-stores-page-redesign-design.md`
(brief: context, approved direction C, the decisions above) and commit it with the
implementation branch.

## Invariants check

- No product reads touched — `withVisibility` / piece-count concerns disappear with
  the RPC call (read-only RPC removal; the Supabase function itself stays, unused —
  no DB change needed).
- i18n parity test covers the new key; language-aware accessors aren't involved
  (the `T` component threads language itself).
- Filter-URL semantics unchanged (`/feed?store=…` links, same as today).

## Verification

1. `npm test` — i18n parity test passes with the new key.
2. Start the dev preview (read-path only — safe against prod Supabase; do **not**
   touch `/api/cron` or `/api/enrich`):
   - `/stores` renders the label + all active stores, no counts, no numbers.
   - Hover a name on desktop width → siblings dim, hovered stays white; mouse-out
     restores all-white.
   - Toggle language (EN→FR) → label switches to "BOUTIQUES — PARIS".
   - Click a store name → lands on `/feed?store=<domain>` with that store's feed.
   - Resize to mobile width (~380px) → names scale down via clamp, superscripts
     don't overflow; no hover artifacts.
3. Screenshot the page and share as proof.
