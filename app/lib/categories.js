// Canonical category taxonomy. The ONLY place to add or edit categories.
// Every other file derives its data from CATEGORIES via the exports below.
//
// Shape of each entry:
//   slug      — URL-safe identifier (e.g. "tops", "jackets_coats")
//   label     — EN human-readable display string (e.g. "Jackets & Coats")
//   labelFr   — FR display string; required on every entry
//   dbName    — display string stored in the products.category column
//   shortKey  — (groups only) compact alias used by nav code to key sub-menus
//   children  — (groups only) array of { slug, label, labelFr, subcategory? }
//
// Children inherit their parent's dbName: a product tagged "tops_tees" in the
// URL filters against rows where products.category = "Tops" in the DB.

export const CATEGORIES = [
  {
    slug: "tops",
    label: "Tops",
    labelFr: "Hauts",
    dbName: "Tops",
    shortKey: "tops",
    children: [
      { slug: "tops_hoodies_sweaters", label: "Hoodies & Sweaters", labelFr: "Pulls & Sweats",    subcategory: "hoodies_sweaters" },
      { slug: "tops_shirts_blouses",   label: "Shirts & Blouses",   labelFr: "Chemises & Blouses", subcategory: "shirts_blouses"   },
      { slug: "tops_tees",             label: "Tees",               labelFr: "T-shirts",            subcategory: "tees"             },
      { slug: "tops_knitwear",         label: "Knitwear",           labelFr: "Maille",              subcategory: "knitwear"         },
    ],
  },
  { slug: "bottoms",        label: "Bottoms",          labelFr: "Bas",                  dbName: "Bottoms" },
  { slug: "dresses_skirts", label: "Dresses & Skirts", labelFr: "Robes & Jupes",        dbName: "Dresses & Skirts" },
  {
    slug: "jackets_coats",
    label: "Jackets & Coats",
    labelFr: "Vestes & Manteaux",
    dbName: "Jackets & Coats",
    shortKey: "jackets",
    children: [
      { slug: "jackets", label: "Jackets", labelFr: "Vestes",   subcategory: "jackets" },
      { slug: "coats",   label: "Coats",   labelFr: "Manteaux", subcategory: "coats"   },
    ],
  },
  { slug: "footwear",        label: "Footwear",          labelFr: "Chaussures",          dbName: "Footwear" },
  {
    slug: "bags_accessories",
    label: "Bags & Accessories",
    labelFr: "Sacs & Accessoires",
    dbName: "Bags & Accessories",
    shortKey: "bags",
    children: [
      { slug: "bags",        label: "Bags",        labelFr: "Sacs",        subcategory: "bags"        },
      { slug: "accessories", label: "Accessories", labelFr: "Accessoires", subcategory: "accessories" },
    ],
  },
  { slug: "sets", label: "Sets", labelFr: "Ensembles", dbName: "Sets" },
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

// Given an array of URL slugs (parent or leaf), separate them into:
//   parentCategories — DB categories filtered without a subcategory constraint
//   leafFilters      — (category, subcategory) pairs that must match together
//
// The caller composes them as an OR clause:
//   category IN (parentCategories) OR (category=X AND subcategory=Y) OR …
//
// Keeping the two shapes separate is what fixes the mixed parent+leaf bug:
// flattening into independent `category IN (…)` AND `subcategory IN (…)`
// filters intersects them globally and silently drops parent-only rows.
export function resolveCategoryFilter(slugs) {
  if (!Array.isArray(slugs) || slugs.length === 0) {
    return { parentCategories: [], leafFilters: [] };
  }
  const parentCategories = new Set();
  const leafFilters = [];
  for (const slug of slugs) {
    const entry = SLUG_TO_FILTER[slug];
    if (!entry) {
      // Unknown slug: preserve the legacy `|| s` fallback by treating it
      // as a raw category filter. Mismatches are silently filtered out
      // downstream when no rows match.
      parentCategories.add(slug);
      continue;
    }
    if (entry.subcategory) {
      leafFilters.push({ category: entry.category, subcategory: entry.subcategory });
    } else {
      parentCategories.add(entry.category);
    }
  }
  return {
    parentCategories: [...parentCategories],
    leafFilters,
  };
}

// Helper: pick the right label for the given language, falling back to EN.
function lbl(entry, lang) {
  return (lang === "fr" && entry.labelFr) ? entry.labelFr : entry.label;
}

// Helper: "All <Label>" equivalent per language.
function allLabel(entry, lang) {
  return lang === "fr" ? `Tout afficher` : `All ${entry.label}`;
}

// Filter panel groups. Leaves have children=null; groups include an
// "All <Label>" entry as the first child (so the parent slug remains
// selectable). Used by DesktopFilterPanel.
// Pass language ("en"|"fr") to get labels in that language.
export function getFilterGroups(lang = "en") {
  return CATEGORIES.map((c) => ({
    value: c.slug,
    label: lbl(c, lang),
    children: c.children
      ? [
          { value: c.slug, label: allLabel(c, lang) },
          ...c.children.map((ch) => ({ value: ch.slug, label: lbl(ch, lang) })),
        ]
      : null,
  }));
}

// Top-level nav entries. Used by Column1 (desktop side panel) and
// the mobile drawer's primary list.
export function getNavTopLevel(lang = "en") {
  return CATEGORIES.map((c) => ({
    slug: c.slug,
    label: lbl(c, lang),
    expandable: Boolean(c.children),
    shortKey: c.shortKey || c.slug,
    childSlugs: (c.children || []).map((ch) => ch.slug),
  }));
}

// Sub-menu lookup keyed by shortKey. Each entry has the heading to
// display plus the [value, label] tuples for sub-items, with the
// parent slug surfaced as "All <Label>" first. Used by SubcategoryList
// (desktop) and mobile drawer expansions.
//
// Uses the same `shortKey || slug` fallback as getNavTopLevel so that
// the two exports always agree on the lookup key.
export function getSubcategoriesByShortKey(lang = "en") {
  return Object.fromEntries(
    CATEGORIES
      .filter((c) => c.children)
      .map((c) => [
        c.shortKey || c.slug,
        {
          heading: lbl(c, lang),
          items: [
            [c.slug, allLabel(c, lang)],
            ...c.children.map((ch) => [ch.slug, lbl(ch, lang)]),
          ],
        },
      ]),
  );
}

// Module-load assertion: catch schema drift fast. Every grouped category
// must have a unique shortKey (or slug fallback). Runs against raw CATEGORIES
// so it fires on import regardless of language accessor calls.
{
  const grouped = CATEGORIES.filter((c) => c.children);
  const navKeys = grouped.map((c) => c.shortKey || c.slug);
  const subKeys = grouped.map((c) => c.shortKey || c.slug);
  const missing = navKeys.filter((k) => !subKeys.includes(k));
  const duplicates = navKeys.filter((k, i) => navKeys.indexOf(k) !== i);
  if (missing.length || duplicates.length) {
    throw new Error(
      `categories.js: nav/sub-menu key mismatch. ` +
      `missing=${JSON.stringify(missing)} duplicates=${JSON.stringify(duplicates)}`,
    );
  }
}
