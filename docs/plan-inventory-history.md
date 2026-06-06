# Inventory history + insights — design proposal

> **Status: PROPOSAL.** Two phases. Phase 1 (capture) is the urgent, buildable
> piece — every hour without it is data lost forever. Phase 2 (dashboard) is
> designed but deferred until weeks of data accumulate. Implementation of either
> happens only after explicit go-ahead.

## Context

Dépôt's pipeline tracks **current state only**. The hourly Shopify→Supabase
cron overwrites every product row in place and **hard-deletes** rows that
disappear from a store's `products.json`. No table retains how inventory changes
over time, so the market signals the user wants — sell-through velocity (how long
a piece stays live before it sells/leaves) and demand proxies (which
brands/categories turn over fastest) — are discarded every hour and are
unrecoverable after the fact. Goal: capture forward-going inventory history
**additively** (never touching or risking the inventory write path), then expose
it through a private in-app dashboard.

## Findings (evidence base — live DB `pnjewddyeslsbozoeyks` + source)

1. **Schema / timestamps.** `products` has 21 columns and exactly one timestamp,
   `synced_at` — set to one per-run constant on every row of every upsert
   ([app/api/cron/route.js:46](../app/api/cron/route.js)); a "last touched" stamp,
   not a creation marker (all live rows share one value). **No** `created_at` /
   `updated_at` / `first_seen` / `sold_at`. Sold = `available=false` with no
   timestamp of the flip. Shopify's `created_at` is parsed then dropped.
2. **Disappearance.** By omission → either **hard-DELETE** (store synced cleanly,
   [route.js:256-260](../app/api/cron/route.js)) or **left untouched**. No
   tombstone. Only `enrich_runs.stale_deleted` count survives (how many, not
   which).
3. **Existing history.** Only `enrich_runs` is append-only — counts only, zero
   product identity. Nothing reconstructs per-product history today.
4. **Sold behavior varies sharply by store** (live `available` distribution):
   flip-and-linger (sold → `available=false`, stays listed): lobscur 90%,
   lesarchives 89%, esco 66%, **dolcevitahub 63%** (74% of all inventory), atdawn
   60%, graindesell 57%. Delist-on-sale (sold → removed): dotcomme 0%, seys 1.5%,
   yourgarmentz 9%, nuovo 13%. ⇒ capture **both** transitions; no single sold
   rule fits all stores.

## Decision summary

- **Capture model:** daily full snapshot of **all** rows (incl.
  `available=false`). Touches zero existing read/write logic; ~1–3 GB/yr; daily
  resolution is ample for day-to-week resale lifecycles. Chosen over hourly
  (~6–73 GB, redundant) and event/delta (cheaper but edits existing read paths).
- **Sold signal:** track both `available` true→false (sold-by-flip) and
  departure (sold-by-delist); the lifecycle view computes both.
- **Analysis surface:** private `/admin` dashboard reading **saved SQL views**.
- **v1 panels:** sell-through velocity · brand/category turnover · inventory
  flow. (Price behavior + an *era* breakdown deferred — era has no data source
  yet; would need tags / title-parsing / enrichment.)
- **Feed unaffected:** storefront already filters `available=true` via
  `withVisibility`; the history table is write-only for analytics and never feeds
  the storefront.

---

## Phase 1 — Capture (build first)

### New table (create via Supabase SQL Editor — MCP is read-only)

```sql
CREATE TABLE inventory_snapshots (
  id           bigserial PRIMARY KEY,
  observed_at  timestamptz NOT NULL,   -- = cron syncStart of the capturing run
  handle       text NOT NULL,
  store_domain text NOT NULL,
  shopify_id   bigint,
  brand        text,
  title        text,
  name         text,
  category     text,
  subcategory  text,
  price        text,                   -- mirror canonical TEXT '€xx.xx'
  available    boolean,
  hidden       boolean
);
CREATE INDEX idx_inv_snap_observed     ON inventory_snapshots (observed_at);
CREATE INDEX idx_inv_snap_handle_store ON inventory_snapshots (handle, store_domain, observed_at);
```

### Capture logic — new `app/lib/captureInventorySnapshot.js` (strictly additive)

