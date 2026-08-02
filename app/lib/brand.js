import BRANDS from "../brands.js";

// Canonicalization aliases: alternate spellings / sub-labels → the allowlist's
// canonical brand. Module-level (not a local inside normalizeBrand) so the brand
// sets below can also fold in the raw alias spellings: BRANDS.map(normalizeBrand)
// stores ONLY the canonical form ("maison margiela"), so a title carrying the
// common short spelling ("Margiela Jacket") would slip past the substring
// detectors. See ALIAS_SPELLINGS below.
export const BRAND_ALIASES = {
  "MARGIELA": "MAISON MARGIELA",
  "MARTIN MARGIELA": "MAISON MARGIELA",
  "MAISON MARTIN MARGIELA": "MAISON MARGIELA",
  "A.P.C": "A.P.C.",
  "ALAIA": "ALAÏA",
  "AZZEDINE ALAÏA": "ALAÏA",
  "AZZEDINE ALAIA": "ALAÏA",
  "ALEXANDER MCQUEEN": "ALEXANDER MCQUEEN",
  "BELLEVILLE SASSOON": "BELLVILLE SASSOON",
  "CÉLINE": "CELINE",
  "COURREGES": "COURRÈGES",
  "FAYCAL AMOR": "FAYÇAL AMOR",
  "GIANFRANCO FERRE": "GIANFRANCO FERRÉ",
  "CHRISTIAN DIOR": "DIOR",
  "DIOR HOMME": "DIOR",
  "GIANNI VERSACE": "VERSACE",
  "GUCCI BY TOM FORD": "GUCCI",
  "CAVALLI": "ROBERTO CAVALLI",
  "JUST CAVALLI": "ROBERTO CAVALLI",
  "CAVALLI CLASS": "ROBERTO CAVALLI",
  "BIKKEMBERGS": "DIRK BIKKEMBERGS",
  // Split brand families collapsed by docs/plan-title-brand-formatting-repair.md.
  // "SAINT LAURENT" is the user-chosen house label for the whole YSL family.
  "YVES SAINT LAURENT": "SAINT LAURENT",
  "YSL": "SAINT LAURENT",
  "SAINT LAURENT PARIS": "SAINT LAURENT",
  "COMME DES GARCONS": "COMME DES GARÇONS",
  "COMME DES GARCONS HOMME PLUS": "COMME DES GARÇONS HOMME PLUS",
  "FERRE": "GIANFRANCO FERRÉ",
  "FERRÉ": "GIANFRANCO FERRÉ",
  "MCQUEEN": "ALEXANDER MCQUEEN",
  "FAYCAL": "FAYÇAL AMOR",
  // Deliberately NOT aliased: sub-line words (BLACK, GIRL, DRKSHDW, BLANCHE).
  // They would enter BRAND_HANDLE_SLUGS and let any handle containing "black"
  // resolve to a brand. Sub-lines are handled by stripSubLinePrefix in
  // app/lib/handleFallback.js instead.
};

// Token-normalizes a brand/title string WITHOUT alias resolution: strips
// diacritics, lowercases, expands "&", collapses every non-alphanumeric run to a
// single space. Returns null on empty/non-string input or empty result. This is
// the raw form used to seed the alias spellings into the brand sets, and the
// shared back half of normalizeBrand.
function normalizeBrandTokens(value) {
  if (!value || typeof value !== "string") return null;

  const result = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return result || null;
}

