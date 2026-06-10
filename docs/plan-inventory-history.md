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

### New table (versioned migration → applied via Supabase SQL Editor)

Commit the DDL as `scripts/sql/2026-06-06-inventory-snapshots.sql` — matching the
repo's `scripts/sql/` migration convention (e.g. `2026-06-01-fx-rates.sql`) — then
apply it through the SQL Editor (MCP is read-only). A committed script keeps the
schema reproducible and reviewable, per CLAUDE.md "schema changes apply before
dependent code merges."

```sql
CREATE TABLE inventory_snapshots (
  id            bigserial PRIMARY KEY,
  observed_at   timestamptz NOT NULL,   -- = cron syncStart of the capturing run
  observed_date date GENERATED ALWAYS AS ((observed_at AT TIME ZONE 'UTC')::date) STORED,
  handle        text NOT NULL,
  store_domain  text NOT NULL,
  shopify_id    bigint,
  brand         text,
  title         text,
  name          text,
  category      text,
  subcategory   text,
  price         text,                   -- mirror canonical TEXT '€xx.xx'
  available     boolean,
  hidden        boolean,
  -- One row per product per UTC day. Makes the daily insert idempotent and
  -- closes the read-then-insert duplicate-day race (insert uses ON CONFLICT
  -- DO NOTHING against this constraint).
  UNIQUE (handle, store_domain, observed_date)
);
CREATE INDEX idx_inv_snap_observed     ON inventory_snapshots (observed_at);
CREATE INDEX idx_inv_snap_handle_store ON inventory_snapshots (handle, store_domain, observed_at);
```

### Capture logic — new `app/lib/captureInventorySnapshot.js` (strictly additive)

One exported function, `captureInventorySnapshot(syncStart, summary)`, called once
near the end of the cron:
1. **Clean-run gate** — if `summary.errors.length > 0`, **skip** (return). On a
   partial run, errored stores keep stale, un-reconciled rows in `products`
   ([cron/route.js:222-266](../app/api/cron/route.js)); snapshotting then would
   freeze contaminated data for the day. Skipping lets a later clean run capture.
   (Trade-off: an all-day store outage yields a missing day — preferable to a
   contaminated one.)
2. **Daily gate** — read the latest `observed_at`; if its UTC date == `syncStart`'s
   UTC date, return (no-op on the other ~23 runs/day). Because the gate keys off a
   *successful* prior insert, a transient failure **self-heals**: the next hourly
   run retries until one clean run lands the day.
3. **Re-read** all rows via paged `.range()` (PAGE 1000) **with a deterministic
   `.order("id", { ascending: true })`** — without an explicit order, concurrent
   writes can make pages skip or duplicate rows, and a skipped row would later read
   as a false *departure*. Every existing paged read orders first
   ([products/route.js:204-206](../app/api/products/route.js)). Stamp each row
   `observed_at = syncStart`.
4. **Idempotent bulk insert** into `inventory_snapshots` in batches of 500 via
   `upsert(batch, { onConflict: "handle,store_domain,observed_date", ignoreDuplicates: true })`
   — ON CONFLICT DO NOTHING, belt-and-suspenders with the UNIQUE constraint.
5. **Structured logging, not silent swallow** — wrap the body in `try/catch`, but
   check the supabase `error` *and* catch thrown exceptions; on either, emit
   `console.error(JSON.stringify({ event: "inventory_snapshot_fail", error }))`, and
   on success `console.log(JSON.stringify({ event: "inventory_snapshot_ok", rows }))`.
   Also stash `summary.snapshot = { captured, rows }` for the response. This mirrors
   the **FX-refresh** precedent ([cron/route.js:282-296](../app/api/cron/route.js)),
   which deliberately does *not* swallow silently — inventory history is data, not
   throwaway telemetry, so a persistent failure must be alertable. Errors are caught
   (never rethrown), so the cron response is unaffected.

### Hook point

[cron/route.js](../app/api/cron/route.js) — **after the stale-delete block (~:266)
and *before* the `waitUntil` enrich trigger (~:268)**, `await`ed. This placement
gives the clean-run gate access to `summary.errors`/`summary.deleted`, and captures
a **deterministic pre-enrich state** for this run (the enrich invocation that
mutates `brand`/`title`/`category`/`subcategory`/`hidden` hasn't been triggered
yet). Awaiting adds latency only on the ~once/day run that actually captures; the
other ~23 runs hit the cheap gate and return immediately, well within
`maxDuration = 300`.

