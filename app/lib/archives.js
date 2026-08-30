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
 *   … either form may add `excludeAttribution: [tokens]`, the negation: a row
 *     is DROPPED when ANY token appears in `name` or `description`. Both
 *     columns are nullable, so each is matched as "is null OR not ilike" —
 *     a bare NOT ILIKE evaluates to NULL on a NULL column and would silently
 *     drop the row. Use it to keep a known false-positive CLASS out durably
 *     (re-editions, another house's tenure) where handle-pinned `exclude`
 *     entries wouldn't survive a relisting.
 */
export const ARCHIVES = [
  {
    live: true,
    slug: "martin-margiela",
    name: "MARTIN MARGIELA",
    years: "1988–2009",
    tenureLine: "Maison Martin Margiela 1988–2009",
    // No portrait yet — Margiela famously never appears in photographs. The
    // hero renders text-only until the curator supplies an image.
    image: null,
    imageAlt: null,
    editorialSlug: null,
    description:
      "Martin Margiela redefined fashion from his Paris maison between 1988 and 2009 — pioneering deconstruction, exposed linings, and the artisanal reworking of found garments, all under a strict anonymity that made the clothes themselves the only statement.",
    rules: [
      // The entire window is Martin's own tenure — no competing designer, so
      // no attribution token (contrast the Dior/Galliano rule below). Un-dated
      // pieces are NOT pulled by a "martin" mention: the house kept the name
      // "Maison Martin Margiela" until 2015, six years post-tenure, so the
      // token doesn't attribute era. excludeAttribution keeps the known
      // false-positive CLASS out durably: 2012 H&M re-editions and
      // Hermès-tenure pieces parse into the window via the original season in
      // their copy, and handle-pinned excludes wouldn't survive a relisting.
      {
        brand: "MAISON MARGIELA",
        eraStart: 1988,
        eraEnd: 2009,
        excludeAttribution: ["h&m", "h & m", "hermes", "hermès"],
      },
    ],
    include: [],
    // Identity-audit exclusions (2026-08-30): era_year dates re-editions by the
    // season they reproduce, so the 2012 Margiela × H&M collab pieces parse into
    // the window; the Hermès piece is Martin's, but at Hermès. Pinned by handle
    // as well as by excludeAttribution because a listing may carry the collab
    // only in its title (which attribution never reads).
    exclude: [
      { storeDomain: "dolcevitahub.com", handle: "2000s-maison-margiela-h-m-shearling-beige-reversible-long-jacket" },
      { storeDomain: "dolcevitahub.com", handle: "ss2005-maison-margiela-x-h-m-reversed-denim-jacket-re-edition-1" },
      { storeDomain: "dolcevitahub.com", handle: "ss2005-maison-margiela-x-h-m-reversed-denim-jacket-re-edition-3" },
      { storeDomain: "dolcevitahub.com", handle: "aw2006-maison-margiela-re-edition-h-m-silver-steel-no-dial-watch" },
      { storeDomain: "dolcevitahub.com", handle: "2006-maison-margiela-h-m-upside-brown-leather-shoulder-bag" },
      { storeDomain: "dolcevitahub.com", handle: "ss2009-maison-margiela-h-m-re-edition-white-t-shirt" },
      { storeDomain: "lesarchivesparis.com", handle: "hermes-by-martin-margiela-1990s-silk-cardigan-top" },
    ],
  },
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
