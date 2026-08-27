# CLAUDE.md

**Dépôt** — curated Paris archive fashion. Hourly Shopify→Supabase sync; one
feed filtered by store, category (parent + leaf subcategory), brand, price,
search.

## Single sources of truth

- Product reads → `app/lib/productQueries.js` (visibility, row select, mapper,
  interleaved-RPC call shape); feed query composition →
  `app/lib/fetchProductsPage.js` (`/api/products` is a thin wrapper).
- Category taxonomy + `resolveCategoryFilter` + `CATEGORY_SLUG_TO_DB` →
  `app/lib/categories.js`. A category-filter change needs a parallel pass over
  the interleaved RPCs.
- Sort options → `app/lib/sort-options.js`. UI strings (en/fr, parity enforced
  by `app/lib/i18n/__tests__/messages.test.js`) → `app/lib/i18n/messages.js`.
- `MAX_ENRICH_ATTEMPTS` → `app/lib/enrichLimits.js`. Never re-declare it.

## Invariants

- **Every `available = true` read must also `.eq("hidden", false)`** via
  `withVisibility` (`productQueries.js`). `hidden` is `NOT NULL`; `.eq` excludes
  NULL, so a nullable drift leaks silently. It and the carve-out below both drop
  the literal `'€0.00'` (NOT-FOR-SALE stock); NULL price stays visible — unknown,
  not unsellable. **Carve-out:** `withCuratedVisibility` filters `hidden` only,
  keeping SOLD pieces under an overlay for editorial/archive reads. Don't
  consolidate (drops sold) or reuse elsewhere (leaks sold into the feed).
- **The zero-price predicate is duplicated in BOTH interleaved RPCs.** Redefining
  only `get` leaves it returning rows `count` omits — understating totals and
  stranding the feed's tail beyond reachable pages.
- **Editorial fields (`brand`/`title`/`category`/`subcategory`) write only if
  NULL** — cron's Step-2 upsert + `enrich_product`'s COALESCE (SQL below). A
  plain `UPDATE` reintroduces the clobber race.
- **`era_year` is DERIVED, not editorial** — a deterministic parse
  (`parseEra.js`), plainly overwritten by every writer. Keep it out of cron's
  `editorialRows` (the COALESCE-protected surface) and out of Step 1's `syncRows`
  (name-only batch → a title-derived value gets clobbered hourly). `/api/enrich`
  re-reads the *persisted* title after the RPC, never its own candidate: the
  COALESCE may have kept a concurrent run's title.
- **Cron stale-delete is scoped to `successfulDomains`, never global.** A domain
  is added only when sync returned `count > 0`; `fetchStoreProducts` must throw
  on non-200 AND on 200-with-malformed `products` — a silent truncated return
  feeds the scoped delete bad data.
- **Brand-from-handle fallback stays deterministic** — regex against the curated
  allowlist only; never prompt the model with the handle (hallucinated brand →
  passes allowlist → invisible bad data).
- **Enrich's batch SELECT and its remaining-count query must carry identical
  filters** — a mismatch pins `remaining > 0`, burning all 30 hops on no-ops.
- **PostgREST reads:** chunk handle lists through `chunkArray`
  (`app/lib/chunk.js`, size 100) or long-handle stores blow past the URL limit;
  double-quote any `.or()` value containing `, . : ( )` or whitespace via
  `escapePostgrestValue` (`fetchProductsPage.js`; `search-products` has an
  inline equivalent). Unwrapped, `"vivienne westwood"` returns nothing and
  `"Dresses, Skirts & Robes"` 400s.
- **Price is stored as TEXT** (`'€29.99'`, EUR) — the canonical base; conversion
  is presentational, never written back. DB ordering on it is lexicographic, so
  price sorts order and paginate on **`price_cents`**, a STORED GENERATED INT
  parsed from `price` (`scripts/sql/2026-08-17-price-cents.sql`). It is
  DB-derived, never authored: Postgres rejects direct writes, so no writer may
  include it in a payload. Unparseable/NULL price → NULL `price_cents` → sorts
  last via `nullsFirst: false`, still visible.
- **Filter submits are additive.** `buildFeedUrl(searchParams, {…})` merges
  (feed actions), `buildFreshFeedUrl` discards (nav menu / store links); a raw
  `router.push('/feed?search=…')` wipes every other param. `MobileFilterPanel`
  buffers drafts and commits one push — per-dimension pushes revive the
  RESET→APPLY race.
- **Language-aware taxonomy/sort accessors default to `"en"` silently.**
  `getFilterGroups`, `getNavTopLevel`, `getSubcategoriesByShortKey` and
  `getSortOptions` take `lang`; a consumer that forgets to thread it renders
  English on toggle — no error, and the parity test checks only message keys.
