# CLAUDE.md

## What this app is

**Dépôt** — a curated Paris archive fashion discovery platform. Partner stores
sync Shopify inventory hourly into Supabase. Users browse a unified feed
filtered by store, category, brand, price, and search.

## Before editing

- **Read relevant files end-to-end before changing them.** Do not infer
  architecture from filenames or function names. The same concept (filter
  logic, sort options) often lives in several files with different shapes.
- **Touching any query, filter, or sort?** Check all three product-read
  surfaces in parallel: `/api/products/route.js` (REST handler), the
  `get_interleaved_products` / `count_interleaved_products` RPCs (SQL, DB-only),
  and direct Supabase reads in components (`MoreFromStore.js`, PDP, homepage).
  A change in one almost always needs a parallel change in the others.

## Core architecture

- **Next.js App Router** (no TypeScript)
- **Tailwind CSS v4** — uses `@tailwindcss/postcss`, not `tailwind.config.js`
- **Supabase** (Frankfurt, PostgreSQL) — primary data store, only cache layer
- **Shopify `/products.json`** — per-store source, fetched hourly
- **OpenAI API (`gpt-5.4-mini`)** — `cleanTitle.js` (from `/api/enrich`),
  `generateDescription.js` (from PDP)
- **GitHub Actions** — `.github/workflows/sync.yml` triggers `/api/cron` hourly
  (replaces the deleted `vercel.json` Hobby cron, which was capped at 1×/day)
- **Vercel `waitUntil`** — fans out cron → enrich and self-chains enrich
- **Beehiiv** — newsletter via `/api/subscribe`

## Key flows

- **Sync** (`/api/cron`): pull Shopify, normalise, upsert sync fields.
  Editorial fields (`brand`, `title`, `category`) stay NULL. Triggers
  `/api/enrich` via `waitUntil`. Pre-upsert snapshot resets `enrich_attempts`
  for any row whose Shopify `name` or `description` changed.
- **Enrich** (`/api/enrich`): batches of 150 NULL-editorial rows where
  `available = true` and `enrich_attempts < 3`, paced at 1.2 s/call (legacy
  Haiku Tier 1 ceiling — gpt-5.4-mini headroom is higher; pacing is now
  conservative-but-harmless). Writes via the `enrich_product` RPC's
  `COALESCE`. Self-chains up to 30 hops. Auth: `Bearer $CRON_SECRET`.
- **Feed** (`FeedClient.js` + `/api/products`): URL-driven filters/sort,
  load-more, back-nav scroll restore. Default sort = `get_interleaved_products`.
  Price sort fetches all matching rows and sorts in JS.
- **PDP**: Shopify live fetch + Supabase brand/title/store + on-demand
  description (cached back to the row).

## Non-negotiable invariants

- **Redis/Upstash stays gone.** Do not import or reference it.
- **Editorial fields write only if NULL.** Enforced in cron's Step-2 editorial
  upsert and the `enrich_product` RPC's `COALESCE`. Replacing the RPC with a
  plain `UPDATE` reintroduces the editorial-clobber race.
- **`cleanTitle.js` returns `null` or `{ brand, title }`** — never echoes raw
  input. A failed model call must not write a placeholder.
- **Cron stale-delete is scoped to `successfulDomains`, never global.** A
  store whose sync rejected — or returned 0 rows / HTTP 200 with empty/malformed
  payload — never refreshed `synced_at`. A global `DELETE WHERE synced_at < syncStart`
  then wipes its last-known-good inventory. Only push to `successfulDomains` when
  `count > 0`. (See [aa7e5a8], [bef18ee].)
- **`fetchStoreProducts` throws on non-200 and on 200-with-malformed `products`**
  (missing field or non-array). A truncated list silently returned would feed the
  scoped delete bad data — same loss class as above. (See [b0f48c1], [884e366].)
- **PostgREST IN queries on handle lists must use `chunkArray`**
  (`app/lib/chunk.js`, size 100). Long-handle stores blow past PostgREST's URL
  limit and return 400. Applies to the pre-upsert SELECT, the editorial-state
  SELECT, and the `enrich_attempts` reset UPDATE in `/api/cron`.
- **Enrich batch SELECT and remaining-count query must carry identical filters**
  (`available = true` AND `enrich_attempts < MAX_ENRICH_ATTEMPTS`). A mismatch
  keeps `remaining > 0` permanently, burning all 30 self-chain hops per cron run
  on no-op batches.
