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
- **In-loop `row.X` reads require X in the batch SELECT projection** — filtering
  a column doesn't select it; an unselected `row.X` is `undefined` → silent
  `NaN`.
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
- **Editorial entries are registered manually** in
  `content/editorial/index.js`'s hardcoded `ENTRIES` array — no fs
  auto-discovery; new entries are imported + pushed.
- **Never `import` `content/homepage-edit.json` statically.**
  `app/lib/loadHomepagePicks.js` reads it via `fs.readFile` + `JSON.parse` in
  try/catch (returns `[]` on failure); `app/page.js` falls back to a date-seeded
  rotation when empty. A static import lets a syntax error crash the homepage
  before the fallback triggers.
- **`save-homepage-edit` writes atomically via tmp + rename** — prevents a
  truncated file from a mid-write interruption crashing the homepage on next
  read.
- **Editorial save/delete rollback is asymmetric.** Save: if `<slug>.js` writes
  but the `index.js` patch fails AND the slug file is new, it's unlinked;
  existing entries get no rollback (content already overwritten). Delete
  unpatches `index.js` first, then removes the slug file; a failed removal rolls
  the unpatch back.

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
- **`mv_product_lifecycle` / `mv_daily_flow` MVs + `refresh_inventory_insights()`
  + pg_cron job `refresh-inventory-insights`** — the insights `v_*` views are
  thin wrappers over these MVs; pg_cron refreshes them hourly, gated on a new
  ledger day (so the real refresh runs once, right after capture). Don't
  re-inline the heavy lifecycle SQL into the views: every PostgREST read —
  service_role included — runs under the authenticator role's
  `statement_timeout=8s`, and the raw query takes 25s+ (the 2026-07-03
  timeout incident). DDL:
  [`scripts/sql/2026-07-03-inventory-insights-mv.sql`](scripts/sql/2026-07-03-inventory-insights-mv.sql).

## Sharp edges

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
- Schema/RPC changes apply to Supabase **before** dependent code merges.
- Manual SQL (`enrich_attempts` resets, self-brand sweeps, RPC migrations)
  routes through the Supabase SQL Editor — MCP is read-only. Snapshot before
  destructive runs.

## Environment variables

Standard: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`.

Annotated:

- `NEXT_PUBLIC_BASE_URL` — defaults to `http://localhost:3000`.
- `CRON_SECRET` — bearer for `/api/cron` + `/api/enrich`; also a GitHub Actions
  repo secret.
- `VERCEL_AUTOMATION_BYPASS_SECRET` — auto-injected by Vercel; lets cron
  self-fetch bypass Deployment Protection on previews.
