# CLAUDE.md

**Dépôt** — curated Paris archive fashion. Hourly Shopify→Supabase sync;
unified feed filtered by store, category (parent + leaf subcategory), brand,
price, search.

## Before editing

Product-read changes go through `app/lib/productQueries.js` (visibility
filter, row select + mapper, interleaved-RPC call shape) — all five
consumers compose it. Category-filter changes still need a parallel pass
over the interleaved RPCs + `resolveCategoryFilter` in
`app/lib/categories.js`.

## Invariants

- **Redis/Upstash stays gone.**
- **Editorial fields (`brand`, `title`, `category`, `subcategory`) write only
  if NULL.** Enforced by cron's Step-2 upsert and the `enrich_product` RPC's
  COALESCE. A plain `UPDATE` reintroduces the clobber race.
- **`subcategory` write is parent-gated inside the RPC.** Only COALESCE-writes
  `p_subcategory` when the row's effective parent (existing `category` if
  set, else `p_category`) equals `p_category`. An unguarded
  `COALESCE(subcategory, p_subcategory)` violates
  `products_subcategory_matches_category` when the classifier's leaf parent
  disagrees with the row's already-set category, burning enrich retries
  silently on re-classification candidates.
- **`cleanTitle.js`'s `null` is retryable.** It covers transient OpenAI
  failures (5xx, rate-limit, 8 s timeout) as well as genuinely
  unclassifiable rows — treat as transient, not terminal.
- **Brand-from-handle fallback stays deterministic.** Regex against the
  curated allowlist only; never prompt the model with the handle
  (hallucinated brand → passes allowlist → invisible bad data). Slug list
  keeps dashed AND compact variants, longest-first.
- **Cron stale-delete is scoped to `successfulDomains`, never global.** A
  domain is added only when sync returned `count > 0`. `fetchStoreProducts`
  must throw on non-200 AND on 200-with-malformed `products` — a silent
  truncated return feeds the scoped delete bad data.
- **PostgREST IN queries on handle lists must use `chunkArray`**
  (`app/lib/chunk.js`, size 100). Long-handle stores blow past PostgREST's
  URL limit.
- **PostgREST `.or()` values containing `, . : ( )` or whitespace must be
  double-quoted** (and any embedded `"` escaped). Unwrapped, those
  characters split the filter into syntax tokens — `"vivienne westwood"`
  returns nothing and a category like `"Dresses, Skirts & Robes"` 400s.
  Use `escapePostgrestValue` in `/api/products/route.js`; `search-products`
  has an inline equivalent.
- **Enrich batch SELECT and remaining-count query must carry identical
  filters.** Both already share `withVisibility` for `available`/`!hidden`;
  the drift risk is the hand-replicated pair: `enrich_attempts < MAX` and
  `brand|title|category IS NULL`. A mismatch pins `remaining > 0` forever,
  burning all 30 self-chain hops on no-ops.
- **In-loop `row.X` reads require X in the batch SELECT projection.**
  PostgREST filters and projections are independent: `.lt("enrich_attempts",
  MAX)` works without selecting the column, but `row.enrich_attempts` is
  then `undefined` and `+ 1` silently becomes `NaN`.
- **Self-branded store hide gates are asymmetric.** For domains in
  `SELF_BRANDED_STORES`, `/api/enrich` hides immediately when
  `isSelfBranded()` resolves on the success branch, but on the null branch
  hides ONLY at retry exhaustion. Hiding on the first null would
  permanently kill legitimate-brand rows on one transient OpenAI failure.
- **Allowlist-rejected rows are hidden, not deleted.**
  `update({ hidden: true, enrich_attempts: MAX })` scoped to `row.id`.
  `delete()` reintroduces the sync-recreate / enrich-rereject loop that
  previously dominated OpenAI spend.
- **`hidden` is `NOT NULL` (default `false`); every `available = true` read
  must also filter `hidden = false`.** `.eq("hidden", false)` excludes
  NULL, so if the column drifts nullable, hide-aware filters silently leak.
  Use `withVisibility` from `app/lib/productQueries.js`; all callers
  compose it.
- **`get_interleaved_products` RPC must return `name`.** `ProductCard` falls
  back to it when `title` is null.
- **Price is stored as TEXT** (`'€29.99'`). DB ordering is lexicographic, so
  `/api/products` price sorts fetch all matching rows and sort numerically
  in JS before paginating.
- **`FALLBACK_STORES` in `stores.js`** is the safety net when Supabase is
  unreachable. Do not delete.
- **`maxDuration = 300`** on `/api/cron` and `/api/enrich`. Lowering it
  breaks the enrich drain.
- **Filter submits are additive.** Search/brand UI merges via
  `buildFeedUrl(searchParams, { … })`; `router.push('/feed?search=…')`
  silently wipes every other param. Two builders: `buildFeedUrl` merges
  (feed actions), `buildFreshFeedUrl` discards (nav menu / store links).
- **`MobileFilterPanel` commits atomically.** `draftCategories`,
  `draftStore`, `draftBrand` buffer locally; APPLY does one `router.push`,
  RESET clears drafts without committing. Per-dimension `router.push`
  reintroduces the RESET→APPLY race.
- **Single sources of truth:** category taxonomy + `resolveCategoryFilter`
  + `CATEGORY_SLUG_TO_DB` → `app/lib/categories.js`; sort options →
  `app/lib/sort-options.js`; product reads (visibility filter, row select
  + mapper, interleaved-RPC call shape) → `app/lib/productQueries.js`.
