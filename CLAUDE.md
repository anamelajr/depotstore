markdown# CLAUDE.md

## What this app is

**Dépôt** — a curated Paris archive fashion discovery platform. Partner stores
sync Shopify inventory nightly into Supabase. Users browse a unified feed
filtered by store, brand, category, price, and search. Editorial identity is
the product's differentiator.

## Core architecture

- **Next.js App Router** (no TypeScript)
- **Tailwind CSS v4** — uses `@tailwindcss/postcss`, not `tailwind.config.js`
- **Supabase** (Frankfurt, PostgreSQL) — primary data store and only cache layer
- **Shopify `/products.json`** — nightly product source per store
- **Claude API** — title/brand extraction (`cleanTitle.js`), descriptions (`generateDescription.js`)
- **Beehiiv** — newsletter via `/api/subscribe`
- **Redis is currently removed. Do not re-add it without an explicit architecture decision.**

## Key flows

**Nightly sync** — cron hits `/api/cron`, pulls Shopify inventory, normalises
and upserts into Supabase. Editorial fields (branry) only write
if currently NULL — sync fields always overwrite.

**Feed** — `FeedClient.js` manages URL-driven filter/sort state, load-more
pagination, and back-navigation restore via `/api/products`. Default sort uses
`get_interleaved_products` RPC. Price sort fetches all matching rows and sorts
in JS.

**Product detail** — fetches live from Shopify at request time.

## Non-negotiable invariants

Do not change these without explicit instruction.

- **Redis is currently removed.** Do not import or reference Upstash anywhere.
- **Editorial fields only write if NULL.** Never overwrite a populated brand,
  title, or category via the cron upsert.
- **`cleanTitle.js` returns `null` on failure**, never `rawTitle`. A failed
  Haiku call must not write a bad title to the DB.
- **`stores.js` parse block must write `null` on `cleanTitle` failure**,
  never `rawTitle`.
- **`get_interleaved_products` RPC must return the `name` column.** Do not
  recreate it without `name` — `ProductCard` falls back to it when   is null.
- **Price is stored as TEXT** (`'€29.99'`). Never assume numeric ordering.
- **`FALLBACK_STORES` in `stores.js` is a safety net.** Do not delete it.
- **`BackToFeedLink` enables filter-aware back navigation.** Do not delete it.
- **`nav-height` is `50px` in `globals.css`** — must match `h-[50px]` in nav.
- **Category URL slugs are translated to DB display values in
  `app/api/products/route.js`.** Update that mapping if categories or slugs
  change.

## Known sharp edges

- **dot COMME** uses `/collections/paris/products.json`, not `/products.json`.
- **`backfillTitles.mjs` and `prewarm.js`** have hardcoded store arrays not
  connected to the `stores` table. Update them manually when adding stores.
- **Treat Vercel as the source of truth for behavioural verification.**
  Localhost may mislead on hydration and UI issues.
- **`stores` table is source of truth for active stores.** Toggle with
  `UPDATE stores SET active = false` — never hardcode visibility in components.

## Workflow

- Preferal diffs. Do not refactor unrelated code in the same change.
- Verify all changes on Vercel before considering a task done.
- Dropping and recreating an RPC loses dependent query logic — confirm the full
  column list before recreating.
- When adding a store: INSERT into `stores` table, then update hardcoded arrays
  in `scripts/backfillTitles.mjs` and `scripts/prewarm.js` manually.
- Straightforward changes: push to `main`. Risky or multi-file changes: branch,
  verify Vercel preview, then merge.

## Environment variables
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_BASE_URL          # defaults to http://localhost:3000
CRON_SECRET                   # bearer token for /api/cron
BEEHIIV_PUBLICATION_ID
BEEHIIV_API_KEY

## Commands

```bash
npm run dev      # Dev server — verify on Vercel, not here
npm run build    # Production build
npm run lint     # ESLint
```