- **Featured-archive membership is brand + era window (+ attribution tokens).**
  `BRAND_ALIASES` folds designer tenure at write time ("Dior Homme" → "DIOR"),
  so brand + years alone files Galliano womenswear under Slimane. Archive reads
  throw on any Supabase error by design: `unstable_cache` won't cache a throw,
  but WOULD cache a partial archive for an hour.
- **Never `import` `content/homepage-edit.json` statically** —
  `loadHomepagePicks.js` reads it via `fs.readFile` in try/catch so a syntax
  error degrades to the date-seeded rotation instead of crashing the homepage.
- **Daily inventory snapshot gates on the `inventory_snapshot_days` ledger,
  never on "rows exist for today"** — a failed partial capture writes no ledger
  row, so the next hourly run backfills idempotently. It runs in `/api/cron`
  **after** the stale-delete; reordering silently corrupts departure history,
  which is append-only and cannot be recomputed.
- **The archiver deletes only frozen, verified id sets** — remote count == local
  count > 0, a `day_manifest` row, and a successful `archive_day_registry`
  upsert; the delete set is local ids `<= manifest.max_id`, never a date
  predicate. Any continuity violation aborts nonzero **before** anything
  verifies, deletes, or rebuilds. Deletion needs `--prune`; default is mirror-only.

## DB objects not in git

Live only in Supabase. Confirm the full column list against production before
any change.

- **`enrich_product(p_handle, p_store_domain, p_brand, p_title, p_category,
  p_subcategory)` RPC** — the COALESCE write enforcing editorial protection. Its
  `subcategory` write is parent-gated: an unguarded
  `COALESCE(subcategory, p_subcategory)` trips the CHECK below when the
  classifier's leaf parent disagrees with the row's category, burning retries.
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
- **`increment_description_attempts(p_ids BIGINT[])` /
  `decrement_description_attempts(p_ids BIGINT[])` RPCs** — claim-by-increment
  for `/api/backfill-descriptions`, issued BEFORE any OpenAI call. The
  increment is a soft claim: it doesn't exclude rows from re-selection
  (attempts=1 still passes `< 3`) — the route's attempts-ASC-first ordering is
  what steers an overlapping run onto a different batch, so keep that ordering
  and this increment together (the only-if-NULL write guard stops duplicate
  writes, not duplicate calls). The decrement releases rows the 240s deadline
  stranded before any call was made, so they don't burn toward `MAX_ATTEMPTS`
  untried. Needs `description_attempts INT NOT NULL DEFAULT 0`. DDL:
  [`scripts/sql/2026-08-17-description-attempts.sql`](scripts/sql/2026-08-17-description-attempts.sql).
- **`increment_enrich_attempts` RPC** — `enrich_attempts = enrich_attempts + 1`
  WHERE handle + store_domain. Needs `enrich_attempts INT NOT NULL DEFAULT 0`.
- **`get_interleaved_products` / `count_interleaved_products` RPCs** — take
  `p_store`, `p_category` (comma-joined), `p_subcategory`, `p_search`,
  `p_brand`, plus paging on `get`. `get` must return `name`: `ProductCard`
  falls back to it when `title` is null.
- **`products_subcategory_matches_category` CHECK** — ties each subcategory to
  one category (`subcategory='jackets'` only under `category='Jackets & Coats'`).
- **`enrich_runs` table** — token-spend telemetry; insert failures are swallowed
  by routes. DDL: [`docs/enrich-runs-logging-spec.md`](docs/enrich-runs-logging-spec.md).
- **`archive_day_registry` table** — durable REMOTE witness for the local
  inventory archive, written before a day is pruned and never pruned itself. It
  is the only proof a pruned ORPHAN day (rows with no ledger entry) existed, so
  the archiver enumerates required days from the registry ∪
  `inventory_snapshot_days`. DDL:
  [`scripts/sql/2026-07-26-archive-day-registry.sql`](scripts/sql/2026-07-26-archive-day-registry.sql).
- **`mv_product_lifecycle` / `mv_daily_flow` MVs + `refresh_inventory_insights()`
  + pg_cron `refresh-inventory-insights`** — the insights `v_*` views are thin
  wrappers, refreshed hourly. Never re-inline the lifecycle SQL: the raw query
  takes 25s+ against the 8s REST cap. DDL:
  [`scripts/sql/2026-07-03-inventory-insights-mv.sql`](scripts/sql/2026-07-03-inventory-insights-mv.sql).

## Sharp edges

