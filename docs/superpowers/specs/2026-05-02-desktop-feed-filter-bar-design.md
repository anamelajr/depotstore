# Desktop feed filter bar & panel — design

**Status:** Approved
**Date:** 2026-05-02
**Scope:** `/feed` page, desktop only (≥ `md` breakpoint)

## Summary

Add a floating bottom-center bar to the feed page on desktop with two halves —
**FILTERS** and **SORT**. FILTERS opens a left-side slide-in panel with a dim
overlay; SORT opens a small popover dropdown. Filters apply immediately on
selection (no Apply button) and are written to the same URL params the feed
already uses. The existing mobile Refine/Sort flow is untouched.

The change also exposes two sort options that the API already supports but the
UI hides: **Default** (the interleaved discovery sort) and **Oldest**. These
are added to both desktop and mobile via a single shared constant.

## Goals

- Match the visual references: Rick Owens for the floating bar, Maison Margiela
  for the panel layout.
- Reuse all existing feed state — no parallel state machine, no duplicated
  fetch logic.
- Preserve scroll restore, Load More, and URL-driven behavior exactly.
- Mirror the existing nav `SubcategoryList` typography and active-state
  treatment so the panel feels native to Dépôt.

## Non-goals

- No changes to `MobileFilterDrawer.js`, `MobileSortSheet.js` UX (only the
  shared sort options constant changes).
- No new feed filters (no brand filter, no size, no color — out of scope).
- No changes to `app/api/products/route.js` — the API already supports all 5
  sort modes.
- No refactor of category-list duplication. The category data stays duplicated
  in `MobileFilterDrawer`, the nav `SubcategoryList`, and the new
  `DesktopFilterPanel`. (Lift-out is a separate, future change.)

## Files

### New (3 components, 1 shared constant)

- `app/components/feed/DesktopFeedBar.js` — floating bottom-center bar.
- `app/components/feed/DesktopFilterPanel.js` — left-side slide-in panel +
  overlay.
- `app/components/feed/DesktopSortMenu.js` — popover dropdown anchored above
  the SORT button.
- `app/lib/sort-options.js` — single source of truth for sort UI options and
  UI-value → API-value mapping.

### Edited (2)

- `app/feed/FeedClient.js` — add two booleans for desktop UI state, render the
  three new components, import `SORT_OPTIONS` and `SORT_MAP` from the shared
  file, adjust default-sort handling so `interleaved` is a real selectable
  value, bump main bottom padding to `md:pb-32`.
- `app/components/MobileSortSheet.js` — delete its local `SORT_OPTIONS`
  constant, import from the shared file. Becomes a 5-option list automatically.

### Untouched

- `MobileFilterDrawer.js`, `app/api/products/route.js`, the nav, scroll-restore
  logic, Load More logic.

## Component specs

### `DesktopFeedBar.js`

**Props**
```
activeFilterCount: number
activeSortValue:   string         // "interleaved" | "latest" | ...
sortOpen:          boolean        // for active-tint on the SORT button
onOpenFilters:     () => void
onToggleSort:      () => void
```

**Position & visibility**
- `fixed`, `bottom: 24px`, horizontally centered (`left-1/2 -translate-x-1/2`).
- `z-index: 30`.
- `hidden md:flex` — never rendered below `md`.
- Always visible while scrolling. No hide-on-scroll-down behavior.

**Style**
- Width 360px, height 48px. Two equal halves (`flex-1`), 1px vertical divider
  (`border-l border-zinc-800` on the right half).
- `bg-zinc-900`, `border border-zinc-800`,
  `shadow-[0_8px_28px_rgba(0,0,0,0.6)]`.
- No rounded corners.
- Buttons: `font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-50`.
- Hover: `hover:bg-white/5`. SORT button gets `bg-white/5` while
  `sortOpen === true`.

**Active count / label**
- FILTERS button shows ` · N` suffix when `activeFilterCount > 0`.
- SORT button label is always "SORT" (the active value is shown inside the
  dropdown via the `—` indicator).

### `DesktopFilterPanel.js`

**Props**
```
isOpen:              boolean
onClose:             () => void
selectedCategories:  string[]
onToggleCategory:    (slug: string) => void
selectedStore:       string
storeOptions:        { value, label }[]
onStoreChange:       (value: string) => void
onClearAll:          () => void
```

**Layout**
- Overlay: `fixed inset-0 bg-black/50`, `z-index: 40`. Click closes.
- Panel: `fixed left-0 top-0 h-screen w-[360px] bg-[#0a0a0a]
  border-r border-zinc-800`, `z-index: 50`. Slides in from
  `transform: translateX(-100%)` → `translateX(0)` with
  `transition-transform duration-300 ease-out`.
- Body scroll locked while open (`document.body.style.overflow = "hidden"`).

**Header (56px)**
- Border-bottom `border-zinc-800`.
- Left: `REFINE` label, `font-mono text-[11px] uppercase tracking-widest
  text-zinc-50`.
