# CLAUDE.md

**Dépôt** — curated Paris archive fashion. Hourly Shopify→Supabase sync; one
feed filtered by store, category (parent + leaf subcategory), brand, price,
search.

## Single sources of truth

- Product reads → `app/lib/productQueries.js`; feed query composition →
  `app/lib/fetchProductsPage.js` (`/api/products` is a thin wrapper).
- Category taxonomy + `resolveCategoryFilter` + `CATEGORY_SLUG_TO_DB` →
  `app/lib/categories.js`. A category-filter change needs a parallel pass over
  the interleaved RPCs.
- Sort options → `app/lib/sort-options.js`. UI strings (en/fr, parity-tested) →
  `app/lib/i18n/messages.js`.
- `MAX_ENRICH_ATTEMPTS` → `app/lib/enrichLimits.js`. Never re-declare it.
- Map camera/style → `app/lib/mapView.js`, shared by `ParisMap.js`,
  `MapSnapshot.js`, and `scripts/generate-map-snapshot.mjs`. Changing it means
  regenerating `public/paris-map-snapshot.webp`.

## Invariants

- **Every `available = true` read must also `.eq("hidden", false)`** via
  `withVisibility` (`productQueries.js`) — `hidden` is NOT NULL and `.eq`
  excludes NULL, so nullable drift leaks silently. **Carve-out:**
  `withCuratedVisibility` filters `hidden` only, keeping SOLD pieces for
  editorial/archive reads. Don't consolidate (drops sold) or reuse elsewhere
  (leaks sold into the feed).
- **The zero-price predicate is duplicated in BOTH interleaved RPCs.** Redefining
  only `get` returns rows `count` omits — understated totals, stranded tail.
- **Editorial fields (`brand`/`title`/`category`/`subcategory`) write only if
  NULL** — cron's Step-2 upsert + `enrich_product`'s COALESCE. A plain `UPDATE`
  reintroduces the clobber race.
- **`era_year` is DERIVED (`parseEra.js`), not editorial** — plainly overwritten
  by every writer. Keep it out of cron's `editorialRows` and Step 1's
  `syncRows`; `/api/enrich` re-reads the *persisted* title after the RPC, never
  its own candidate.
- **Cron stale-delete is scoped to `successfulDomains`, never global.**
  `fetchStoreProducts` must throw on non-200 AND on 200-with-malformed
  `products` — a silent truncated return feeds the scoped delete bad data.
- **Brand-from-handle fallback stays deterministic** — regex against the curated
  allowlist only; never prompt the model with the handle.
- **Enrich's batch SELECT and its remaining-count query must carry identical
  filters** — a mismatch pins `remaining > 0`, burning all 30 hops on no-ops.
- **PostgREST reads:** chunk handle lists via `chunkArray` (size 100) or long
  stores blow the URL limit; wrap `.or()` values containing `, . : ( )` or
  whitespace with `escapePostgrestValue` (`fetchProductsPage.js`) — unwrapped,
  they silently match nothing or 400.
- **Price is TEXT** (`'€29.99'`, EUR) — the canonical base; conversion is
  presentational, never written back. Price sorts order and paginate on
  **`price_cents`**, a STORED GENERATED INT — Postgres rejects direct writes,
  so no writer may include it in a payload. NULL price → NULL `price_cents` →
  sorts last, still visible.
- **Filter submits are additive.** `buildFeedUrl` merges, `buildFreshFeedUrl`
  discards; a raw `router.push('/feed?…')` wipes every other param.
  `MobileFilterPanel` commits ONE push — per-dimension pushes revive the
  RESET→APPLY race.
- **Language-aware accessors (`getFilterGroups`, `getNavTopLevel`,
  `getSubcategoriesByShortKey`, `getSortOptions`) default to `"en"` silently** —
  an unthreaded `lang` renders English on toggle with no error.
- **Featured-archive membership is brand + era window (+ attribution tokens).**
  `BRAND_ALIASES` folds designer tenure at write time, so brand + years alone
  misattributes designers. Archive reads throw on any Supabase error by design:
  `unstable_cache` would cache a partial archive for an hour.
