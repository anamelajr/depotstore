// Helpers for the enrich route's deterministic handle-fallback path.
// Extracted from app/api/enrich/route.js so they can be unit-tested without
// re-exporting from a Next App Router route module — `route.js` named exports
// are reserved for HTTP method handlers and route segment config.

import { brandSpellings, canonicalBrand, normalizeBrand } from "./brand.js";

// Token-aware title case. Preserves canonical casing for season codes
// (FW1998, SS99, AW2000) and decade markers (2000s, 1990s) per
// cleanTitle's prompt examples. Other tokens get standard title case
// (first letter upper, rest lower).
//
// The season guard admits split years ("FW02/03"), letter-slash prefixes
// ("F/W02") and a trailing comma or period, because the generic branch below
// lowercases everything after the first character — that is how "FW02/03"
// once became "Fw02/03". Uppercasing is all this function owes them; the
// compaction to the house form is normalizeSeasonCodes' job downstream
// (app/lib/seasonCodes.js).
export function toTitleCase(s) {
  return s
    .split(/\s+/)
    .map((token) => {
      if (!token) return token;
      if (/^(F\/?W|S\/?S|A\/?W)\d{2,4}([/-]\d{2,4})?[.,]?$/i.test(token)) {
        return token.toUpperCase();
      }
      // Bare "S/S" — the year is the next token ("S/S 2004").
      if (/^[FSA]\/[WS]$/i.test(token)) return token.toUpperCase();
      if (/^\d{4}s$/i.test(token)) return token.toLowerCase();
      // Title-case each `/`-separated segment: "wool/silk" → "Wool/Silk". The
      // generic branch below only uppercases the token's first character, which
      // left "Wool/silk" in production titles. Every season-code shape returns
      // above, so this can't touch "F/W02" or "FW02/03".
      return token
        .split("/")
        .map((seg) =>
          seg ? seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase() : seg
        )
        .join("/");
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

// nameWithoutBrand removes exactly the one phrase it is handed. A vendor name
// carrying a DIFFERENT spelling of the same designer than the one we resolved
// ("YSL RECTANGULAR METAL …" under brand "Yves Saint Laurent") therefore kept
// its alias token, and toTitleCase turned it into "Ysl …" — the production
// class this repair exists for. Strip every spelling of the family, longest
// first (brandSpellings is already sorted that way), so no shorter spelling can
// strand a fragment of a longer one.
export function stripAllBrandSpellings(name, brand) {
  let out = name;
  for (const spelling of brandSpellings(brand)) {
    out = nameWithoutBrand(out, spelling);
  }
  return out;
}

// Diffusion / sub-line words that vendors put between the house brand and the
// garment ("COMME DES GARÇONS BLACK - FW2014 …", "RICK OWENS DRKSHDW - COTTON
// TANK TOP"). They are NOT brand aliases — aliasing them would put "black" and
// "girl" into BRAND_HANDLE_SLUGS and let any handle containing those words
// resolve to a brand — so they get a conservative, per-brand, leading-position-
// only table here. Keyed by normalized canonical brand.
// Exported (read-only) for the formatting validator, which distinguishes a
// leaked sub-line prefix from a plain season-ordering problem — the two need
// different fixes, so the alert must not conflate them.
export const SUB_LINE_PREFIXES = {
  "rick owens": ["DRKSHDW", "LILIES"],
  "comme des garcons": ["HOMME PLUS", "HOMME", "BLACK", "GIRL", "SHIRT", "PLAY", "TAO"],
  "ann demeulemeester": ["BLANCHE"],
  "maison margiela": ["MM6"],
  "yohji yamamoto": ["Y'S", "POUR HOMME"],
  "john galliano": ["LONDON"],
  "valentino": ["BOUTIQUE"],
};

// Builds the body of a leading-sub-line regex from a prefix literal. Two things
// the raw string cannot do on its own:
//   - regex metacharacters ("Y'S" is safe, but "Y/PROJECT"-shaped future
//     entries are not) must be escaped;
//   - the apostrophe must match BOTH the straight `'` and the curly `’` —
//     vendors use either, and row 15239796 stores the curly one, so a literal
//     `'` would silently miss it.
// Exported so the formatting validator matches exactly what the strip matches.
export function subLinePrefixPattern(prefix) {
  return prefix
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+")
    .replace(/['’]/g, "['’]");
}

// Removes a leading sub-line marker left behind after the brand strip. Matches
// ONLY at the start and only when followed by a dash separator, so a genuine
// descriptor ("Black Wool Coat", "Shirt Blue Abstract Face Shirt") survives —
// the dash is what marks the vendor's brand/description boundary.
export function stripSubLinePrefix(title, brand) {
  const key = normalizeBrand(canonicalBrand(brand));
  const prefixes = SUB_LINE_PREFIXES[key];
  if (!prefixes || !title) return title;
  for (const prefix of [...prefixes].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`^\\s*${subLinePrefixPattern(prefix)}\\s*-\\s*`, "i");
    if (re.test(title)) return title.replace(re, "");
  }
  return title;
}

// Removes dash artifacts left by the brand / sub-line strips: a leading or
// trailing " - ", and orphaned runs where both sides collapsed away.
export function collapseDanglingDash(title) {
  if (typeof title !== "string") return title;
  return title
    .replace(/\s*-\s*-\s*/g, " - ")
    .replace(/^[\s-]+/, "")
    .replace(/[\s-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SEASON_TOKEN = /\b(?:FW|SS|AW)\d{2,4}(?:\s?[/-]\s?\d{2,4})?\b/gi;

// "Top - FW10" → "FW10 Top". The house convention puts the season first
// (docs/plan-season-code-standardization.md), but normalizeSeasonCodes is
// position-preserving by contract and its zero-write backfill tests depend on
// that, so the reordering lives HERE — fallback path and the one-time title
// backfill only, never in seasonCodes.js.
//
// Gated on exactly one season token: with two, which one leads is an editorial
// call, not a deterministic one, and those rows go to manual review instead.
export function seasonToFront(title) {
  if (typeof title !== "string" || !title) return title;
  const matches = title.match(SEASON_TOKEN);
  if (!matches || matches.length !== 1) return title;
  const token = matches[0];
  const idx = title.indexOf(token);
  if (idx === 0) return title;
  const rest = (title.slice(0, idx) + title.slice(idx + token.length))
    .replace(/\s*-\s*/g, " - ");
  const cleaned = collapseDanglingDash(rest);
  return cleaned ? `${token} ${cleaned}` : token;
}

// The whole deterministic fallback pipeline, in the one order that works:
//   1. sanitize the RAW name first, so a leading "(New Arrival)" is removed
//      while its parentheses are still balanced (production id 5139850);
//   2. strip every spelling of the resolved brand;
//   3. drop a leading sub-line marker, then any dash the strips orphaned;
//   4. move a lone season code to the front;
//   5. title-case, then sanitize again for markers the strips exposed.
// Exported as one function so route.js and the title backfill share a single
// composition rather than two drifting copies.
export function buildFallbackTitle(name, brand) {
  return sanitizeFallbackTitle(
    toTitleCase(
      seasonToFront(
        collapseDanglingDash(
          stripSubLinePrefix(
            stripAllBrandSpellings(sanitizeFallbackTitle(name), brand),
            brand
          )
        )
      )
    )
  );
}
