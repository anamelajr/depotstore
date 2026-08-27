// Featured Archives — the set behind the home band and the /archives/[slug]
// pages. The module FeaturedArchives.js's comment reserved; that phase is this
// one.
//
// Names, year ranges and descriptions are CONTENT, not chrome: English-only,
// never routed through i18n messages (a designer's name and tenure don't
// translate, and the description is the user's own copy). Only the page's
// surrounding labels — eyebrow, item count, story link — are translated.
//
// Membership is strict by construction. Designer tenure is destroyed at write
// time (BRAND_ALIASES folds "Dior Homme" → "DIOR", "YSL" → "SAINT LAURENT"), so
// a brand + year range alone would file Galliano womenswear under Slimane. Each
// rule therefore pairs the brand with an era window and, where the brand's
// stock in that window is dominated by another designer, a required attribution
// token. `include` / `exclude` are the curator's manual override on top.

/**
 * Rule shapes (see fetchArchiveProducts.js for the query translation):
 *   { brand, eraStart, eraEnd }            — brand within an era window
 *   { brand, eraYearNull: true }           — brand with NO readable era
 *   … either form may add `attribution: [tokens]`, matched case-insensitively
 *     against `name` / `description` (OR across tokens).
 */
export const ARCHIVES = [
  { name: "MARTIN MARGIELA", years: "1999–2008", live: false },
  {
    live: true,
    slug: "hedi-slimane",
    name: "HEDI SLIMANE",
    years: "2000–07 · 2012–16",
    // Hero tenure line — house + years pairs. Mobile breaks on the separator.
    tenureLine: "Dior Homme 2000–07 · Saint Laurent 2012–16",
    image: "/archives/hedi-slimane/portrait.webp",
    imageAlt: "Hedi Slimane portrait",
    // When set, the hero renders a VIEW COLLECTION STORY link to
    // /editorial/<slug>. No Slimane entry exists yet.
    editorialSlug: null,
    description:
      "Hedi Slimane reshaped modern menswear at Dior Homme, defining the radically slim silhouette of the 2000s, a vision he later revisited at Saint Laurent, fusing sharp tailoring with rock and youth culture.",
    rules: [
      // Attribution REQUIRED: 2000–07 Dior stock is dominated by Galliano
      // womenswear (64 rows carry the era signal, ~6 carry homme/Slimane).
      { brand: "DIOR", eraStart: 2000, eraEnd: 2007, attribution: ["homme", "hedi", "slimane"] },
      { brand: "SAINT LAURENT", eraStart: 2012, eraEnd: 2016 },
      // Named but UN-YEARED pieces only (e.g. "SL10H … by Hedi Slimane"
      // sneakers with no season token). eraYearNull guards against future
      // out-of-tenure listings whose copy merely mentions Slimane ("succeeding
      // Hedi Slimane"): attributed rows WITH a year are already covered by the
      // range rule above, or correctly excluded by it.
      { brand: "SAINT LAURENT", eraYearNull: true, attribution: ["hedi", "slimane"] },
    ],
    // Curation overrides, both [{ storeDomain, handle }]. `include` pulls a
    // piece the rules miss; `exclude` drops one they wrongly catch.
    include: [],
    exclude: [],
  },
  { name: "RICK OWENS", years: "2011–2015", live: false },
  { name: "COMME DES GARÇONS", years: "1999–2005", live: false },
  { name: "HELMUT LANG", years: "1996–2005", live: false },
];

/** Archives with a real page behind them, in band order. */
export function getLiveArchives() {
  return ARCHIVES.filter((a) => a.live);
}

/** The live archive for `slug`, or undefined — inert entries never match. */
export function getArchiveBySlug(slug) {
  return ARCHIVES.find((a) => a.live && a.slug === slug);
}
