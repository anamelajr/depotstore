# Currency / Region Selector — Phase 1

## Context

Dépôt is a curated feed that links **out** to Paris retailers' Shopify stores — there
is no checkout on the site, and prices are stored as EUR text (`'€29.99'`). UK and US
visitors currently have to mentally convert. This change adds a header control (replacing
the "Newsletter" link) where a visitor picks a **currency** (€ default / £ for UK / $ for
US) and sees every price converted from the EUR base, **rounded to the nearest 5** and
shown **without an "≈" sign**. The control also includes a **Language row (English /
Français)** as a shell — Français is rendered but **inert** in this phase; the actual
French translation is a separate later project.

This is **phase 1 (currency)**; French i18n comes later.

Two notes on what you'll actually see vs. the white mockup:
- **The real panel is dark**, matching your site (`bg-zinc-900`/`#0a0a0a`, zinc text) —
  not white like the brainstorm mockup. The active item is highlighted in **white
  (`text-zinc-50`)**, inactive options are dimmer grey, Français is muted. Concept is
  identical to the mockup, just on your dark theme.
- **Editorial article pages become per-request rendered** instead of pre-built (their
  product data still stays cached hourly). This is the clean way to avoid a €→£ price
  flicker on those pages; cost is negligible at this site's scale. Flag if you'd rather
  keep them static and accept the flicker.

## Approach

**Spine:** one universal client `<Price eur={rawEurString} />` component used at all six
price-display sites. Five of the six are server components, but they can render a client
child; this gives correct server-rendered HTML (no flash), **live** updates everywhere
when currency flips (no navigation needed), and zero per-site cookie/rate reads. The
selected currency and the FX rates both live in one `CurrencyProvider` context, seeded
server-side from a cookie + the rates table so the first paint is already correct.

EUR stays the **stored and sorted base** — nothing about the Shopify sync or the price
sort changes (conversion is monotonic, so EUR-base sort == converted sort).

### New files
- **`app/lib/currency.js`** — pure parse/convert/round/format. `parseEur("€29.99") → 29.99`;
  `roundTo5(n) = Math.max(5, Math.round(n/5)*5)` (the `Math.max(5,…)` floor stops a €2 item
  rounding to £0); `formatPrice(rawEur, currency, rates)` returns the display string — EUR
  is passthrough of the raw string, GBP/USD return e.g. `"£255"` / `"$325"` (integer, no
  "≈"). Exports `CURRENCIES = { EUR/GBP/USD: { symbol, label } }`.
- **`app/lib/fx.js`** — `FALLBACK_RATES = { GBP: 0.85, USD: 1.08 }` (mirrors the
  `FALLBACK_STORES` safety-net pattern in `app/lib/stores.js`); `getFxRates()` server read
  from Supabase `fx_rates`, falling back to `FALLBACK_RATES` on any error; `refreshFxRates()`
  fetches Frankfurter and upserts the row. Imports `supabaseAdmin`; never imported by client.
  - **Observability (do not let fallback masquerade as live data):** when `getFxRates()`
    falls back it must `console.warn` a structured line (e.g.
    `{ event: "fx_read_fallback", reason }`) and return a `source: "fallback" | "db"`
    marker alongside the rates so server diagnostics can tell them apart. A missing /
    schema-drifted `fx_rates` table must be loud, not silent — otherwise stale hardcoded
    rates ship looking correct. (`getFxRates` uses the service-role client, which bypasses
    RLS, so the locked-RLS table is still readable server-side; the real exposure is a
    missing table or a skipped migration step.)
  - **`refreshFxRates()` must time-bound the Frankfurter fetch** with an `AbortController`
    (~5 s), mirroring `cleanTitle.js`'s existing timeout pattern, so a hung provider can
    never stall the caller. Throw on non-200 or malformed shape (no `rates.GBP`/`rates.USD`).