- **Every PostgREST read runs under `authenticator`'s `statement_timeout = 8s`
  (anon key: 3s) — service_role does not bypass it.** Anything that can grow
  past 8s must be precomputed or moved off the REST path.
- **Brand filter is `ILIKE` substring, not equality.** Only the interleaved RPC
  `unaccent`s, so accent-folding holds on the default feed but not once an
  explicit sort switches to the direct-query branch.
- **dot COMME** uses `/collections/paris/products.json`, not `/products.json`.
- **`MoreFromStore` queries Supabase directly** to dodge `NEXT_PUBLIC_BASE_URL`
  ambiguity on preview. Don't consolidate back to HTTP.
- **Adding a currency touches four sites:** `currency.js`, `CurrencyProvider.js`,
  `layout.js`, `fx.js`'s rate parse. Cron refreshes `fx_rates` hourly, degrading
  to `FALLBACK_RATES`.
- **Nav heights are coupled.** `--nav-height: 56px` (`globals.css`) must match
  `h-[56px]` on desktop nav; mobile stays `h-[50px]`.
- **`overflow-x-hidden` promotes `overflow-y` to auto**, creating a scrolling
  ancestor that breaks `position: sticky` descendants. Use `overflow-x-clip`.
- **Font variables are two-layer:** `next/font/local` exposes `--font-satoshi` /
  `--font-general-sans`; `@theme inline` maps Tailwind's font tokens onto them
  (dropping `inline` fails silently). Raw-HTML injection (Leaflet in
  `ParisMap.js`) must reference the next/font variable directly.
- **Admin is local-only** — `/admin/*` and `/api/admin/*` 404 in production via
  `middleware.js`; publish-to-preview refuses when `HEAD == main` unless
  `{ newSession: true }`. Admin routes read editorial modules with `fs.readFile`
  + `new Function`, not `import()` (which cached stale modules in dev).
- **`loadSource` defaults to `allowFiles: false`.** Never pass `true` from an
  HTTP route: request-controlled paths could read `.env.local` and exfiltrate it
  through the OpenAI prompt.

## Workflow

- **Do not push directly to `main`.** Branch every change; merge only after
  explicit user instruction.
- **Verify on localhost, Claude preview, or Vercel.** All three hit the single
  production Supabase (no dev DB), so read-path UI checks are safe but **never
  trigger `/api/cron` or `/api/enrich` locally** — they write prod rows and spend
  OpenAI. `maxDuration = 300` on both; lowering it breaks the enrich drain.
- **Two read-only health probes, bearer-`CRON_SECRET`, polled by GitHub Actions.**
  `/api/health/enrich` (`enrich-health.yml`) alarms when OpenAI goes quiet — a
  red job IS the alert. `/api/health/formatting` (`formatting-audit.yml`) files
  findings into ONE permanently open issue labelled `formatting-audit`; there a
  red job means the *check* broke, and only a fingerprint change emails. Neither
  writes; both are safe locally.
  - **Fingerprint before truncation, over `(key, id)` tuples** — hashing the
    display-capped list hides changes past the cap; hashing bare ids misses an
    item swapping violation class. The field *value* is excluded on purpose.
  - The scan pages by **keyset** (`.gt("id", lastId)`), not `.range()`:
    `/api/enrich` flips `hidden` mid-scan, which would shift every later offset
    and silently drop a row.
- Schema/RPC changes apply to Supabase **before** dependent code merges.
- Manual SQL routes through the Supabase SQL Editor — MCP is read-only. Snapshot
  before destructive runs.

## Environment variables

Standard: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`.

- `NEXT_PUBLIC_BASE_URL` — defaults to `http://localhost:3000`.
- `NEXT_PUBLIC_CARTO_BASEMAPS_KEY` — free-tier CARTO basemaps key (`ParisMap.js`);
  unset degrades to keyless tiles stamped "API KEY REQUIRED", never breaks the map.
- `DEPOT_ARCHIVE_DB` — laptop-only path to the local inventory archive. When set,
  `/admin/inventory` reads full local history via
  `inventoryArchive/localReaders.js`; unset (Vercel), it reads Supabase and never
  loads `node:sqlite`.
- `CRON_SECRET` — bearer for `/api/cron`, `/api/enrich`, both `/api/health/*`;
  also a GitHub Actions repo secret.
- `ENRICH_HEALTH_URL` / `FORMATTING_HEALTH_URL` — GitHub Actions repo
  *variables* (not app env). Unset = the job fails loudly.
- `VERCEL_AUTOMATION_BYPASS_SECRET` — auto-injected by Vercel; lets cron
  self-fetch bypass Deployment Protection on previews.