- **Editorial entries are registered manually in
  `content/editorial/index.js`'s hardcoded `ENTRIES` array.** No
  filesystem auto-discovery — new entries are imported + pushed.
- **Never `import` `content/homepage-edit.json` statically.**
  `app/lib/loadHomepagePicks.js` reads it via `fs.readFile` + `JSON.parse`
  inside try/catch (returns `[]` on any failure), with a date-seeded
  rotation as runtime fallback. A static import would let a syntax error
  crash production homepage rendering before the fallback could trigger.
- **`save-homepage-edit` writes atomically via tmp + rename.** Prevents a
  truncated file from a mid-write interruption crashing the homepage on
  the next read.
- **Editorial save rollback is asymmetric.** If `<slug>.js` writes but
  `index.js` patch fails AND the slug file did not exist before this
  save, the slug file is unlinked. For existing entries, no rollback —
  prior content is already overwritten.

## DB objects not in git

Live only in Supabase. Confirm full column list against production before
applying any change.

- **`enrich_product(p_handle, p_store_domain, p_brand, p_title, p_category,
  p_subcategory)` RPC** — the COALESCE write that enforces editorial
  protection. Subcategory write is parent-gated so a stale parent never
  trips `products_subcategory_matches_category`:
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
- **`increment_enrich_attempts` RPC** — `UPDATE products SET
  enrich_attempts = enrich_attempts + 1 WHERE handle = … AND store_domain
  = …`. Requires `enrich_attempts INT NOT NULL DEFAULT 0` on `products`.
- **`get_interleaved_products` / `count_interleaved_products` RPCs** —
  accept `p_store`, `p_category` (comma-joined), `p_subcategory`,
  `p_search`, `p_brand`, plus paging params on the get variant.
- **`products_subcategory_matches_category` CHECK constraint** — ties
  each subcategory value to one category (e.g. `subcategory='jackets'`
  only valid when `category='Jackets & Coats'`). The RPC parent-gate
  above is the runtime guard against violations.
- **`enrich_runs` table** — token-spend telemetry. Insert failures are
  swallowed by routes; dropping it won't break sync. DDL:
  [`docs/enrich-runs-logging-spec.md`](docs/enrich-runs-logging-spec.md).

## Sharp edges

- **dot COMME** uses `/collections/paris/products.json`, not
  `/products.json`.
- **Brand filter is `unaccent` + `ILIKE` substring**, not strict equality
  — covers casing drift, brand fragmentation, and diacritics. Requires
  `extensions.unaccent` and the `p_brand` parameter on both interleaved
  RPCs.
- **`MoreFromStore` queries Supabase directly** to dodge
  `NEXT_PUBLIC_BASE_URL` ambiguity on preview. Don't consolidate it back
  to HTTP.
- **Nav heights are coupled.** `--nav-height: 56px` (in `globals.css`)
  must match `h-[56px]` on desktop nav; mobile nav stays `h-[50px]`.
- **`overflow-x-hidden` promotes `overflow-y` to auto** and creates a new
  scrolling ancestor — breaks `position: sticky` descendants. Use
  `overflow-x-clip` on feed wrappers.
- **Font variables are two-layer.** `next/font/local` exposes
  `--font-satoshi` / `--font-general-sans`; `@theme inline` in
  `globals.css` maps Tailwind's `--font-sans` / `--font-mono` /
  `--font-serif` onto them. Collapsing the layers re-introduces a
  self-referential `@theme` that fails silently if anyone drops `inline`.
  Raw-HTML injection (Leaflet markup in `ParisMap.js`) must reference the
  next/font variable directly — Tailwind utilities can't reach a detached
  DOM.
- **Admin tool is local-only.** `/admin/*` and `/api/admin/*` return 404
  in production via `middleware.js`. Admin routes that read editorial
  modules use `fs.readFile` + `new Function`, not dynamic `import()` —
  the latter cached stale module instances across slugs in dev.
  **Publish-to-preview route is also dev-only;** refuses when `HEAD == main`
  unless `{ newSession: true }` is passed.
- **`loadSource` defaults to `allowFiles: false`.** The shared draft
  helper treats non-HTTP values as inline text unless the caller
  explicitly opts in. Only the CLI opts in. **Never pass
  `allowFiles: true` from an HTTP route** — request-controlled paths
  could read `.env.local` and exfiltrate the contents through the OpenAI
  prompt (DNS rebind / hostile local process).

## Workflow

- **Do not push directly to `main`.** Branch + Vercel preview every
  change. Merge only after explicit user instruction. Verify on Vercel,
  not localhost.
- Schema/RPC changes apply to Supabase **before** dependent code merges.
- Manual SQL (`enrich_attempts` resets, self-brand sweeps, RPC
  migrations) routes through the Supabase SQL Editor — MCP is read-only.
  Snapshot before destructive runs.

## Environment variables

Standard: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`.

Annotated:

- `NEXT_PUBLIC_BASE_URL` — defaults to `http://localhost:3000`.
- `CRON_SECRET` — bearer for `/api/cron` + `/api/enrich`; also a GitHub
  Actions repo secret.
- `VERCEL_AUTOMATION_BYPASS_SECRET` — auto-injected by Vercel; lets cron
  self-fetch bypass Deployment Protection on previews.
