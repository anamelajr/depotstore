# CLAUDE.md

**Dépôt** — curated Paris archive fashion. Hourly Shopify→Supabase sync;
unified feed filtered by store, category (parent + leaf subcategory), brand,
price, search.

## Before editing

Product-read changes compose `app/lib/productQueries.js` (visibility filter,
row select + mapper, interleaved-RPC call shape). Category-filter changes also
need a parallel pass over the interleaved RPCs + `resolveCategoryFilter`
(`app/lib/categories.js`).

## Invariants

- **Editorial fields (`brand`/`title`/`category`/`subcategory`) write only if
  NULL** — cron's Step-2 upsert + `enrich_product`'s COALESCE; a plain `UPDATE`
  reintroduces the clobber race. The `subcategory` write is parent-gated in the
  RPC (SQL below): an unguarded `COALESCE(subcategory, p_subcategory)` trips
  `products_subcategory_matches_category` when the classifier's leaf parent
  disagrees with the row's category, silently burning enrich retries.
- **`cleanTitle.js`'s `null` is retryable** — covers transient OpenAI failures
  as well as unclassifiable rows; treat as transient, not terminal.
- **Brand-from-handle fallback stays deterministic** — regex against the curated
  allowlist only; never prompt the model with the handle (hallucinated brand →
  passes allowlist → invisible bad data).
- **Cron stale-delete is scoped to `successfulDomains`, never global.** A domain
  is added only when sync returned `count > 0`; `fetchStoreProducts` must throw
  on non-200 AND on 200-with-malformed `products` — a silent truncated return
  feeds the scoped delete bad data.
- **PostgREST IN queries on handle lists must use `chunkArray`**
  (`app/lib/chunk.js`, size 100) — long-handle stores blow past the URL limit.
- **PostgREST `.or()` values with `, . : ( )` or whitespace must be
  double-quoted** (escape any embedded `"`). Unwrapped, those split the filter
  into tokens — `"vivienne westwood"` returns nothing, `"Dresses, Skirts &
  Robes"` 400s. Use `escapePostgrestValue` (`/api/products/route.js`);
  `search-products` has an inline equivalent.
- **Enrich batch SELECT and remaining-count query must carry identical
  filters.** Both share `withVisibility`; the drift risk is the hand-replicated
  `enrich_attempts < MAX` + `brand|title|category IS NULL`. A mismatch pins
  `remaining > 0` forever, burning all 30 self-chain hops on no-ops.
- **Self-branded store hide gates are asymmetric.** For `SELF_BRANDED_STORES`,
  `/api/enrich` hides immediately on the success branch but on the null branch
  only at retry exhaustion — hiding on first null would kill legitimate-brand
  rows on one transient OpenAI failure.
- **Allowlist-rejected rows are hidden, not deleted** —
  `update({ hidden: true, enrich_attempts: MAX })` scoped to `row.id`.
  `delete()` reintroduces the sync-recreate / enrich-rereject loop that once
  dominated OpenAI spend.
- **Every `available = true` read must also `.eq("hidden", false)`** via
  `withVisibility` (`productQueries.js`). `hidden` is `NOT NULL`; `.eq` excludes
  NULL, so a nullable drift leaks silently. **Carve-out:**
  `withCuratedVisibility` (same file) filters `hidden = false` only — editorial
  reads keep SOLD (`available = false`) pieces under an overlay; don't
  consolidate (drops sold) or reuse elsewhere (leaks sold into feed).
- **`get_interleaved_products` RPC must return `name`** — `ProductCard` falls
  back to it when `title` is null.
- **Price is stored as TEXT** (`'€29.99'`, EUR) — the canonical sorted base;
  currency conversion is presentational (client-side), never written back. DB
  ordering is lexicographic, so `/api/products` price sorts fetch all matching
  rows and sort numerically in JS before paginating.
- **`FALLBACK_STORES` (`stores.js`)** is the safety net when Supabase is
  unreachable. Don't delete.
- **`maxDuration = 300`** on `/api/cron` + `/api/enrich`. Lowering it breaks the
  enrich drain.
- **Filter submits are additive.** Search/brand UI merges via
  `buildFeedUrl(searchParams, {…})`; `router.push('/feed?search=…')` wipes every
  other param. Two builders: `buildFeedUrl` merges (feed actions),
  `buildFreshFeedUrl` discards (nav menu / store links).
- **`MobileFilterPanel` commits atomically.** `draftCategories`/`draftStore`/
  `draftBrand` buffer locally; APPLY does one `router.push`, RESET clears drafts
  without committing. Per-dimension `router.push` reintroduces the RESET→APPLY
  race.
- **Single sources of truth:** category taxonomy + `resolveCategoryFilter` +
  `CATEGORY_SLUG_TO_DB` → `app/lib/categories.js`; sort options →
  `app/lib/sort-options.js`; product reads → `app/lib/productQueries.js`; UI
  strings (en/fr, parity enforced by `app/lib/i18n/__tests__/messages.test.js`)
  → `app/lib/i18n/messages.js`.