- **`app/components/CurrencyProvider.js`** (`"use client"`) — context `{ currency,
  setCurrency, language, rates }`. `setCurrency` updates state + writes cookie
  `depot_currency` (`path=/; max-age=1y; samesite=lax`); no reload. Exports `useCurrency()`.
  **Constraint:** `useState` must seed from the `initialCurrency` **prop** (server-passed
  from the cookie), never a client `document.cookie` read in the initializer — otherwise
  SSR renders EUR and the client flips on hydration (the exact flash we're avoiding, plus
  a hydration-mismatch warning).
- **`app/components/Price.js`** (`"use client"`) — reads `useCurrency()`, calls
  `formatPrice`, applies the `.replace(/\.00$/,"")` strip on the EUR branch, renders `"—"`
  when null. Takes `eur` (raw string) + `className`. **Intentional consistency change:**
  the strip now runs on *all* sites, so `€100.00` → `€100` on the product detail page and
  editorial grids too (today only the feed cards strip it). GBP/USD are integer multiples
  of 5, so the strip is a no-op there.
- **`app/components/nav/RegionMenu.js`** + **`RegionPanel.js`** (`"use client"`) — mirror
  the existing `app/components/feed/DesktopSortMenu.js` (outside-click + Escape, `role=menu`,
  dark panel) and `app/components/MobileSortPanel.js`. Trigger label `` `${language.toUpperCase()} · ${CURRENCIES[currency].symbol}` `` → `EN · €`, + caret. Panel: Language row
  (English active / Français muted+`aria-disabled`+no-op), Currency row (€/£/$ each call
  `setCurrency` then close), and the footer note text exactly **"Prices are converted from
  EUR"**.

### Edited files
- **`app/layout.js`** — `const initialCurrency = (await cookies()).get("depot_currency")?.value`
  (validate against allowed set, fall back `"EUR"`); `const rates = await getFxRates();`
  pass both into `LayoutClient`. (This `cookies()` call is what makes the tree dynamic.)
- **`app/components/LayoutClient.js`** — wrap its tree in `<CurrencyProvider initialCurrency
  rates>` so both `<Nav>` (trigger) and `children` (the `<Price>`s) share one context.
- **`app/components/nav/TopBar.js`** — replace the Newsletter `<Link>` at **lines 116–118**
  with `<RegionMenu />`; keep the adjacent `Saved` link and `baseLink` style.
- **`app/components/MobileNavMenu.js`** — add a compact Language/Currency section to
  `RootView`'s footer block (the `mt-auto pt-8 border-t` div near About/Contact, ~L92–99).
  (There is **no** Newsletter link in the mobile menu to replace — confirmed.)
- **The six price sites** → swap the price text node for `<Price eur={…} className={…} />`,
  keeping the surrounding wrapper classes: `ProductCard.js` (L84 mobile, L108 desktop; drop
  the L21 strip), `ProductInfoPanel.js:39`, `product/[handle]/page.js:58`,
  `MoreFromStore.js:70`, `editorial/_components/PiecesFeatured.js:35`,
  `editorial/_components/MoreFromDesigner.js:30`.
- **`app/editorial/[slug]/page.js`** — wrap `fetchEditorialProducts` in
  `unstable_cache` so the hourly data cache survives the page going dynamic.
  **Cache key must be per-slug.** `unstable_cache` already keys on the *arguments* passed
  (and `fetchEditorialProducts` receives each entry's `curatedProducts`/`brandFilter` as
  args — verified against Next 16.2.0 docs), so distinct slugs already get distinct entries.
  But pass an **explicit** slug keyPart as belt-and-suspenders against a future
  closure-capture mis-implementation:
  `unstable_cache(fetchEditorialProducts, ["editorial-products", slug], { revalidate: 3600 })`.
