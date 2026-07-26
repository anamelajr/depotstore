# Add Trévise & Chez Snow Bunny to the Dépôt feed

## Context

The user wants two new Paris stores added smoothly to Dépôt — feed, nav menu, filters, map, /stores page — with product titles standardized into the existing format (ALL-CAPS brand + short Title-Case title). A third store, **Retro Chic, is explicitly skipped** (user decision): it runs on Wix, has no `products.json`, and cannot be synced.

Verified facts (checked live during planning, 2026-07-26):

| Store | Domain | Platform | Catalog | Available |
|---|---|---|---|---|
| Trévise | `treviseparis.com` | Shopify ✓ (`/products.json` at root) | 426 products | 284 |
| Chez Snow Bunny | `chezsnowbunny.fr` | Shopify ✓ (`/products.json` at root) | 4,795 products | 1,986 |

**Curation decision (user):** allowlist stays untouched — only brands already in `app/brands.js` (plus `BRAND_ALIASES`) enter the feed. Chez Snow Bunny is only ~40% designer archive; the rest (Levi's, Diesel, Miss Sixty, Benetton, Cop Copine, Ralph Lauren, unbranded "Vintage…" pieces, their "SB" house label) must never enter the DB. Trévise also carries some non-allowlisted labels (Blumarine, Chloé, Plein Sud, Christian Lacroix, Emanuel Ungaro, Romeo Gigli, Lolita Lempicka, Alberta Ferretti, Moschino, Paco Rabanne, La Perla).

The mechanism already exists: `FILTER_BY_BRAND` in [app/lib/shopifyFetch.js:9](app/lib/shopifyFetch.js) drops products at sync time unless (existing curated brand row) OR (vendor is allowlisted) OR (`titleContainsAllowedBrand(name)`). Both stores put brand names in product titles, so the title check works for both. **Both new domains go into this set** — non-matching products never enter the DB and never spend OpenAI tokens.

Title standardization needs **no new work**: `/api/enrich` → `cleanTitle.js` already produces the standard format for every new row, triggered automatically after each cron sync.

No UI files need editing for listing surfaces — nav, filters, map, /stores, homepage all read from `getActiveStores()` (DB-first).

## Critical ordering — code deploys BEFORE the DB rows

Inserting the `stores` rows is what activates syncing (cron iterates `getActiveStores()`). If rows are inserted before the `FILTER_BY_BRAND` code deploys, the next hourly cron syncs **all** ~5,200 products unfiltered, and enrich burns attempts/OpenAI spend rejecting ~3,000 of them (rejected rows get `hidden=true, enrich_attempts=MAX` — polluting the DB).

So, inverting the usual schema-first rule (this is data, not schema — code doesn't break without the rows):

1. Merge + deploy the code changes (branch → PR → user merges → Vercel deploy).
2. **Then** insert the two `stores` rows via the Supabase SQL Editor (MCP is read-only per CLAUDE.md — the user runs the SQL, provide it ready to paste).
3. Next hourly GitHub-Actions cron picks the stores up automatically. Do **not** trigger `/api/cron` or `/api/enrich` locally (writes prod, spends OpenAI — CLAUDE.md invariant).

## Code changes (one branch)

### 1. `app/lib/shopifyFetch.js`
```js
export const FILTER_BY_BRAND = new Set([
  "dolcevitahub.com",
  "treviseparis.com",
  "chezsnowbunny.fr",
]);
```

### 2. `app/lib/stores.js` — append to `FALLBACK_STORES`
```js
  { domain: "treviseparis.com", storeName: "Trévise" },
  { domain: "chezsnowbunny.fr", storeName: "Chez Snow Bunny" },
```
(Fallback entries are intentionally minimal — domain + storeName only, matching the existing comment.)

### 3. `supabase/schema.sql` — append to the seed `INSERT` block (docs-only mirror, `ON CONFLICT DO NOTHING`)
```sql
  ('treviseparis.com',     'Trévise',            'Trévise',            'Oberkampf',              48.8631, 2.3682, true),
  ('chezsnowbunny.fr',     'Chez Snow Bunny',    'Chez Snow Bunny',    'Le Marais',              48.8654, 2.3621, true)
```

### 4. `app/components/ProductCard.js` — `SHORT_NAMES`
```js
    "Chez Snow Bunny": "Snow Bunny",
```
("Chez Snow Bunny" is as long as the names already shortened; Trévise needs no entry.)

**Not changed:** `app/brands.js` / `BRAND_ALIASES` (user decision), `SELF_BRANDED_STORES` (neither store's house label passes the allowlist, so the sync filter already excludes it), i18n messages (store strings come from the DB), any UI listing component.

## Production SQL (run in Supabase SQL Editor AFTER deploy)

Coordinates geocoded via Nominatim from the user-supplied addresses:
- Trévise — 9 Rue Oberkampf, 75011 Paris → `48.8631, 2.3682`
- Chez Snow Bunny — 12 Rue Dupetit-Thouars, 75003 Paris → `48.8654, 2.3621`

```sql
INSERT INTO stores (domain, store_name, display_name, location, lat, lng, active) VALUES
  ('treviseparis.com', 'Trévise',         'Trévise',         'Oberkampf', 48.8631, 2.3682, true),
  ('chezsnowbunny.fr', 'Chez Snow Bunny', 'Chez Snow Bunny', 'Le Marais', 48.8654, 2.3621, true)
ON CONFLICT (domain) DO NOTHING;
```

## Verification

**Pre-merge (localhost — read-path only, safe):**
1. `npm run build` (or `npm run lint` + existing test suite, incl. `app/lib/i18n/__tests__/messages.test.js`) passes.
2. Run dev server; before the DB insert exists, confirm nothing breaks: feed, nav, map render exactly as today (new stores absent — expected).
3. Unit-sanity the filter locally without hitting prod: node REPL importing `titleContainsAllowedBrand` against sample titles from both stores (e.g. "Roberto Cavalli Spring 2003 Silk Chinoiserie Set" → true; "Vintage Black Leather Trench" → false; "Levi's Blue Denim…" → false).

**Post-insert (production, after the next hourly cron):**
4. Check the cron summary / `enrich_runs` `per_store_synced`: expect roughly ~280 Trévise rows and a filtered subset (~1,900 of 4,795 total; ~40%) for Chez Snow Bunny — NOT the full catalogs.
5. Feed: filter by each new store — products appear; titles progressively standardized as the enrich drain completes (batches of 80 × up to 30 self-chain hops per cron run; expect full standardization within 1–2 cron cycles).
6. Nav (desktop StoresPanel + mobile menu): both stores listed; links carry `?store=` and keep other params (buildFreshFeedUrl).
7. Homepage map: two new pins at Oberkampf and Haut-Marais with correct tooltips; `/stores` page lists both with locations.
8. PDP for a new-store product: store name + location render (resolveProductDetail reads the `stores` row — this is why the row must exist before products are browsable).
9. Spot-check that no non-allowlisted brand (Levi's, Diesel, Blumarine…) appears when filtering either store.

**Expected one-time cost:** ~2,200 new rows enriched ⇒ ~2,200 `cleanTitle` OpenAI calls spread over the drain. Cron duration will grow (Chez Snow Bunny alone is 20 paginated fetches × 500 ms sleep ≈ +15–30 s) — watch it stays under `maxDuration = 300`.

## Out of scope
- Retro Chic (Wix — skipped entirely per user).
- Any allowlist/brand additions (per user).
- Wix connector work.
