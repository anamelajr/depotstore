// Apply the ordered category rules to a prepared (lowercased, collapsed)
// text blob. Returns a category string or null when nothing matches.
//
// Order matters — rule N short-circuits later rules. A product's text may
// contain multiple garment nouns (e.g. a Bag's desc mentioning "wear with
// jeans"), so rules are arranged by false-positive risk: most specific
// first, ambiguous fallbacks last.
//
// `strict` mode is used for description / editorial fallback passes. It
// drops the bare `set/suit/ensemble/combination/combi` tokens from rule 6
// because descriptions commonly contain prose like "set-in sleeves",
// "set of buttons", or "combination of leather and cotton" that would
// otherwise pollute the Sets bucket.
function tryClassify(text, { strict = false } = {}) {
  if (!text) return null;

  // 1. Footwear — specific nouns, very low false-positive risk.
  //    Bare `flats?` is intentionally NOT in this list because "flat"
  //    matches common style descriptors like "flat circle leather panel"
  //    or "flat-front trousers" and routes them to Footwear. The
  //    explicit `ballet[\s-]?flats?` / `pointed[\s-]?flats?` /
  //    `ballerina[\s-]?flats?` patterns recover the common subtypes
  //    without the bare-token risk.
  if (/\b(boots?|shoes?|sneakers?|trainers?|sandals?|heels?|loafers?|mules?|clogs?|pumps?|slippers?|espadrilles?|oxfords?|brogues?|moccasins?|derby|derbies|slides?|slip[\s-]?ons?|wedges?|tabis?|ballet[\s-]?flats?|pointed[\s-]?flats?|ballerina[\s-]?flats?|kitten[\s-]?heels?)\b/.test(text)) {
    return "Footwear";
  }

  // 2. Bags & Accessories. Note on irregular plurals: "watch"/"brooch"
  //    pluralise as "watches"/"brooches", not "watchs"/"broochs", so
  //    `watches?` would ONLY match "watche"/"watches" (never the singular).
  //    Use `watch(?:es)?` / `brooch(?:es)?` to catch both.
  //
  //    `collars?`, `hoods?`, and `armbands?` are intentionally NOT in this
  //    list: jackets, coats, shirts, and dresses commonly carry these
  //    words as descriptors (e.g. "Fur Collar Leather Jacket", "Hooded
  //    Parka", "Armband Windbreaker"), and putting them here hijacks the
  //    garment before rule 3/4b can claim it.
  //
  //    Order: in LOOSE mode (title/name passes) B&A runs at this position,
  //    BEFORE garment rules, so titles like "Cargo Shoulder Bag" and
  //    "JPG Watch" cannot be hijacked by fabric/brand tokens. In STRICT
  //    mode (description / editorial fallback) the same accessory tokens
  //    frequently appear as styling prose ("with leather belt", "ring
  //    detail", "perfect with a silk scarf") inside descriptions of
  //    actual garments. We defer B&A in strict mode so garment rules
  //    (3/4/4b/5) get first claim — see rule 5.5 below.
  const bagsAccessoriesRx = /\b(bags?|totes?|clutch(?:es)?|purses?|handbags?|backpacks?|satchels?|pouch(?:es)?|wallets?|briefcases?|duffels?|crossbody|belts?|scarves|scarf|headscarves|headscarfs?|gloves?|sunglasses|eyeglasses|glasses|eyewear|beanies?|hats?|caps?|berets?|headbands?|necklaces?|chokers?|bracelets?|earrings?|rings?|brooch(?:es)?|jewelry|jewellery|watch(?:es)?|bowtie|bow[\s-]?tie|pendants?|dog[\s-]?tags?|bangles?|mittens?|neckpieces?|umbrellas?|card[\s-]?holders?|pouchettes?|baguettes?|compact[\s-]?mirrors?|chapkas?|accessor(?:y|ies))\b/;
  if (!strict && bagsAccessoriesRx.test(text)) {
    return "Bags & Accessories";
  }
  // Bare `ties?` is checked LATE (after Tops/Bottoms/Sets) — see rule 7.5.
  // If we ran it here, "Tie Blouse" / "Floral Tie Blouse" / "Sleeveless Tie
  // Sweater" would all be hijacked into B&A before rule 4b's `blouses?` /
  // `sweaters?` could classify them.

  // 3. Jackets & Coats. Includes bolero (short jacket), perfecto (leather
  //    motorcycle jacket), cape, caban (peacoat).
  if (/\b(jackets?|coats?|blazers?|parkas?|bombers?|puffers?|anoraks?|trench(?:coats?|es)?|overcoats?|peacoats?|windbreakers?|raincoats?|shearlings?|boleros?|perfectos?|capes?|cabans?)\b/.test(text)) {
    return "Jackets & Coats";
  }

  // 4. Dresses & Skirts — negative lookahead stops "dress shirt"/"dress pants"
  //    from being pulled in. midi/maxi only count when modifying dress/skirt.
  if (/\bdress(?:es)?\b(?!\s*(shirt|shirts|pants?|trousers?))/.test(text) ||
      /\b(skirts?|miniskirts?|gowns?|jumpsuits?|sundress(?:es)?|rompers?|kaftans?|caftans?)\b/.test(text) ||
      /\b(midi|maxi)\s+(dress(?:es)?|skirts?)\b/.test(text)) {
    return "Dresses & Skirts";
  }

  // 4b. High-confidence Tops nouns — these run BEFORE Bottoms so that a
  //     product whose name contains both a Bottoms token AND an unambiguous
  //     top noun (e.g. "Jean Paul Gaultier 'Jeans' Hawaiian Shirt", where
  //     'Jeans' is a JPG sub-line and the garment is a shirt) resolves to
  //     Tops. Zip-up garments are captured here too. Low-confidence tops
  //     nouns (top, tank, vest, knit, jersey, long/short-sleeve) stay in
  //     the catch-all rule 7. `bodies` (lingerie body), `bras`, `corsets`,
  //     and `bustiers` join the high-confidence list.
  if (/\b(t[\s-]?shirts?|tee[\s-]?shirts?|tees?|shirts?|blouses?|sweaters?|hoodies?|sweatshirts?|cardigans?|tank[\s-]?tops?|polo[\s-]?shirts?|polos?|turtlenecks?|pullovers?|crewnecks?|knitwears?|camisoles?|bodysuits?|waistcoats?|tunics?|zip[\s-]?ups?|zipups?|bod(?:y|ies)|bras?|corsets?|bustiers?|vests?|roll[\s-]?necks?|button[\s-]?ups?|button[\s-]?downs?|overshirts?)\b/.test(text)) {
    return "Tops";
  }

  // 4b'. Fabric/style tokens that ARE upper-body when alone but yield to
  //      Bottoms when a pants noun is present in the title. "Ninja Fleece"
  //      → Tops, but "Fleece Pants" / "Half Zip Sport Pants" → Bottoms.
  if (/\b(fleeces?|half[\s-]?zips?)\b/.test(text) &&
      !/\b(pants?|trousers?|jeans?|joggers?|shorts?|leggings?|culottes?|sweatpants?|chinos?|slacks|capris?|bermudas?)\b/.test(text)) {
    return "Tops";
  }

  // 5. Bottoms — `\bshorts?\b` allows singular "Short" (e.g. "Beige Cargo
  //    Short"). The (?![\s-]?sleeves?) lookahead matches both "short
  //    sleeves" (space) and "short-sleeve" (hyphen) so neither hijacks
  //    into Bottoms before the Tops-fallback rule 7 sees them. Generic
  //    fabric words (denim/cargo/linen/wide/leather/zip) still need an
  //    accompanying bottoms noun. `capris?` captures "Capri" / "Capri
  //    Pants" listings.
  if (/\bshorts?\b(?![\s-]?sleeves?)/.test(text) ||
      /\b(trousers?|pants?|jeans|leggings?|joggers?|chinos?|slacks|sweatpants?|culottes?|bermudas?|capris?)\b/.test(text) ||
      /\b(denim|cargo|linen|wide|leather|zip)\s+(pants?|jeans?|shorts?|trousers?)\b/.test(text)) {
    return "Bottoms";
  }

  // 6. Sets. In loose mode (title/name passes) we accept bare `set`/`suit`/
  //    `ensemble`/`combination`/`combi` so titles like "Wool Set",
  //    "1990s Pinstripe Wool Suit", or "Tuxedo Ensemble" classify. In strict
  //    mode (description / editorial passes) we drop those bare tokens —
  //    raw descriptions frequently contain "set-in sleeves", "set of
  //    buttons", or "combination of leather and cotton" prose, and bare
  //    matching against that prose pollutes Sets.
  const setsLoose = /\b(matching\s+sets?|two[\s-]?piece\s+sets?|three[\s-]?piece\s+sets?|co[\s-]?ord(?:s|inates?)?|tracksuits?|sets?|suits?|ensembles?|combinations?|combis?|two[\s-]?pieces?)\b/;
  const setsStrict = /\b(matching\s+sets?|two[\s-]?piece\s+sets?|three[\s-]?piece\s+sets?|co[\s-]?ord(?:s|inates?)?|tracksuits?|two[\s-]?pieces?)\b/;
  if ((strict ? setsStrict : setsLoose).test(text)) {
    return "Sets";
  }

  // 7. Tops — most ambiguous, runs last. Explicit short/long-sleeve catches
  //    products like "Short Sleeves Polo Shirt" that singular-"short" used
  //    to hijack into Bottoms.
  if (/\b(t[\s-]?shirts?|tee[\s-]?shirts?|tees?|shirts?|blouses?|sweaters?|hoodies?|sweatshirts?|cardigans?|tank[\s-]?tops?|tanks?|vests?|waistcoats?|polo[\s-]?shirts?|polos?|jerseys?|turtlenecks?|pullovers?|knitwears?|knits?|crewnecks?|long[\s-]?sleeves?|short[\s-]?sleeves?|camisoles?|cami|bodysuits?|tunics?|tops?)\b/.test(text)) {
    return "Tops";
  }

  // 7.5. Late `ties?` / `necktie(s)` clause — runs AFTER Tops so
  //      "Tie Blouse", "Floral Tie Blouse", and "Sleeveless Tie Sweater"
  //      classify as Tops via rule 4b/7. Standalone "Tie", "Silk Tie",
  //      "Necktie" still route here. `(?![\s-]?dye)` keeps "tie-dye" prose
  //      out. Note: "Knit Tie" (knitted necktie) is shadowed by rule 7's
  //      `knits?` and resolves to Tops — acceptable tradeoff vs. recovering
  //      the much larger "Tie <garment>" Tops bucket.
  if (/\b(neckties?|ties?)\b(?![\s-]?dye)/.test(text)) {
    return "Bags & Accessories";
  }

  // 8. Strict-mode B&A fallback — runs LAST (after every garment rule)
  //    so a description mentioning both a garment and an accessory
  //    ("fitted top in cotton with belt loops") classifies as the
  //    garment, not B&A. Pure accessory descriptions ("Hermes silk
  //    scarf with rolled edges", "leather belt with brass buckle")
  //    reach this rule and classify correctly.
  if (strict && bagsAccessoriesRx.test(text)) {
    return "Bags & Accessories";
  }

  return null;
}

