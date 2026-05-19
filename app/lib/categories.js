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
