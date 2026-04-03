import { cleanTitle } from "./cleanTitle.js";
import BRANDS from "../brands.js";

const BRAND_SET = new Set(BRANDS.map((b) => b.toLowerCase()));
const FILTER_BY_BRAND = new Set(["dolcevitahub.com"]);

export const STORES = [
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

export function assignCategory(product) {
  const text = `${product.productType} ${product.name}`.toLowerCase();
  if (/\b(jacket|coat|blazer|parka|bomber|puffer|anorak|trench|overcoat|peacoat)\b/.test(text)) return "Jackets & Coats";
  if (/\b(dress|skirt|midi|maxi|miniskirt)\b/.test(text)) return "Dresses & Skirts";
  if (/\b(trouser|pant|jean|denim|short|cargo|legging|jogger|chino)\b/.test(text)) return "Bottoms";
  if (/\b(shoe|boot|sneaker|heel|loafer|sandal|mule|clog|pump|trainer)\b/.test(text)) return "Footwear";
  if (/\b(bag|tote|clutch|purse|wallet|belt|scarf|hat|cap|glove|jewelry|necklace|earring|bracelet|ring|accessory|sunglasses|beanie)\b/.test(text)) return "Bags & Accessories";
  if (/\b(set|suit|co-ord|matching)\b/.test(text)) return "Sets";
  if (/\b(top|shirt|tee|blouse|knit|sweater|hoodie|sweatshirt|cardigan|tank|vest|polo|jersey|longsleeve)\b/.test(text)) return "Tops";
  return null;
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
    const url = `${base}?limit=250&page=${page}`;
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

  const cleaned = await Promise.all(
    normalized.map(async (p) => {
      const result = await cleanTitle(p);
      let brand = null;
      let title = p.name;
      try {
        const clean = result.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(clean);
        brand = parsed.brand ?? null;
        title = parsed.title ?? p.name;
      } catch {
        title = result ?? p.name;
      }

     // Brand filter — only applied to specific stores
     if (FILTER_BY_BRAND.has(store.domain) && (!brand || !BRAND_SET.has(brand.toLowerCase()))) return null;

      const category = assignCategory(p);

      return { ...p, brand, title, category };
    })
  );

  // Filter out nulls (products that failed brand check)
  return cleaned.filter(Boolean);
}