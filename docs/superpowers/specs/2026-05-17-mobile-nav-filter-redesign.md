# Mobile Nav + Filter + Sort Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cluttered top-sticky mobile nav, filter drawer, and sort sheet with a coherent set of full-screen panels and a floating bottom action bar — RO-inspired layout, Dépôt's existing dark mono typography.

**Architecture:** Five new mobile-only components live under `app/components/` (`MobileNavMenu`, `MobileFilterPanel`, `MobileSortPanel`, `MobileFeedActionBar`, `MobileSearchStrip`). They replace the inline `MobileNav` in `Nav.js`, the existing `MobileFilterDrawer.js`, and `MobileSortSheet.js`. URL state stays the source of truth via `buildFeedUrl` / `buildFreshFeedUrl` — no state-management changes. Desktop is untouched.

**Tech Stack:** Next.js App Router, Tailwind v4, React 18, `createPortal` for overlays, no new dependencies.

**Visual mockups:** Iterated through v1→v5 in the brainstorming visual companion. v5 is the final approved direction. Mockups persist at `.superpowers/brainstorm/84103-1779020479/content/`.

> **Theme note:** The mockups in the companion used a white background for clarity. The actual implementation runs on Dépôt's existing **dark** site palette: `bg-[#0a0a0a]`, `text-zinc-50`, `border-zinc-800`, `text-zinc-400` for muted, `font-mono uppercase tracking-[0.2em]`. Every code snippet below uses the dark palette.

---

## Context

The current mobile UI grew organically and feels cluttered:

- **Nav menu** lists 11 items at the top level (7 product categories + STORES, DESIGNERS, ABOUT, CONTACT), with inline-expanding subcategories that push other items down.
- **Filter drawer** opens from a top-sticky `Refine | Sort` header. Filters are chip-toggles in one flat scroll.
- **Sort sheet** is a bottom sheet, inconsistent with the full-screen filter drawer.
- **Filter chips** (search, brand) render above the grid, adding visual noise on already small screens.

The user's references (Rick Owens for filter/sort, SSENSE for nav) point to a cleaner pattern: collapsed root views, drill-down navigation, generous whitespace, a floating action bar at the bottom of the feed.

---

## Final design

### A. Mobile nav menu

**Root view** (opens from hamburger):
- 3 items: `SHOP ›`, `STORES ›`, `DESIGNERS ›`
- Footer band: `About`, `Contact` (sentence case, lighter weight)
- Generous vertical rhythm — no dense dividers between primary items
- `‹` BACK on subviews, ✕ CLOSE on root

**SHOP subview** (after tapping SHOP):
- All 7 categories — `TOPS ›`, `BOTTOMS`, `DRESSES & SKIRTS`, `JACKETS & COATS ›`, `FOOTWEAR`, `BAGS & ACCESSORIES ›`, `SETS`
- Chevron only on categories with subcategories. Leaf categories navigate straight to `/feed?category=<slug>`.

**Subcategory subview** (after tapping a parent like TOPS):
- E.g. for TOPS: `Hoodies & Sweaters`, `Shirts & Blouses`, `Tees`, `Knitwear`. Each navigates to `/feed?category=<subslug>`.

All transitions: horizontal slide ~150ms ease-out. Body scroll locked while open.

### B. Feed page — floating action bar

- Remove the top-sticky `Refine | Sort` block (`FeedClient.js:325-354`).
- Remove the inline chip row above the grid on mobile (`FeedClient.js:382-401` — desktop keeps it).
- Add a **floating `FILTERS | SORT` bar** fixed near the bottom with side + bottom inset, rounded corners, semi-translucent dark background, light shadow. A small dot badge appears next to `FILTERS` when any filter is set.
- Add a **sticky search strip** below the header (`Searching: "tabi" ×`) when `?search=` is set. Only search renders here — brand is surfaced inside the filter panel. The URL parameter is `search`, not `q` — `FeedClient.js` already derives `searchQuery` from `searchParams.get("search")` and `handleClearSearch` removes `search`. Reuse those.

### C. Filter panel (full-screen, drill-down)

**Root view:**
- Header: blank-left · `FILTERS` (center) · `✕ CLOSE` (right)
- "Active" section (only when brand is set): `Brand · Margiela ×`
- Rows: `CATEGORY ›`, `STORE ›` (each shows a count when selections exist, e.g. `CATEGORY · 2 ›`)
- Bottom footer: `RESET | APPLY` (semi-translucent dark)

**CATEGORY subview:**
- Header: `‹ BACK` · `FILTERS` · `✕ CLOSE`
- 7 accordion sections, each with `+` / `−`. All sections behave identically (consistency over functionality — leaf categories like BOTTOMS expand to a single "View All Bottoms" checkbox).
- Expanded section: `View All <Category>` + subcategory checkboxes.

**STORE subview:**
- Same structure: each active store from `stores.js` is a checkbox row.

**RESET semantics:** Every filter in the panel — categories, store, and brand — is buffered as a draft. RESET clears all three drafts at once. The × on the Active row clears `draftBrand` (not the URL). APPLY commits all three to the URL atomically in a single `router.push`. This is the only way to avoid a real race: two adjacent `router.push` calls (one for brand-clear, one for APPLY) close over different `searchParams` snapshots and can resurrect the cleared brand. By buffering everything and committing once, RESET → APPLY always produces a clean URL regardless of tap speed. The on-feed `MobileSearchStrip` × handles `?search=` independently — it is not part of the filter panel and is not affected by RESET.

### D. Sort panel (full-screen)

- Replaces the current bottom sheet.
- Header: blank-left · `SORT BY` · `✕ CLOSE`
- Radio list — 5 options from `SORT_OPTIONS` in `app/lib/sort-options.js`.
- Tap commits to URL and closes immediately.

