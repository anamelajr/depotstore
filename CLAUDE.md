# CLAUDE.md

## What this app is

**Dépôt** — a curated Paris archive fashion discovery platform. Partner stores
sync Shopify inventory nightly into Supabase. Users browse a unified feed
filtered by store, category, price, and search.

## Before editing

- **Read relevant files end-to-end before changing them.** Do not infer
  architecture from filenames or function names. The same concept (category
  taxonomy, sort options, filter logic) often lives in several files with
  different shapes.
- **Touching any query, filter, or sort?** Check all three product-read
  surfaces in parallel: `/api/products/route.js` (REST handler), the
  `get_interleaved_products` / `count_interleaved_products` RPCs (SQL, DB-only),
  and direct Supabase reads in components (`MoreFromStore.js`, PDP, homepage).
  A change in one almost always needs a parallel change in the others.

## Core architecture

- **Next.js App Router** (no TypeScript)
- **Tailwind CSS v4** — uses `@tailwindcss/postcss`, not `tailwind.config.js`
- **Supabase** (Frankfurt, PostgreSQL) — primary data store, only cache layer
- **Shopify `/products.json`** — nightly source per store
- **Claude API** — `cleanTitle.js` (from `/api/enrich`), `generateDescription.js` (from PDP)
- **Vercel `waitUntil`** — fans out cron → enrich and self-chains enrich
- **Beehiiv** — newsletter via `/api/subscribe`

## Key flows

- **Sync** (`/api/cron`): pull Shopify, normalise, upsert sync fields.
  Editorial fields (`brand`, `title`, `category`) stay NULL. Triggers
  `/api/enrich` via `waitUntil`.
- **Enrich** (`/api/enrich`): batches of 150 NULL-editorial rows, Haiku
  paced at 1.2 s/call (50 RPM Tier 1 ceiling), writes via the
  `enrich_product` RPC's `COALESCE`. Self-chains up to 30 hops. Auth:
  `Bearer $CRON_SECRET`.
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
  input. A failed Haiku call must not write a placeholder.
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
- **Category slugs → DB display strings** live in `CATEGORY_SLUG_TO_DB`
  (`app/api/products/route.js`). Sort UI options live in `app/lib/sort-options.js`
  (`SORT_OPTIONS` + `SORT_MAP`). Don't duplicate either.

## Sharp edges

- **dot COMME** uses `/collections/paris/products.json`, not `/products.json`.
- **`stores` table is source of truth for active stores.** Never hardcode
  visibility in components. `backfillTitles.mjs` still has hardcoded arrays —
  update manually when adding stores.
- **Tier 1 Haiku is 50 RPM.** Every `cleanTitle` invocation must respect this.
- **Brand filter is UI-only.** `DesignersPanel` writes `?brand=X` URLs that
  `/api/products` ignores. Wire it through or remove the panel.
- **Category taxonomy is duplicated in ~7 files.** Refactor before adding the
  8th. (api/products, lib/feed-utils, feed/DesktopFilterPanel,
  MobileFilterDrawer, nav/Column1, nav/SubcategoryList, Nav.js mobile.)
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
- Dropping and recreating an RPC loses dependent query logic — confirm the
  full column list first.
- When adding a store: `INSERT` into `stores`, then update
  `scripts/backfillTitles.mjs` arrays manually.

## Environment variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_BASE_URL                # defaults to http://localhost:3000
CRON_SECRET                         # bearer for /api/cron and /api/enrich
ANTHROPIC_API_KEY                   # cleanTitle + generateDescription
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
