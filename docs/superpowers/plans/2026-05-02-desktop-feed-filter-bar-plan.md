# Desktop Feed Filter Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop-only floating bottom-center bar to `/feed` with two halves (FILTERS / SORT). FILTERS opens a left-side slide-in panel; SORT opens a popover dropdown. Filters apply immediately on selection. Mobile flow untouched.

**Architecture:** Three new presentational components under `app/components/feed/`. UI state (panel/menu open) lives as two booleans in `FeedClient.js`. Filter writes go through the existing handlers (`handleStoreChange`, `handleToggleCategory`, `handleSortChange`, `handleClearAll`) — no new state machine, no parallel data layer. `SORT_OPTIONS` and `SORT_MAP` move to a shared `app/lib/sort-options.js` so mobile and desktop stay in sync, and the new "Default" (interleaved) and "Oldest" sort modes that the API already supports become selectable.

**Tech Stack:** Next.js App Router (no TypeScript), React 19, Tailwind CSS v4. No test framework in this project — verification is via `npm run lint`, `npm run build`, and Vercel preview deploy (per `CLAUDE.md`: "Treat Vercel as the source of truth for behavioural verification").

**Reference docs:**
- Spec: [docs/superpowers/specs/2026-05-02-desktop-feed-filter-bar-design.md](../specs/2026-05-02-desktop-feed-filter-bar-design.md)
- Visual references: Rick Owens (rickowens.eu) for the bar; Maison Margiela (maisonmargiela.com) for the panel layout.