- Right: typographic `×` close button, `text-zinc-400 hover:text-zinc-50`.

**Body**

Two sections, in order:

1. **STORE**
   - Section label: `font-mono text-[10px] uppercase tracking-[0.22em]
     text-zinc-600`, `pb-3`.
   - Rows: "All Stores" + each entry from `storeOptions`.
   - Row style (matches nav `SubcategoryList`):
     `block py-2 font-mono text-[11px] uppercase tracking-widest text-zinc-300
     hover:text-zinc-50`.
   - Active row: `text-zinc-50` + `<span class="-ml-4 mr-1">— </span>` prefix.
   - Single-select. Clicking a non-active store calls
     `onStoreChange(opt.value)`. Clicking the currently active store calls
     `onStoreChange(ALL_STORES_VALUE)` (toggles back to "All Stores"),
     matching the existing `MobileFilterDrawer` behavior. Clicking the
     "All Stores" row when it is already active is a no-op.

2. **CATEGORY**
   - Same section label style.
   - Vertical list grouped by parent. Sub-categories indented (`pl-4`).
   - Group order and items match the existing `MobileFilterDrawer`
     `CATEGORY_GROUPS` exactly:
     - Tops → All Tops, Hoodies & Sweaters, Shirts & Blouses, Tees, Knitwear
     - Bottoms
     - Dresses & Skirts
     - Jackets & Coats
     - Footwear
     - Bags & Accessories
     - Sets
   - Multi-select. Click toggles via `onToggleCategory`.
   - Active row treatment identical to STORE.

**Footer**
- Sticky bottom, border-top `border-zinc-800`.
- Single "RESET" link: `font-mono text-[11px] uppercase tracking-widest
  text-zinc-400 hover:text-zinc-50`. Calls `onClearAll`. Does not close the
  panel.

**Keyboard & a11y**
- `Escape` closes the panel.
- Focus moves to the close button on open, restores to the FILTERS bar button
  on close.
- Panel: `role="dialog" aria-modal="true" aria-label="Refine filters"`.
- Overlay: `aria-hidden="true"`.

### `DesktopSortMenu.js`

**Props**
```
isOpen:        boolean
onClose:       () => void
selectedSort:  string
onSortChange:  (value: string) => void
```

**Position**
- Rendered inside the same wrapper as the bar.
- `position: absolute`, `bottom: calc(100% + 8px)`, `right: 0` — sits 8px above
  the SORT half.
- Width 220px, `bg-zinc-900`, `border border-zinc-800`,
  `shadow-[0_8px_28px_rgba(0,0,0,0.6)]`.

**Items**
- Five rows, in this exact order: Default, Newest, Oldest,
  Price low → high, Price high → low.
- Row: full-width, left-aligned text, `font-mono text-[11px] uppercase
  tracking-[0.18em] text-zinc-400 hover:text-zinc-50 hover:bg-white/5`,
  `px-4 py-3`.
- Active row: `text-zinc-50`, trailing `—` aligned right (matches
  `MobileSortSheet`).

**Behavior**
- Closes on: outside click, `Escape`, opening the FILTERS panel, selecting an
  option.
- Does NOT lock body scroll.

### `app/lib/sort-options.js`

```js
export const SORT_OPTIONS = [
  { value: "interleaved", label: "Default" },
  { value: "latest",      label: "Newest" },
  { value: "oldest",      label: "Oldest" },
  { value: "price_asc",   label: "Price low → high" },
  { value: "price_desc",  label: "Price high → low" },
];

// UI value → API "sort" param value. null means: omit ?sort= entirely
// (the API treats absent ?sort= as the interleaved discovery RPC).
export const SORT_MAP = {
  interleaved: null,
  latest:      "newest",
  oldest:      "oldest",
  price_asc:   "price_asc",
  price_desc:  "price_desc",
};
```

## `FeedClient.js` changes

**Imports**
```js
import { SORT_OPTIONS, SORT_MAP } from "../lib/sort-options";
import DesktopFeedBar    from "../components/feed/DesktopFeedBar";
import DesktopFilterPanel from "../components/feed/DesktopFilterPanel";
import DesktopSortMenu   from "../components/feed/DesktopSortMenu";
```
Remove the existing inline `const SORT_MAP = ...` and the
`import { SORT_OPTIONS } from "../components/MobileSortSheet";`.

**State delta**
```js
const [desktopFilterOpen, setDesktopFilterOpen] = useState(false);
const [desktopSortOpen,   setDesktopSortOpen]   = useState(false);
```

**Helpers**
```js
const openDesktopFilter = useCallback(() => {
  setDesktopSortOpen(false);
  setDesktopFilterOpen(true);
}, []);
const toggleDesktopSort = useCallback(() => {
  setDesktopFilterOpen(false);
  setDesktopSortOpen(o => !o);
}, []);
```

**Default-sort handling**
- Change `urlSort` initializer:
  `const urlSort = searchParams.get("sort") || "interleaved";`
  (was `"latest"`).