- **Never `import` `content/homepage-edit.json` statically** —
  `loadHomepagePicks.js` uses `fs.readFile` so a syntax error degrades to the
  rotation instead of crashing the homepage.
- **Daily inventory snapshot gates on the `inventory_snapshot_days` ledger,
  never on "rows exist for today"** — failed partials backfill idempotently. It
  runs **after** cron's stale-delete; reordering silently corrupts the
  append-only departure history.
- **The archiver deletes only frozen, verified id sets** (remote count == local
  count > 0, a `day_manifest` row, a successful `archive_day_registry` upsert);
  the delete set is ids `<= manifest.max_id`, never a date predicate. Any
  continuity violation aborts nonzero before anything mutates. Deletion needs
  `--prune`; default is mirror-only.

## DB objects not in git

Live only in Supabase. Confirm the full column list against production before
any change.

- **`enrich_product(p_handle, p_store_domain, p_brand, p_title, p_category,
  p_subcategory)` RPC** — the COALESCE write. Its `subcategory` write is
  parent-gated: an unguarded COALESCE trips the CHECK below, burning retries.
  ```sql
  UPDATE products SET
    brand       = COALESCE(brand,    p_brand),
    title       = COALESCE(title,    p_title),
    category    = COALESCE(category, p_category),
    subcategory = CASE
      WHEN COALESCE(category, p_category) = p_category
        THEN COALESCE(subcategory, p_subcategory)
      ELSE subcategory
    END
  WHERE handle = p_handle AND store_domain = p_store_domain;
  ```
- **`increment_description_attempts` / `decrement_description_attempts`
  (`p_ids BIGINT[]`) RPCs** — claim-by-increment for
  `/api/backfill-descriptions`, issued BEFORE any OpenAI call. The increment is
  a soft claim; the route's attempts-ASC-first ordering is what steers
  overlapping runs onto different batches — keep the two together. The
  decrement releases rows the 240s deadline stranded before any call. DDL:
  [`scripts/sql/2026-08-17-description-attempts.sql`](scripts/sql/2026-08-17-description-attempts.sql).
- **`increment_enrich_attempts` RPC** — `enrich_attempts + 1` WHERE handle +
  store_domain.
- **`get_interleaved_products` / `count_interleaved_products` RPCs** — take
  `p_store`, `p_category` (comma-joined), `p_subcategory`, `p_search`,
  `p_brand`, plus paging on `get`. `get` must return `name`: `ProductCard`
  falls back to it when `title` is null.
- **`products_subcategory_matches_category` CHECK** — ties each subcategory to
  one category.
- **`enrich_runs` table** — token-spend telemetry; insert failures swallowed by
  routes. DDL: [`docs/enrich-runs-logging-spec.md`](docs/enrich-runs-logging-spec.md).
- **`archive_day_registry` table** — durable REMOTE witness for the local
  archive, written before a day is pruned, never pruned itself; the archiver
  enumerates required days from registry ∪ `inventory_snapshot_days`. DDL:
  [`scripts/sql/2026-07-26-archive-day-registry.sql`](scripts/sql/2026-07-26-archive-day-registry.sql).
- **`mv_product_lifecycle` / `mv_daily_flow` MVs + `refresh_inventory_insights()`
  + pg_cron `refresh-inventory-insights`** — the insights `v_*` views are thin
  wrappers, refreshed hourly. Never re-inline the lifecycle SQL: it takes 25s+
  against the 8s REST cap. DDL:
  [`scripts/sql/2026-07-03-inventory-insights-mv.sql`](scripts/sql/2026-07-03-inventory-insights-mv.sql).

## Sharp edges

- **Every PostgREST read runs under `authenticator`'s `statement_timeout = 8s`
  (anon key: 3s) — service_role does not bypass it.** Anything that can grow
  past 8s must be precomputed or moved off the REST path.
- **Root-layout cold-miss reads are double-bounded:** 4s internal aborts in
  `stores.js`/`fx.js`, a deliberately later 6s race in `layout.js`; fallbacks
  fire only on throw so they're never cached. Removing either layer restores
  the sitewide document stall.