// Swimwear / robe guard. There is no taxonomy slot for swimwear today, and
// these titles produce noisy false positives downstream:
//   - "Mesh Swimsuit"      → desc literally writes "swim suit" (with space),
//                            which matches `\bsuit\b` and routes to Sets.
//   - "Swimsuit - Moschino"→ desc says "ring detail", matches `rings?`.
//   - "Swimsuit - Ralph L."→ desc "halter top", matches `tops?`.
//   - "Leopard Bathrobe"   → desc "tie belt", matches `belts?`.
// Returning null short-circuits classification before any pass runs, leaving
// these correctly uncategorised until a swimwear/robe taxonomy is added.
const SWIMWEAR_RX = /\b(swim[\s-]?suits?|bikinis?|trikinis?|swim[\s-]?wear|bathrobes?)\b/;
function isSwimwear(...sources) {
  const text = sources.filter(Boolean).join(" ").toLowerCase();
  return SWIMWEAR_RX.test(text);
}

function classifyTopsLeaf(text) {
  if (!text) return null;
  if (/\b(t[\s-]?shirts?|tee[\s-]?shirts?|tees?)\b/.test(text)) return "tees";
  if (/\b(hoodies?|sweatshirts?|sweaters?|crewnecks?|cardigans?|pullovers?|fleeces?|half[\s-]?zips?)\b/.test(text)) return "hoodies_sweaters";
  if (/\b(shirts?|blouses?|polo[\s-]?shirts?|polos?|button[\s-]?ups?|button[\s-]?downs?|overshirts?|tunics?|tank[\s-]?tops?|tanks?|camisoles?|cami|bodysuits?|bras?|corsets?|bustiers?|vests?|waistcoats?|jerseys?)\b/.test(text)) return "shirts_blouses";
  if (/\b(knitwears?|knits?|turtlenecks?|roll[\s-]?necks?)\b/.test(text)) return "knitwear";
  return null;
}