- **`app/api/cron/route.js`** — refresh FX in a **non-blocking** path. Preferred: run
  `refreshFxRates()` inside `waitUntil(...)` (the handler already uses `waitUntil` at L274
  for the enrich trigger) so a slow provider never delays the cron response or its
  `enrich_runs` log. If `fxRefreshed` must appear in the response JSON instead, keep it an
  **isolated** awaited `try { await refreshFxRates() } catch` placed **after** the
  stale-delete and outside the sync `Promise.allSettled` — but only safe because
  `refreshFxRates` is now timeout-bounded (above). Either way it can never touch the
  `successfulDomains` delete guard. (Schedule is dashboard-configured; no `vercel.json`.)

### Out-of-band (do before merge — MCP is read-only)
Create + seed the `fx_rates` table via the **Supabase SQL Editor**:
```sql
create table if not exists public.fx_rates (
  id integer primary key default 1,
  base text not null default 'EUR',
  gbp numeric not null, usd numeric not null,
  fetched_at timestamptz not null default now(),
  constraint fx_rates_singleton check (id = 1)
);
insert into public.fx_rates (id, base, gbp, usd) values (1,'EUR',0.85,1.08)
  on conflict (id) do nothing;
alter table public.fx_rates enable row level security; -- no policies: server-only
```
**Seed with *real current* rates, not the `FALLBACK_RATES` constant.** If the seed equals
`0.85/1.08` and the table read silently fails, fallback and live values are
indistinguishable and verification passes on broken infra. Use today's actual EUR→GBP/USD
so a working read produces visibly different numbers than the fallback.

FX source: **Frankfurter** (`https://api.frankfurter.app/latest?from=EUR&to=GBP,USD`) —
free, no key, ECB-based.

### Untouched (guarded invariants)
EUR price-sort in `app/api/products/route.js` (keep its inline `parsePrice` as-is); the
Shopify-sync EUR base in `shopifyFetch.js`/`resolveProductDetail.js`; the cron
stale-delete logic; and the **footer newsletter signup form** (only the header link goes).

## Verification (on a Vercel preview, not localhost)
1. Run the `fx_rates` SQL in Supabase first, then push the branch and open the preview URL.
2. **Desktop header:** shows `EN · €`, Newsletter gone, Saved present. Panel opens → English
   active/white, Français muted + click does nothing; €/£/$ clickable; note reads exactly
   "Prices are converted from EUR".
3. **Switch to £/$:** trigger updates (`EN · £`); every feed card, product detail,
   MoreFromStore, and editorial grid price updates **live** with no reload. A €300 item
   shows `£255` and `$325`; no "≈".
4. **No-flash:** with `depot_currency=GBP` cookie set, hard-reload a product page and an
   **editorial** page (disable JS / view source) — the `£` must be in the initial HTML.
5. **Persistence:** reload + navigate → currency sticks.
6. **Mobile:** open the portal menu → Language/Currency in the footer works; FR inert.
7. **Cron:** hit `/api/cron` with the `CRON_SECRET` bearer → `fx_rates.fetched_at` updates
   and the row holds live Frankfurter values; sync summary (`totalUpserted`, `deleted`)
   unaffected. (If FX runs in `waitUntil`, verify via `fetched_at`/logs rather than a
   response flag.)
8. **Sort unchanged:** price asc/desc ordering identical before and after.

### Negative-path checks (added per adversarial review)
9. **Two editorial slugs render distinct grids:** load two different editorial articles
   back-to-back; confirm each shows its own `curatedProducts`/brand grid (guards the
   per-slug cache key — finding 1).
10. **Missing/broken `fx_rates`:** temporarily point at an env without the table (or rename
    it) → prices must still render via fallback AND `getFxRates` must emit the
    `fx_read_fallback` warn / `source: "fallback"` marker (finding 3). Live vs. fallback
    must be distinguishable (seed differs from `0.85/1.08`).
11. **FX provider timeout:** simulate a hung Frankfurter (block the host) → `refreshFxRates`
    aborts at ~5 s, the cron completes normally, and the last-good `fx_rates` row is
    retained (finding 2).
