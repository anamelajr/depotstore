# Add Trévise & Chez Snow Bunny to the Dépôt feed

## Context

The user wants two new Paris stores added smoothly to Dépôt — feed, nav menu, filters, map, /stores page — with product titles standardized into the existing format (ALL-CAPS brand + short Title-Case title). A third store, **Retro Chic, is explicitly skipped** (user decision): it runs on Wix, has no `products.json`, and cannot be synced.

Verified facts (checked live during planning, 2026-07-26):

| Store | Domain | Platform | Catalog | Available | Will sync (dry-run) | Enrich load (synced ∩ available) |
|---|---|---|---|---|---|---|
| Trévise | `treviseparis.com` | Shopify ✓ (`/products.json` at root) | 426 products | 284 | 369 | 245 |
| Chez Snow Bunny | `chezsnowbunny.fr` | Shopify ✓ (`/products.json` at root) | 4,795 products | 1,986 | 2,094 | 768 |

"Will sync" numbers come from a full-catalog dry run of the exact `FILTER_BY_BRAND` predicate (`isAllowedBrand(vendor) || titleContainsAllowedBrand(title)`) executed against both live catalogs during planning.

**Curation decision (user):** allowlist stays untouched — only brands already in `app/brands.js` (plus `BRAND_ALIASES`) enter the feed. Chez Snow Bunny is only ~40% designer archive; the rest (Levi's, Diesel, Miss Sixty, Benetton, Cop Copine, Ralph Lauren, unbranded "Vintage…" pieces, their "SB" house label) must never enter the DB. Trévise also carries some non-allowlisted labels (Blumarine, Chloé, Plein Sud, Christian Lacroix, Emanuel Ungaro, Romeo Gigli, Lolita Lempicka, Alberta Ferretti, Moschino, Paco Rabanne, La Perla).

The mechanism already exists: `FILTER_BY_BRAND` in [app/lib/shopifyFetch.js:9](app/lib/shopifyFetch.js) drops products at sync time unless (existing curated brand row) OR (vendor is allowlisted) OR (`titleContainsAllowedBrand(name)`). Both stores put brand names in product titles, so the title check works for both. **Both new domains go into this set** — non-matching products are dropped at sync time and spend no OpenAI tokens.

**Known imprecision (measured, accepted):** `titleContainsAllowedBrand` is substring-based, and `app/lib/brand.js` explicitly documents that short brands collide inside longer words ("ami" ⊂ "camisole") — and warns that widening this shared matcher would change dolcevitahub's shipped write-path, so we do NOT touch it. The full-catalog dry run measured the actual leak: **0 false positives at Trévise, exactly 20 at Chez Snow Bunny** (families: "JustCavalli…" ⊃ cavalli ×8, "Nara Camicie…" ⊃ ami ×7, "Fendissime…" ⊃ fendi ×4, "Murakami…" ⊃ ami ×1). These 20 rows will sync, appear briefly with raw titles, cost one `cleanTitle` call each, then be rejected by `isAllowedBrand` at enrich and hidden (`hidden=true, enrich_attempts=MAX`) — the standard self-healing path. This is why the invariant is "curated at sync, guaranteed at enrich", not "never enters the DB".

Title standardization needs **no new work**: `/api/enrich` → `cleanTitle.js` already produces the standard format for every new row, triggered automatically after each cron sync.

No UI files need editing for listing surfaces — nav, filters, map, /stores, homepage all read from `getActiveStores()` (DB-first).

## Critical ordering — code deploys BEFORE the DB rows

Inserting the `stores` rows is what activates syncing (cron iterates `getActiveStores()`). If rows are inserted before the `FILTER_BY_BRAND` code deploys, the next hourly cron syncs **all** ~5,200 products unfiltered, and enrich burns attempts/OpenAI spend rejecting ~3,000 of them (rejected rows get `hidden=true, enrich_attempts=MAX` — polluting the DB).

So, inverting the usual schema-first rule (this is data, not schema — code doesn't break without the rows):

1. Merge + deploy the code changes **except the `FALLBACK_STORES` entries** (branch → PR → user merges → Vercel deploy). The fallback entries ship in a follow-up commit only after both stores are activated and verified — see change 2 below for why.
2. **Then** insert the `stores` rows via the Supabase SQL Editor (MCP is read-only per CLAUDE.md — the user runs the SQL, provide it ready to paste), **staggered**: insert Trévise first, verify its sync + enrich drain over the next cron cycle, then insert Chez Snow Bunny. `/api/enrich` has no run lease or row lock — two overlapping drains can select the same batch and double-spend OpenAI calls. Staggering keeps each drain small (245 rows, then 768) so it completes well inside one hourly cycle; a lease is deliberately out of scope for a one-time backfill this size.
3. Next hourly GitHub-Actions cron picks the stores up automatically. Do **not** trigger `/api/cron` or `/api/enrich` locally (writes prod, spends OpenAI — CLAUDE.md invariant).

**Rollback ordering (the mirror rule):** if the code deploy is ever reverted while the store rows are active, cron still discovers both domains from the DB but without the `FILTER_BY_BRAND` entries — the next hourly run imports both full catalogs unfiltered. Note that deactivating a store row only removes it from nav/map/filters/sync — product reads (`productQueries.js`) never join `stores.active`, so already-imported products would stay in the global feed and remain reachable via `?store=` links and PDP URLs. Full rollback therefore runs in this order:

1. `UPDATE stores SET active = false WHERE domain IN ('treviseparis.com','chezsnowbunny.fr');`
2. `UPDATE products SET hidden = true WHERE store_domain IN ('treviseparis.com','chezsnowbunny.fr');` — hidden, not deleted, matching the codebase's hide-don't-delete convention. (Snapshot before running, per CLAUDE.md.) **Reversing this rollback must NOT be a blanket `hidden = false`:** some rows in these domains are policy-hidden by the enrich pipeline (`hidden = true, enrich_attempts = MAX` — e.g. the 20 substring false positives) and must stay hidden. Restore with `UPDATE products SET hidden = false WHERE store_domain IN (…) AND enrich_attempts < 3;` — pipeline-rejected rows all carry `enrich_attempts = MAX`, so the attempts guard preserves them.
3. Verify: the global feed and a direct `?store=` filter return none of these products; next cron summary no longer lists the domains.
4. Revert the code (including removing the two domains from `FALLBACK_STORES` if the follow-up commit already shipped).

## Code changes (one branch)

### 1. `app/lib/shopifyFetch.js`
```js
export const FILTER_BY_BRAND = new Set([
  "dolcevitahub.com",
  "treviseparis.com",
  "chezsnowbunny.fr",
]);
```

### 2. `app/lib/stores.js` — append to `FALLBACK_STORES` (**follow-up commit, AFTER both stores are activated and verified**)
```js
  { domain: "treviseparis.com", storeName: "Trévise" },
  { domain: "chezsnowbunny.fr", storeName: "Chez Snow Bunny" },
```
(Fallback entries are intentionally minimal — domain + storeName only, matching the existing comment.)

**Why deferred:** `getActiveStores()` returns the entire `FALLBACK_STORES` list whenever the Supabase `stores` read fails. If the new domains were in the fallback before their DB rows exist, a transient read error during cron would sync them early — bypassing the staggered activation and producing feed products whose PDPs 404 (PDP requires the `stores` row). The fallback list must only ever contain stores that are already live. For the same reason, a rollback that deactivates the DB rows must also remove these fallback entries (see Rollback ordering).

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

`ON CONFLICT … DO UPDATE SET active = true` (not `DO NOTHING`) so re-running after a rollback — which retains the row with `active = false` — actually reactivates it instead of silently no-opping. Confirm the statement reports `INSERT 0 1` / check `active = true` afterwards.

Step 1 — Trévise first:
```sql
INSERT INTO stores (domain, store_name, display_name, location, lat, lng, active) VALUES
  ('treviseparis.com', 'Trévise', 'Trévise', 'Oberkampf', 48.8631, 2.3682, true)
ON CONFLICT (domain) DO UPDATE SET active = true;
```

Step 2 — after the next cron cycle verifies Trévise (see Verification), Chez Snow Bunny:
```sql
INSERT INTO stores (domain, store_name, display_name, location, lat, lng, active) VALUES
  ('chezsnowbunny.fr', 'Chez Snow Bunny', 'Chez Snow Bunny', 'Le Marais', 48.8654, 2.3621, true)
ON CONFLICT (domain) DO UPDATE SET active = true;
```

## Verification

**Pre-merge (localhost — read-path only, safe):**
1. `npm run build` (or `npm run lint` + existing test suite, incl. `app/lib/i18n/__tests__/messages.test.js`) passes.
2. Run dev server; before the DB insert exists, confirm nothing breaks: feed, nav, map render exactly as today (new stores absent — expected).
3. Unit-sanity the filter locally without hitting prod: node REPL importing `titleContainsAllowedBrand` against sample titles from both stores (e.g. "Roberto Cavalli Spring 2003 Silk Chinoiserie Set" → true; "Vintage Black Leather Trench" → false; "Levi's Blue Denim…" → false).

**Post-insert (production, after the next hourly cron):**
4. Check the cron summary / `enrich_runs` `per_store_synced`: expect ~369 Trévise rows, then ~2,094 for Chez Snow Bunny once activated — NOT the full catalogs (426 / 4,795). Numbers materially above the dry-run figures mean the filter isn't active — deactivate the row and investigate.
5. Feed: filter by each new store — products appear; titles progressively standardized as the enrich drain completes (batches of 80 × up to 30 self-chain hops per cron run; expect full standardization within 1–2 cron cycles).
6. Nav (desktop StoresPanel + mobile menu): both stores listed; links carry `?store=` and keep other params (buildFreshFeedUrl).
7. Homepage map: two new pins at Oberkampf and Haut-Marais with correct tooltips; `/stores` page lists both with locations.
8. PDP for a new-store product: store name + location render (resolveProductDetail reads the `stores` row — this is why the row must exist before products are browsable).
9. Spot-check that no non-allowlisted brand (Levi's, Diesel, Blumarine…) appears when filtering either store.

**Expected one-time cost:** ~1,013 available rows enriched (245 Trévise + 768 Chez Snow Bunny) ⇒ ~1,013 `cleanTitle` OpenAI calls, plus ~20 wasted calls on the known substring false positives. Cron duration will grow (Chez Snow Bunny alone is 20 paginated fetches × 500 ms sleep ≈ +15–30 s) — watch it stays under `maxDuration = 300`.

## Out of scope
- Retro Chic (Wix — skipped entirely per user).
- Any allowlist/brand additions (per user).
- Wix connector work.