- In `handleSortChange(v)`: if `v === "interleaved"`, delete the `sort` param
  from the URL (instead of setting it). All other values are set as today.
- In both fetch effects, replace
  `if (urlSort && urlSort !== "latest") params.set("sort", SORT_MAP[urlSort] || "newest");`
  with:
  ```js
  const apiSort = SORT_MAP[urlSort];
  if (apiSort) params.set("sort", apiSort);
  ```
  This makes `interleaved` (the new default) omit `?sort=`, so the API falls
  through to the existing `get_interleaved_products` RPC code path —
  unchanged behavior for users on `/feed` with no sort param.

**Resize edge case**
Add an effect that listens for `matchMedia("(max-width: 767px)")` change and
calls `setDesktopFilterOpen(false); setDesktopSortOpen(false);` when the
viewport drops below `md`. Prevents stuck body scroll lock.

**JSX additions** (placed inside the existing `<div>` tree, alongside the
existing `<MobileFilterDrawer>` and `<MobileSortSheet>`):
```jsx
<DesktopFeedBar
  activeFilterCount={activeFilterCount}
  activeSortValue={selectedSort}
  sortOpen={desktopSortOpen}
  onOpenFilters={openDesktopFilter}
  onToggleSort={toggleDesktopSort}
/>
<DesktopFilterPanel
  isOpen={desktopFilterOpen}
  onClose={() => setDesktopFilterOpen(false)}
  selectedCategories={localCategories}
  onToggleCategory={handleToggleCategory}
  selectedStore={localStore}
  storeOptions={storeOptions}
  onStoreChange={handleStoreChange}
  onClearAll={handleClearAll}
/>
<DesktopSortMenu
  isOpen={desktopSortOpen}
  onClose={() => setDesktopSortOpen(false)}
  selectedSort={selectedSort}
  onSortChange={handleSortChange}
/>
```

**Padding bump**
- `<main>` className: `pb-24` → `pb-24 md:pb-32`.

## `MobileSortSheet.js` changes

- Remove the local `export const SORT_OPTIONS = [...]`.
- `import { SORT_OPTIONS } from "../lib/sort-options";`
- No other changes — the existing `onSortChange(opt.value)` flow already routes
  through `FeedClient.handleSortChange`, which now handles `interleaved` and
  `oldest` correctly.

## Z-index map (post-change, full app)

| Layer                              | z-index |
|------------------------------------|---------|
| Mobile sticky header               | 20      |
| Desktop floating bar               | 30      |
| Desktop sort menu (in bar wrapper) | 30      |
| Desktop panel overlay              | 40      |
| Desktop panel                      | 50      |
| Mobile drawers (drawer/sheet)      | 9998–9999 |

The desktop panel uses lower z-indices than the mobile drawers because they
never coexist (separate breakpoints).

## Verification

Per `CLAUDE.md`, **Vercel is the source of truth for behavior verification.**

1. Local: `npm run lint`, `npm run build` must pass.
2. Push to a branch. Open the Vercel preview URL.
3. **Desktop checks (≥ md):**
   - Floating bar visible at bottom-center on initial load and after scroll.
   - FILTERS click → panel slides in, overlay dims feed, body scroll locked.
   - `Escape`, overlay click, and `×` button all close the panel.
   - Selecting a store updates URL (`?store=...`), feed refetches, active row
     shows `— ` prefix.
   - Toggling a category updates URL (`?category=...`), refetches, multi-select
     stacks correctly.
   - RESET clears URL to `/feed`; panel stays open.
   - SORT click → dropdown opens above SORT button.
   - Outside click, `Escape`, and selecting an option all close the dropdown.
   - "Default" selection → URL has no `sort` param; "Default" stays
     highlighted on reload.
   - "Oldest" selection → URL `?sort=oldest`; feed re-orders.
4. **Mobile checks (< md):**
   - Existing mobile sticky bar untouched (no double bar, no overlap).
   - Mobile sort sheet shows 5 options.
5. **Cross-cut:**
   - Click product → Back button → scroll position and product count
     restored.
   - Load More works on desktop with the bar visible; bar does not overlap
     "Load More" button.
   - Resize across the `md` boundary while panel is open → panel closes
     cleanly, body scroll restored.

## Risks / open questions

- **Category list duplication.** A 4th copy of the category-group structure
  ships with this change. Acceptable per the project workflow rule, but worth
  flagging as a future cleanup.
- **Bar visual weight on small desktop viewports.** 360px is fine at typical
  desktop widths but could feel chunky on a narrow window between `md` (768px)
  and ~1000px. Verify on Vercel preview at varied widths and trim width if
  needed.
- **Editorial preference on the bar's color.** `bg-zinc-900` against the
  `#0a0a0a` feed gives a subtle distinction. If a user-tested screenshot shows
  it disappearing, swap to `bg-[#161616]` or similar before merging.
