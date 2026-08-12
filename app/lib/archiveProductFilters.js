// Client-side category filtering and sorting for a featured archive page.
//
// The feed does this work in Postgres because it pages through tens of
// thousands of rows; an archive is tens of rows, fully fetched server-side and
// handed to the client in one payload, so the same semantics are reproduced
// here in memory. "Same semantics" is the point: parent/leaf OR matching comes
// from resolveCategoryFilter, group labels come from getFilterGroups, and the
// price sort parses through parseEur — no second taxonomy, no second parser.
//
// Pure module: no I/O, no React. Its consumer is ArchiveProductsClient.

import { getFilterGroups, resolveCategoryFilter } from "./categories.js";
import { parseEur } from "./currency.js";

function leafKey(category, subcategory) {
  return `${category}::${subcategory}`;
}

// Deterministic last-resort tie-break so equal sort keys never reorder between
// renders (Array#sort is stable, but the input order isn't guaranteed to be).
function identity(product) {
  return `${product.storeDomain}::${product.handle}`;
}

/**
 * Filter-panel groups covering only the categories actually present in
 * `products`, in the canonical taxonomy order.
 *
 * A parent whose leaves are all absent — or which is present only through rows
 * with a NULL subcategory — renders as a plain leaf row (children: null),
 * because an expandable group with nothing under it is a dead end. A parent
 * with at least one present leaf keeps the "All <Label>" first child, mirroring
 * getFilterGroups, so the parent slug itself stays selectable.
 *
 * `lang` must be threaded explicitly — getFilterGroups defaults to English
 * silently (CLAUDE.md).
 */
export function buildArchiveFilterGroups(products, lang = "en") {
  const presentCategories = new Set();
  const presentLeaves = new Set();
  for (const p of products ?? []) {
    if (p?.category == null) continue;
    presentCategories.add(p.category);
    if (p.subcategory != null) presentLeaves.add(leafKey(p.category, p.subcategory));
  }

  const groups = [];
  for (const group of getFilterGroups(lang)) {
    const { parentCategories } = resolveCategoryFilter([group.value]);
    const dbName = parentCategories[0];
    if (!presentCategories.has(dbName)) continue;

    // The first child is the "All <Label>" alias for the parent slug; the rest
    // are the real leaves. Drop it here and re-add it only if a leaf survives.
    const leaves = (group.children ?? [])
      .filter((child) => child.value !== group.value)
      .filter((child) => {
        const { leafFilters } = resolveCategoryFilter([child.value]);
        const leaf = leafFilters[0];
        return leaf != null && presentLeaves.has(leafKey(leaf.category, leaf.subcategory));
      });

    const allChild = (group.children ?? []).find((child) => child.value === group.value);
    groups.push({
      value: group.value,
      label: group.label,
      children: leaves.length && allChild ? [allChild, ...leaves] : null,
    });
  }
  return groups;
}

/**
 * Products matching any of `slugs` (parent or leaf), or all products when the
 * selection is empty.
 *
 * OR semantics, not intersection — the same shape resolveCategoryFilter exists
 * to preserve: a parent slug matches on category alone, a leaf slug matches
 * only when category AND subcategory agree. Rows with a NULL category match
 * nothing, which is exactly what the feed does with unenriched stock.
 */
export function filterProductsByCategories(products, slugs) {
  const list = products ?? [];
  if (!Array.isArray(slugs) || slugs.length === 0) return list;

  const { parentCategories, leafFilters } = resolveCategoryFilter(slugs);
  const parents = new Set(parentCategories);
  const leaves = new Set(leafFilters.map((f) => leafKey(f.category, f.subcategory)));

  return list.filter((p) => {
    if (p?.category == null) return false;
    if (parents.has(p.category)) return true;
    return p.subcategory != null && leaves.has(leafKey(p.category, p.subcategory));
  });
}

// Ascending comparator that always sends null/undefined to the end, whichever
// direction the caller is sorting in. Applied to both price and syncedAt: a
// row with no usable key is unrankable, and floating it to the top of "oldest"
// (or "price low → high") would read as data, not as absence.
function compareNullsLast(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// Direction-aware wrapper. Negating compareNullsLast wholesale would flip the
// null placement along with the ordering, floating unrankable rows to the top
// of every descending sort — so the sign is applied only once both keys exist.
function compareDirNullsLast(a, b, dir) {
  if (a == null || b == null) return compareNullsLast(a, b);
  return dir * compareNullsLast(a, b);
}

function syncedKey(product) {
  return product?.syncedAt == null ? null : String(product.syncedAt);
}

/**
 * A sorted copy of `products` for one of the feed's sort values.
 *
 * "interleaved" is the archive's default: the server already returns
 * newest-synced first, so it and "latest" are the same ordering here.
 * Prices are TEXT in the DB (CLAUDE.md), so they're parsed to numbers before
 * comparison rather than sorted lexicographically.
 */
export function sortArchiveProducts(products, sort) {
  const list = [...(products ?? [])];

  const byNewest = (a, b) => compareDirNullsLast(syncedKey(a), syncedKey(b), -1);
  const tie = (a, b) => identity(a).localeCompare(identity(b));

  if (sort === "oldest") {
    return list.sort(
      (a, b) => compareDirNullsLast(syncedKey(a), syncedKey(b), 1) || tie(a, b),
    );
  }

  if (sort === "price_asc" || sort === "price_desc") {
    const dir = sort === "price_asc" ? 1 : -1;
    return list.sort(
      (a, b) =>
        compareDirNullsLast(parseEur(a?.price), parseEur(b?.price), dir) ||
        byNewest(a, b) ||
        tie(a, b),
    );
  }

  // "interleaved" | "latest" | anything unrecognized
  return list.sort((a, b) => byNewest(a, b) || tie(a, b));
}
