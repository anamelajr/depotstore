export const dynamic = "force-dynamic";
import { cleanTitle } from "../../lib/cleanTitle.js";
const STORES = [
  { domain: "lobscur.com", storeName: "L'OBSCUR" },
  { domain: "dolcevitahub.com", storeName: "Dolce Vita Hub" },
  { domain: "seyswardrobe.fr", storeName: "Seys Wardrobe" },
  { domain: "numero13vintage.com", storeName: "Numero 13 Vintage" },
  { domain: "lesarchivesparis.com", storeName: "Les Archives Paris" },
  { domain: "atdawnparis.com", storeName: "at dawn paris" },
  { domain: "nuovo-paris.com", storeName: "Nuovo Paris" },
  { domain: "yourgarmentz.com", storeName: "yourgarmentz" },
  { domain: "www.dotcomme.net", storeName: "dot COMME" },
];

function toAbsoluteUrl(inputUrl, domain) {
  if (typeof inputUrl !== "string" || inputUrl.length === 0) return null;
  try {
    // Already absolute.
    if (/^https?:\/\//i.test(inputUrl)) return inputUrl;
    // Shopify often returns relative paths like "/products/handle".
    if (inputUrl.startsWith("/")) return `https://${domain}${inputUrl}`;
    return `https://${domain}/${inputUrl}`;
  } catch {
    return null;
  }
}

function normalizeProduct(product, store) {
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

  // All images, not just the first
  const images = Array.isArray(product?.images)
    ? product.images.map((img) => img?.src).filter(Boolean)
    : [];
  const imageUrl = images[0] ?? null;

  // Raw description from Shopify (HTML stripped)
  const rawDescription = typeof product?.body_html === "string"
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
    (handle
      ? `https://${store.domain}/products/${handle}`
      : null);

  return {
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
  };
}

async function fetchStoreProducts(store) {
  const url = store.domain === "www.dotcomme.net"
    ? "https://www.dotcomme.net/collections/paris/products.json?limit=250"
    : `https://${store.domain}/products.json?limit=250`;
  
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.error(`Failed fetching ${store.domain}: ${res.status} ${res.statusText}`);
    return [];
  }
  const data = await res.json();
  const products = Array.isArray(data?.products) ? data.products : [];
  const normalized = products.map((p) => normalizeProduct(p, store)).filter(Boolean);
const cleaned = await Promise.all(
  normalized.map(async (p) => ({
    ...p,
    name: await cleanTitle(p),
  }))
);
return cleaned;
}

export async function GET() {
  const results = await Promise.allSettled(STORES.map((s) => fetchStoreProducts(s)));

  const normalized = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      normalized.push(...r.value);
    } else {
      console.error(r.reason);
    }
  }

  return Response.json(normalized);
}