- **Brand filter is `ILIKE` substring, not equality.** Only the interleaved RPC
  `unaccent`s, so accent-folding drops once an explicit sort switches to the
  direct-query branch.
- **`MoreFromStore` queries Supabase directly** to dodge `NEXT_PUBLIC_BASE_URL`
  ambiguity on preview. Don't consolidate back to HTTP.
- **Adding a currency touches four sites:** `currency.js`, `CurrencyProvider.js`,
  `layout.js`, `fx.js`'s rate parse.
- **Nav heights are coupled.** `--nav-height: 56px` (`globals.css`) must match
  `h-[56px]` on desktop nav; mobile stays `h-[50px]`.
- **`overflow-x-hidden` promotes `overflow-y` to auto**, creating a scrolling
  ancestor that breaks `position: sticky` descendants. Use `overflow-x-clip`.
- **Font variables are two-layer:** `next/font/local` exposes `--font-satoshi` /
  `--font-general-sans`; `@theme inline` maps Tailwind's tokens onto them
  (dropping `inline` fails silently). DOM injected outside React (MapLibre
  popup/zoom control in `ParisMap.js`) must reference the next/font variable.
- **The live map layer stays `opacity:0` + `pointer-events:none` until MapLibre
  fires "load"** (a 12s fallback tears it down to the snapshot) — never
  transparent-but-interactive over the snapshot. The occluded snapshot layer
  must be `inert`: `aria-hidden` alone leaves its links in tab order.
- **Admin is local-only** — `/admin/*` and `/api/admin/*` 404 in production via
  `middleware.js`; publish-to-preview refuses when `HEAD == main` unless
  `{ newSession: true }`. Admin routes read editorial modules with `fs.readFile`
  + `new Function`, not `import()` (which cached stale modules in dev).
- **`loadSource` defaults to `allowFiles: false`.** Never pass `true` from an
  HTTP route: request-controlled paths could read `.env.local` and exfiltrate
  it through the OpenAI prompt.

## Workflow

- **Do not push directly to `main`.** Branch every change; merge only after
  explicit user instruction.
- **Verify on localhost, Claude preview, or Vercel.** All three hit the single
  production Supabase (no dev DB), so read-path UI checks are safe but **never
  trigger `/api/cron` or `/api/enrich` locally** — they write prod rows and
  spend OpenAI. `maxDuration = 300` on both; lowering it breaks the enrich
  drain.
- **Two read-only health probes, bearer-`CRON_SECRET`, polled by GitHub
  Actions.** `/api/health/enrich` (`enrich-health.yml`): a red job IS the
  alert. `/api/health/formatting` (`formatting-audit.yml`) files findings into
  ONE open issue labelled `formatting-audit`; there a red job means the *check*
  broke, and only a fingerprint change emails. Neither writes; both are safe
  locally.
- Schema/RPC changes apply to Supabase **before** dependent code merges.
- Manual SQL routes through the Supabase SQL Editor — MCP is read-only.
  Snapshot before destructive runs.

## Environment variables

Standard: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`.

- `NEXT_PUBLIC_BASE_URL` — defaults to `http://localhost:3000`.
- `NEXT_PUBLIC_CARTO_BASEMAPS_KEY` — CARTO basemaps key. When set, a
  `transformRequest` appends `?key=` to every `basemaps.cartocdn.com` request —
  the style URL alone would never reach the tiles. Unset, the live map renders
  keyless, but `generate-map-snapshot.mjs` refuses to run: keyless tiles may be
  watermarked and must never be checked in.
- `DEPOT_ARCHIVE_DB` — laptop-only path to the local inventory archive; when
  set, `/admin/inventory` reads local history, else Supabase (never loads
  `node:sqlite` on Vercel).
- `CRON_SECRET` — bearer for `/api/cron`, `/api/enrich`, both `/api/health/*`;
  also a GitHub Actions repo secret.
- `ENRICH_HEALTH_URL` / `FORMATTING_HEALTH_URL` — GitHub Actions repo
  *variables* (not app env). Unset = the job fails loudly.
- `VERCEL_AUTOMATION_BYPASS_SECRET` — auto-injected by Vercel; lets cron
  self-fetch bypass Deployment Protection on previews.