- **`enrich_product` RPC is not in git.** Rebuild via:
  ```sql
  CREATE OR REPLACE FUNCTION enrich_product(
    p_handle TEXT, p_store_domain TEXT,
    p_brand TEXT, p_title TEXT, p_category TEXT
  ) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
  BEGIN
    UPDATE products SET
      brand    = COALESCE(brand,    p_brand),
      title    = COALESCE(title,    p_title),
      category = COALESCE(category, p_category)
    WHERE handle = p_handle AND store_domain = p_store_domain;
  END;
  $$;
  ```
- **`increment_enrich_attempts` RPC is not in git.** Requires
  `ALTER TABLE products ADD COLUMN enrich_attempts INT NOT NULL DEFAULT 0;`
  then:
  ```sql
  CREATE OR REPLACE FUNCTION increment_enrich_attempts(
    p_handle TEXT, p_store_domain TEXT
  ) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
  BEGIN
    UPDATE products SET enrich_attempts = enrich_attempts + 1
    WHERE handle = p_handle AND store_domain = p_store_domain;
  END;
  $$;
  ```
- **`hidden = false` must accompany every `available = true` read.** Editorial
  hide flag, never overwritten by cron. Currently filtered in `/api/products`
  and the interleaved RPCs. **Missing in `MoreFromStore.js`.**
- **`get_interleaved_products` RPC must return the `name` column.**
  `ProductCard` falls back to it when `title` is null.
- **Price is stored as TEXT** (`'€29.99'`). Never assume numeric ordering.
- **`FALLBACK_STORES` in `stores.js`** is the safety net used when Supabase is
  unreachable. Do not delete it.
- **`maxDuration = 300`** on `/api/cron` and `/api/enrich`. Reducing it breaks
  the enrich drain.
- **Single sources of truth — don't duplicate:**
  - Category taxonomy (slugs, DB names, nav structure, subcategory chips):
    `app/lib/categories.js`. All 7 consumers import from here.
  - Category slug → DB display string: `CATEGORY_SLUG_TO_DB` in the same file.
  - Sort UI options: `SORT_OPTIONS` + `SORT_MAP` in `app/lib/sort-options.js`.

## Sharp edges

- **dot COMME** uses `/collections/paris/products.json`, not `/products.json`.
- **`stores` table is source of truth for active stores.** Never hardcode
  visibility in components. `scripts/backfillTitles.mjs` still has hardcoded
  store arrays — update manually when adding stores.
- **Brand filter uses `unaccent` + `ILIKE` substring match** (not strict
  equality) — covers casing drift (`Margiela` → `MAISON MARGIELA`), brand
  fragmentation (`Rick Owens` → DRKSHDW etc.), and diacritics
  (`Garçons` ↔ `Garcons`). Requires `extensions.unaccent` extension and the
  `p_brand` parameter on both interleaved RPCs.
- **`MoreFromStore` queries Supabase directly** to dodge `NEXT_PUBLIC_BASE_URL`
  ambiguity on preview. Don't "consolidate" it back to HTTP. (Homepage
  Today's Edit still uses the bad pattern.)
- **Two URL builders:** `buildFeedUrl` merges with current URL (feed),
  `buildFreshFeedUrl` discards it (nav menu). Picking the wrong one causes
  filter-preservation bugs.
- **Nav heights are coupled.** `--nav-height: 56px` must match `h-[56px]` on
  desktop nav; mobile nav stays `h-[50px]`.
- **`BackToFeedLink`** powers desktop-PDP filter-aware back navigation. Keep it.
- **Verify on Vercel.** Localhost can mislead on hydration, UI, and preview-only
  env vars.

## Workflow

- Prefer minimal diffs. Do not refactor unrelated code in the same change.
- **Do not push directly to `main`.** Branch + Vercel preview for every change.
  Merge only after explicit user instruction.
- Schema/RPC changes apply to Supabase **before** the dependent code merges
  (deploy-order discipline). Confirm full column list before dropping/recreating
  any RPC — dependent query logic is easy to lose.
- Adding a store: `INSERT` into `stores`, then update the hardcoded arrays in
  `scripts/backfillTitles.mjs`.
- Cron schedule lives in `.github/workflows/sync.yml` (repo Variable `CRON_URL`,
  Secret `CRON_SECRET`). Do not re-introduce `vercel.json`.

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_BASE_URL                # defaults to http://localhost:3000
CRON_SECRET                         # bearer for /api/cron and /api/enrich;
                                    # also set as a GitHub Actions repo secret
OPENAI_API_KEY                      # cleanTitle + generateDescription
VERCEL_AUTOMATION_BYPASS_SECRET     # auto-injected; lets cron self-fetch
                                    # bypass Vercel SSO on preview deploys
BEEHIIV_PUBLICATION_ID
BEEHIIV_API_KEY
```

## Commands

```bash
npm run dev      # Dev server — verify on Vercel, not here
npm run build    # Production build
npm run lint     # ESLint
```
