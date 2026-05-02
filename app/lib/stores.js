import { cleanTitle } from "./cleanTitle.js";
import { supabaseAdmin } from "./supabase.js";
import BRANDS from "../brands.js";

async function fetchExistingEditorialByHandle(storeDomain) {
  const map = {};
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("handle, brand, title, category")
      .eq("store_domain", storeDomain)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`Existing-products fetch failed for ${storeDomain}:`, error.message);
      return map;
    }
    if (!data || data.length === 0) break;
    for (const row of data) map[row.handle] = row;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

// Normalizes brand strings for reliable comparison
// Handles accents, punctuation, slashes, spacing differences
function normalizeBrand(value) {
  if (!value || typeof value !== "string") return null;

  const ALIASES = {
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
    "CAVALLI CLASS": "CAVALLI",
    "BIKKEMBERGS": "DIRK BIKKEMBERGS",
  };

  const upper = value.trim().toUpperCase();
  const resolved = ALIASES[upper] !== undefined ? ALIASES[upper] : value;

  const result = resolved
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return result || null;
}

// Check if a raw title string contains an allowed brand name
function titleContainsAllowedBrand(rawTitle) {
  if (!rawTitle) return false;
  const normalizedTitle = normalizeBrand(rawTitle);
  for (const brand of BRAND_SET_NORMALIZED) {
    if (normalizedTitle.includes(brand)) return true;
  }
  return false;
}

const BRAND_SET_NORMALIZED = new Set(BRANDS.map(normalizeBrand).filter(Boolean));
const FILTER_BY_BRAND = new Set(["dolcevitahub.com"]);

// Safety net used by getActiveStores() when Supabase is unreachable.
// Intentionally minimal: domain + storeName only. Downstream consumers
// like ParisMap filter by `lat != null` so fallback rows are silently
// omitted from the map — preferred over crashing or showing stale geo.
const FALLBACK_STORES = [
  { domain: "lobscur.com", storeName: "L'OBSCUR" },
  { domain: "dolcevitahub.com", storeName: "Dolce Vita Hub" },
  { domain: "seyswardrobe.fr", storeName: "Seys Wardrobe" },
  { domain: "numero13vintage.com", storeName: "Numero 13 Vintage" },
  { domain: "lesarchivesparis.com", storeName: "Les Archives Paris" },
  { domain: "atdawnparis.com", storeName: "at dawn paris" },
  { domain: "nuovo-paris.com", storeName: "Nuovo Paris" },
  { domain: "yourgarmentz.com", storeName: "yourgarmentz" },
  { domain: "www.dotcomme.net", storeName: "dot COMME" },
  { domain: "escoparis.com", storeName: "ESCO" },
  { domain: "graindesell.shop", storeName: "Grain de sell" },
];

function mapStoreRow(row) {
  return {
    domain: row.domain,
    storeName: row.store_name,
    displayName: row.display_name,
    location: row.location,
    lat: row.lat,
    lng: row.lng,
  };
}

export async function getActiveStores() {
  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("domain, store_name, display_name, location, lat, lng")
    .eq("active", true)
    .order("store_name");

  if (error) {
    console.error("Failed to fetch stores:", error.message);
    return FALLBACK_STORES;
  }

  if (!data) return FALLBACK_STORES;

  return data.map(mapStoreRow);
}

export async function getAllStores() {
  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("domain, store_name, display_name, location, lat, lng, active")
    .order("store_name");

  if (error) {
    console.error("Failed to fetch stores:", error.message);
    return [];
  }

  return data.map((row) => ({ ...mapStoreRow(row), active: row.active }));
}