One exported function, called once at the **end** of the cron:
1. **Daily gate** — read latest `observed_at`; if its date == today's, return
   (no-op on the other ~23 runs/day).
2. **Re-read** all rows via paged `.range()` (PAGE 1000), selecting the columns
   above, stamping `observed_at = syncStart`. (Captures *post-enrichment*
   editorial from prior runs.)
3. **Bulk insert** into `inventory_snapshots` in batches of 500.
4. Whole body wrapped in one swallowing `try/catch` → `console.error` —
   **mirrors the `enrich_runs` pattern** ([route.js:298-313](../app/api/cron/route.js)).

### Hook point

[app/api/cron/route.js](../app/api/cron/route.js) Stage 5 — after the `enrich_runs`
insert and the `waitUntil` enrich-trigger/FX-refresh. Wrap the call in
`waitUntil(...)` (like `refreshFxRates`) so it adds zero response latency.

### Failure isolation (non-negotiable)

Runs **after** upsert + stale-delete + enrich trigger; separate statement,
separate table, no shared transaction; own swallowing catch (+ `waitUntil`); not
inside the `Promise.allSettled` store map, so it can never affect
`successfulDomains` or the stale-delete (the 2026-05-05 incident failure mode). A
missing/broken table is a silent no-op (supabase-js doesn't throw on SQL errors).

### Cold-start seed (one-time)

On first deploy, run one capture immediately so all ~21k current rows get a t0
baseline. Optionally import `products_pre_subcategory_snapshot` (full rows @
2026-05-21) as an earlier historical point — a free ~2.5-week head start.

### Storage

~20,972 rows/day × 365 ≈ 7.6M rows/yr ≈ 1–3 GB/yr incl. indexes. Keep
indefinitely; revisit a rollup/retention policy after a year of data.

### Phase 1 verification

1. Create `inventory_snapshots` in Supabase SQL Editor.
2. Deploy to Vercel; trigger one cron run. Confirm ~21k rows land with today's
   `observed_at` and the cron summary/errors are unchanged.
3. Trigger a second same-day run → daily gate early-returns (no duplicate set).
4. Failure-isolation test: point the helper at a bad table name once → cron still
   returns 200 with a normal summary and only a `console.error`.
5. Spot-check `GROUP BY brand` over one snapshot returns sensible counts.

---

## Phase 2 — Insights dashboard (deferred until data accumulates)

### Saved SQL views (the math layer — created in SQL Editor)

- **`v_product_lifecycle`** — per `(handle, store_domain)`: `first_seen`
  (min observed_at), `last_seen` (max), `sold_at_flip` (first snapshot where
  `available` went true→false), `departed_at` (last_seen when the row no longer
  appears in the newest snapshot), `days_to_sell_flip`, `days_to_departure`,
  latest `brand`/`category`/`subcategory`/`price`, current status.
- **`v_brand_turnover`** / **`v_category_turnover`** — departures (and flips) per
  period ÷ average active = turnover rate, per brand / category.
- **`v_daily_flow`** — arrivals vs departures per day + net inventory.

### Dashboard page (thin — reads views, no heavy logic)

Private page under `/admin` (already 404s in prod via `middleware.js`). v1
layout:
- **KPI cards:** active now · sold/left this period · median days-to-sell · new
  arrivals.
- **Sell-through velocity:** days-to-sell distribution + fastest-moving brands
  (uses `days_to_sell_flip` for flip-and-linger stores, `days_to_departure` for
  delist stores).
- **Turnover (demand proxy):** ranked bars by brand and category.
- **Inventory flow:** arrivals vs departures over time + net line.
- Date-range + store filter; per-store breakdown table.

Charts via a small lib (e.g. Recharts) or plain CSS bars — decided during the
Phase 2 spec (check for an existing charting dep first).

### Deferred (not v1)

- **Price behavior** panel (price-over-time, drop-before-sale).
- **Era** breakdown — needs an era source first (Shopify tags / title-parsing /
  enrichment); decide before building the panel.

---

## Sequencing

Build & ship **Phase 1** now (stop the data loss); it's safe and self-contained.
Phase 2 gets its own spec once a few weeks of snapshots exist to render. Each
phase is reviewed before any code is written.