### Failure isolation (non-negotiable)

Runs **after** the upsert + stale-delete (never inside the `Promise.allSettled`
store map), so it can never affect `successfulDomains` or the stale-delete (the
2026-05-05 incident failure mode). Separate statement, separate table, no shared
transaction with the inventory write path. Its own `try/catch` catches and logs
every failure without rethrowing — so a broken/missing table or a failed insert
degrades to a logged no-op, never a blocked or corrupted sync.

### Cold-start seed (one-time)

On first deploy, run one capture immediately so all ~21k current rows get a t0
baseline. Optionally import `products_pre_subcategory_snapshot` (full rows @
2026-05-21) as an earlier historical point — a free ~2.5-week head start.

### Storage

~20,972 rows/day × 365 ≈ 7.6M rows/yr ≈ 1–3 GB/yr incl. indexes. Keep
indefinitely; revisit a rollup/retention policy after a year of data.

### Phase 1 verification

> **Vercel only — never trigger `/api/cron` (or `/api/enrich`) locally.** Both
> write production rows and spend OpenAI (CLAUDE.md Workflow rule). All checks
> below run against a Vercel deployment.

1. Apply `scripts/sql/2026-06-06-inventory-snapshots.sql` via the SQL Editor.
2. Deploy to Vercel; trigger one cron run. Confirm ~21k rows land with today's
   `observed_at`, the dedup count matches `COUNT(*) = COUNT(DISTINCT handle||store_domain)`
   for the day (no skips/dups from pagination), and the cron summary/errors are
   unchanged.
3. **Daily gate:** trigger a second same-day run → no new rows (gate early-returns).
4. **Idempotency:** the `ON CONFLICT DO NOTHING` + UNIQUE constraint means even a
   forced double-capture for one day cannot create duplicate per-product rows.
5. **Clean-run gate:** on a run where a store errored (`summary.errors` non-empty),
   confirm capture is skipped and a later clean run captures the day.
6. **Failure isolation:** point the helper at a bad table name once → cron still
   returns 200 with a normal summary and an `inventory_snapshot_fail` log line.
7. Spot-check `GROUP BY brand` over one snapshot returns sensible counts.

---

## Phase 2 — Insights dashboard (deferred until data accumulates)

### Saved SQL views (the math layer — created in SQL Editor)

- **`v_product_lifecycle`** — per `(handle, store_domain)`: `first_seen`
  (min observed_at), `last_seen` (max), `sold_at_flip` (first snapshot where
  `available` went true→false), `departed_at` (last_seen when the row no longer
  appears in the newest snapshot), `days_to_sell_flip`, `days_to_departure`
  (both ±1-day resolution — see Known limitations), `first_seen_censored`
  (boolean: `first_seen <= deploy_date`, so velocity is a lower bound), latest
  `brand`/`category`/`subcategory`/`price`, current status. Needs concrete SQL
  authored in the Phase 2 spec.
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

## Known limitations & accepted tradeoffs

Both are inherent to the daily-snapshot choice and are accepted for v1 — recorded
here so the analytics are read with the right caveats, not silently trusted.

- **Daily resolution under-measures fast movers.** An item that appears and
  sells/delists *between* two daily snapshot ticks is captured coarsely (±1-day
  resolution, ~1-day floor) or, if it never spans a tick, **missed entirely**.
  This bias lands hardest on the "fastest movers" panel — the very thing it's
  meant to surface. Accepted because resale lifecycles run days-to-weeks, not
  hours. **Cheap future upgrade if sub-day precision is wanted:** add an hourly
  *pre-delete departure capture* (the investigation's "Candidate C" — a `SELECT`
  with the stale-delete's predicate, run just before [cron/route.js:256](../app/api/cron/route.js))
  to log exact departures, without paying for hourly full snapshots.
- **`first_seen` is left-censored for the existing backlog.** The cold-start seed
  stamps all ~21k current rows with `first_seen = deploy day`, so velocity for
  pre-existing inventory is a *lower bound* until those items churn through (the
  optional 2026-05-21 backfill softens this by ~2.5 weeks, partially). Items that
  *arrive after* deploy have accurate `first_seen`. Surface a "first seen ≥ deploy
  date" flag in `v_product_lifecycle` so the dashboard can exclude or annotate
  censored rows.

---

## Sequencing

Build & ship **Phase 1** now (stop the data loss); it's safe and self-contained.
Phase 2 gets its own spec once a few weeks of snapshots exist to render. Each
phase is reviewed before any code is written.
