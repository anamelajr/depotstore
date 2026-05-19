# CLAUDE.md

**Dépôt** — curated Paris archive fashion. Hourly Shopify→Supabase sync; unified
feed filtered by store, category, brand, price, search.

## Core architecture

- **Next.js App Router**, no TypeScript
- **Tailwind CSS v4** — `@tailwindcss/postcss`, no `tailwind.config.js`
- **Supabase** (Frankfurt) — primary store and only cache layer
- **Shopify `/products.json`** — per-store source, fetched hourly
- **OpenAI `gpt-5.4-mini`** — `cleanTitle.js` (enrich), `generateDescription.js` (PDP)
- **GitHub Actions** (`.github/workflows/sync.yml`) triggers `/api/cron` hourly

## Key flows

- **Sync** (`/api/cron`): pull Shopify → normalise → upsert sync fields.
  Editorial fields (`brand`, `title`, `category`) stay NULL. A pre-upsert snapshot
  resets `enrich_attempts` for rows whose Shopify `name` or `description` changed.
  Triggers `/api/enrich` via Vercel `waitUntil`.
- **Enrich** (`/api/enrich`): pulls NULL-editorial rows where `available`,
  `!hidden`, `enrich_attempts < 3`. On `cleanTitle` null, falls back to
  deterministic `brandFromHandle()` against the curated allowlist. Writes via
  the `enrich_product` RPC's `COALESCE`. Self-chains up to 30 hops. Each batch
  + cron tick writes to `enrich_runs` (telemetry; insert failures swallowed).
- **Feed** (`FeedClient.js` + `/api/products`): URL-driven filters/sort,
  load-more, back-nav scroll restore. Default sort = `get_interleaved_products`.
  Price sort fetches all matching rows and sorts in JS.
- **PDP**: Shopify live fetch + Supabase brand/title/store + on-demand
  description (cached back to the row).

## Before editing

Filter/query/sort changes need a parallel pass over all three product-read
surfaces: `/api/products/route.js`, the `get_interleaved_products` /
`count_interleaved_products` RPCs, and direct Supabase reads
(`MoreFromStore.js`, PDP, homepage).

## Invariants

- **Redis/Upstash stays gone.**
- **Editorial fields write only if NULL.** Enforced by cron's Step-2 upsert
  and the `enrich_product` RPC's `COALESCE`. A plain `UPDATE` reintroduces
  the clobber race.
- **`cleanTitle.js` returns `null` or `{ brand, title }`** — never echoes raw
  input. `null` covers both bad output and transient OpenAI failures (5xx,
  rate-limit, 8 s timeout) — treat as retryable, not terminal.
- **Brand-from-handle fallback stays deterministic.** Regex against the
  curated allowlist only; never prompt the model with the handle (hallucinated
  brand → passes allowlist → invisible bad data). Slug list keeps dashed AND
  compact variants, longest-first.
- **Cron stale-delete is scoped to `successfulDomains`, never global.** A
  domain is added only when sync returned `count > 0`. `fetchStoreProducts`
  must throw on non-200 AND on 200-with-malformed `products` — a silent
  truncated return feeds the scoped delete bad data.
- **PostgREST IN queries on handle lists must use `chunkArray`**
  (`app/lib/chunk.js`, size 100). Long-handle stores blow past PostgREST's
  URL limit.
- **Enrich batch SELECT and remaining-count query must carry identical
  filters** (`available`, `!hidden`, `enrich_attempts < MAX`). A mismatch
  pins `remaining > 0` forever, burning all 30 self-chain hops on no-ops.
- **In-loop `row.X` reads require X in the batch SELECT projection.**
  PostgREST filters and projections are independent: `.lt("enrich_attempts",
  MAX)` works without selecting the column, but `row.enrich_attempts` is
  then `undefined` and `+ 1` silently becomes `NaN`.
- **Self-branded store hide gates are asymmetric.** For domains in
  `SELF_BRANDED_STORES`, `/api/enrich` hides immediately when
  `isSelfBranded()` resolves on the success branch, but on the null branch
  hides ONLY at retry exhaustion. Hiding on the first null would permanently
  kill legitimate-brand rows on one transient OpenAI failure.
