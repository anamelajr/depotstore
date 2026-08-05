# Inventory dashboard: quick-wins clarity pass

## Context

The `/admin/inventory` dashboard is hard to interpret. Three cheap fixes were agreed:

1. **Show the hidden numbers.** `rankTurnover` (app/lib/inventoryAnalytics.js) already
   computes `turnoverRate` (% of a brand's/category's tracked items that exited) and
   `avgDaysToSell` (how fast they move), but the brand/category charts display only the
   raw `exited` count. Raw counts just reward the biggest store. NOTE (Codex round 2):
   exits mix true sales with plain removals (`isExited` counts `sold` + `departed`), so
   every UI label must say "left" / "sold or removed" — never bare "% sold" or "demand".
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
- **Denominator contract (Codex round 3):** with a date window active, the rows reaching
  `rankTurnover` are (active now) + (exited in window) per brand — which is identically
  (stock present at window start) + (arrivals during the window), the standard simple
  sell-through denominator. Codex's claim that this is a survivor-biased cohort is
  incorrect (pre-window exits are excluded from numerator AND denominator; every
  start-of-window and mid-window item is included), but two residues are real and are
  adopted: (a) captions/tooltips state the formula explicitly — "left ÷ (stock at window
  start + new arrivals)" — instead of a vague phrase; (b) the metric is not
  exposure-weighted (a day-29 arrival counts as fully exposed) — named as a caption-level
  limitation; an item-days exposure metric goes to Not in scope.
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
  - richer tooltip: **% left (sold or removed)**, avg days to leave, left, active, total
    tracked — no tooltip or label field may read "% sold" (exits include plain removals);
  - panel titles drop the demand claim: "Brand turnover — % of stock that left" /
    "Category turnover — % of stock that left" (replacing "exited (demand proxy)");
  - `—` for days when `avgDaysToSell` is null.
- Captions wired from props:
  - Velocity: "How long items take to leave. Only items first listed after tracking
    started are counted (N of M exits in this window)."
  - Flow: "New listings vs removals per day, all stores combined." When a store filter is
    active, make the all-stores scope a full caption sentence, not just a title suffix.
  - Brand/category: "% = items that left ÷ items available in the window (stock at the
    start + new arrivals) — sold or removed; stores don't reliably distinguish, and a
    late arrival counts as fully available. Brands with under 20 tracked items are
    hidden so one big store can't dominate. Days = average time to leave."

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
- Add a case: rows with `current_status: "departed"` (non-sale removals) count into
  `exited`/`turnoverRate` — locking in that the field is "left", not "sold"; the UI
  label contract above is what keeps the wording honest.
- Denominator boundary cases (Codex round 3), via `filterLifecycle` + `rankTurnover`
  composed: a pre-window exit appears in neither numerator nor denominator; a mid-window
  arrival still active appears in the denominator only; an item present at window start
  that exits in-window appears in both — proving denominator = start stock + arrivals.

## Not in scope
- Per-store flow chart (v_daily_flow has no store grain in v1) — caption only.
- Sold-vs-removed split (a true sales-only ranking restricted to reliable flip signals),
  price/GMV panels, aging report, brand-alias normalization — later phases. This pass
  only makes the labels honest about the mix.
- Exposure-weighted turnover (item-days denominator) — the simple sell-through rate is
  kept for v1 with its limitation stated in the caption.

## Verification
- `npm test -- inventoryAnalytics` passes.
- Load `http://localhost:3000/admin/inventory` (read-only page; safe against prod DB):
  captions render; brand bars show "% · days" labels; pick a store + "Last 7 days" and
  confirm the per-store table shrinks to that store and counts change with the window.