// Apply the ordered category rules to a prepared (lowercased, collapsed)
// text blob. Returns a category string or null when nothing matches.
function tryClassify(text) {
  if (!text) return null;

  // 1. Footwear — specific nouns, very low false-positive risk.
  if (/\b(boots?|shoes?|sneakers?|trainers?|sandals?|heels?|loafers?|mules?|clogs?|pumps?|slippers?|espadrilles?|oxfords?|brogues?|moccasins?|derby|derbies)\b/.test(text)) {
    return "Footwear";
  }

  // 2. Bags & Accessories — run before Bottoms/Tops so "Cargo Shoulder Bag"
  //    and "Jean Paul Gaultier Watch" cannot be hijacked by fabric / brand tokens.
  // Note on irregular plurals: "watch"/"brooch" pluralise as "watches"/"brooches",
  // not "watchs"/"broochs", so `watches?` would ONLY match "watche"/"watches"
  // (never the singular). Use `watch(?:es)?` / `brooch(?:es)?` to catch both.
  if (/\b(bags?|totes?|clutch(?:es)?|purses?|handbags?|backpacks?|satchels?|pouch(?:es)?|wallets?|briefcases?|duffels?|crossbody|belts?|scarves|scarf|headscarves|headscarfs?|gloves?|sunglasses|eyeglasses|glasses|eyewear|beanies?|hats?|caps?|berets?|headbands?|necklaces?|chokers?|bracelets?|earrings?|rings?|brooch(?:es)?|jewelry|jewellery|watch(?:es)?|bowtie|bow[\s-]?tie)\b/.test(text)) {
    return "Bags & Accessories";
  }

  // 3. Jackets & Coats.
  if (/\b(jackets?|coats?|blazers?|parkas?|bombers?|puffers?|anoraks?|trench(?:coats?|es)?|overcoats?|peacoats?|windbreakers?|raincoats?|shearlings?)\b/.test(text)) {
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
  //     the catch-all rule 7.
  if (/\b(t[\s-]?shirts?|tee[\s-]?shirts?|tees?|shirts?|blouses?|sweaters?|hoodies?|sweatshirts?|cardigans?|tank[\s-]?tops?|polo[\s-]?shirts?|polos?|turtlenecks?|pullovers?|crewnecks?|knitwears?|camisoles?|bodysuits?|waistcoats?|tunics?|zip[\s-]?ups?|zipups?)\b/.test(text)) {
    return "Tops";
  }

  // 5. Bottoms — plural-biased to avoid "short sleeve" / bare-"jean" collisions.
  //    Generic fabric words (denim / cargo) do NOT match on their own; they
  //    need an accompanying bottoms noun to count.
  if (/\b(trousers?|pants?|jeans|shorts|leggings?|joggers?|chinos?|slacks|sweatpants?|culottes?|bermudas?)\b/.test(text) ||
      /\b(denim|cargo)\s+(pants?|jeans?|shorts|trousers?)\b/.test(text)) {
    return "Bottoms";
  }

  // 6. Sets — bare "set" / "suit" is far too noisy; require explicit phrasing.
  if (/\b(matching\s+sets?|two[\s-]?piece\s+sets?|three[\s-]?piece\s+sets?|co[\s-]?ord(?:s|inates?)?|tracksuits?)\b/.test(text)) {
    return "Sets";
  }

  // 7. Tops — most ambiguous, runs last. Explicit short/long-sleeve catches
  //    products like "Short Sleeves Polo Shirt" that singular-"short" used
  //    to hijack into Bottoms.
  if (/\b(t[\s-]?shirts?|tee[\s-]?shirts?|tees?|shirts?|blouses?|sweaters?|hoodies?|sweatshirts?|cardigans?|tank[\s-]?tops?|tanks?|vests?|waistcoats?|polo[\s-]?shirts?|polos?|jerseys?|turtlenecks?|pullovers?|knitwears?|knits?|crewnecks?|long[\s-]?sleeves?|short[\s-]?sleeves?|camisoles?|cami|bodysuits?|tunics?|tops?)\b/.test(text)) {
    return "Tops";
  }

  return null;
}

// Classify a product into one of the feed categories, or return null when
// there is no confident match. Prefers null over a wrong guess — the feed
// filter is unforgiving when rows are mislabelled.
//
// Expected input (any field may be missing / null):
//   productType — Shopify product_type string (sync time only; absent on backfill)
//   title       — cleanTitle() output, brand already stripped
//   name        — raw Shopify title (brand usually prefixed)
//   brand       — cleanTitle() brand, used to strip from `name`
//   vendor      — Shopify vendor, fallback brand source for stripping
//
// Two-pass strategy:
//   1. Try the cleaned `title` (already brand-stripped by cleanTitle()).
//   2. If that yields null, fall back to the raw `name` with brand/vendor
//      tokens stripped. This catches cleanTitle() regressions where the key
//      garment noun was dropped — e.g. title "Van Gogh Skeleton Buffalo
//      Leather" (missing "Jacket") or "Royal Legacy Archive Zip-up" cleaned
//      to "Royal Legacy Archive Zip" (missing "-up").
export function assignCategory(product) {
  const rawType = typeof product?.productType === "string" ? product.productType : "";
  const rawName = typeof product?.name === "string" ? product.name : "";
  const rawTitle = typeof product?.title === "string" ? product.title : "";
  const rawBrand = typeof product?.brand === "string" ? product.brand : "";
  const rawVendor = typeof product?.vendor === "string" ? product.vendor : "";

  const prepareText = (primary) =>
    `${rawType} ${primary}`.toLowerCase().replace(/\s+/g, " ").trim();

  // Pass 1: cleaned title + productType.
  if (rawTitle.trim()) {
    const result = tryClassify(prepareText(rawTitle));
    if (result !== null) return result;
  }

  // Pass 2: raw name with brand/vendor tokens stripped. Handles cleanTitle
  // regressions where the decisive garment noun was dropped.
  let strippedName = rawName;
  for (const candidate of [rawBrand, rawVendor]) {
    const b = candidate.trim();
    if (!b) continue;
    const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    strippedName = strippedName.replace(new RegExp(`\\b${escaped}\\b`, "gi"), " ");
  }
  return tryClassify(prepareText(strippedName));
}

export function toAbsoluteUrl(inputUrl, domain) {
  if (typeof inputUrl !== "string" || inputUrl.length === 0) return null;
  try {
    if (/^https?:\/\//i.test(inputUrl)) return inputUrl;
    if (inputUrl.startsWith("/")) return `https://${domain}${inputUrl}`;
    return `https://${domain}/${inputUrl}`;
  } catch {
    return null;
  }
}

export function normalizeProduct(product, store) {
  const name = typeof product?.title === "string" ? product.title : null;
  const productType =
    typeof product?.product_type === "string" ? product.product_type : "";
  const vendor = typeof product?.vendor === "string" ? product.vendor : null;
  const handle = typeof product?.handle === "string" ? product.handle : null;

  const tags = Array.isArray(product?.tags)
    ? product.tags.filter((t) => typeof t === "string")
    : typeof product?.tags === "string"
      ? product.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  const images = Array.isArray(product?.images)
    ? product.images.map((img) => img?.src).filter(Boolean)
    : [];
  const imageUrl = images[0] ?? null;

  const rawDescription =
    typeof product?.body_html === "string"
      ? product.body_html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
      : null;

  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const available = variants.some((v) => v?.available === true);
  let minPrice = null;

  for (const variant of variants) {
    const raw = variant?.price;
    const n = Number.parseFloat(String(raw ?? ""));
    if (!Number.isFinite(n)) continue;
    minPrice = minPrice === null ? n : Math.min(minPrice, n);
  }

  const price = minPrice === null ? null : `€${minPrice.toFixed(2)}`;

  const productUrl =
    toAbsoluteUrl(product?.url, store.domain) ??
    (handle ? `https://${store.domain}/products/${handle}` : null);

  return {
    shopifyId: product?.id ?? null,
    name,
    price,
    imageUrl,
    images,
    storeName: store.storeName,
    storeDomain: store.domain,
    productUrl,
    available,
    productType,
    tags,
    vendor,
    handle,
    rawDescription,
    createdAt: product?.created_at ?? null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchStoreProducts(store) {
  const base =
    store.domain === "www.dotcomme.net"
      ? "https://www.dotcomme.net/collections/paris/products.json"
      : `https://${store.domain}/products.json`;

  const allProducts = [];
  let page = 1;
  while (true) {
    const url = `${base}?limit=250&page=${page}&country=FR`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(
        `Failed fetching ${store.domain} page ${page}: ${res.status} ${res.statusText}`
      );
      break;
    }
    const data = await res.json();
    const batch = Array.isArray(data?.products) ? data.products : [];
    if (batch.length === 0) break;
    allProducts.push(...batch);
    if (batch.length < 250) break;
    page++;
    await sleep(500);
  }

  const normalized = allProducts
    .map((p) => normalizeProduct(p, store))
    .filter(Boolean);

  const existingByHandle = await fetchExistingEditorialByHandle(store.domain);

    const cleaned = await Promise.all(
      normalized.map(async (p) => {
        const existing = p.handle ? existingByHandle[p.handle] : null;
        if (existing && existing.brand && existing.title && existing.category) {
          const brand = existing.brand;
          const title = existing.title;
          const category = existing.category;

          if (FILTER_BY_BRAND.has(store.domain)) {
            const resolvedBrand =
              normalizeBrand(brand) ||
              normalizeBrand(p.vendor) ||
              (titleContainsAllowedBrand(p.name) ? "matched_via_title" : null);
            if (!resolvedBrand) return null;
            if (resolvedBrand !== "matched_via_title" && !BRAND_SET_NORMALIZED.has(resolvedBrand)) return null;
          }

          return { ...p, brand, title, category };
        }

        const result = await cleanTitle(p);
        let brand = null;
        let title = null;
        if (result) {
          try {
            const clean = result.replace(/```json|```/g, "").trim();
            const parsed = JSON.parse(clean);
            brand = parsed.brand || null;
            title = parsed.title || null;
          } catch {
            // parse failed — leave brand and title as null
          }
        }

      // Brand filter — only applied to specific stores
      if (FILTER_BY_BRAND.has(store.domain)) {
        // Try cleanTitle brand first, then vendor as fallback, then raw title scan
        const resolvedBrand =
          normalizeBrand(brand) ||
          normalizeBrand(p.vendor) ||
          (titleContainsAllowedBrand(p.name) ? "matched_via_title" : null);

        // No recognizable brand found — reject
        if (!resolvedBrand) return null;

        // Brand found but not in allowlist — reject
        if (resolvedBrand !== "matched_via_title" && !BRAND_SET_NORMALIZED.has(resolvedBrand)) return null;
      }

      const category = assignCategory({ ...p, brand, title });
      return { ...p, brand, title, category };
    })
  );

  return cleaned.filter(Boolean);
}