function classifyJacketsCoatsLeaf(text) {
  if (!text) return null;
  if (/\b(bombers?|blazers?|anoraks?|windbreakers?|boleros?|perfectos?)\b/.test(text)) return "jackets";
  if (/\b(trench(?:coats?|es)?|parkas?|peacoats?|overcoats?|raincoats?)\b/.test(text)) return "coats";
  if (/\bjackets?\b/.test(text)) return "jackets";
  if (/\bcoats?\b/.test(text)) return "coats";
  return null;
}

function classifyBagsAccessoriesLeaf(text) {
  if (!text) return null;
  if (/\b(bags?|totes?|clutch(?:es)?|purses?|handbags?|backpacks?|satchels?|pouch(?:es)?|wallets?|briefcases?|duffels?|crossbody|baguettes?|pouchettes?|card[\s-]?holders?)\b/.test(text)) return "bags";
  if (/\b(belts?|scarves|scarf|headscarves|headscarfs?|gloves?|sunglasses|eyeglasses|glasses|eyewear|beanies?|hats?|caps?|berets?|headbands?|necklaces?|chokers?|bracelets?|earrings?|rings?|brooch(?:es)?|jewelry|jewellery|watch(?:es)?|bowtie|bow[\s-]?tie|pendants?|dog[\s-]?tags?|bangles?|mittens?|neckpieces?|umbrellas?|compact[\s-]?mirrors?|chapkas?|neckties?|ties?)\b/.test(text)) return "accessories";
  return null;
}

