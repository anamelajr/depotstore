export const dynamic = "force-dynamic";

const STORES = [
  { domain: "lobscur.com", storeName: "L'OBSCUR" },
  { domain: "dolcevitahub.com", storeName: "Dolce Vita Hub" },
  { domain: "seyswardrobe.fr", storeName: "Seys Wardrobe" },
  { domain: "numero13vintage.com", storeName: "Numero 13 Vintage" },
  { domain: "lesarchivesparis.com", storeName: "Les Archives Paris" },
  { domain: "atdawnparis.com", storeName: "at dawn paris" },
  { domain: "nuovo-paris.com", storeName: "Nuovo Paris" },
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
  const tags = Array.isArray(product?.tags)
    ? product.tags.filter((t) => typeof t === "string")
    : typeof product?.tags === "string"
      ? product.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  const imageUrl =
    Array.isArray(product?.images) && product.images.length > 0
      ? product.images[0]?.src ?? null
      : null;

  // Price: pick the minimum variant price and format as EUR.
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
    (typeof product?.handle === "string" && product.handle.length > 0
      ? `https://${store.domain}/products/${product.handle}`
      : null);

  return {
    name,
    price,
    imageUrl,
    storeName: store.storeName,
    productUrl,
    available,
    productType,
    tags,
  };
}

async function fetchStoreProducts(store) {
  const url = `https://${store.domain}/products.json?limit=250`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Failed fetching ${store.domain} products.json: ${res.status} ${res.statusText}`
    );
  }
  const data = await res.json();
  const products = Array.isArray(data?.products) ? data.products : [];
  return products.map((p) => normalizeProduct(p, store)).filter(Boolean);
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

