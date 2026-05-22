import { normalizeBrand } from "./brand.js";

// Stores whose own house line ("NUOVO PARIS") is out of scope for the
// curated archive feed. Narrower than FILTER_BY_BRAND: only hides the
// store's self-brand variants and rows that exhausted enrichment with
// brand=null. Real third-party brand inventory at the same store stays
// visible. Wiring lives in /api/enrich, not in sync — see plan notes.
export const SELF_BRANDED_STORES = new Set(["nuovo-paris.com", "atdawnparis.com"]);

// True when `brand` resolves to the store's own house line, or when
// brand is missing entirely. The null/empty branch is provided so the
// helper is composable from any future call site without re-implementing
// null semantics. /api/enrich calls this only on the success branch
// (where `newBrand` is non-null) and handles the null-brand retry-budget
// logic separately.
export function isSelfBranded(storeDomain, brand) {
  if (!SELF_BRANDED_STORES.has(storeDomain)) return false;
  if (brand === null || brand === undefined) return true;
  const n = normalizeBrand(brand);
  if (!n) return true;
  if (storeDomain === "nuovo-paris.com") {
    return n === "nuovo" || n === "nuovo paris" || n.startsWith("nuovo paris ");
  }
  if (storeDomain === "atdawnparis.com") {
    return n === "at dawn" || n === "at dawn paris" || n.startsWith("at dawn paris ");
  }
  return false;
}