- **Language-aware taxonomy/sort accessors default to `"en"` silently.**
  `getFilterGroups`, `getNavTopLevel`, `getSubcategoriesByShortKey`
  (`categories.js`), `getSortOptions` (`sort-options.js`) take `lang` defaulting
  to `"en"`. A consumer that forgets to thread the active language renders
  English on toggle — no error, and the parity test checks only message keys.
- **Never `import` `content/homepage-edit.json` statically.**
  `app/lib/loadHomepagePicks.js` reads it via `fs.readFile` + `JSON.parse` in
  try/catch (returns `[]` on failure); `app/page.js` falls back to a date-seeded
  rotation when empty. A static import lets a syntax error crash the homepage
  before the fallback triggers.
- **Daily inventory snapshot gates on the `inventory_snapshot_days` ledger,
  never on "rows exist for today"** — a failed partial capture writes no ledger
  row, so the next hourly run retries and backfills idempotently; gating on rows
  would freeze a partial day forever. Capture runs in `/api/cron` **after** the
  stale-delete — reordering silently corrupts departure history, which is
  append-only and cannot be recomputed.

- **The archiver deletes only frozen, verified id sets.** A day in
  `inventory_snapshots` may be pruned only after remote count == local count > 0,
  a `day_manifest` row (count + hash + `max_id`), and a successful
  `archive_day_registry` upsert; the delete set is local ids `<= manifest.max_id`,
  never a date-predicate delete and never "all ids for the day" (bigserial is
  monotonic, so a post-verification backfill row can't enter the set). Any
  continuity violation — a pruned day with no manifest, a local day short of its
  manifest count, remote 0 read as "matches local 0" — aborts the run nonzero
  **before** anything verifies, deletes, or rebuilds the derived tables. Deletion
  needs `--prune`; the default run is mirror-only.

## DB objects not in git

Live only in Supabase. Confirm the full column list against production before
any change.

- **`enrich_product(p_handle, p_store_domain, p_brand, p_title, p_category,
  p_subcategory)` RPC** — the COALESCE write enforcing editorial protection,
  with the parent-gated `subcategory` write:
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
- **`increment_enrich_attempts` RPC** — `UPDATE products SET enrich_attempts =
  enrich_attempts + 1 WHERE handle = … AND store_domain = …`. Requires
  `enrich_attempts INT NOT NULL DEFAULT 0`.
- **`get_interleaved_products` / `count_interleaved_products` RPCs** — accept
  `p_store`, `p_category` (comma-joined), `p_subcategory`, `p_search`,
  `p_brand`, plus paging on the get variant.
- **`products_subcategory_matches_category` CHECK** — ties each subcategory to
  one category (e.g. `subcategory='jackets'` only when `category='Jackets &
  Coats'`). The RPC parent-gate above is the runtime guard.
- **`enrich_runs` table** — token-spend telemetry; insert failures are swallowed
  by routes, so dropping it won't break sync. DDL:
  [`docs/enrich-runs-logging-spec.md`](docs/enrich-runs-logging-spec.md).
- **`archive_day_registry` table** — durable REMOTE witness for the local
  inventory archive (`observed_date PK, in_ledger, row_count, row_hash,
  verified_at`; RLS on, no policies). Written by `scripts/inventoryArchiver.mjs`
  at verification time, **before** that day is pruned; never pruned itself. It is
  the only proof a pruned ORPHAN day (rows with no ledger entry — the 2026-05-21
  backfill) ever existed, so the archiver's continuity guard enumerates required
  days from `archive_day_registry ∪ inventory_snapshot_days`. DDL:
  [`scripts/sql/2026-07-26-archive-day-registry.sql`](scripts/sql/2026-07-26-archive-day-registry.sql).
- **`mv_product_lifecycle` / `mv_daily_flow` MVs + `refresh_inventory_insights()`
  + pg_cron job `refresh-inventory-insights`** — the insights `v_*` views are
  thin wrappers over these MVs, refreshed hourly by pg_cron gated on a new
  ledger day. Never re-inline the lifecycle SQL into the views: the raw query
  takes 25s+ against the 8s REST cap (2026-07-03 incident). DDL:
  [`scripts/sql/2026-07-03-inventory-insights-mv.sql`](scripts/sql/2026-07-03-inventory-insights-mv.sql).

## Sharp edges

- **Every PostgREST read runs under `authenticator`'s `statement_timeout=8s`
  (anon key: 3s) — service_role does not bypass it.** Any query that can grow
  past 8s must be precomputed or moved out of the REST path.
- **dot COMME** uses `/collections/paris/products.json`, not `/products.json`.
- **Brand filter is `ILIKE` substring, not strict equality.** Only the
  interleaved RPC `unaccent`s (diacritic-tolerant); `/api/products`'s
  direct-query branches (explicit sort, or mixed parent+leaf) don't —
  accent-folding holds on the default feed, not once a sort is applied.
- **`MoreFromStore` queries Supabase directly** to dodge `NEXT_PUBLIC_BASE_URL`
  ambiguity on preview. Don't consolidate back to HTTP.
- **Adding a currency touches four sites:** `currency.js`,
  `CurrencyProvider.js`, `layout.js`, `fx.js`'s rate parse. Hourly cron
  refreshes the `fx_rates` singleton, degrading to `FALLBACK_RATES` on failure.
- **Nav heights are coupled.** `--nav-height: 56px` (`globals.css`) must match
  `h-[56px]` on desktop nav; mobile nav stays `h-[50px]`.
- **`overflow-x-hidden` promotes `overflow-y` to auto**, creating a new
  scrolling ancestor — breaks `position: sticky` descendants. Use
  `overflow-x-clip` on feed wrappers.
- **Font variables are two-layer.** `next/font/local` exposes `--font-satoshi` /
  `--font-general-sans`; `@theme inline` (`globals.css`) maps Tailwind's
  `--font-sans`/`-mono`/`-serif` onto them (dropping `inline` makes `@theme`
  self-referential, fails silently). Raw-HTML injection (Leaflet in
  `ParisMap.js`) must reference the next/font variable directly — Tailwind
  utilities can't reach a detached DOM.
- **Admin tool is local-only.** `/admin/*` and `/api/admin/*` 404 in production
  via `middleware.js`. Admin routes reading editorial modules use `fs.readFile`
  + `new Function`, not dynamic `import()` (which cached stale module instances
  across slugs in dev). **Publish-to-preview is also dev-only;** refuses when
  `HEAD == main` unless `{ newSession: true }` is passed.
- **`loadSource` defaults to `allowFiles: false`** — treats non-HTTP values as
  inline text unless the caller opts in (only the CLI does). **Never pass
  `allowFiles: true` from an HTTP route:** request-controlled paths could read
  `.env.local` and exfiltrate it through the OpenAI prompt.

## Workflow

- **Do not push directly to `main`.** Branch every change; merge only after
  explicit user instruction.
- **Verify on localhost, Claude preview, or Vercel.** All three hit the single
  production Supabase (no dev DB), so read-path UI checks are safe but **never
  trigger `/api/cron` or `/api/enrich` locally** — they write prod rows and
  spend OpenAI. Vercel-only: `NEXT_PUBLIC_BASE_URL`-dependent links and cron
  self-fetch; `/admin/*` is localhost-only (404 in prod).
- **Two read-only health probes, both bearer-`CRON_SECRET`, both polled by
  GitHub Actions.** `/api/health/enrich` (`enrich-health.yml`) alarms when
  OpenAI goes quiet — a red job IS the alert. `/api/health/formatting`
  (`formatting-audit.yml`) scans every live row against the house convention
  and files findings into ONE permanently open issue labelled
  `formatting-audit`; there, a red job means the *check* broke, and the only
  thing that emails is a comment posted when the violation fingerprint changes.
  Neither writes. Both are safe to hit locally, unlike `/api/cron` +
  `/api/enrich`.
  - Rules live in `app/lib/formattingHealth.js` and compose the existing
    helpers (`withVisibility`, `normalizeSeasonCodes`, `manualReviewFlags`,
    `canonicalBrand`, `titleLeaksAllowedBrandStrict`) rather than restating
    them — a rule that stops tracking the write path is worse than no rule.
  - **Fingerprint before truncation, over `(key, id)` tuples.** Hashing the
    display-capped `items[]` would hide a change past the cap; hashing bare ids
    would miss an item swapping one violation class for another. The field
    *value* is excluded on purpose, so bad-title→different-bad-title stays
    silent.
  - A NULL editorial field under `MAX_ENRICH_ATTEMPTS` (`app/lib/enrichLimits.js`,
    imported by `/api/enrich` — do not re-declare it) is **silent**: still
    queued, not broken.
  - The scan pages by **keyset** (`.gt("id", lastId)`), not `.range()`.
    `captureInventorySnapshot.js` can use offsets because it applies no
    visibility filter; this one filters, and `/api/enrich` flips `hidden`
    mid-scan, which would shift every later offset and silently drop a row.
- Schema/RPC changes apply to Supabase **before** dependent code merges.
- Manual SQL (`enrich_attempts` resets, self-brand sweeps, RPC migrations)
  routes through the Supabase SQL Editor — MCP is read-only. Snapshot before
  destructive runs.

## Environment variables

Standard: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`.

Annotated:

- `NEXT_PUBLIC_BASE_URL` — defaults to `http://localhost:3000`.
- `DEPOT_ARCHIVE_DB` — laptop-only path to the local inventory archive
  (`~/DepotArchive/inventory-archive.sqlite`). When set, `/admin/inventory` reads
  the full local history via `app/lib/inventoryArchive/localReaders.js`; unset
  (Vercel), it reads Supabase and never loads `node:sqlite`.
- `CRON_SECRET` — bearer for `/api/cron` + `/api/enrich` + both `/api/health/*`
  probes; also a GitHub Actions repo secret.
- `ENRICH_HEALTH_URL` / `FORMATTING_HEALTH_URL` — GitHub Actions repo
  *variables* (not app env), the deployed URL each health workflow curls. Unset
  = the job fails loudly rather than silently passing.
- `VERCEL_AUTOMATION_BYPASS_SECRET` — auto-injected by Vercel; lets cron
  self-fetch bypass Deployment Protection on previews.
