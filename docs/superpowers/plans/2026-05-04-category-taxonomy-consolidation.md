# Category Taxonomy Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace seven inline copies of the category taxonomy with one canonical source at `app/lib/categories.js`, and fix the mobile filter drawer's four missing sub-category buttons as a side-effect.

**Architecture:** A single `CATEGORIES` array of category objects (each with optional `children` and `shortKey`) lives in `app/lib/categories.js`. Four named exports derive from it the exact shapes each consumer needs (`CATEGORY_SLUG_TO_DB`, `FILTER_GROUPS`, `NAV_TOP_LEVEL`, `SUBCATEGORIES_BY_SHORTKEY`). Consumers either import directly or apply a tiny local `.map(...)` transform that keeps their existing prop shape.

**Tech Stack:** Next.js 16 (App Router), React 19, plain JS (ESM). No test framework — verification is `npm run build`, `npm run lint`, and Vercel preview, matching CLAUDE.md's "verify on Vercel, not localhost" rule.

**Verification model (read this first):** This codebase has no test runner. Each task ends with `npm run build` and `npm run lint` as the equivalent of running tests. The user-visible fix (mobile filter drawer sub-buttons) is verified on the Vercel preview in the final task. There is no TDD loop with red→green; the substitute is build-must-pass + diff review + preview screenshot.

**Files touched:**
- Create: `app/lib/categories.js`
- Modify: `app/api/products/route.js` (delete lines 20-38, add import)
- Modify: `app/components/feed/DesktopFilterPanel.js` (delete lines 7-42, add import)
- Modify: `app/components/MobileFilterDrawer.js` (delete lines 6-55, add import + transform)
- Modify: `app/components/nav/Column1.js` (delete lines 8-16, add import + transform)
- Modify: `app/components/nav/SubcategoryList.js` (delete lines 6-30, add import + adjust render)
- Modify: `app/components/Nav.js` (delete lines 12-40, add import + transforms)

**Out of scope:** `app/lib/feed-utils.js` (`classifyProduct` keyword arrays). That file maps product titles → slugs heuristically; it's not taxonomy data and stays untouched.

---

## Task 1: Create the canonical categories module

**Files:**
- Create: `app/lib/categories.js`

- [ ] **Step 1: Create the file with canonical source and derived helpers**

Create `app/lib/categories.js` with this exact content:

