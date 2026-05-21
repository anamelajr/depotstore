// Canonical category taxonomy. The ONLY place to add or edit categories.
// Every other file derives its data from CATEGORIES via the exports below.
//
// Shape of each entry:
//   slug      — URL-safe identifier (e.g. "tops", "jackets_coats")
//   label     — human-readable display string (e.g. "Jackets & Coats")
//   dbName    — display string stored in the products.category column
//   shortKey  — (groups only) compact alias used by nav code to key sub-menus
//   children  — (groups only) array of { slug, label, subcategory? } leaf entries
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
      { slug: "tops_hoodies_sweaters", label: "Hoodies & Sweaters", subcategory: "hoodies_sweaters" },
      { slug: "tops_shirts_blouses",   label: "Shirts & Blouses",   subcategory: "shirts_blouses"   },
      { slug: "tops_tees",             label: "Tees",               subcategory: "tees"             },
      { slug: "tops_knitwear",         label: "Knitwear",           subcategory: "knitwear"         },
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
      { slug: "jackets", label: "Jackets", subcategory: "jackets" },
      { slug: "coats",   label: "Coats",   subcategory: "coats"   },
    ],
  },
  { slug: "footwear", label: "Footwear", dbName: "Footwear" },
  {
    slug: "bags_accessories",
    label: "Bags & Accessories",
    dbName: "Bags & Accessories",
    shortKey: "bags",
    children: [
      { slug: "bags",        label: "Bags",        subcategory: "bags"        },
      { slug: "accessories", label: "Accessories", subcategory: "accessories" },
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

// Leaf-aware slug → DB filter shape. Parent slugs resolve to a category
// filter with no subcategory; leaf slugs resolve to BOTH (category +
// subcategory). Unknown slugs return { category: slug, subcategory: null }
// — preserves the legacy `|| s` fallback in /api/products/route.js.
const SLUG_TO_FILTER = (() => {
  const map = {};
  for (const c of CATEGORIES) {
    map[c.slug] = { category: c.dbName, subcategory: null };
    for (const child of c.children || []) {
      map[child.slug] = { category: c.dbName, subcategory: child.subcategory };
    }
  }
  return map;
})();

// Given an array of URL slugs (parent or leaf), return the deduplicated
// arrays of DB category values and subcategory slugs to filter on.
// Either array may be empty.
export function resolveCategoryFilter(slugs) {
  if (!Array.isArray(slugs) || slugs.length === 0) {
    return { categoryDbValues: [], subcategorySlugs: [] };
  }
  const cats = new Set();
  const subs = new Set();
  for (const slug of slugs) {
    const entry = SLUG_TO_FILTER[slug];
    if (!entry) {
      cats.add(slug);
      continue;
    }
    cats.add(entry.category);
    if (entry.subcategory) subs.add(entry.subcategory);
  }
  return {
    categoryDbValues: [...cats],
    subcategorySlugs: [...subs],
  };
}

// Filter panel groups. Leaves have children=null; groups include an
// "All <Label>" entry as the first child (so the parent slug remains
// selectable). Used by DesktopFilterPanel.
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
