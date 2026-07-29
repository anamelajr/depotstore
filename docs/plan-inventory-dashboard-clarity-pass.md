# Inventory dashboard: quick-wins clarity pass

## Context

The `/admin/inventory` dashboard is hard to interpret. Three cheap fixes were agreed:

1. **Show the hidden numbers.** `rankTurnover` (app/lib/inventoryAnalytics.js) already
   computes `turnoverRate` (% of a brand's/category's tracked items that exited — the real
   demand signal) and `avgDaysToSell` (how fast they move), but the brand/category charts
   display only the raw `exited` count. Raw counts just reward the biggest store.
2. **Make the filters honest.** The store/date selectors update the KPI cards and the top
   charts, but the per-store table is hard-coded to all-time/all-stores
   (`storeSummary(observed)` at inventoryAnalytics.js:264), and the flow chart is always
   global. The page half-responds to filters with no visible explanation.
3. **Plain-English captions.** Each panel gets one muted sentence saying what it shows and
   what it excludes — especially the velocity histogram / median, which silently cover only
   items first seen after tracking began ("based on N of M exits").

## Changes

### 1. `app/lib/inventoryAnalytics.js`
- `getInventoryInsights`: pass the **date-windowed, store-filtered** `rows` to
  `storeSummary` instead of all-time `observed` (update the "always all-time" comment).
- Add to `meta`: `sellableExits` (count of rows passing `isSellable`) so the page can
  caption "velocity based on N of M exits" (M = `kpis.exitedPeriod`).
- `rankTurnover`: add a **minimum-sample guard** for rate ranking — only groups with
  `total >= MIN_TURNOVER_SAMPLE` (20) are eligible for the top-12 by `turnoverRate`;
  smaller groups are dropped from the chart (they'd otherwise fake 100% rates off 2–3
  items). Sort by `turnoverRate` desc, tie-break by `exited` desc. Keep the exported
  shape unchanged otherwise so tests extend rather than rewrite.
- **Unit contract (Codex adversarial finding):** `turnoverRate` stays a 0–1 fraction
  internally; each group additionally gets `turnoverPct` = `Math.round(turnoverRate *
  1000) / 10` (0–100, one decimal). The chart, axis, labels, and tooltip all use
  `turnoverPct` exclusively — never plot the fraction on a 0–100 axis, and never scale
  only in the label formatter.

### 2. `app/admin/inventory/_components/InventoryCharts.js`
- `Panel`: accept an optional `caption` prop — small muted line under the title.
- `TurnoverBars`: re-orient the chart around demand, not volume, to counter the
  Dolce-Vita-Hub saturation (one store's 12k exits currently dominates every ranking):
  - bars plot **`turnoverPct`** (0–100, from the unit contract above) with an explicit
    axis domain `[0, 100]`, ranked by rate;
  - visible right-side label: `"62% · 9d · 310 items"` (rate · avg days · tracked count);
  - richer tooltip: % sold, avg days-to-sell, exited, active, total tracked;
  - `—` for days when `avgDaysToSell` is null.
- Captions wired from props:
  - Velocity: "How long items take to leave. Only items first listed after tracking
    started are counted (N of M exits in this window)."
  - Flow: "New listings vs removals per day, all stores combined." When a store filter is
    active, make the all-stores scope a full caption sentence, not just a title suffix.
  - Brand/category: "Ranked by the share of each brand's stock that left in this window
    (brands with under 20 tracked items are hidden) — so one big store can't dominate
    the ranking. Days = average time to leave."

### 3. `app/admin/inventory/page.js`
- Thread `meta.sellableExits` / `kpis.exitedPeriod` into the captions.
- KPI cards: one-line muted sub-caption each (e.g. Sold/left: "sold or removed —
  stores don't always distinguish"; Median: "only items listed after tracking began").
- Per-store table: now follows the filters; add caption "Follows the filters above."
  With a store selected it naturally shows a single row.

### 4. Tests — `app/lib/__tests__/inventoryAnalytics.test.js`
- Update the `getInventoryInsights` integration expectations: `storeBreakdown` is now
  windowed/filtered; assert new `meta.sellableExits`.
- `rankTurnover`: new cases — sorts by rate desc; drops groups below the 20-item
  sample floor; tie-breaks by exited count; `turnoverRate: 0.62` yields
  `turnoverPct: 62` (and e.g. `0.625` → `62.5`). No React render tests — the repo has
  no component-test infra; axis/label agreement is covered by the shared `turnoverPct`
  field plus the browser check in Verification.
- Add a case: date window excludes an old exit from `storeBreakdown` counts.

## Not in scope
- Per-store flow chart (v_daily_flow has no store grain in v1) — caption only.
- Sold-vs-removed split, price/GMV panels, aging report, brand-alias normalization —
  later phases.

## Verification
- `npm test -- inventoryAnalytics` passes.
- Load `http://localhost:3000/admin/inventory` (read-only page; safe against prod DB):
  captions render; brand bars show "% · days" labels; pick a store + "Last 7 days" and
  confirm the per-store table shrinks to that store and counts change with the window.