```js
// Canonical category taxonomy. The ONLY place to add or edit categories.
// Every other file derives its data from CATEGORIES via the exports below.
//
// Shape of each entry:
//   slug      — URL-safe identifier (e.g. "tops", "jackets_coats")
//   label     — human-readable display string (e.g. "Jackets & Coats")
//   dbName    — display string stored in the products.category column
//   shortKey  — (groups only) compact alias used by nav code to key sub-menus
//   children  — (groups only) array of { slug, label } leaf entries
//
// Children inherit their parent's dbName: a product tagged "tops_tees" in the
// URL filters against rows where products.category = "Tops" in the DB.

export const CATEGORIES = [
  {
    slug: "tops",
    label: "Tops",
    dbName: "Tops",
    shortKey: "tops",
    children: [
      { slug: "tops_hoodies_sweaters", label: "Hoodies & Sweaters" },
      { slug: "tops_shirts_blouses",   label: "Shirts & Blouses"   },
      { slug: "tops_tees",             label: "Tees"               },
      { slug: "tops_knitwear",         label: "Knitwear"           },
    ],
  },
  { slug: "bottoms",        label: "Bottoms",          dbName: "Bottoms" },
  { slug: "dresses_skirts", label: "Dresses & Skirts", dbName: "Dresses & Skirts" },
  {
    slug: "jackets_coats",
    label: "Jackets & Coats",
    dbName: "Jackets & Coats",
    shortKey: "jackets",
    children: [
      { slug: "jackets", label: "Jackets" },
      { slug: "coats",   label: "Coats"   },
    ],
  },
  { slug: "footwear", label: "Footwear", dbName: "Footwear" },
  {
    slug: "bags_accessories",
    label: "Bags & Accessories",
    dbName: "Bags & Accessories",
    shortKey: "bags",
    children: [
      { slug: "bags",        label: "Bags"        },
      { slug: "accessories", label: "Accessories" },
    ],
  },
  { slug: "sets", label: "Sets", dbName: "Sets" },
];

// Flat slug → DB display string. Children inherit parent's dbName.
// Used by /api/products/route.js to map URL slugs to the strings stored
// in products.category and consumed by get_interleaved_products RPC.
export const CATEGORY_SLUG_TO_DB = Object.fromEntries(
  CATEGORIES.flatMap((c) => [
    [c.slug, c.dbName],
    ...(c.children || []).map((child) => [child.slug, c.dbName]),
  ]),
);

// Filter panel groups. Leaves have children=null; groups include an
// "All <Label>" entry as the first child (so the parent slug remains
// selectable). Used by DesktopFilterPanel directly and adapted by
// MobileFilterDrawer.
export const FILTER_GROUPS = CATEGORIES.map((c) => ({
  value: c.slug,
  label: c.label,
  children: c.children
    ? [
        { value: c.slug, label: `All ${c.label}` },
        ...c.children.map((ch) => ({ value: ch.slug, label: ch.label })),
      ]
    : null,
}));

// Top-level nav entries. Used by Column1 (desktop side panel) and
// the mobile drawer's primary list in Nav.js.
export const NAV_TOP_LEVEL = CATEGORIES.map((c) => ({
  slug: c.slug,
  label: c.label,
  expandable: Boolean(c.children),
  shortKey: c.shortKey || c.slug,
  childSlugs: (c.children || []).map((ch) => ch.slug),
}));

// Sub-menu lookup keyed by shortKey. Each entry has the heading to
// display plus the [value, label] tuples for sub-items, with the
// parent slug surfaced as "All <Label>" first. Used by SubcategoryList
// (desktop) and Nav.js mobile drawer expansions.
//
// Uses the same `shortKey || slug` fallback as NAV_TOP_LEVEL so that
// the two exports always agree on the lookup key. Diverging fallback
// rules silently breaks expanded sub-menus when a future grouped
// category is added without an explicit shortKey.
export const SUBCATEGORIES_BY_SHORTKEY = Object.fromEntries(
  CATEGORIES
    .filter((c) => c.children)
    .map((c) => [
      c.shortKey || c.slug,
      {
        heading: c.label,
        items: [
          [c.slug, `All ${c.label}`],
          ...c.children.map((ch) => [ch.slug, ch.label]),
        ],
      },
    ]),
);

// Module-load assertion: catch schema drift fast. Every grouped
// category surfaced in NAV_TOP_LEVEL must have a matching entry in
// SUBCATEGORIES_BY_SHORTKEY under the same key. If a future engineer
// adds children without a shortKey OR adds duplicate shortKeys, this
// throws on import — long before a user clicks an empty sub-menu.
{
  const navKeys = NAV_TOP_LEVEL.filter((c) => c.expandable).map((c) => c.shortKey);
  const subKeys = Object.keys(SUBCATEGORIES_BY_SHORTKEY);
  const missing = navKeys.filter((k) => !subKeys.includes(k));
  const duplicates = navKeys.filter((k, i) => navKeys.indexOf(k) !== i);
  if (missing.length || duplicates.length) {
    throw new Error(
      `categories.js: nav/sub-menu key mismatch. ` +
      `missing=${JSON.stringify(missing)} duplicates=${JSON.stringify(duplicates)}`,
    );
  }
}
```

- [ ] **Step 2: Verify the build still passes**

Run: `npm run build`
Expected: Build succeeds. The new module is unused at this point, so this only confirms the syntax is valid and Next.js is happy with it.

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add app/lib/categories.js
git commit -m "feat(categories): add canonical taxonomy module"
```

---

## Task 2: Migrate `/api/products/route.js`

**Files:**
- Modify: `app/api/products/route.js` — replace lines 20-38 (`CATEGORY_SLUG_TO_DB` definition) with an import

- [ ] **Step 1: Add the import and delete the inline constant**

In `app/api/products/route.js`, the file currently begins:

```js
import { supabase } from "../../lib/supabase.js";

export const dynamic = "force-dynamic";

// Split search query into words; each word must appear in title, brand, or name.
// Chained .or() calls are ANDed by PostgREST (append semantics, not overwrite).
function applySearchFilter(query, search) {
  ...
}

// Map URL-safe category slugs to the display-name strings stored in the DB.
// Subcategory slugs (e.g. tops_tees) map to their parent category.
const CATEGORY_SLUG_TO_DB = {
  tops: "Tops",
  tops_hoodies_sweaters: "Tops",
  tops_shirts_blouses: "Tops",
  tops_tees: "Tops",
  tops_knitwear: "Tops",
  bottoms: "Bottoms",
  dresses_skirts: "Dresses & Skirts",
  jackets_coats: "Jackets & Coats",
  jackets: "Jackets & Coats",
  coats: "Jackets & Coats",
  footwear: "Footwear",
  bags_accessories: "Bags & Accessories",
  bags: "Bags & Accessories",
  accessories: "Bags & Accessories",
  sets: "Sets",
};

