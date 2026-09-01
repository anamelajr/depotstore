# Gucci by Tom Ford 1990–2004 featured archive

## Context

Dépôt has two live featured archives — Martin Margiela 1988–2009 and Hedi Slimane (Dior Homme / Saint Laurent). The user wants a third for the Tom Ford years at Gucci, 1990–2004. The archive system is config-driven: adding one is a new entry in `app/lib/archives.js` plus a test update; the route, fetch layer, homepage band, and i18n all pick it up automatically.

### Production data audit (2026-09-01, via read-only Supabase MCP)

- 976 `GUCCI` rows total; 415 with `era_year` in 1990–2004; **227 buyable** under the visibility predicate (`available = true`, `hidden = false`, non-zero price).
- 77 of the 227 explicitly mention "tom ford" in `name`/`description`.
- 158 visible `GUCCI` rows have `era_year IS NULL`; 6 of those mention "tom ford".
- `TOM FORD` (the 2005+ label) is a **separate canonical brand** (20 rows) — `.eq("brand", "GUCCI")` can never leak it. `BRAND_ALIASES` already folds `"GUCCI BY TOM FORD" → "GUCCI"` (`app/lib/brand.js:26`).
- Random sample of the 227 is clean (FW97 GG boots, SS01 Dragon sneakers, FW04 pony hair, etc.).
- **False positives found:** 8 in-window rows whose descriptions reference post-Ford designers (Giannini-era Pelham/Hysteria bags titled "2000s …" parse to `era_year` 2000). Excluded via attribution tokens below.

### User decisions

1. **Membership: era window only** — all `GUCCI` with `era_year` 1990–2004 counts as the Ford years (he was at the house the whole window). ~227 items, Margiela pattern; no positive attribution gate.
2. **Plus the null-era rule** — `GUCCI`, `eraYearNull`, attribution `["tom ford"]` (Slimane/Saint-Laurent pattern), +~6 items.
3. **Band slot: replace the inert `COMME DES GARÇONS` placeholder** — band stays at five entries; no `FeaturedArchives.js` layout risk.
4. **Name/slug: `GUCCI BY TOM FORD` / `gucci-by-tom-ford`** — disambiguates from the later TOM FORD label.
5. **No portrait** — `image: null`, `imageAlt: null`; hero collapses to single column. Can be added later.
6. (Derived from audit) **`excludeAttribution: ["michele", "giannini"]`** on the era-window rule, dropping the 8 post-Ford rows — same mechanism as Margiela's H&M/Hermès exclusion.

## Changes

### 1. `app/lib/archives.js`

Replace the inert `{ name: "COMME DES GARÇONS", years: …, live: false }` entry (keeping its band position) with:

```js
{
  live: true,
  slug: "gucci-by-tom-ford",
  name: "GUCCI BY TOM FORD",
  years: "1990–2004",
  tenureLine: "Gucci 1990–2004",
  image: null,
  imageAlt: null,
  editorialSlug: null,
  description: "<one-paragraph editorial description — draft below, user may edit>",
  rules: [
    { brand: "GUCCI", eraStart: 1990, eraEnd: 2004,
      excludeAttribution: ["michele", "giannini"] },
    { brand: "GUCCI", eraYearNull: true, attribution: ["tom ford"] },
  ],
  include: [],
  exclude: [],
}
```

Draft description (English-only by convention; chrome i18n untouched):
> "Between 1990 and 2004, Tom Ford remade Gucci from a fading leather-goods house into the defining force of nineties glamour — velvet tailoring, satin shirts and G-frame monograms cut with a dark, sensual precision. Every piece here dates from his tenure."

Rule shapes already exist in `fetchArchiveProducts.js` (`eraStart/eraEnd`, `eraYearNull`, `attribution`, `excludeAttribution`) — **no fetch-layer change**.

### 2. `app/lib/__tests__/archives.test.js`

- `ARCHIVES` length stays 5 — assertion unchanged.
- Update any assertion enumerating inert names (COMME DES GARÇONS is no longer inert).
- Add `getArchiveBySlug("gucci-by-tom-ford")` assertions alongside the margiela/slimane ones (returns the entry; rules well-formed; alt-iff-image invariant already covered generically).

### 3. Spec doc

Write `docs/superpowers/specs/2026-09-01-gucci-by-tom-ford-archive-design.md` following the Margiela spec's structure (`docs/superpowers/specs/2026-08-30-martin-margiela-archive-design.md`): context, data audit numbers above, user decisions, per-file changes, verification.

### Explicitly NOT needed

- i18n (`messages.js`) — archive chrome keys already exist in en/fr.
- `FeaturedArchives.js`, `app/archives/[slug]/page.js`, `fetchArchiveProducts.js`, cache-key bump, SQL/RPC, portrait asset.

## Verification

1. `npm test` — archives + fetchArchiveProducts suites pass.
2. `npm run dev` (worktree needs `.env.local` + `npm ci` — see memory note), then:
   - Homepage band shows GUCCI BY TOM FORD as a live link in the old CDG slot; RICK OWENS / HELMUT LANG remain inert.
   - `/archives/gucci-by-tom-ford` renders the single-column hero (no portrait), item count ≈ 230, grid populated; filter/sort panel works.
   - Spot-check: no Pelham/Hysteria (Giannini) pieces in the grid; a known "tom ford"-attributed undated piece appears.
   - `/archives/comme-des-garcons` (never existed) and unknown slugs still 404.
3. Read-path only — safe against production Supabase per CLAUDE.md.

## Workflow

Branch from current worktree branch; commit spec + code; PR to `main`; merge only on explicit user instruction.
