// Helpers for the enrich route's deterministic handle-fallback path.
// Extracted from app/api/enrich/route.js so they can be unit-tested without
// re-exporting from a Next App Router route module — `route.js` named exports
// are reserved for HTTP method handlers and route segment config.

// Token-aware title case. Preserves canonical casing for season codes
// (FW1998, SS99, AW2000) and decade markers (2000s, 1990s) per
// cleanTitle's prompt examples. Other tokens get standard title case
// (first letter upper, rest lower).
export function toTitleCase(s) {
  return s
    .split(/\s+/)
    .map((token) => {
      if (!token) return token;
      if (/^(FW|SS|AW)\d{2,4}$/i.test(token)) return token.toUpperCase();
      if (/^\d{4}s$/i.test(token)) return token.toLowerCase();
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(" ");
}

// Mirror cleanTitle's prompt rule "remove collection names in quotes,
// parentheticals" so the deterministic fallback writes a title that
// meets the same editorial bar. Stripping is delimiter-class greedy
// (each class runs once over the string); collapse whitespace and
// trim afterward. No-op on titles without quotes/parens.
export function sanitizeFallbackTitle(s) {
  return s
    .replace(/«[^»]*»/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Removes the brand from the raw name before title-casing, so a row whose
// Shopify name *does* include the brand (e.g. "HELMUT LANG DRESS") doesn't
// produce a redundant title that echoes the brand line on the product card —
// the same failure mode cleanTitle's `brandInTitle` guard exists to prevent.
// Match is whole-word, case-insensitive, and accent-insensitive against the
// full brand phrase; if no match, original name is returned untouched.
export function nameWithoutBrand(name, brand) {
  const accentStrip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const tokens = accentStrip(brand).split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return name;
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(
    `(^|[^A-Za-z0-9])${escaped.join("[^A-Za-z0-9]+")}([^A-Za-z0-9]|$)`,
    "gi"
  );
  const stripped = accentStrip(name);
  const after = stripped.replace(re, "$1$2");
  if (after === stripped) return name;
  // Strip leading/trailing non-alphanumerics so a name like "FENDI - WOOL"
  // doesn't leave a dangling delimiter ("- Wool") in the resulting title.
  return after
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}