export async function GET(request) {
```

Change to:

```js
import { supabase } from "../../lib/supabase.js";
import { CATEGORY_SLUG_TO_DB } from "../../lib/categories.js";

export const dynamic = "force-dynamic";

// Split search query into words; each word must appear in title, brand, or name.
// Chained .or() calls are ANDed by PostgREST (append semantics, not overwrite).
function applySearchFilter(query, search) {
  ...
}

export async function GET(request) {
```

The body of `GET` is unchanged. Only the inline `CATEGORY_SLUG_TO_DB` constant (and its preceding two-line comment) is deleted; the import is added at the top.

- [ ] **Step 2: Spot-check the produced map matches the deleted one**

The new `CATEGORY_SLUG_TO_DB` from `app/lib/categories.js` produces exactly these entries (in this order):

```
tops                    → Tops
tops_hoodies_sweaters   → Tops
tops_shirts_blouses     → Tops
tops_tees               → Tops
tops_knitwear           → Tops
bottoms                 → Bottoms
dresses_skirts          → Dresses & Skirts
jackets_coats           → Jackets & Coats
jackets                 → Jackets & Coats
coats                   → Jackets & Coats
footwear                → Footwear
bags_accessories        → Bags & Accessories
bags                    → Bags & Accessories
accessories             → Bags & Accessories
sets                    → Sets
```

Compare against the deleted block at the top of `route.js` in the previous diff: 15 entries, byte-identical strings. If anything mismatches, the canonical source in Task 1 is wrong — go fix it before proceeding.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: Build succeeds. If the build fails with "Cannot find module" or similar, the import path is wrong (relative path from `app/api/products/route.js` is `../../lib/categories.js`).

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/products/route.js
git commit -m "refactor(api): use shared CATEGORY_SLUG_TO_DB"
```

---

## Task 3: Migrate `DesktopFilterPanel.js`

**Files:**
- Modify: `app/components/feed/DesktopFilterPanel.js` — replace lines 7-42 (`CATEGORY_GROUPS` definition) with an aliased import

The new `FILTER_GROUPS` export has the same field names (`value`, `label`, `children`) and the same `value`/`label` strings as the existing inline constant. The only structural difference is `children` is `null` instead of `undefined` for leaves; the existing render logic uses `if (!group.children)` and `group.children?.some(...)`, both of which handle `null` and `undefined` identically.

- [ ] **Step 1: Replace the inline constant with an aliased import**

In `app/components/feed/DesktopFilterPanel.js`, the file currently begins:

```js
"use client";

import { useState, useEffect, useRef } from "react";
import { ALL_STORES_VALUE } from "../../lib/feed-utils";

// Grouped category hierarchy. Groups with `children` are collapsible;
// groups without are direct filter buttons.
const CATEGORY_GROUPS = [
  {
    value: "tops",
    label: "Tops",
    children: [
      { value: "tops",                  label: "All Tops"          },
      { value: "tops_hoodies_sweaters", label: "Hoodies & Sweaters" },
      { value: "tops_shirts_blouses",   label: "Shirts & Blouses"   },
      { value: "tops_tees",             label: "Tees"               },
      { value: "tops_knitwear",         label: "Knitwear"           },
    ],
  },
  { value: "bottoms",        label: "Bottoms"          },
  { value: "dresses_skirts", label: "Dresses & Skirts" },
  {
    value: "jackets_coats",
    label: "Jackets & Coats",
    children: [
      { value: "jackets_coats", label: "All Jackets & Coats" },
      { value: "jackets",       label: "Jackets"              },
      { value: "coats",         label: "Coats"                },
    ],
  },
  { value: "footwear", label: "Footwear" },
  {
    value: "bags_accessories",
    label: "Bags & Accessories",
    children: [
      { value: "bags_accessories", label: "All Bags & Accessories" },
      { value: "bags",             label: "Bags"                   },
      { value: "accessories",      label: "Accessories"            },
    ],
  },
  { value: "sets", label: "Sets" },
];

export default function DesktopFilterPanel({
  ...
```

Change to:

```js
"use client";

import { useState, useEffect, useRef } from "react";
import { ALL_STORES_VALUE } from "../../lib/feed-utils";
import { FILTER_GROUPS as CATEGORY_GROUPS } from "../../lib/categories.js";

export default function DesktopFilterPanel({
  ...
```

Nothing inside the component body changes — `CATEGORY_GROUPS` is still the symbol used at line 184 (`{CATEGORY_GROUPS.map((group) => {`).

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add app/components/feed/DesktopFilterPanel.js
git commit -m "refactor(feed): use shared FILTER_GROUPS for desktop panel"
```

---

## Task 4: Migrate `MobileFilterDrawer.js` (user-visible fix lands here)

**Files:**
- Modify: `app/components/MobileFilterDrawer.js` — delete lines 6-55 (dead `CATEGORY_LABELS` and inline `CATEGORY_GROUPS`), add import and small local transform

This is the task that adds the four missing sub-category buttons to the mobile drawer (`jackets`, `coats`, `bags`, `accessories`). Before this task, mobile users could not filter by those four slugs; after, they match desktop.

- [ ] **Step 1: Delete the dead `CATEGORY_LABELS` and replace `CATEGORY_GROUPS` with a derived form**

In `app/components/MobileFilterDrawer.js`, the file currently begins:

```js
"use client";

import { useEffect } from "react";
import { ALL_STORES_VALUE } from "../lib/feed-utils";

const CATEGORY_LABELS = {
  tops: "Tops",
  tops_hoodies_sweaters: "Hoodies & Sweaters",
  tops_shirts_blouses: "Shirts & Blouses",
  tops_tees: "Tees",
  tops_knitwear: "Knitwear",
  bottoms: "Bottoms",
  dresses_skirts: "Dresses & Skirts",
  jackets_coats: "Jackets & Coats",
  footwear: "Footwear",
  bags_accessories: "Bags & Accessories",
  sets: "Sets",
};

const CATEGORY_GROUPS = [
  {
    label: "Tops",
    items: [
      ["tops", "All Tops"],
      ["tops_hoodies_sweaters", "Hoodies & Sweaters"],
      ["tops_shirts_blouses", "Shirts & Blouses"],
      ["tops_tees", "Tees"],
      ["tops_knitwear", "Knitwear"],
    ],
  },
  {
    label: "Bottoms",
    items: [["bottoms", "Bottoms"]],
  },
  {
    label: "Dresses & Skirts",
    items: [["dresses_skirts", "Dresses & Skirts"]],
  },
  {
    label: "Jackets & Coats",
    items: [["jackets_coats", "All Jackets & Coats"]],
  },
  {
    label: "Footwear",
    items: [["footwear", "Footwear"]],
  },
  {
    label: "Bags & Accessories",
    items: [["bags_accessories", "All Bags & Accessories"]],
  },
  {
    label: "Sets",
    items: [["sets", "Sets"]],
  },
];

export default function MobileFilterDrawer({
  ...
```

Change to:

```js
"use client";

import { useEffect } from "react";
import { ALL_STORES_VALUE } from "../lib/feed-utils";
import { FILTER_GROUPS } from "../lib/categories.js";

// Mobile renders each category group as a row of chips. Leaves render as a
// single chip with the parent's full label ("Bottoms"); groups render their
// children including the synthesized "All <Label>" entry first.
const CATEGORY_GROUPS = FILTER_GROUPS.map((g) => ({
  label: g.label,
  items: g.children
    ? g.children.map((c) => [c.value, c.label])
    : [[g.value, g.label]],
}));

export default function MobileFilterDrawer({
  ...
```

The dead `CATEGORY_LABELS` constant is deleted entirely (it was never imported or referenced — confirmed with grep).

The render block from line 140 onward (`{CATEGORY_GROUPS.map((group) => (`) is unchanged — the derived shape is structurally identical to the old inline shape, so the JSX still works.

After this task, the drawer's "Jackets & Coats" group will show three chips (`All Jackets & Coats`, `Jackets`, `Coats`) instead of one, and "Bags & Accessories" will show three (`All Bags & Accessories`, `Bags`, `Accessories`) instead of one. This is the intentional user-visible behavior change.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: Clean. If lint complains about unused `CATEGORY_LABELS` it means it wasn't fully deleted — re-check the file.

- [ ] **Step 4: Commit**

```bash
git add app/components/MobileFilterDrawer.js
git commit -m "fix(mobile-filters): expose missing sub-category buttons via shared taxonomy"
```

The commit message intentionally calls out `fix` instead of `refactor` because this task changes user-visible behavior — the four extra chips. Reviewers seeing the diff should know to test the drawer.

---

## Task 5: Migrate `nav/Column1.js`

**Files:**
- Modify: `app/components/nav/Column1.js` — replace lines 8-16 (`CATEGORY_ITEMS`) with an import + transform

The component uses `item.expandKey || item.key` (line 31) — meaning items without an `expandKey` fall back to their slug. The new derived form sets `expandKey` for every item using `shortKey || slug`, so the fallback becomes unnecessary but the existing code still works.

- [ ] **Step 1: Replace the inline constant**

In `app/components/nav/Column1.js`, the file currently begins:

```js
"use client";

import Link from "next/link";
import { buildFreshFeedUrl } from "../../lib/feed-utils";

const CONTACT_EMAIL = "hello@depot.paris";

const CATEGORY_ITEMS = [
  { key: "tops",            label: "Tops",                 expandable: true  },
  { key: "bottoms",         label: "Bottoms",              expandable: false },
  { key: "dresses_skirts",  label: "Dresses & Skirts",     expandable: false },
  { key: "jackets_coats",   label: "Jackets & Coats",      expandable: true, expandKey: "jackets", aliases: ["jackets", "coats"] },
  { key: "footwear",        label: "Footwear",             expandable: false },
  { key: "bags_accessories",label: "Bags & Accessories",   expandable: true, expandKey: "bags", aliases: ["bags", "accessories"] },
  { key: "sets",            label: "Sets",                 expandable: false },
];
```

Change to:

```js
"use client";

import Link from "next/link";
import { buildFreshFeedUrl } from "../../lib/feed-utils";
import { NAV_TOP_LEVEL } from "../../lib/categories.js";

const CONTACT_EMAIL = "hello@depot.paris";

const CATEGORY_ITEMS = NAV_TOP_LEVEL.map((c) => ({
  key: c.slug,
  label: c.label,
  expandable: c.expandable,
  expandKey: c.shortKey,
  aliases: c.childSlugs,
}));
```

The render block from line 24 onward is unchanged. Note that leaves now also carry `expandKey` (their own slug) and `aliases` (an empty array), which the component's `if (item.expandable)` branch never reads — so this is a harmless data difference.

- [ ] **Step 2: Spot-check the produced array**

The derived `CATEGORY_ITEMS` will look like:

```
{ key: "tops",             label: "Tops",             expandable: true,  expandKey: "tops",    aliases: [...] }
{ key: "bottoms",          label: "Bottoms",          expandable: false, expandKey: "bottoms", aliases: [] }
{ key: "dresses_skirts",   label: "Dresses & Skirts", expandable: false, expandKey: "dresses_skirts", aliases: [] }
{ key: "jackets_coats",    label: "Jackets & Coats",  expandable: true,  expandKey: "jackets", aliases: ["jackets","coats"] }
{ key: "footwear",         label: "Footwear",         expandable: false, expandKey: "footwear", aliases: [] }
{ key: "bags_accessories", label: "Bags & Accessories", expandable: true, expandKey: "bags", aliases: ["bags","accessories"] }
{ key: "sets",             label: "Sets",             expandable: false, expandKey: "sets",    aliases: [] }
```

Compare to the deleted inline constant: the seven entries are in the same order with identical keys/labels and matching expandable/expandKey/aliases for the three expandable entries. Leaves now carry extra fields the component ignores — safe.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/nav/Column1.js
git commit -m "refactor(nav): use shared NAV_TOP_LEVEL for Column1"
```

---

## Task 6: Migrate `nav/SubcategoryList.js`

**Files:**
- Modify: `app/components/nav/SubcategoryList.js` — replace lines 6-30 (`SUBCATEGORIES` + `HEADINGS`) with an import and adjust the render to read from the new shape

The new `SUBCATEGORIES_BY_SHORTKEY` returns `{ heading, items }` per shortKey rather than two parallel maps. The render function pulls both fields from one lookup.

- [ ] **Step 1: Replace the two inline maps and adjust the render**

In `app/components/nav/SubcategoryList.js`, the file currently is:

```js
"use client";

import Link from "next/link";
import { buildFreshFeedUrl } from "../../lib/feed-utils";

const SUBCATEGORIES = {
  tops: [
    ["tops",                  "All Tops"],
    ["tops_hoodies_sweaters", "Hoodies & Sweaters"],
    ["tops_shirts_blouses",   "Shirts & Blouses"],
    ["tops_tees",             "Tees"],
    ["tops_knitwear",         "Knitwear"],
  ],
  jackets: [
    ["jackets_coats", "All Jackets & Coats"],
    ["jackets",       "Jackets"],
    ["coats",         "Coats"],
  ],
  bags: [
    ["bags_accessories", "All Bags & Accessories"],
    ["bags",             "Bags"],
    ["accessories",      "Accessories"],
  ],
};

const HEADINGS = {
  tops:    "Tops",
  jackets: "Jackets & Coats",
  bags:    "Bags & Accessories",
};

const itemBase =
  "block py-2 font-mono text-[11px] uppercase tracking-widest transition-colors text-zinc-300 hover:text-zinc-50";
const itemActive = "text-zinc-50";
const labelStyle =
  "mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600";

export default function SubcategoryList({ expandKey, searchParams }) {
  const items = SUBCATEGORIES[expandKey];
  if (!items) return null;
  const selectedCategories = searchParams.getAll("category");

  return (
    <div>
      <div className={labelStyle}>{HEADINGS[expandKey]}</div>
      {items.map(([value, label]) => {
        const active = selectedCategories.includes(value);
        return (
          <Link
            key={value}
            href={buildFreshFeedUrl({ category: [value] })}
            className={`${itemBase} ${active ? itemActive : ""}`}
          >
            {active && <span className="-ml-4 mr-1">— </span>}
            {label}
          </Link>
        );
      })}
    </div>
  );
}
```

Change to:

```js
"use client";

import Link from "next/link";
import { buildFreshFeedUrl } from "../../lib/feed-utils";
import { SUBCATEGORIES_BY_SHORTKEY } from "../../lib/categories.js";

const itemBase =
  "block py-2 font-mono text-[11px] uppercase tracking-widest transition-colors text-zinc-300 hover:text-zinc-50";
const itemActive = "text-zinc-50";
const labelStyle =
  "mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600";

export default function SubcategoryList({ expandKey, searchParams }) {
  const data = SUBCATEGORIES_BY_SHORTKEY[expandKey];
  if (!data) return null;
  const { heading, items } = data;
  const selectedCategories = searchParams.getAll("category");

  return (
    <div>
      <div className={labelStyle}>{heading}</div>
      {items.map(([value, label]) => {
        const active = selectedCategories.includes(value);
        return (
          <Link
            key={value}
            href={buildFreshFeedUrl({ category: [value] })}
            className={`${itemBase} ${active ? itemActive : ""}`}
          >
            {active && <span className="-ml-4 mr-1">— </span>}
            {label}
          </Link>
        );
      })}
    </div>
  );
}
```

Two lines change inside the component: `const data = SUBCATEGORIES_BY_SHORTKEY[expandKey]; if (!data) return null; const { heading, items } = data;` (replacing the two `[expandKey]` lookups), and `<div className={labelStyle}>{heading}</div>` reads the destructured local instead of `HEADINGS[expandKey]`.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add app/components/nav/SubcategoryList.js
git commit -m "refactor(nav): use shared SUBCATEGORIES_BY_SHORTKEY"
```

---

## Task 7: Migrate `Nav.js`

**Files:**
- Modify: `app/components/Nav.js` — replace lines 12-40 (`CATEGORY_ITEMS` + `MOBILE_NAV_ITEMS`) with imports + transforms

`Nav.js`'s `CATEGORY_ITEMS` is a partial duplicate of `SubcategoryList`'s `SUBCATEGORIES` (just the `items` arrays, no headings). Both can derive from the same `SUBCATEGORIES_BY_SHORTKEY`.

`MOBILE_NAV_ITEMS` is the top-level mobile primary list — derive from `NAV_TOP_LEVEL`.

- [ ] **Step 1: Replace both inline constants**

In `app/components/Nav.js`, the relevant block (lines 1-40) currently is:

```js
"use client";

import { useRef, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { buildFreshFeedUrl } from "../lib/feed-utils";
import Link from "next/link";
import { createPortal } from "react-dom";
import DesktopNav from "./DesktopNav";

const CONTACT_EMAIL = "hello@depot.paris";

const CATEGORY_ITEMS = {
  tops: [
    ["tops", "All Tops"],
    ["tops_hoodies_sweaters", "Hoodies & Sweaters"],
    ["tops_shirts_blouses", "Shirts & Blouses"],
    ["tops_tees", "Tees"],
    ["tops_knitwear", "Knitwear"],
  ],
  jackets: [
    ["jackets_coats", "All Jackets & Coats"],
    ["jackets", "Jackets"],
    ["coats", "Coats"],
  ],
  bags: [
    ["bags_accessories", "All Bags & Accessories"],
    ["bags", "Bags"],
    ["accessories", "Accessories"],
  ],
};

const MOBILE_NAV_ITEMS = [
  { label: "TOPS", href: "/feed?category=tops", key: "tops" },
  { label: "BOTTOMS", href: "/feed?category=bottoms", key: "bottoms" },
  { label: "DRESSES & SKIRTS", href: "/feed?category=dresses_skirts", key: "dresses_skirts" },
  { label: "JACKETS & COATS", href: "/feed?category=jackets_coats", key: "jackets_coats" },
  { label: "FOOTWEAR", href: "/feed?category=footwear", key: "footwear" },
  { label: "BAGS & ACCESSORIES", href: "/feed?category=bags_accessories", key: "bags_accessories" },
  { label: "SETS", href: "/feed?category=sets", key: "sets" },
];
```

Change to:

```js
"use client";

import { useRef, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { buildFreshFeedUrl } from "../lib/feed-utils";
import { SUBCATEGORIES_BY_SHORTKEY, NAV_TOP_LEVEL } from "../lib/categories.js";
import Link from "next/link";
import { createPortal } from "react-dom";
import DesktopNav from "./DesktopNav";

const CONTACT_EMAIL = "hello@depot.paris";

// Sub-menus keyed by shortKey (tops/jackets/bags). Mobile drawer reads
// .items only — the heading isn't rendered here.
const CATEGORY_ITEMS = Object.fromEntries(
  Object.entries(SUBCATEGORIES_BY_SHORTKEY).map(([k, v]) => [k, v.items]),
);

// Top-level mobile primary list. Labels are uppercased here for the
// drawer's typography; preserves existing visual output exactly.
const MOBILE_NAV_ITEMS = NAV_TOP_LEVEL.map((c) => ({
  label: c.label.toUpperCase(),
  href: `/feed?category=${c.slug}`,
  key: c.slug,
}));
```

The rest of the file (the `MobileNav` function, the render logic, the `key.split("_")[0]` derivation that maps top-level keys to shortKeys) is unchanged. Leaving the `.split("_")[0]` heuristic in place keeps this refactor minimal — it's a pre-existing sharp edge, not introduced here.

- [ ] **Step 2: Spot-check uppercase labels**

Confirm the derived `MOBILE_NAV_ITEMS` produces these exact label strings:

```
"TOPS", "BOTTOMS", "DRESSES & SKIRTS", "JACKETS & COATS",
"FOOTWEAR", "BAGS & ACCESSORIES", "SETS"
```

`"Tops".toUpperCase()` → `"TOPS"` ✓
`"Dresses & Skirts".toUpperCase()` → `"DRESSES & SKIRTS"` ✓
`"Bags & Accessories".toUpperCase()` → `"BAGS & ACCESSORIES"` ✓

If any label doesn't match exactly, the canonical `CATEGORIES.label` field in Task 1 has the wrong casing — fix it there.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/Nav.js
git commit -m "refactor(nav): use shared categories module in Nav.js"
```

---

## Task 8: End-to-end verification on Vercel preview

**Files:** none (verification only)

This is the only task that produces evidence the user-visible fix in Task 4 actually works in production-like conditions. CLAUDE.md is explicit: localhost can mislead on hydration and preview-only env vars; verify on Vercel.

- [ ] **Step 1: Push the branch and open a PR**

```bash
git push -u origin HEAD
gh pr create --title "Consolidate category taxonomy + fix mobile sub-filters" --body "$(cat <<'EOF'
## Summary
- Adds `app/lib/categories.js` as the single source of truth for category taxonomy
- Replaces 7 inline copies (route.js, DesktopFilterPanel, MobileFilterDrawer, Column1, SubcategoryList, Nav.js) with imports
- Fixes mobile filter drawer: adds the four sub-category chips (`Jackets`, `Coats`, `Bags`, `Accessories`) that were silently missing on mobile but present on desktop
- Removes dead `CATEGORY_LABELS` constant from `MobileFilterDrawer.js`

## Test plan
- [ ] Vercel preview: desktop refine panel still expands Tops / Jackets & Coats / Bags & Accessories with all sub-buttons
- [ ] Vercel preview: mobile refine drawer now shows `Jackets`, `Coats`, `Bags`, `Accessories` chips (previously absent)
- [ ] Vercel preview: clicking each chip filters the feed correctly (URL `?category=jackets`, `?category=coats`, etc.)
- [ ] Vercel preview: desktop nav menu — Tops/Jackets/Bags expand to correct sub-menus with correct headings
- [ ] Vercel preview: mobile nav drawer — TOPS/JACKETS & COATS/BAGS & ACCESSORIES expand and show sub-items
- [ ] Vercel preview: API filters still work: `/api/products?category=tops_tees`, `?category=jackets`, `?category=bags_accessories`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Wait for the Vercel preview deploy and capture its URL**

Run: `gh pr view --json statusCheckRollup --jq '.statusCheckRollup[] | select(.name == "Vercel") | .targetUrl'`
Or check the PR page for the Vercel preview URL once the deploy is green.

- [ ] **Step 3: Desktop verification on the preview URL**

In a desktop browser, on the preview URL:

1. Open `/feed`. Click the "Refine" button to open `DesktopFilterPanel`.
2. Click "Tops" — verify it expands to show: All Tops, Hoodies & Sweaters, Shirts & Blouses, Tees, Knitwear.
3. Click "Jackets & Coats" — verify it expands to show: All Jackets & Coats, Jackets, Coats.
4. Click "Bags & Accessories" — verify it expands to show: All Bags & Accessories, Bags, Accessories.
5. Click "Tees" — verify the URL becomes `/feed?category=tops_tees` and the feed updates.
6. Open the desktop nav menu (top-bar). Click "Tops" — verify the sub-menu shows the same five entries with the heading "Tops".

If any sub-item is missing or labeled differently, check `app/lib/categories.js` for the relevant `label` string.

- [ ] **Step 4: Mobile verification on the preview URL**

On the preview URL using mobile device emulation (or a real phone):

1. Open `/feed`. Tap the filter button to open `MobileFilterDrawer`.
2. Scroll to the "Jackets & Coats" group — verify it now shows three chips: `All Jackets & Coats`, `Jackets`, `Coats`. **This is the fix — before this change, only `All Jackets & Coats` appeared.**
3. Scroll to the "Bags & Accessories" group — verify three chips: `All Bags & Accessories`, `Bags`, `Accessories`. **Also part of the fix.**
4. Tap the `Jackets` chip — verify URL becomes `/feed?category=jackets` and feed updates.
5. Tap the `Bags` chip — verify URL becomes `/feed?category=bags`.
6. Open the mobile nav drawer (hamburger). Tap "JACKETS & COATS" — verify it expands to show All Jackets & Coats / Jackets / Coats.

- [ ] **Step 5: API verification — slug→DB mapping integrity**

The risk this step protects against: a broken `CATEGORY_SLUG_TO_DB` entry produces a clean HTTP 200 with `total: 0` (because the route falls back to the raw slug, no rows match, and the route still returns successfully). An "empty array, 200 OK" response is therefore *exactly* the symptom of a regression — it cannot be the success criterion.

Instead, exploit the fact that in this taxonomy every child slug maps to the *same* DB string as its parent (`jackets` → "Jackets & Coats", same as `jackets_coats` → "Jackets & Coats"). So child and parent slug requests must return **identical totals**. Any divergence means the mapping broke.

Run each pair below on the preview URL and compare the `total` field in the JSON response:

| Request A | Request B | Expected |
|-----------|-----------|----------|
| `/api/products?category=jackets` | `/api/products?category=jackets_coats` | `A.total === B.total` |
| `/api/products?category=coats` | `/api/products?category=jackets_coats` | `A.total === B.total` |
| `/api/products?category=bags` | `/api/products?category=bags_accessories` | `A.total === B.total` |
| `/api/products?category=accessories` | `/api/products?category=bags_accessories` | `A.total === B.total` |
| `/api/products?category=tops_tees` | `/api/products?category=tops` | `A.total <= B.total` and `A.total > 0` |
| `/api/products?category=tops_hoodies_sweaters` | `/api/products?category=tops` | `A.total <= B.total` and `A.total > 0` |

The first four pairs are equality assertions: child and parent map to the same DB string, so the totals must match exactly. The last two are subset assertions: tops sub-slugs all map to "Tops", so the parent's total is the sum across sub-slugs and each individual sub-slug must be non-empty (a zero result means that sub-slug isn't mapping correctly).

If any check fails, do NOT merge. The slug→DB mapping in `app/lib/categories.js` has regressed — fix it and re-run.

A handy one-liner for any pair (run in the browser console on the preview):

```js
const t = async (q) => (await (await fetch(`/api/products?category=${q}`)).json()).total;
console.log("jackets vs jackets_coats:",  await t("jackets"),       await t("jackets_coats"));
console.log("coats vs jackets_coats:",    await t("coats"),         await t("jackets_coats"));
console.log("bags vs bags_accessories:",  await t("bags"),          await t("bags_accessories"));
console.log("accessories vs bags_acc:",   await t("accessories"),   await t("bags_accessories"));
console.log("tops_tees vs tops:",         await t("tops_tees"),     await t("tops"));
console.log("tops_hoodies vs tops:",      await t("tops_hoodies_sweaters"), await t("tops"));
```

Each pair should print two equal numbers (rows 1-4) or two numbers where the first is positive and ≤ the second (rows 5-6).

- [ ] **Step 6: Capture screenshots and attach to the PR**

Take a screenshot of the mobile filter drawer showing the new chips. Comment on the PR with the screenshot so the reviewer can confirm the user-visible change without spinning up the preview themselves.

- [ ] **Step 7: Hand off**

The PR is ready for human review and merge. Do not merge to `main` — CLAUDE.md says "Merge only after explicit user instruction".