### E. Cross-cutting

- **Typography:** Existing `font-mono uppercase tracking-[0.2em]` family. Headers 11px, row labels 11px, checkbox/radio labels 10px.
- **Z-index:** Panels `z-[9999]`, backdrop `z-[9998]`, floating bar `z-30`.
- **Body lock:** Existing `document.body.style.overflow = "hidden"` pattern on open.
- **Animation:** Reuse existing `navMenuEnter` keyframe for fade-up on open. Subview transitions inside a panel slide horizontally (`translate-x`).

---

## Files

### Create
- `app/components/MobileNavMenu.js` — replaces inline `MobileNav` in `Nav.js`. Drill-down: root → SHOP → subcategory.
- `app/components/MobileFilterPanel.js` — replaces `MobileFilterDrawer.js`. Drill-down: root → CATEGORY/STORE.
- `app/components/MobileSortPanel.js` — replaces `MobileSortSheet.js`. Full-screen radio list.
- `app/components/MobileFeedActionBar.js` — fixed floating `FILTERS | SORT` bar.
- `app/components/MobileSearchStrip.js` — sticky strip showing the active `?search=` value.

### Modify
- `app/components/Nav.js` — strip the inline `MobileNav` function, import `MobileNavMenu`.
- `app/feed/FeedClient.js` — replace the top-sticky `Refine | Sort` block, swap drawers for new panels, replace the inline FilterChip row with `MobileSearchStrip`, add `MobileFeedActionBar`, add `pb-[80px]` to the grid to avoid cards sitting under the bar.

### Delete (after migration verified)
- `app/components/MobileFilterDrawer.js`
- `app/components/MobileSortSheet.js`

### Read-only inputs (do not modify)
- `app/lib/categories.js` — `NAV_TOP_LEVEL`, `SUBCATEGORIES_BY_SHORTKEY`, `CATEGORY_SLUG_TO_DB`
- `app/lib/sort-options.js` — `SORT_OPTIONS`, `SORT_MAP`
- `app/lib/feed-utils.js` — `buildFeedUrl`, `buildFreshFeedUrl`, `ALL_STORES_VALUE`
- `app/lib/stores.js` — store list / `FALLBACK_STORES`

---

## Verification protocol

**At every task, before marking it complete:** start (or reuse) the Claude Preview MCP, navigate to the affected route, take a `preview_snapshot` and `preview_screenshot` at a mobile viewport (`preview_resize { width: 390, height: 844 }`). Verify the change matches the design in the v5 mockup. Test the interaction (tap → drill, tap × → clear, scroll → bar stays put). Fix anything that drifts before committing.

**Do not skip this step.** UI bugs are cheaper to catch one task at a time than to find a pile of them after the whole branch lands.

---

## Tasks

### Task 1: MobileNavMenu — root view

**Files:**
- Create: `app/components/MobileNavMenu.js`

- [ ] **Step 1: Scaffold the component file with the root view only.**

