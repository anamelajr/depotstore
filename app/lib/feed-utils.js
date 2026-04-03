import BRANDS from "../brands";

export const ALL_STORES_VALUE = "ALL";
export const PAGE_SIZE = 42;

const BAG_KEYWORDS = [
  "bag", "crossbody", "backpack", "handbag", "tote", "document holder",
  "wallet", "pouchette", "furkin", "purse",
];
const ACCESSORY_KEYWORDS = [
  "sunglasses", "bracelet", "necklace", "gloves", "hat", "scarf",
  "belt", "cap", "beanie", "headband",
];
const TOPS_KEYWORDS = [
  "shirt", "sweater", "cardigan", "hoodie", "t-shirt", "tee", "t shirt",
  "knitwear", "polo", "striped polo", "longsleeve", "longsleeves",
  "sweat-shirt", "sweat", "crewneck", "knit", "blouse", "tunic",
  "jackey", "corset", "vest", "shawl", "waistcoat", "bolero", "cape", "legging", "apron",
];
const BOTTOMS_KEYWORDS = ["jeans", "pants", "pant", "shorts", "trousers", "joggers", "overalls", "hysteric glamour"];
const JACKETS_COATS_KEYWORDS = ["jacket", "blazer", "coat", "bomber", "puffer", "trench", "fur"];
const DRESSES_SKIRTS_KEYWORDS = ["dress", "mini dress", "gown", "skirt", "jumpsuit"];
const TOPS_HOODIES_SWEATERS_KEYWORDS = ["hoodie", "sweat", "sweat-shirt", "crewneck"];
const TOPS_SHIRTS_BLOUSES_KEYWORDS = ["shirt", "blouse", "polo", "tunic"];
const TOPS_TEES_KEYWORDS = ["tee", "t-shirt", "t shirt"];
const TOPS_KNITWEAR_KEYWORDS = ["sweater", "cardigan", "knit", "knitwear"];
const JACKETS_KEYWORDS = ["jacket", "bomber", "blazer", "puffer"];
const COATS_KEYWORDS = ["coat", "trench", "cape"];
const FOOTWEAR_KEYWORDS = ["boots", "boot", "sneakers", "shoes", "loafers", "heels", "sandals", "mules", "pumps"];

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function extractBrandTags(title) {
  const t = normalizeText(title);
  const matches = [];
  for (const brand of BRANDS) {
    const nb = normalizeText(brand);
    if (!nb) continue;
    if (t.includes(nb)) matches.push(brand);
  }
  return Array.from(new Set(matches));
}

function containsAnyKeyword(text, keywords) {
  return keywords.some((kw) => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
    return re.test(text);
  });
}

function hasSetsKeyword(text) {
  return containsAnyKeyword(text, ["set", "two piece", "three piece", "2 piece", "3 piece", "2p"]);
}

export function classifyProduct(product) {
  const t = normalizeText(product?.name ?? "");
  const categories = new Set();
  const hasBags = containsAnyKeyword(t, BAG_KEYWORDS);
  const hasAccessories = containsAnyKeyword(t, ACCESSORY_KEYWORDS);
  const hasFootwear = containsAnyKeyword(t, FOOTWEAR_KEYWORDS);
  const hasSets = hasSetsKeyword(t);
  const hasDressesSkirts = containsAnyKeyword(t, DRESSES_SKIRTS_KEYWORDS);
  const hasJackets = containsAnyKeyword(t, JACKETS_KEYWORDS);
  const hasCoats = containsAnyKeyword(t, COATS_KEYWORDS);
  const hasJacketsCoats = containsAnyKeyword(t, JACKETS_COATS_KEYWORDS);
  const hasTops = containsAnyKeyword(t, TOPS_KEYWORDS);
  const hasBottomsCore = containsAnyKeyword(t, BOTTOMS_KEYWORDS);
  // Denim now only triggers bottoms when paired with a garment word
  const hasDenim = containsAnyKeyword(t, ["denim jeans", "denim pant", "denim short", "denim trouser"]);

  if (hasBags) {
    categories.add("bags_accessories");
    categories.add("bags");
    if (hasAccessories) categories.add("accessories");
    return { categories };
  }
  if (hasAccessories) {
    const hasPrimaryClothing =
      hasDressesSkirts || hasJacketsCoats || hasTops || hasBottomsCore ||
      (hasDenim && !hasJacketsCoats);
    if (!hasPrimaryClothing) {
      categories.add("bags_accessories");
      categories.add("accessories");
      return { categories };
    }
  }
  if (hasFootwear) {
    categories.add("footwear");
    return { categories };
  }
  if (hasSets) {
    categories.add("sets");
    return { categories };
  }
  if (hasDressesSkirts) {
    categories.add("dresses_skirts");
    return { categories };
  }
  if (hasJacketsCoats) {
    categories.add("jackets_coats");
    if (hasJackets) categories.add("jackets");
    if (hasCoats) categories.add("coats");
    return { categories };
  }
  if (hasTops) {
    categories.add("tops");
    if (containsAnyKeyword(t, TOPS_HOODIES_SWEATERS_KEYWORDS)) categories.add("tops_hoodies_sweaters");
    if (containsAnyKeyword(t, TOPS_SHIRTS_BLOUSES_KEYWORDS)) categories.add("tops_shirts_blouses");
    if (containsAnyKeyword(t, TOPS_TEES_KEYWORDS)) categories.add("tops_tees");
    if (containsAnyKeyword(t, TOPS_KNITWEAR_KEYWORDS)) categories.add("tops_knitwear");
    return { categories };
  }
  if (hasBottomsCore || hasDenim) {
    categories.add("bottoms");
    return { categories };
  }
  return { categories };
}