- **Allowlist-rejected rows are hidden, not deleted.** `update({ hidden:
  true, enrich_attempts: MAX })` scoped to `row.id`. `delete()` reintroduces
  the sync-recreate / enrich-rereject loop that previously dominated OpenAI
  spend.
- **`hidden` is `NOT NULL` (default `false`); every `available = true` read
  must also filter `hidden = false`.** `.eq("hidden", false)` excludes NULL,
  so if the column drifts nullable, hide-aware filters silently leak.
- **`get_interleaved_products` RPC must return `name`.** `ProductCard` falls
  back to it when `title` is null.
- **Price is stored as TEXT** (`'€29.99'`). Never assume numeric ordering.
- **`FALLBACK_STORES` in `stores.js`** is the safety net when Supabase is
  unreachable. Do not delete.
- **`maxDuration = 300`** on `/api/cron` and `/api/enrich`. Lowering it
  breaks the enrich drain.
- **Filter submits are additive.** Search/brand UI merges via
  `buildFeedUrl(searchParams, { … })`; `router.push('/feed?search=…')`
  silently wipes every other param. Two builders: `buildFeedUrl` merges
  (feed actions), `buildFreshFeedUrl` discards (nav menu / store links).
- **`MobileFilterPanel` commits atomically.** `draftCategories`, `draftStore`,
  `draftBrand` buffer locally; APPLY does one `router.push`, RESET clears
  drafts without committing. Per-dimension `router.push` reintroduces the
  RESET→APPLY race.
- **Single sources of truth:** category taxonomy + `CATEGORY_SLUG_TO_DB` →
  `app/lib/categories.js`; sort options → `app/lib/sort-options.js`.

## DB objects not in git

Live only in Supabase. Confirm full column list against production before
applying any change.

- **`enrich_product` RPC** — the COALESCE write that enforces editorial
  protection.
  ```sql
  UPDATE products SET
    brand    = COALESCE(brand,    p_brand),
    title    = COALESCE(title,    p_title),
    category = COALESCE(category, p_category)
  WHERE handle = p_handle AND store_domain = p_store_domain;
  ```
- **`increment_enrich_attempts` RPC** — `UPDATE products SET enrich_attempts
  = enrich_attempts + 1 WHERE handle = … AND store_domain = …`. Requires
  `enrich_attempts INT NOT NULL DEFAULT 0` on `products`.
- **`enrich_runs` table** — token-spend telemetry. Insert failures are
  swallowed by routes; dropping it won't break sync. DDL:
  [`docs/enrich-runs-logging-spec.md`](docs/enrich-runs-logging-spec.md).

## Sharp edges

- **dot COMME** uses `/collections/paris/products.json`, not `/products.json`.
- **Brand filter is `unaccent` + `ILIKE` substring** (not strict equality) —
  covers casing drift, brand fragmentation, and diacritics. Requires
  `extensions.unaccent` and the `p_brand` parameter on both interleaved RPCs.
- **`MoreFromStore` queries Supabase directly** to dodge `NEXT_PUBLIC_BASE_URL`
  ambiguity on preview. Don't consolidate it back to HTTP.
- **Nav heights are coupled.** `--nav-height: 56px` must match `h-[56px]` on
  desktop nav; mobile nav stays `h-[50px]`.
- **`overflow-x-hidden` promotes `overflow-y` to auto** and creates a new
  scrolling ancestor — breaks `position: sticky` descendants. Use
  `overflow-x-clip` on feed wrappers.

## Workflow

- **Do not push directly to `main`.** Branch + Vercel preview every change.
  Merge only after explicit user instruction. Verify on Vercel, not localhost.
- Schema/RPC changes apply to Supabase **before** dependent code merges.
- Manual SQL (`enrich_attempts` resets, self-brand sweeps) routes through the
  Supabase SQL Editor — MCP is read-only. Snapshot before destructive runs.

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_BASE_URL              # defaults to http://localhost:3000
CRON_SECRET                       # bearer for /api/cron + /api/enrich;
                                  # also a GitHub Actions repo secret
OPENAI_API_KEY
VERCEL_AUTOMATION_BYPASS_SECRET   # auto-injected; lets cron self-fetch
                                  # bypass Vercel SSO on previews
BEEHIIV_PUBLICATION_ID
BEEHIIV_API_KEY
```