```jsx
"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

const CONTACT_EMAIL = "hello@depot.paris";

export default function MobileNavMenu({ isOpen, onClose }) {
  // 'root' | 'shop' | { type: 'subcategory', shortKey: string, label: string }
  const [view, setView] = useState("root");

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      setView("root");
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-[#0a0a0a] text-zinc-50 flex flex-col motion-safe:[animation:navMenuEnter_150ms_ease-out]">
      {view === "root" && <RootView onClose={onClose} onOpenShop={() => setView("shop")} />}
      {/* SHOP and subcategory views land in Task 2 */}
    </div>,
    document.body
  );
}

function RootView({ onClose, onOpenShop }) {
  return (
    <>
      <header className="flex items-center justify-between h-[50px] px-5 shrink-0">
        <Link href="/" onClick={onClose} className="font-mono text-[11px] tracking-[0.32em] uppercase">
          DÉPÔT
        </Link>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ✕ CLOSE
        </button>
      </header>
      <div className="flex-1 flex flex-col px-8 pt-12 pb-8">
        <button
          onClick={onOpenShop}
          className="flex items-center justify-between py-6 font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-50"
        >
          <span>SHOP</span><span className="text-zinc-600 text-[14px] font-light">›</span>
        </button>
        <Link
          href="/stores"
          onClick={onClose}
          className="flex items-center justify-between py-6 font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-50"
        >
          <span>STORES</span><span className="text-zinc-600 text-[14px] font-light">›</span>
        </Link>
        <Link
          href="/designers"
          onClick={onClose}
          className="flex items-center justify-between py-6 font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-50"
        >
          <span>DESIGNERS</span><span className="text-zinc-600 text-[14px] font-light">›</span>
        </Link>
        <div className="mt-auto pt-8 border-t border-zinc-900 flex flex-col gap-4">
          <Link href="/about" onClick={onClose} className="font-sans text-[11px] text-zinc-500">
            About
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} onClick={onClose} className="font-sans text-[11px] text-zinc-500">
            Contact
          </a>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Wire it into `Nav.js` temporarily next to the existing `MobileNav` so it can be visually compared.**

In `app/components/Nav.js`, add the import and render it side-by-side:
```jsx
import MobileNavMenu from "./MobileNavMenu";
// ...inside Nav, after the existing MobileNav createPortal:
<MobileNavMenu isOpen={isMobileOpen} onClose={() => setIsMobileOpen(false)} />
```
(Old `MobileNav` stays for now — it'll be ripped out after Task 3.)

- [ ] **Step 3: Visual verification.**

Run dev server, `preview_resize { width: 390, height: 844 }`, navigate to `/`, tap the hamburger. Confirm:
- Root view renders with 3 items + footer
- ✕ CLOSE dismisses
- Body scroll locks while open
- Typography matches `font-mono uppercase tracking-[0.34em]`

If the old `MobileNav` also opens and overlaps, that's expected — both are on `z-[9999]`. The new one will replace the old in Task 3.

- [ ] **Step 4: Commit.**

```bash
git add app/components/MobileNavMenu.js app/components/Nav.js
git commit -m "feat(mobile-nav): scaffold MobileNavMenu root view"
```

### Task 2: MobileNavMenu — SHOP subview + subcategory subview

**Files:**
- Modify: `app/components/MobileNavMenu.js`

- [ ] **Step 1: Import category data.**

At the top of `MobileNavMenu.js`:
```js
import { NAV_TOP_LEVEL, SUBCATEGORIES_BY_SHORTKEY } from "../lib/categories.js";
import { buildFreshFeedUrl } from "../lib/feed-utils";
```

- [ ] **Step 2: Add the SHOP and subcategory subview components.**

Add below `RootView`:
```jsx
function ShopView({ onClose, onBack, onOpenSubcategory }) {
  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <button onClick={onBack} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ‹ BACK
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          SHOP
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ✕
        </button>
      </header>
      <div className="flex-1 px-8 pt-10 pb-8 flex flex-col gap-6 overflow-y-auto">
        {NAV_TOP_LEVEL.map((cat) => {
          const subs = SUBCATEGORIES_BY_SHORTKEY[cat.shortKey];
          const hasSubs = !!subs;
          if (hasSubs) {
            return (
              <button
                key={cat.slug}
                onClick={() => onOpenSubcategory({ shortKey: cat.shortKey, label: cat.label })}
                className="flex items-center justify-between font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
              >
                <span>{cat.label.toUpperCase()}</span>
                <span className="text-zinc-600 text-[14px] font-light">›</span>
              </button>
            );
          }
          return (
            <Link
              key={cat.slug}
              href={buildFreshFeedUrl({ category: [cat.slug] })}
              onClick={onClose}
              className="flex items-center justify-between font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
            >
              <span>{cat.label.toUpperCase()}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function SubcategoryView({ onClose, onBack, shortKey, label }) {
  const subs = SUBCATEGORIES_BY_SHORTKEY[shortKey];
  if (!subs) return null;
  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <button onClick={onBack} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ‹ BACK
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          {label.toUpperCase()}
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ✕
        </button>
      </header>
      <div className="flex-1 px-8 pt-10 pb-8 flex flex-col gap-6 overflow-y-auto">
        {subs.items.map(([slug, sublabel]) => (
          <Link
            key={slug}
            href={buildFreshFeedUrl({ category: [slug] })}
            onClick={onClose}
            className="font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
          >
            {sublabel}
          </Link>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Wire the view state into the main component.**

Update the main `MobileNavMenu` render block:
```jsx
return createPortal(
  <div className="fixed inset-0 z-[9999] bg-[#0a0a0a] text-zinc-50 flex flex-col motion-safe:[animation:navMenuEnter_150ms_ease-out]">
    {view === "root" && (
      <RootView onClose={onClose} onOpenShop={() => setView("shop")} />
    )}
    {view === "shop" && (
      <ShopView
        onClose={onClose}
        onBack={() => setView("root")}
        onOpenSubcategory={(sub) => setView({ type: "subcategory", ...sub })}
      />
    )}
    {typeof view === "object" && view.type === "subcategory" && (
      <SubcategoryView
        onClose={onClose}
        onBack={() => setView("shop")}
        shortKey={view.shortKey}
        label={view.label}
      />
    )}
  </div>,
  document.body
);
```

- [ ] **Step 4: Visual verification.**

`preview_resize { width: 390, height: 844 }`, open menu, tap SHOP → see 7 categories. Tap TOPS → see 4 subcategories. Tap BACK → return to SHOP. Tap a leaf like BOTTOMS → navigates to `/feed?category=bottoms` and closes menu. Take `preview_screenshot` for each state.

- [ ] **Step 5: Commit.**

```bash
git add app/components/MobileNavMenu.js
git commit -m "feat(mobile-nav): add SHOP and subcategory drill-down"
```

### Task 3: Remove the old `MobileNav` from `Nav.js`

**Files:**
- Modify: `app/components/Nav.js`

- [ ] **Step 1: Delete the inline `MobileNav` function (lines 32–163) and its constants (lines 13–30 — `CATEGORY_ITEMS`, `MOBILE_NAV_ITEMS`, `MOBILE_NAV_SECONDARY`).**

- [ ] **Step 2: Remove unused imports (`SUBCATEGORIES_BY_SHORTKEY`, `NAV_TOP_LEVEL` are now imported by `MobileNavMenu`).**

- [ ] **Step 3: Remove the duplicate `createPortal` render — the new component already creates its own portal.**

The bottom of `Nav.js` should now end with:
```jsx
      {/* Desktop nav */}
      <DesktopNav stores={stores} />

      {/* Mobile overlay */}
      <MobileNavMenu isOpen={isMobileOpen} onClose={() => setIsMobileOpen(false)} />
    </>
  );
}
```

- [ ] **Step 4: Visual verification.**

Re-open the mobile menu. Only the new design should render. No duplicate overlay. Body scroll lock works. Take `preview_screenshot`.

- [ ] **Step 5: Commit.**

```bash
git add app/components/Nav.js
git commit -m "refactor(mobile-nav): remove old inline MobileNav"
```

### Task 4: MobileSearchStrip

**Files:**
- Create: `app/components/MobileSearchStrip.js`

- [ ] **Step 1: Create the component.**

```jsx
"use client";

export default function MobileSearchStrip({ query, onClear }) {
  if (!query) return null;
  return (
    <div className="md:hidden sticky top-[50px] z-30 flex items-center justify-between px-4 py-2 bg-zinc-950/95 backdrop-blur border-b border-zinc-800/60">
      <span className="font-mono text-[9px] tracking-[0.28em] uppercase text-zinc-400">
        Searching: <span className="text-zinc-200">&ldquo;{query}&rdquo;</span>
      </span>
      <button
        onClick={onClear}
        aria-label={`Clear search ${query}`}
        className="text-zinc-300 hover:text-zinc-50 transition-colors p-1 font-mono text-[14px] leading-none"
      >
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Visual verification.**

Wire it temporarily in `FeedClient.js` above `<main>`, navigate to `/feed?search=tabi`, confirm the strip renders, sticks below the mobile nav (top: 50px = nav height), and × clears the URL param via the existing `handleClearSearch`. `preview_screenshot`.

- [ ] **Step 3: Commit.**

```bash
git add app/components/MobileSearchStrip.js app/feed/FeedClient.js
git commit -m "feat(mobile-feed): add sticky search-state strip"
```

### Task 5: MobileFeedActionBar

**Files:**
- Create: `app/components/MobileFeedActionBar.js`

- [ ] **Step 1: Create the component.**

```jsx
"use client";

export default function MobileFeedActionBar({
  hasActiveFilters,
  onOpenFilters,
  onOpenSort,
}) {
  return (
    <div className="md:hidden fixed bottom-4 left-4 right-4 z-30 grid grid-cols-2 h-11 rounded-sm bg-zinc-950/85 backdrop-blur shadow-[0_10px_30px_rgba(0,0,0,0.45)] border border-zinc-800/40">
      <button
        type="button"
        onPointerDown={onOpenFilters}
        className="flex items-center justify-center gap-2 font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-50 border-r border-zinc-800/40"
      >
        FILTERS
        {hasActiveFilters && (
          <span className="inline-block w-1 h-1 rounded-full bg-zinc-50" aria-hidden />
        )}
      </button>
      <button
        type="button"
        onPointerDown={onOpenSort}
        className="flex items-center justify-center font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-50"
      >
        SORT
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Visual verification.**

Wire it in `FeedClient.js` temporarily. Check that it floats above the grid with 16px side+bottom margin, doesn't overlap with the last row of cards once the grid gets `pb-[80px]`, stays in place while scrolling. `preview_screenshot`.

- [ ] **Step 3: Commit.**

```bash
git add app/components/MobileFeedActionBar.js
git commit -m "feat(mobile-feed): add floating FILTERS/SORT action bar"
```

### Task 6: MobileSortPanel

**Files:**
- Create: `app/components/MobileSortPanel.js`

- [ ] **Step 1: Create the component.**

```jsx
"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { SORT_OPTIONS } from "../lib/sort-options";

export default function MobileSortPanel({ isOpen, selectedSort, onSortChange, onClose }) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-[#0a0a0a] text-zinc-50 flex flex-col motion-safe:[animation:navMenuEnter_150ms_ease-out]">
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <span />
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          SORT BY
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ✕ CLOSE
        </button>
      </header>
      <div className="flex-1 px-8 pt-12 pb-8 flex flex-col gap-8">
        {SORT_OPTIONS.map((opt) => {
          const isActive = opt.value === selectedSort;
          return (
            <button
              key={opt.value}
              onClick={() => { onSortChange(opt.value); onClose(); }}
              className="flex items-center font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
            >
              <span
                className={`inline-block w-[11px] h-[11px] rounded-full border border-zinc-50 mr-4 ${isActive ? "before:content-[''] before:block before:m-[1.5px] before:w-[6px] before:h-[6px] before:rounded-full before:bg-zinc-50" : ""}`}
              />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 2: Visual verification.**

`preview_resize { width: 390, height: 844 }`, open from the bar, tap each option, confirm URL updates and panel closes. Body scroll lock works. `preview_screenshot`.

- [ ] **Step 3: Commit.**

```bash
git add app/components/MobileSortPanel.js
git commit -m "feat(mobile-feed): full-screen MobileSortPanel"
```

### Task 7: MobileFilterPanel — root view

**Files:**
- Create: `app/components/MobileFilterPanel.js`

The panel uses local "draft" state for category, store, AND brand. APPLY commits all three to the URL atomically in one `router.push`. RESET clears all three drafts. The Active-row × only mutates `draftBrand` — it must not call `router.push`. **Invariant:** no panel control may push to the router except the single APPLY commit. This is non-negotiable; it's how the RESET→APPLY race is closed.

- [ ] **Step 1: Create the file with root view only.**

```jsx
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ALL_STORES_VALUE } from "../lib/feed-utils";

export default function MobileFilterPanel({
  isOpen,
  onClose,
  selectedCategories,
  selectedStore,
  selectedBrand,
  storeOptions,
  onApply,        // (next: { categories, store, brand }) => void  — all three commit atomically
}) {
  const [view, setView] = useState("root"); // 'root' | 'category' | 'store'
  const [draftCategories, setDraftCategories] = useState(selectedCategories);
  const [draftStore, setDraftStore] = useState(selectedStore);
  const [draftBrand, setDraftBrand] = useState(selectedBrand);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      setDraftCategories(selectedCategories);
      setDraftStore(selectedStore);
      setDraftBrand(selectedBrand);
      setView("root");
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen, selectedCategories, selectedStore, selectedBrand]);

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  const handleApply = () => {
    onApply({ categories: draftCategories, store: draftStore, brand: draftBrand });
    onClose();
  };
  const handleReset = () => {
    setDraftCategories([]);
    setDraftStore(ALL_STORES_VALUE);
    setDraftBrand("");
  };

  const totalActive =
    draftCategories.length +
    (draftStore !== ALL_STORES_VALUE ? 1 : 0) +
    (draftBrand ? 1 : 0);

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-[#0a0a0a] text-zinc-50 flex flex-col motion-safe:[animation:navMenuEnter_150ms_ease-out]">
      {view === "root" && (
        <FilterRoot
          onClose={onClose}
          onOpenCategory={() => setView("category")}
          onOpenStore={() => setView("store")}
          draftBrand={draftBrand}
          onClearDraftBrand={() => setDraftBrand("")}
          categoryCount={draftCategories.length}
          storeCount={draftStore !== ALL_STORES_VALUE ? 1 : 0}
        />
      )}
      {/* CategoryView and StoreView land in Tasks 8 and 9 */}

      <footer className="absolute bottom-0 left-0 right-0 h-14 grid grid-cols-2 bg-zinc-950/95 backdrop-blur border-t border-zinc-800/60">
        <button
          onClick={handleReset}
          className="font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-300 border-r border-zinc-800/60"
        >
          RESET
        </button>
        <button
          onClick={handleApply}
          className="font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
        >
          APPLY{totalActive > 0 ? ` (${totalActive})` : ""}
        </button>
      </footer>
    </div>,
    document.body
  );
}

function FilterRoot({
  onClose,
  onOpenCategory,
  onOpenStore,
  draftBrand,
  onClearDraftBrand,
  categoryCount,
  storeCount,
}) {
  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <span />
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          FILTERS
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ✕ CLOSE
        </button>
      </header>
      <div className="flex-1 px-8 pt-6 pb-20 overflow-y-auto">
        {draftBrand && (
          <>
            <p className="font-mono text-[8.5px] tracking-[0.32em] uppercase text-zinc-500 mb-2 mt-1">
              Active
            </p>
            <div className="flex items-center justify-between py-3 border-b border-zinc-900">
              <span className="font-mono text-[10px] tracking-[0.28em] uppercase text-zinc-50">
                <span className="text-zinc-500 mr-2">Brand</span>{draftBrand}
              </span>
              <button onClick={onClearDraftBrand} aria-label="Clear brand" className="text-zinc-300 text-[14px] leading-none">×</button>
            </div>
            <div className="h-4" />
          </>
        )}
        <button
          onClick={onOpenCategory}
          className="flex items-center justify-between w-full py-4 border-b border-zinc-900 font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
        >
          <span>
            CATEGORY
            {categoryCount > 0 && (
              <span className="ml-2 text-zinc-500 tracking-[0.18em]">· {categoryCount}</span>
            )}
          </span>
          <span className="text-zinc-600 text-[14px] font-light">›</span>
        </button>
        <button
          onClick={onOpenStore}
          className="flex items-center justify-between w-full py-4 border-b border-zinc-900 font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
        >
          <span>
            STORE
            {storeCount > 0 && (
              <span className="ml-2 text-zinc-500 tracking-[0.18em]">· {storeCount}</span>
            )}
          </span>
          <span className="text-zinc-600 text-[14px] font-light">›</span>
        </button>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Visual verification.**

Wire it in FeedClient temporarily next to the existing `MobileFilterDrawer`. Open from the action bar. Confirm:
- Root view shows CATEGORY › / STORE ›
- Landing on `/feed?brand=Margiela` shows the "Active" row with Margiela. Tap × → Active row disappears (draftBrand cleared, but URL still has brand). Tap APPLY → URL drops `brand=`.
- APPLY footer translucent at bottom

`preview_screenshot`.

- [ ] **Step 3: Commit.**

```bash
git add app/components/MobileFilterPanel.js
git commit -m "feat(mobile-filter): scaffold root view with brand surface"
```

### Task 8: MobileFilterPanel — CATEGORY subview

**Files:**
- Modify: `app/components/MobileFilterPanel.js`

- [ ] **Step 1: Import category data at top.**

```js
import { NAV_TOP_LEVEL, SUBCATEGORIES_BY_SHORTKEY } from "../lib/categories.js";
```

- [ ] **Step 2: Add the CategoryView component.**

```jsx
function CategoryView({ onBack, onClose, draftCategories, setDraftCategories }) {
  const [expanded, setExpanded] = useState(null); // shortKey or null

  const toggle = (slug) => {
    setDraftCategories((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <button onClick={onBack} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ‹ BACK
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          FILTERS
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ✕ CLOSE
        </button>
      </header>
      <div className="flex-1 px-8 pt-2 pb-20 overflow-y-auto">
        {NAV_TOP_LEVEL.map((cat) => {
          const isExpanded = expanded === cat.shortKey;
          const subs = SUBCATEGORIES_BY_SHORTKEY[cat.shortKey];
          return (
            <div key={cat.slug}>
              <button
                onClick={() => setExpanded(isExpanded ? null : cat.shortKey)}
                className="flex items-center justify-between w-full py-4 border-b border-zinc-900 font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
              >
                <span>{cat.label.toUpperCase()}</span>
                <span className="text-zinc-50 text-[15px] font-extralight leading-none">
                  {isExpanded ? "−" : "+"}
                </span>
              </button>
              {isExpanded && (
                <div className="py-3 flex flex-col gap-3 border-b border-zinc-900">
                  <OptionRow
                    label={`View All ${cat.label}`}
                    checked={draftCategories.includes(cat.slug)}
                    onChange={() => toggle(cat.slug)}
                  />
                  {subs && subs.items.map(([slug, sublabel]) => (
                    <OptionRow
                      key={slug}
                      label={sublabel}
                      checked={draftCategories.includes(slug)}
                      onChange={() => toggle(slug)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function OptionRow({ label, checked, onChange }) {
  return (
    <button
      onClick={onChange}
      className="flex items-center font-mono text-[9px] tracking-[0.28em] uppercase text-zinc-50"
    >
      <span
        className={`inline-block w-[11px] h-[11px] mr-3.5 border border-zinc-50 ${checked ? "bg-zinc-50" : ""}`}
      />
      {label}
    </button>
  );
}
```

- [ ] **Step 3: Wire the view into the main component.**

Inside the `MobileFilterPanel` return, after the FilterRoot conditional:
```jsx
{view === "category" && (
  <CategoryView
    onBack={() => setView("root")}
    onClose={onClose}
    draftCategories={draftCategories}
    setDraftCategories={setDraftCategories}
  />
)}
```

- [ ] **Step 4: Visual verification.**

From filter root, tap CATEGORY. Confirm:
- Header reads `‹ BACK · FILTERS · ✕ CLOSE`
- 7 sections render, all with `+`
- Tap TOPS → `+` becomes `−`, "View All Tops" + 4 subcategories appear
- Tap a checkbox → fills black, draft state increments
- Tap APPLY → URL updates with `?category=...&category=...`
- Tap a leaf like BOTTOMS → expand shows just "View All Bottoms"

`preview_screenshot` of TOPS expanded and of BOTTOMS expanded.

- [ ] **Step 5: Commit.**

```bash
git add app/components/MobileFilterPanel.js
git commit -m "feat(mobile-filter): CATEGORY subview with consistent +/-"
```

### Task 9: MobileFilterPanel — STORE subview

**Files:**
- Modify: `app/components/MobileFilterPanel.js`

- [ ] **Step 1: Add the StoreView component.**

```jsx
function StoreView({ onBack, onClose, draftStore, setDraftStore, storeOptions }) {
  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <button onClick={onBack} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ‹ BACK
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          FILTERS
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ✕ CLOSE
        </button>
      </header>
      <div className="flex-1 px-8 pt-6 pb-20 overflow-y-auto flex flex-col gap-3">
        <OptionRow
          label="All stores"
          checked={draftStore === ALL_STORES_VALUE}
          onChange={() => setDraftStore(ALL_STORES_VALUE)}
        />
        {storeOptions
          .filter((s) => s.value !== ALL_STORES_VALUE)
          .map((s) => (
            <OptionRow
              key={s.value}
              label={s.label}
              checked={draftStore === s.value}
              onChange={() => setDraftStore(s.value)}
            />
          ))}
      </div>
    </>
  );
}
```

(Store is single-select, not multi-select, to match the existing `selectedStore` model in `FeedClient.js`. Tapping a store sets it directly.)

- [ ] **Step 2: Wire into the main component.**

```jsx
{view === "store" && (
  <StoreView
    onBack={() => setView("root")}
    onClose={onClose}
    draftStore={draftStore}
    setDraftStore={setDraftStore}
    storeOptions={storeOptions}
  />
)}
```

- [ ] **Step 3: Visual verification.**

From filter root, tap STORE. Confirm the list of stores renders, only one can be selected at a time (radio behavior, but using checkbox UI for consistency — matches today's drawer). `preview_screenshot`.

- [ ] **Step 4: Commit.**

```bash
git add app/components/MobileFilterPanel.js
git commit -m "feat(mobile-filter): STORE subview"
```

### Task 10: Integrate the new panels into FeedClient

**Files:**
- Modify: `app/feed/FeedClient.js`

- [ ] **Step 1: Update imports.**

Replace:
```js
import MobileFilterDrawer from "../components/MobileFilterDrawer";
import MobileSortSheet from "../components/MobileSortSheet";
```
with:
```js
import MobileFilterPanel from "../components/MobileFilterPanel";
import MobileSortPanel from "../components/MobileSortPanel";
import MobileFeedActionBar from "../components/MobileFeedActionBar";
import MobileSearchStrip from "../components/MobileSearchStrip";
```

- [ ] **Step 2: Add an `onApply` handler that commits all three drafts (categories, store, brand) atomically.**

```js
const handleApplyFilters = useCallback(({ categories, store, brand }) => {
  setLocalCategories(categories);
  setLocalStore(store);
  const updates = { category: categories };
  updates.store = store !== ALL_STORES_VALUE ? store : null;
  // brand is buffered in the panel; this is the only commit path for it.
  // Empty string and undefined both clear the param via buildFeedUrl.
  updates.brand = brand || null;
  router.push(buildFeedUrl(searchParams, updates));
}, [router, searchParams]);
```

- [ ] **Step 3: Delete the mobile sticky `Refine | Sort` header (lines 325–354 of current file).** Desktop and mobile no longer share this surface.

- [ ] **Step 4: Replace the mobile chip row (lines 382–401) with a single `md:hidden`-aware render.**

Keep the chip rendering ONLY for desktop:
```jsx
{(searchQuery || selectedBrand) && (
  <div className="hidden md:flex mb-4 md:mb-6 flex-wrap gap-2">
    {/* existing FilterChip block — unchanged */}
  </div>
)}
```

- [ ] **Step 5: Add the search strip below the main `<header>` of FeedClient and above `<main>`.**

```jsx
<MobileSearchStrip query={searchQuery} onClear={handleClearSearch} />
```

- [ ] **Step 6: Replace the drawers with panels and add the action bar.**

```jsx
<MobileFilterPanel
  isOpen={filterOpen}
  onClose={() => setFilterOpen(false)}
  selectedCategories={localCategories}
  selectedStore={localStore}
  selectedBrand={selectedBrand}
  storeOptions={storeOptions}
  onApply={handleApplyFilters}
/>
<MobileSortPanel
  isOpen={sortOpen}
  selectedSort={selectedSort}
  onSortChange={handleSortChange}
  onClose={() => setSortOpen(false)}
/>
<MobileFeedActionBar
  hasActiveFilters={activeFilterCount > 0}
  onOpenFilters={() => { setSortOpen(false); setFilterOpen(true); }}
  onOpenSort={() => { setFilterOpen(false); setSortOpen(true); }}
/>
```

- [ ] **Step 7: Add bottom padding to the grid container so the last row doesn't sit under the floating bar.**

In the grid wrapper:
```jsx
<main className="mx-auto max-w-7xl px-4 pb-32 md:pb-32 pt-3 md:pt-8">
```
(Was `pb-24 md:pb-32`. Mobile needs more clearance for the floating bar's 44px + 16px inset + safe area.)

- [ ] **Step 8: Visual verification.**

`preview_resize { width: 390, height: 844 }`. Navigate to `/feed`:
- No top-sticky `Refine | Sort` block
- No chip row above the grid (chips would show on desktop only)
- Floating `FILTERS | SORT` bar bottom-fixed
- `?search=tabi` → strip below header
- `?brand=Margiela` → only the dot badge on FILTERS
- `?search=tabi&brand=Margiela` together → strip for search, dot badge for brand, both visible
- Tap FILTERS → root → CATEGORY → drill, toggle, APPLY → URL updates, panel closes, dot badge appears
- Tap SORT → full-screen panel → pick "Newest" → URL updates, panel closes
- Last row of cards visible (not under the bar)

`preview_screenshot` for: feed default, feed with search, filter root, filter category, filter store, sort, mobile nav.

- [ ] **Step 9: Commit.**

```bash
git add app/feed/FeedClient.js
git commit -m "feat(mobile-feed): wire MobileFilterPanel, MobileSortPanel, MobileFeedActionBar, MobileSearchStrip"
```

### Task 11: Delete the old drawer/sheet components

**Files:**
- Delete: `app/components/MobileFilterDrawer.js`
- Delete: `app/components/MobileSortSheet.js`

- [ ] **Step 1: Verify no references remain.**

Run: `grep -rn "MobileFilterDrawer\|MobileSortSheet" app/`
Expected: no matches.

- [ ] **Step 2: Delete the files.**

```bash
git rm app/components/MobileFilterDrawer.js app/components/MobileSortSheet.js
```

- [ ] **Step 3: Visual verification.**

Re-test the full flow at mobile viewport. Confirm nothing regressed. `preview_screenshot`.

- [ ] **Step 4: Commit.**

```bash
git commit -m "chore(mobile): remove obsolete MobileFilterDrawer and MobileSortSheet"
```

### Task 12: Playwright test suite

**Files:**
- Create: `tests/mobile-redesign.spec.js`

(If the project doesn't yet have Playwright installed, run `npm install -D @playwright/test && npx playwright install` first and commit the install changes as a separate commit before adding tests.)

- [ ] **Step 1: Write the test file.**

```js
import { test, expect, devices } from "@playwright/test";

const MOBILE = { ...devices["iPhone 13"] };
const SCREENSHOT_DIR = "screenshots/mobile-redesign";

test.use(MOBILE);

test.describe("Mobile feed — golden path", () => {
  test("homepage loads and feed renders product cards", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/dépôt/i);
    await page.goto("/feed");
    await expect(page.locator("article, a[href^='/product']").first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-default.png`, fullPage: false });
  });

  test("floating action bar is visible while scrolling", async ({ page }) => {
    await page.goto("/feed");
    const bar = page.getByRole("button", { name: /^filters/i });
    await expect(bar).toBeVisible();
    await page.mouse.wheel(0, 2000);
    await expect(bar).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-scrolled-bar.png` });
  });

  test("filter panel opens with drill-down navigation", async ({ page }) => {
    await page.goto("/feed");
    await page.getByRole("button", { name: /^filters/i }).click();
    await expect(page.getByText("CATEGORY", { exact: true })).toBeVisible();
    await expect(page.getByText("STORE", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/filter-root.png` });

    await page.getByText("CATEGORY", { exact: true }).click();
    await expect(page.getByText("TOPS")).toBeVisible();
    await expect(page.getByRole("button", { name: /back/i })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/filter-category.png` });

    await page.getByText("TOPS").click();
    await expect(page.getByText(/view all tops/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/filter-tops-expanded.png` });

    await page.getByText("Tees").click();
    await page.getByRole("button", { name: /^apply/i }).click();
    await expect(page).toHaveURL(/category=tops_tees/);
  });

  test("sort panel opens full-screen and updates URL", async ({ page }) => {
    await page.goto("/feed");
    await page.getByRole("button", { name: /^sort/i }).click();
    await expect(page.getByText("SORT BY")).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/sort-panel.png` });
    await page.getByText("Newest").click();
    await expect(page).toHaveURL(/sort=newest/);
  });

  test("mobile nav drills into SHOP and back", async ({ page }) => {
    await page.goto("/feed");
    await page.getByRole("button", { name: /open menu/i }).click();
    await expect(page.getByText("SHOP", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/nav-root.png` });

    await page.getByText("SHOP", { exact: true }).click();
    await expect(page.getByText("TOPS")).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/nav-shop.png` });

    await page.getByRole("button", { name: /back/i }).click();
    await expect(page.getByText("SHOP", { exact: true })).toBeVisible();
    await expect(page.getByText("STORES", { exact: true })).toBeVisible();
  });

  test("product card opens product page", async ({ page }) => {
    await page.goto("/feed");
    const firstCard = page.locator("a[href^='/product']").first();
    await firstCard.waitFor();
    const href = await firstCard.getAttribute("href");
    await firstCard.click();
    await expect(page).toHaveURL(new RegExp(href.replace(/[/?]/g, ".")));
    await page.screenshot({ path: `${SCREENSHOT_DIR}/product-page.png` });
  });

  test("back navigation restores scroll position", async ({ page }) => {
    await page.goto("/feed");
    await page.waitForSelector("a[href^='/product']");
    await page.mouse.wheel(0, 1500);
    const beforeY = await page.evaluate(() => window.scrollY);
    expect(beforeY).toBeGreaterThan(800);

    await page.locator("a[href^='/product']").nth(4).click();
    await page.waitForLoadState("networkidle");
    await page.goBack();
    await page.waitForLoadState("networkidle");

    const afterY = await page.evaluate(() => window.scrollY);
    expect(Math.abs(afterY - beforeY)).toBeLessThan(150);
  });

  test("search handles multi-word queries and shows the sticky strip", async ({ page }) => {
    await page.goto("/feed?search=margiela%20tabi");
    await expect(page.getByText(/searching:/i)).toBeVisible();
    await expect(page.getByText(/margiela tabi/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-search-multiword.png` });

    await page.getByRole("button", { name: /clear search/i }).click();
    await expect(page).not.toHaveURL(/search=/);
  });

  test("brand filter shows only as dot badge and surfaces in Active row", async ({ page }) => {
    await page.goto("/feed?brand=Margiela");
    // No on-feed chip, but the FILTERS button has a dot (we can't directly assert the dot;
    // we assert what we DON'T see — no visible brand label on the grid).
    await expect(page.locator("main").getByText(/brand:/i)).toHaveCount(0);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-brand-active.png` });

    await page.getByRole("button", { name: /^filters/i }).click();
    await expect(page.getByText("Active")).toBeVisible();
    await expect(page.getByText("Margiela")).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/filter-root-brand-active.png` });
  });

  test("RESET inside filter panel clears category drafts", async ({ page }) => {
    await page.goto("/feed?category=tops_tees");
    await page.getByRole("button", { name: /^filters/i }).click();
    await expect(page.getByText(/category · 1/i)).toBeVisible();
    await page.getByRole("button", { name: /reset/i }).click();
    await expect(page.getByText(/category · 1/i)).toHaveCount(0);
  });

  test("RESET also clears the active brand row", async ({ page }) => {
    await page.goto("/feed?brand=Margiela&category=tops_tees");
    await page.getByRole("button", { name: /^filters/i }).click();
    await expect(page.getByText("Active")).toBeVisible();
    await expect(page.getByText("Margiela")).toBeVisible();
    await page.getByRole("button", { name: /reset/i }).click();
    // Drafts cleared in the panel — Active row and counts disappear synchronously:
    await expect(page.getByText("Active")).toHaveCount(0);
    await expect(page.getByText("Margiela")).toHaveCount(0);
    await expect(page.getByText(/category · 1/i)).toHaveCount(0);
    // URL still has the old filters at this point — brand is buffered, not auto-committed.
    await expect(page).toHaveURL(/brand=Margiela/);
    // APPLY commits all three drafts in one atomic router.push:
    await page.getByRole("button", { name: /^apply/i }).click();
    await expect(page).not.toHaveURL(/brand=/);
    await expect(page).not.toHaveURL(/category=/);
  });

  test("body scroll locks while a panel is open", async ({ page }) => {
    await page.goto("/feed");
    const before = await page.evaluate(() => document.body.style.overflow);
    expect(before).not.toBe("hidden");
    await page.getByRole("button", { name: /^filters/i }).click();
    const during = await page.evaluate(() => document.body.style.overflow);
    expect(during).toBe("hidden");
    await page.getByRole("button", { name: /close/i }).first().click();
  });
});