function classifyLeaf(parent, text) {
  switch (parent) {
    case "Tops":               return classifyTopsLeaf(text);
    case "Jackets & Coats":    return classifyJacketsCoatsLeaf(text);
    case "Bags & Accessories": return classifyBagsAccessoriesLeaf(text);
    default:                   return null;
  }
}

// Classify a product into one of the feed categories, or return null when
// there is no confident match. Prefers null over a wrong guess — the feed
// filter is unforgiving when rows are mislabelled.
//
// Expected input (any field may be missing / null):
//   productType            — Shopify product_type string (sync time only; absent on backfill)
//   title                  — cleanTitle() output, brand already stripped
//   name                   — raw Shopify title (brand usually prefixed)
//   brand                  — cleanTitle() brand, used to strip from `name`
//   vendor                 — Shopify vendor, fallback brand source for stripping
//   description            — raw Shopify body_html, plain-texted (optional)
//   editorial_description  — Haiku-generated PDP description, cached (optional)
//
// Pass order:
//   GUARD   Swimwear / robe titles → null. We have no taxonomy slot for them
//           and downstream descriptions trigger noisy FPs (a swimsuit's "halter
//           top" lands in Tops, a bikini's "ring detail" lands in B&A, etc.).
//   PASS 1  tryClassify on cleaned title + productType. Bare-set titles like
//           "Wool Set" are handled correctly because tryClassify's rule 6
//           runs AFTER the specific-garment rules — so "Wool Set" → Sets,
//           but "Suit Jacket"/"Tuxedo Jacket" → Jackets via rule 3 first.
//   PASS 2  Same against the raw name with brand/vendor tokens stripped.
//           Handles cleanTitle() regressions where the decisive garment
//           noun was dropped — e.g. title "Van Gogh Skeleton Buffalo
//           Leather" (missing "Jacket") cleaned away "-up" suffixes.
//   PASS 3  First 250 chars of raw description. Capped because Shopify
//           descriptions trail off into "pairs with X" / "wear with Y"
//           prose that lies about the actual garment type.
//   PASS 4  First 250 chars of editorial_description. Haiku-generated and
//           usually cleaner than the raw desc; sparse coverage today (only
//           PDP-visited rows have one) but rescues the long tail when present.
export function assignCategory(product) {
  const rawType = typeof product?.productType === "string" ? product.productType : "";
  const rawName = typeof product?.name === "string" ? product.name : "";
  const rawTitle = typeof product?.title === "string" ? product.title : "";
  const rawBrand = typeof product?.brand === "string" ? product.brand : "";
  const rawVendor = typeof product?.vendor === "string" ? product.vendor : "";
  const rawDescription = typeof product?.description === "string" ? product.description : "";
  const rawEditorial = typeof product?.editorial_description === "string" ? product.editorial_description : "";

  const prepareText = (primary) =>
    `${rawType} ${primary}`.toLowerCase().replace(/\s+/g, " ").trim();

  // Brand-stripped name. Built once; the swim guard consults it and Pass 2
  // reuses it as the classification text.
  let strippedName = rawName;
  for (const candidate of [rawBrand, rawVendor]) {
    const b = candidate.trim();
    if (!b) continue;
    const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    strippedName = strippedName.replace(new RegExp(`\\b${escaped}\\b`, "gi"), " ");
  }

  // Description heads are computed once. They are used by Pass 3/4 as
  // classifier inputs, and by the late swim guard that runs only AFTER
  // title/name fail (never as a veto against clear title evidence).
  const descHead = rawDescription
    ? rawDescription.slice(0, 250).toLowerCase().replace(/\s+/g, " ").trim()
    : "";
  const editorialHead = rawEditorial
    ? rawEditorial.slice(0, 250).toLowerCase().replace(/\s+/g, " ").trim()
    : "";

  // Early swim guard: only against productType / title / strippedName. We
  // do NOT scan description here, because a clearly-titled item like
  // "Leather Jacket" with a desc that mentions "layer over a swimsuit"
  // must still classify as Jackets — desc text is not allowed to veto a
  // strong title match.
  if (isSwimwear(rawType, rawTitle, strippedName)) {
    return { category: null, subcategory: null };
  }

  // Pass 1: cleaned title + productType.
  if (rawTitle.trim()) {
    const text = prepareText(rawTitle);
    const parent = tryClassify(text);
    if (parent !== null) {
      return { category: parent, subcategory: classifyLeaf(parent, text) };
    }
  }

  // Pass 2: brand/vendor-stripped name + productType.
  if (strippedName.trim()) {
    const text = prepareText(strippedName);
    const parent = tryClassify(text);
    if (parent !== null) {
      return { category: parent, subcategory: classifyLeaf(parent, text) };
    }
  }

  // Late swim guard: title/name produced no match. If the description heads
  // betray swimwear context (a generic "One Piece" whose desc says "swim
  // suit"), null out before description fallback misclassifies on
  // accessory-style prose ("halter top", "ring detail", "tie belt").
  if (isSwimwear(descHead, editorialHead)) {
    return { category: null, subcategory: null };
  }

  // Pass 3: raw description head. Description prose is noisier than titles,
  // so productType is NOT prepended (the desc already speaks for itself)
  // and `strict: true` drops bare set/suit/combination tokens from rule 6.
  if (descHead) {
    const parent = tryClassify(descHead, { strict: true });
    if (parent !== null) {
      return { category: parent, subcategory: classifyLeaf(parent, descHead) };
    }
  }

  // Pass 4: editorial_description head. Last resort, also strict.
  if (editorialHead) {
    const parent = tryClassify(editorialHead, { strict: true });
    if (parent !== null) {
      return { category: parent, subcategory: classifyLeaf(parent, editorialHead) };
    }
  }

  return { category: null, subcategory: null };
}