**Branch:** `claude/affectionate-nightingale-110aee` (the current worktree's branch). Push commits as you go; open a PR after Task 4.

---

## Task 1: Shared sort-options module + expose Default & Oldest

**Goal:** Create a single source of truth for the sort UI options, migrate `MobileSortSheet` and `FeedClient` to use it, and adjust `FeedClient` so "Default" (interleaved) is a real selectable value rather than the absence-of-param fallback.

After this task: the mobile sort sheet shows 5 options instead of 3, and visiting `/feed` with no `sort` param shows "Default" highlighted in the mobile sheet.

**Files:**
- Create: `app/lib/sort-options.js`
- Modify: `app/components/MobileSortSheet.js`
- Modify: `app/feed/FeedClient.js`

---

- [ ] **Step 1.1: Create the shared sort-options module**

Create `app/lib/sort-options.js` with this exact content:

```js
// Single source of truth for sort UI options.
// Consumed by MobileSortSheet (mobile) and DesktopSortMenu (desktop).
//
// SORT_OPTIONS  — what the user sees and what gets written to the URL
// SORT_MAP      — UI value → API "sort" param value (null = omit ?sort=
//                 entirely; the API treats absent ?sort= as the
//                 interleaved discovery RPC)

export const SORT_OPTIONS = [
  { value: "interleaved", label: "Default" },
  { value: "latest",      label: "Newest" },
  { value: "oldest",      label: "Oldest" },
  { value: "price_asc",   label: "Price low → high" },
  { value: "price_desc",  label: "Price high → low" },
];

export const SORT_MAP = {
  interleaved: null,
  latest:      "newest",
  oldest:      "oldest",
  price_asc:   "price_asc",
  price_desc:  "price_desc",
};
```

- [ ] **Step 1.2: Migrate `MobileSortSheet.js` to import from the shared module**

In `app/components/MobileSortSheet.js`:

Replace the lines:
```js
"use client";

import { useEffect } from "react";

export const SORT_OPTIONS = [
  { value: "latest", label: "Latest arrivals" },
  { value: "price_asc", label: "Price: Low to high" },
  { value: "price_desc", label: "Price: High to low" },
];

export default function MobileSortSheet({ isOpen, onClose, selectedSort, onSortChange }) {
```

with:
```js
"use client";

import { useEffect } from "react";
import { SORT_OPTIONS } from "../lib/sort-options";

export default function MobileSortSheet({ isOpen, onClose, selectedSort, onSortChange }) {
```

The rest of the file is unchanged. The `SORT_OPTIONS.map(...)` JSX inside the sheet body now renders 5 options automatically.

- [ ] **Step 1.3: Update `FeedClient.js` imports and remove inline `SORT_MAP`**

In `app/feed/FeedClient.js`:

Replace these two lines near the top:
```js
import { SORT_OPTIONS } from "../components/MobileSortSheet";
import { ALL_STORES_VALUE, buildFeedUrl } from "../lib/feed-utils";
```

with:
```js
import { ALL_STORES_VALUE, buildFeedUrl } from "../lib/feed-utils";
import { SORT_OPTIONS, SORT_MAP } from "../lib/sort-options";
```

Then delete this line entirely (it was line 13 in the original file, just below the `LOAD_SIZE` constant):
```js
const SORT_MAP = { latest: "newest", price_asc: "price_asc", price_desc: "price_desc" };
```

- [ ] **Step 1.4: Change the default `urlSort` to `"interleaved"`**

In `app/feed/FeedClient.js`, find the line:
```js
const urlSort = searchParams.get("sort") || "latest";
```

Replace with:
```js
const urlSort = searchParams.get("sort") || "interleaved";
```

This is the only change needed for the URL → state direction. `selectedSort` (initialized from `urlSort`) and the existing `useEffect(() => { setSelectedSort(urlSort); }, [urlSort])` flow handle the rest.

- [ ] **Step 1.5: Update both fetch effects to use `SORT_MAP[urlSort]`**

In `app/feed/FeedClient.js`, find the line (it appears twice — once in the initial fetch effect, once in the Load More effect):
```js
if (urlSort && urlSort !== "latest") params.set("sort", SORT_MAP[urlSort] || "newest");
```

Replace BOTH occurrences with:
```js
const apiSort = SORT_MAP[urlSort];
if (apiSort) params.set("sort", apiSort);
```

This makes `interleaved` (the new default) omit the `sort` param so the API falls through to the existing `get_interleaved_products` RPC code path. `oldest` now correctly maps to `"oldest"` and gets passed through.

- [ ] **Step 1.6: Update `handleSortChange` to handle `"interleaved"` correctly**

In `app/feed/FeedClient.js`, find:
```js
const handleSortChange = useCallback((v) => {
  setSelectedSort(v);
  setSortOpen(false);
  const params = new URLSearchParams(searchParams.toString());
  params.delete("page");
  if (v === "latest") params.delete("sort");
  else params.set("sort", v);
  const q = params.toString();
  router.replace(`/feed${q ? `?${q}` : ""}`);
}, [searchParams, router]);
```

Replace with:
```js
const handleSortChange = useCallback((v) => {
  setSelectedSort(v);
  setSortOpen(false);
  const params = new URLSearchParams(searchParams.toString());
  params.delete("page");
  if (v === "interleaved") params.delete("sort");
  else params.set("sort", v);
  const q = params.toString();
  router.replace(`/feed${q ? `?${q}` : ""}`);
}, [searchParams, router]);
```

The only change is `"latest"` → `"interleaved"` on the param-deletion line. Selecting "Default" produces clean URLs with no `?sort=` noise; selecting any other value (including `latest`/`oldest`) writes the value directly.

- [ ] **Step 1.7: Run lint**

```bash
npm run lint
```

Expected: passes with no new errors. (The project has zero existing lint errors on the current `main`; if pre-existing warnings appear, ignore them but do not introduce new ones.)

- [ ] **Step 1.8: Run build**

```bash
npm run build
```

Expected: build succeeds. The build will execute `next build` which type-checks JS and bundles the app.

- [ ] **Step 1.9: Commit**

```bash
git add app/lib/sort-options.js app/components/MobileSortSheet.js app/feed/FeedClient.js
git commit -m "$(cat <<'EOF'
feat(feed): expose Default + Oldest sort options via shared module

Lift SORT_OPTIONS and SORT_MAP into app/lib/sort-options.js so mobile and
desktop stay in sync. Make "interleaved" (the existing API default) a real
selectable value labeled "Default", and expose "Oldest" which the API
already supports. URL convention is unchanged — Default still omits
?sort=, falling through to get_interleaved_products on the API side.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Desktop floating bar + sort menu

**Goal:** Add the floating bottom-center bar with FILTERS and SORT halves, and wire up the SORT dropdown so the full sort UX works on desktop. FILTERS button is wired to a state setter that nothing renders against yet — that gets connected in Task 3.

After this task: the bar is visible on desktop (≥ md), clicking SORT opens a 220px dropdown with the 5 options, selecting an option updates the URL and refetches, outside-click and Escape close the dropdown. Clicking FILTERS sets `desktopFilterOpen=true` (no visible effect until Task 3).

**Files:**
- Create: `app/components/feed/DesktopFeedBar.js`
- Create: `app/components/feed/DesktopSortMenu.js`
- Modify: `app/feed/FeedClient.js`

---

- [ ] **Step 2.1: Create `DesktopFeedBar.js`**

Create the directory and file `app/components/feed/DesktopFeedBar.js` with this exact content:

```jsx
"use client";

export default function DesktopFeedBar({
  activeFilterCount,
  sortOpen,
  onOpenFilters,
  onToggleSort,
}) {
  return (
    <div className="flex w-[360px] h-12 bg-zinc-900 border border-zinc-800 shadow-[0_8px_28px_rgba(0,0,0,0.6)]">
      <button
        type="button"
        onClick={onOpenFilters}
        className="flex-1 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-50 transition-colors hover:bg-white/5"
      >
        Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
      </button>
      <button
        type="button"
        data-sort-button
        onClick={onToggleSort}
        className={`flex-1 border-l border-zinc-800 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-50 transition-colors hover:bg-white/5 ${
          sortOpen ? "bg-white/5" : ""
        }`}
      >
        Sort
      </button>
    </div>
  );
}
```

The `data-sort-button` attribute is read by `DesktopSortMenu`'s outside-click handler (next step) so clicking the SORT button doesn't trigger an immediate close-then-reopen race.

- [ ] **Step 2.2: Create `DesktopSortMenu.js`**

Create `app/components/feed/DesktopSortMenu.js` with this exact content:

```jsx
"use client";

import { useEffect, useRef } from "react";
import { SORT_OPTIONS } from "../../lib/sort-options";

export default function DesktopSortMenu({
  isOpen,
  onClose,
  selectedSort,
  onSortChange,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      // Don't fire on the SORT bar button — its own onClick toggles the menu
      if (e.target.closest && e.target.closest("[data-sort-button]")) return;
      onClose();
    };

    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Sort options"
      className="absolute bottom-full right-0 mb-2 w-[220px] bg-zinc-900 border border-zinc-800 shadow-[0_8px_28px_rgba(0,0,0,0.6)] py-1.5"
    >
      {SORT_OPTIONS.map((opt) => {
        const active = selectedSort === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="menuitem"
            onClick={() => {
              onSortChange(opt.value);
              onClose();
            }}
            className={`flex w-full items-center justify-between px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors hover:bg-white/5 ${
              active ? "text-zinc-50" : "text-zinc-400 hover:text-zinc-50"
            }`}
          >
            <span>{opt.label}</span>
            {active && <span>—</span>}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2.3: Add desktop UI state and helpers in `FeedClient.js`**

In `app/feed/FeedClient.js`, find the existing mobile UI state block:
```js
  // Mobile UI state
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
```

Add three new lines right after it:
```js
  // Desktop UI state (≥ md)
  const [desktopFilterOpen, setDesktopFilterOpen] = useState(false);
  const [desktopSortOpen, setDesktopSortOpen] = useState(false);
```

So the block becomes:
```js
  // Mobile UI state
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // Desktop UI state (≥ md)
  const [desktopFilterOpen, setDesktopFilterOpen] = useState(false);
  const [desktopSortOpen, setDesktopSortOpen] = useState(false);
```

- [ ] **Step 2.4: Add the desktop open/toggle helpers in `FeedClient.js`**

Find the `handleClearAll` callback. Just BEFORE it, add these two helpers (they enforce mutual exclusion between the panel and the dropdown):

```js
  const openDesktopFilter = useCallback(() => {
    setDesktopSortOpen(false);
    setDesktopFilterOpen(true);
  }, []);

  const toggleDesktopSort = useCallback(() => {
    setDesktopFilterOpen(false);
    setDesktopSortOpen((o) => !o);
  }, []);
```

- [ ] **Step 2.5: Update `handleSortChange` to also close the desktop sort menu**

In `app/feed/FeedClient.js`, find `handleSortChange` (you edited it in Task 1). Change just the line that says:
```js
    setSortOpen(false);
```

to:
```js
    setSortOpen(false);
    setDesktopSortOpen(false);
```

The full `handleSortChange` after this edit:
```js
  const handleSortChange = useCallback((v) => {
    setSelectedSort(v);
    setSortOpen(false);
    setDesktopSortOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    if (v === "interleaved") params.delete("sort");
    else params.set("sort", v);
    const q = params.toString();
    router.replace(`/feed${q ? `?${q}` : ""}`);
  }, [searchParams, router]);
```

- [ ] **Step 2.6: Import the new components in `FeedClient.js`**

Near the top of the file, alongside the existing component imports:
```js
import MobileFilterDrawer from "../components/MobileFilterDrawer";
import MobileSortSheet from "../components/MobileSortSheet";
```

Add:
```js
import DesktopFeedBar from "../components/feed/DesktopFeedBar";
import DesktopSortMenu from "../components/feed/DesktopSortMenu";
```

- [ ] **Step 2.7: Render the floating bar wrapper at the end of the JSX**

In `app/feed/FeedClient.js`, find the closing `</main>` tag near the bottom. Right after it (still inside the `<div className="min-h-screen bg-[#0a0a0a] ...">` parent), add:

```jsx
        {/* ── DESKTOP: floating filter/sort bar (≥ md) ── */}
        <div className="hidden md:block fixed bottom-6 left-1/2 -translate-x-1/2 z-30">
          <DesktopSortMenu
            isOpen={desktopSortOpen}
            onClose={() => setDesktopSortOpen(false)}
            selectedSort={selectedSort}
            onSortChange={handleSortChange}
          />
          <DesktopFeedBar
            activeFilterCount={activeFilterCount}
            sortOpen={desktopSortOpen}
            onOpenFilters={openDesktopFilter}
            onToggleSort={toggleDesktopSort}
          />
        </div>
```

The wrapper is `position: fixed`, which makes it the positioning context for `DesktopSortMenu`'s `position: absolute` (so the menu sits 8px above the bar, aligned to the right half).

- [ ] **Step 2.8: Run lint**

```bash
npm run lint
```

Expected: passes.

- [ ] **Step 2.9: Run build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 2.10: Commit**

```bash
git add app/components/feed/DesktopFeedBar.js app/components/feed/DesktopSortMenu.js app/feed/FeedClient.js
git commit -m "$(cat <<'EOF'
feat(feed): add desktop floating bar with sort dropdown

Floating bottom-center bar (FILTERS | SORT) gated md and up. SORT opens a
220px popover dropdown anchored above the SORT button with 5 options, em
dash indicator on active. Outside-click and Escape close the dropdown.
FILTERS toggles desktopFilterOpen state; the panel that consumes it
arrives in the next commit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Desktop filter panel

**Goal:** Add the left-side slide-in filter panel with overlay, STORE and CATEGORY sections, RESET footer, body scroll lock, focus management, and Escape-to-close. Wire it into FeedClient so the FILTERS button now opens it.

After this task: full desktop UX works. Clicking FILTERS slides the panel in, dims the feed, locks body scroll. Selecting a store / category writes to URL → triggers refetch → updates active row indicator. RESET clears URL to `/feed`. `×`, Escape, and overlay click all close the panel.

**Files:**
- Create: `app/components/feed/DesktopFilterPanel.js`
- Modify: `app/feed/FeedClient.js`

---

- [ ] **Step 3.1: Create `DesktopFilterPanel.js`**

Create `app/components/feed/DesktopFilterPanel.js` with this exact content:

```jsx
"use client";

import { useEffect, useRef } from "react";
import { ALL_STORES_VALUE } from "../../lib/feed-utils";

// Flat category list. Sub-items get extra left padding via `indent: true`.
// Order and labels match MobileFilterDrawer.CATEGORY_GROUPS exactly.
const CATEGORY_ITEMS = [
  { value: "tops",                  label: "All Tops",                 indent: false },
  { value: "tops_hoodies_sweaters", label: "Hoodies & Sweaters",       indent: true  },
  { value: "tops_shirts_blouses",   label: "Shirts & Blouses",         indent: true  },
  { value: "tops_tees",             label: "Tees",                     indent: true  },
  { value: "tops_knitwear",         label: "Knitwear",                 indent: true  },
  { value: "bottoms",               label: "Bottoms",                  indent: false },
  { value: "dresses_skirts",        label: "Dresses & Skirts",         indent: false },
  { value: "jackets_coats",         label: "All Jackets & Coats",      indent: false },
  { value: "footwear",              label: "Footwear",                 indent: false },
  { value: "bags_accessories",      label: "All Bags & Accessories",   indent: false },
  { value: "sets",                  label: "Sets",                     indent: false },
];

export default function DesktopFilterPanel({
  isOpen,
  onClose,
  selectedCategories,
  onToggleCategory,
  selectedStore,
  storeOptions,
  onStoreChange,
  onClearAll,
}) {
  const closeButtonRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // Body scroll lock while open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Move focus into the panel on open; restore on close
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement;
      requestAnimationFrame(() => {
        closeButtonRef.current?.focus();
      });
    } else if (previouslyFocusedRef.current) {
      previouslyFocusedRef.current.focus?.();
      previouslyFocusedRef.current = null;
    }
  }, [isOpen]);

  // Escape closes
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // NOTE: panel and overlay stay mounted always so the slide/fade transitions
  // can run on open AND close. Visibility is controlled via transform + opacity
  // classes plus pointer-events-none on the overlay when closed.

  return (
    <>
      {/* Overlay — dims the feed, click to close */}
      <div
        className={`hidden md:block fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Refine filters"
        aria-hidden={!isOpen}
        className={`hidden md:flex flex-col fixed left-0 top-0 h-screen w-[360px] bg-[#0a0a0a] border-r border-zinc-800 z-50 transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-5 border-b border-zinc-800 shrink-0">
          <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-50">
            Refine
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="font-mono text-[18px] leading-none text-zinc-400 transition-colors hover:text-zinc-50"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-8">
          {/* STORE section */}
          <section>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
              Store
            </p>
            {storeOptions.map((opt) => {
              const active = opt.value === selectedStore;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    if (opt.value === ALL_STORES_VALUE) {
                      // Re-clicking "All Stores" while active is a no-op
                      if (!active) onStoreChange(ALL_STORES_VALUE);
                    } else {
                      onStoreChange(active ? ALL_STORES_VALUE : opt.value);
                    }
                  }}
                  className={`block w-full text-left py-2 pl-4 font-mono text-[11px] uppercase tracking-widest transition-colors ${
                    active ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50"
                  }`}
                >
                  {active && <span className="-ml-4 mr-1">— </span>}
                  {opt.label}
                </button>
              );
            })}
          </section>

          {/* CATEGORY section */}
          <section>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
              Category
            </p>
            {CATEGORY_ITEMS.map((item) => {
              const active = selectedCategories.includes(item.value);
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onToggleCategory(item.value)}
                  className={`block w-full text-left py-2 font-mono text-[11px] uppercase tracking-widest transition-colors ${
                    item.indent ? "pl-8" : "pl-4"
                  } ${
                    active ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50"
                  }`}
                >
                  {active && <span className="-ml-4 mr-1">— </span>}
                  {item.label}
                </button>
              );
            })}
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-5 py-4 shrink-0">
          <button
            type="button"
            onClick={onClearAll}
            className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 transition-colors hover:text-zinc-50"
          >
            Reset
          </button>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 3.2: Import `DesktopFilterPanel` in `FeedClient.js`**

In `app/feed/FeedClient.js`, alongside the other desktop component imports added in Task 2:
```js
import DesktopFeedBar from "../components/feed/DesktopFeedBar";
import DesktopSortMenu from "../components/feed/DesktopSortMenu";
```

Add:
```js
import DesktopFilterPanel from "../components/feed/DesktopFilterPanel";
```

- [ ] **Step 3.3: Render `DesktopFilterPanel` in `FeedClient.js`**

In `app/feed/FeedClient.js`, find the desktop floating bar block you added in Step 2.7:

```jsx
        {/* ── DESKTOP: floating filter/sort bar (≥ md) ── */}
        <div className="hidden md:block fixed bottom-6 left-1/2 -translate-x-1/2 z-30">
          ...
        </div>
```

Right after the closing `</div>` of that block, add:

```jsx
        {/* ── DESKTOP: filter panel (≥ md) ── */}
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
```

- [ ] **Step 3.4: Run lint**

```bash
npm run lint
```

Expected: passes.

- [ ] **Step 3.5: Run build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 3.6: Commit**

```bash
git add app/components/feed/DesktopFilterPanel.js app/feed/FeedClient.js
git commit -m "$(cat <<'EOF'
feat(feed): add desktop filter panel

Left-side slide-in panel with overlay, STORE and CATEGORY sections, RESET
footer, body scroll lock, focus management, and Escape-to-close. STORE is
single-select (re-clicking the active store toggles back to All Stores).
CATEGORY is multi-select. All writes go through the existing FeedClient
handlers, so URL state, scroll restore, and Load More are untouched.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Polish — bottom padding & responsive resize

**Goal:** Two small but important fixes:
1. Bump main bottom padding on desktop so the floating bar doesn't visually overlap "Load More".
2. Force-close the desktop panel + dropdown when the viewport drops below `md` (so a stuck `body { overflow: hidden }` can't happen if the user resizes while the panel is open).

After this task: production-ready. Push branch, verify on Vercel preview, open PR.

**Files:**
- Modify: `app/feed/FeedClient.js`

---

- [ ] **Step 4.1: Bump desktop bottom padding on `<main>`**

In `app/feed/FeedClient.js`, find the `<main>` opening tag:
```jsx
        <main className="mx-auto max-w-7xl px-4 pb-24 pt-3 md:pt-8">
```

Change the className to:
```jsx
        <main className="mx-auto max-w-7xl px-4 pb-24 md:pb-32 pt-3 md:pt-8">
```

The mobile `pb-24` (96px) is unchanged. Desktop becomes `pb-32` (128px), which gives clearance above the floating bar (24px from bottom + 48px tall + 8px breathing room).

- [ ] **Step 4.2: Add the responsive-resize effect**

In `app/feed/FeedClient.js`, find the existing scroll-hide-show effect:
```js
  // Scroll hide/show for mobile bar
  const [barVisible, setBarVisible] = useState(true);
  const lastScrollY = useRef(0);
  useEffect(() => {
    const handleScroll = () => {
      ...
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);
```

Right AFTER that effect's closing `}, []);`, add:

```js
  // Close desktop panels if viewport drops below md (prevents stuck scroll lock)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 767px)");
    const handler = (e) => {
      if (e.matches) {
        setDesktopFilterOpen(false);
        setDesktopSortOpen(false);
      }
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
```

- [ ] **Step 4.3: Run lint**

```bash
npm run lint
```

Expected: passes.

- [ ] **Step 4.4: Run build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4.5: Commit**

```bash
git add app/feed/FeedClient.js
git commit -m "$(cat <<'EOF'
feat(feed): main padding bump + responsive resize close for desktop bar

Bump main pb to md:pb-32 so Load More clears the floating bar, and add a
matchMedia listener that force-closes the desktop panel + sort dropdown if
the viewport drops below md (prevents a stuck body scroll lock if a user
resizes while the panel is open).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4.6: Push the branch and open the Vercel preview**

```bash
git push -u origin claude/affectionate-nightingale-110aee
```

Wait for the Vercel preview deployment to complete (usually 1-2 minutes). Get the preview URL from the Vercel bot comment on your branch in GitHub, or from the Vercel dashboard.

- [ ] **Step 4.7: Verify on Vercel preview — desktop checks (viewport ≥ 768px)**

Open the preview URL at `/feed` on a desktop viewport (≥ 768px wide). Walk through:

- [ ] Floating bar appears at bottom-center of viewport on initial load.
- [ ] Bar remains visible as you scroll the feed.
- [ ] Click **FILTERS** → panel slides in from the left, feed dims behind a black/50 overlay.
- [ ] Body scroll is locked (try scrolling the feed — only the panel's inner area scrolls).
- [ ] `Escape` closes the panel.
- [ ] Click on the dim overlay → panel closes.
- [ ] Click the `×` button → panel closes.
- [ ] Reopen panel. Click a store under STORE → URL updates with `?store=...`, feed refetches, the selected row shows the `— ` prefix and white text.
- [ ] Click the same store again → URL clears `?store=`, "All Stores" becomes active.
- [ ] Toggle multiple categories → URL stacks with multiple `?category=` params, feed refetches each time, multiple rows show the active treatment.
- [ ] Click **RESET** → URL becomes `/feed`, all active indicators clear, panel STAYS OPEN.
- [ ] Close panel. Click **SORT** → 220px dropdown opens above the SORT button.
- [ ] Hover an option → background tint, text turns white.
- [ ] Click outside the dropdown → it closes.
- [ ] Click SORT again, press `Escape` → it closes.
- [ ] Click SORT, then click FILTERS → SORT closes and FILTERS opens (mutual exclusion).
- [ ] Open SORT, pick "Default" → URL has no `sort` param; reload the page → "Default" stays highlighted in the dropdown.
- [ ] Pick "Oldest" → URL becomes `?sort=oldest`, feed re-orders.
- [ ] Pick "Price low → high" → URL `?sort=price_asc`, feed re-orders cheapest first.

- [ ] **Step 4.8: Verify on Vercel preview — mobile checks (viewport < 768px)**

Resize browser below 768px or use device emulation:

- [ ] Floating desktop bar is hidden — only the existing mobile sticky `Refine | Sort` header is visible at the top.
- [ ] No layout shift, no double bar.
- [ ] Tap **Sort** → mobile sort sheet appears with 5 options (Default, Newest, Oldest, Price low → high, Price high → low).
- [ ] Tap **Default** → URL clears `sort`; reopen sheet → "Default" is highlighted.
- [ ] Tap **Refine** → mobile filter drawer opens (unchanged behavior).

- [ ] **Step 4.9: Verify on Vercel preview — cross-cut behavior**

- [ ] Click any product card → navigates to PDP. Hit browser Back → scroll position restored, exact product count restored. (Same flow as before; the new UI state isn't part of `filterKey`.)
- [ ] On desktop, scroll to bottom → "Load More" button is fully visible above the floating bar (not occluded by it).
- [ ] Click "Load More" → next batch loads, bar still visible.
- [ ] Open the desktop panel, then resize the browser below 768px → panel disappears cleanly, body scroll returns (no stuck `overflow: hidden`).

- [ ] **Step 4.10: Open PR**

If all checks pass:

```bash
gh pr create --title "feat(feed): desktop filter bar & panel + Default/Oldest sort options" --body "$(cat <<'EOF'
## Summary
- Adds a floating bottom-center FILTERS / SORT bar to `/feed` on desktop (≥ md)
- Left-side slide-in filter panel with STORE + CATEGORY, applies on selection (no Apply button), RESET footer, body scroll lock, focus + Escape handling
- 220px SORT dropdown anchored above the SORT button, mutually exclusive with the panel
- Lifts `SORT_OPTIONS` and `SORT_MAP` to `app/lib/sort-options.js`; mobile sort sheet now shows 5 options (adds `Default` and `Oldest` — both already supported by the API)
- Mobile `Refine | Sort` flow untouched

## Spec
[docs/superpowers/specs/2026-05-02-desktop-feed-filter-bar-design.md](docs/superpowers/specs/2026-05-02-desktop-feed-filter-bar-design.md)

## Test plan
- [ ] Desktop ≥ md: bar visible, FILTERS opens panel, store/category writes URL and refetches, RESET clears URL, SORT dropdown opens/closes, Default omits `?sort=`, Oldest sets `?sort=oldest`
- [ ] Mobile < md: existing sticky bar untouched, sort sheet shows 5 options
- [ ] Scroll restore on back-nav still works
- [ ] Load More still works on desktop with bar visible
- [ ] Resize across md boundary while panel is open closes panel cleanly

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL when done.

---

## Self-review reference

If you're executing this plan and want to double-check coverage against the spec, the spec sections map to tasks like this:

| Spec section                       | Implemented by |
|------------------------------------|----------------|
| `app/lib/sort-options.js`          | Task 1 |
| `MobileSortSheet.js` migration     | Task 1 |
| `FeedClient` default-as-interleaved | Task 1 |
| `DesktopFeedBar` component         | Task 2 |
| `DesktopSortMenu` component        | Task 2 |
| `FeedClient` desktop UI state, helpers, mutual exclusion | Task 2 |
| `DesktopFilterPanel` component (header, body, footer, focus, Escape) | Task 3 |
| `FeedClient` panel render          | Task 3 |
| Bottom padding bump (`md:pb-32`)   | Task 4 |
| Resize edge case (matchMedia)      | Task 4 |
| Z-index map                        | Tasks 2 + 3 (matches spec by construction) |
| Verification checklist             | Task 4 (steps 4.7–4.9) |