test.describe("Desktop is untouched", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("desktop shows DesktopNav and the existing filter button", async ({ page }) => {
    await page.goto("/feed");
    await expect(page.locator("nav").first()).toBeVisible();
    // The floating bar should not be present on desktop:
    await expect(page.getByRole("button", { name: /^filters$/i })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-feed.png` });
  });
});
```

- [ ] **Step 2: Add a Playwright config if one doesn't already exist.**

```js
// playwright.config.js
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  retries: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

(Skip this step if `playwright.config.js` already exists. Adjust the existing config to ensure `testDir` includes the new test path.)

- [ ] **Step 3: Run the suite.**

```bash
npx playwright test --reporter=list
```

Expected: all tests pass. Screenshots written to `screenshots/mobile-redesign/`.

If a test fails, fix the underlying UI (not the test) and re-run before moving on. If a test is genuinely brittle (e.g. selector matches multiple elements), tighten the selector — don't loosen the assertion.

- [ ] **Step 4: Commit.**

```bash
git add tests/mobile-redesign.spec.js playwright.config.js
git commit -m "test(mobile): playwright coverage for redesigned nav/filter/sort"
```

---

## Self-review (run before opening the PR)

- [ ] Every spec section (A, B, C, D, E) has a corresponding task.
- [ ] No placeholders, no "TBD", no "similar to Task N" without showing the code.
- [ ] Method signatures consistent across tasks: `onApply({ categories, store, brand })`, `OptionRow({ label, checked, onChange })`. The panel no longer accepts `onClearBrand` — brand is buffered as `draftBrand` and committed via `onApply`.
- [ ] All component file paths use `app/components/`, not `app/components/mobile/`.
- [ ] No mobile-only changes leak to desktop (`md:hidden` / `hidden md:flex` discipline).
- [ ] URL state remains the source of truth — no localStorage, no Context.
- [ ] Each task's verification step uses Claude Preview MCP at mobile viewport.
- [ ] Playwright tests cover: feed loads, filter opens + drill-down, sort opens, product card → PDP, back-nav scroll restore, multi-word search, brand-as-dot-badge, body scroll lock, desktop sanity check.

---

## Post-merge cleanup

- [ ] Delete `.superpowers/brainstorm/` if you don't want to keep the mockup history, or add `.superpowers/` to `.gitignore` if it's not already there.
- [ ] Mirror this plan to `docs/superpowers/specs/2026-05-17-mobile-nav-filter-redesign.md` and `docs/superpowers/plans/2026-05-17-mobile-nav-filter-redesign.md` for future reference.