// Normalizes brand strings for reliable comparison
// Handles accents, punctuation, slashes, spacing differences
export function normalizeBrand(value) {
  if (!value || typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  const resolved = BRAND_ALIASES[upper] !== undefined ? BRAND_ALIASES[upper] : value;
  return normalizeBrandTokens(resolved);
}

// Canonical DISPLAY form for persistence. normalizeBrand() answers "are these
// the same brand?" (lowercased, diacritic-stripped — not displayable); this
// answers "what label do we store?". Returns the input unchanged when no alias
// applies, so non-aliased brands keep the exact cleanTitle output.
export function canonicalBrand(value) {
  if (!value || typeof value !== "string") return value;
  const upper = value.trim().toUpperCase();
  return BRAND_ALIASES[upper] ?? value.trim();
}

// Every uppercase spelling that resolves to the same designer as `brand`:
// the canonical label, the caller's own spelling, and every BRAND_ALIASES key
// pointing at that canonical. Sorted longest-first so a caller stripping them
// in order removes "YVES SAINT LAURENT" before the shorter "SAINT LAURENT"
// (stripping the short one first would strand a dangling "YVES").
//
// The enrich handle-fallback is the consumer: nameWithoutBrand only removes the
// one phrase it is handed, so a name carrying an alias spelling ("YSL
// RECTANGULAR …" under a resolved "Yves Saint Laurent") kept leaking the alias
// into the written title.
export function brandSpellings(brand) {
  if (!brand || typeof brand !== "string") return [];
  const canonicalUpper = canonicalBrand(brand).toUpperCase();
  const spellings = new Set([canonicalUpper, brand.trim().toUpperCase()]);
  for (const [alias, target] of Object.entries(BRAND_ALIASES)) {
    if (target.toUpperCase() === canonicalUpper) spellings.add(alias);
  }
  return [...spellings].filter(Boolean).sort((a, b) => b.length - a.length);
}

// Raw alias spellings, normalized but NOT canonicalized — "margiela",
// "martin margiela", "bikkembergs", "christian dior", etc. Folded into the brand
// sets alongside the canonical forms so the substring detectors catch a title
// using an alias spelling whose canonical form is not a substring of it (e.g.
// "Margiela" vs canonical "Maison Margiela"; "Bikkembergs" vs "Dirk
// Bikkembergs"). Aliases whose canonical IS a substring ("Christian Dior" has
// "dior") were already caught; those are redundant-but-harmless. Derived from
// BRAND_ALIASES — no separate source of truth.
const ALIAS_SPELLINGS = Object.keys(BRAND_ALIASES);

export const BRAND_SET_NORMALIZED = new Set(
  [
    ...BRANDS.map(normalizeBrand),
    ...ALIAS_SPELLINGS.map(normalizeBrandTokens),
  ].filter(Boolean)
);

// Whitespace-stripped variants of every allowlist entry. Catches vendors
// that drop the space between brand tokens — e.g. "MiuMiu" vs "Miu Miu",
// "APC" vs "A.P.C.", "Acne Studios" vs "AcneStudios". Without this, those
// vendors fail the exact-normalized match and end up in /api/enrich, where
// each one consumes ~750 input tokens just to be deleted by the allowlist
// gate. Cheap to maintain — derived from BRANDS, no separate source of truth.
export const BRAND_SET_COMPACT = new Set(
  [
    ...BRANDS.map((b) => normalizeBrand(b)?.replace(/\s+/g, "")),
    ...ALIAS_SPELLINGS.map((a) => normalizeBrandTokens(a)?.replace(/\s+/g, "")),
  ].filter(Boolean)
);

// Allowlist membership check that survives whitespace differences.
// Use this in place of `BRAND_SET_NORMALIZED.has(...)` whenever the input
// is a vendor field or LLM-extracted brand — i.e. anywhere a single brand
// string is being checked against the curated list. Two passes:
//   1. exact normalized match (covers diacritics, punctuation, casing)
//   2. whitespace-stripped match (covers the "MiuMiu" class of bugs)
// Returns false on null/empty/non-string input.
export function isAllowedBrand(value) {
  const normalized = normalizeBrand(value);
  if (!normalized) return false;
  if (BRAND_SET_NORMALIZED.has(normalized)) return true;
  return BRAND_SET_COMPACT.has(normalized.replace(/\s+/g, ""));
}

// Check if a raw title string contains an allowed brand name
export function titleContainsAllowedBrand(rawTitle) {
  if (!rawTitle) return false;
  const normalizedTitle = normalizeBrand(rawTitle);
  for (const brand of BRAND_SET_NORMALIZED) {
    if (normalizedTitle.includes(brand)) return true;
  }
  return false;
}

// Read-only audit detector for the recurring brand-leak sweep (see
// docs/plan-brand-leak-fix.md, Gap 2). A SUPERSET of titleContainsAllowedBrand:
// it composes the same normalized allowlist with the compact spellings the
// app already trusts (BRAND_SET_COMPACT), so titles like "MiuMiu Bag" /
// "APC Jacket" — which titleContainsAllowedBrand misses — are flagged too.
//
// Kept separate from titleContainsAllowedBrand on purpose:
//   - The bucket-2 backfill's SKIP:brand_in_title guard depends on
//     titleContainsAllowedBrand's exact current behavior; widening it would
//     change a shipped write-path. This new helper is additive.
//   - It normalizes ONCE and null-checks up front (titleContainsAllowedBrand
//     throws on a punctuation-only title because normalizeBrand returns null
//     there). This detector scans every visible row, so a single such title
//     must not crash the sweep.
//
// Substring, not token-bounded: short normalized brands (e.g. "ami", "ysl")
// hit incidentally ("ceramic" ⊃ "ami"). That is acceptable — this is a review
// FLAG, never an auto-fix or hide, so over-flagging only adds candidates to
// review. Both BRAND_SET_NORMALIZED and BRAND_SET_COMPACT derive from BRANDS,
// so there is no second source of truth to drift.
export function titleLeaksAllowedBrand(rawTitle) {
  const normalizedTitle = normalizeBrand(rawTitle);
  if (!normalizedTitle) return false;
  for (const brand of BRAND_SET_NORMALIZED) {
    if (normalizedTitle.includes(brand)) return true;
  }
  for (const brand of BRAND_SET_COMPACT) {
    if (normalizedTitle.includes(brand)) return true;
  }
  return false;
}

// Word-boundary variant of titleLeaksAllowedBrand for the WRITE path
// (scripts/backfillTitleClean.mjs's SKIP:brand_in_title guard). The loose
// substring detector above is correct for the read-only audit — over-flagging
// only adds review candidates — but as a write BLOCKER it makes false positives
// permanent: "ami" (AMI Paris) is a substring of "camisole"/"ceramic"/"dynamic",
// so the loose form silently refuses legitimate enrichments like "Silk Camisole".
//
// This variant anchors every allowlist token at word boundaries inside the
// normalized, space-separated title — the same discipline brandFromHandle uses
// (`(^|-)slug(-|$)`) so "ami" can't match "ceramic". Both title and brand pass
// through normalizeBrand, which collapses punctuation to single spaces, so a
// padded-substring test on ` ${brand} ` is an exact whole-token(s) match. It
// keeps the whole-allowlist coverage (a collab partner / era-designer like
// "Tom Ford" under a GUCCI chip is still caught) and both spaced and compact
// spellings ("Miu Miu" / "MiuMiu"), but only when the brand stands as its own
// word(s). It can therefore miss a fully-concatenated leak with no separators
// ("miumiubag") — acceptable on the write path, where the loose audit still
// surfaces such rows for review.
export function titleLeaksAllowedBrandStrict(rawTitle) {
  const normalizedTitle = normalizeBrand(rawTitle);
  if (!normalizedTitle) return false;
  const padded = ` ${normalizedTitle} `;
  for (const brand of BRAND_SET_NORMALIZED) {
    if (padded.includes(` ${brand} `)) return true;
  }
  for (const brand of BRAND_SET_COMPACT) {
    if (padded.includes(` ${brand} `)) return true;
  }
  return false;
}

// Precomputed brand → handle-slug map. Each brand emits up to two slug
// variants: dashed (`miu-miu`) and compact (`miumiu`). The compact variant
// mirrors the BRAND_SET_COMPACT path that isAllowedBrand already trusts —
// without it, the fallback would silently miss handles like `apc-jacket`
// or `miumiu-bag` even though those brand strings are accepted everywhere
// else. Sorted by slug length descending so the most specific match wins
// (e.g. "maison-margiela" before "margiela").
//
// Built from BRANDS *plus* the alias keys — the same two-source construction
// BRAND_SET_NORMALIZED uses. Without the alias keys, moving a name out of
// BRANDS and into BRAND_ALIASES (the canonicalization pattern) would keep it
// allowlist-recognised but silently kill handle recovery for it, e.g.
// `cavalli-turquoise-belt` / `just-cavalli-*`. The returned label is
// canonicalized downstream by canonicalBrand(), so a hit from either list
// resolves to the same stored label.
const BRAND_HANDLE_SLUGS = [...BRANDS, ...ALIAS_SPELLINGS]
  .flatMap((b) => {
    const dashed = b
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!dashed) return [];
    const compact = dashed.replace(/-/g, "");
    const out = [{ brand: b, slug: dashed }];
    if (compact && compact !== dashed) out.push({ brand: b, slug: compact });
    return out;
  })
  .sort((a, b) => b.slug.length - a.slug.length);

// Extracts an allowlisted brand from a Shopify handle slug. Used by the
// enrich route as a deterministic fallback when cleanTitle returns null —
// e.g. At Dawn Paris listings strip the brand from the public name but
// keep it in the URL slug ("fendi-jacket" / name "WOOL BLAZER").
// Hyphen-bounded match so short slugs don't pick up incidental tokens
// (`ami` won't match `ceramic-shirt`). Iterates the precomputed slug list
// rather than building a regex set so the longest-wins ordering is explicit.
export function brandFromHandle(handle) {
  if (!handle || typeof handle !== "string") return null;
  const lower = handle.toLowerCase();
  for (const { brand, slug } of BRAND_HANDLE_SLUGS) {
    if (new RegExp(`(^|-)${slug}(-|$)`).test(lower)) return brand;
  }
  return null;
}
