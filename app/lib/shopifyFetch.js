import { supabaseAdmin } from "./supabase.js";
import {
  normalizeBrand,
  isAllowedBrand,
  titleContainsAllowedBrand,
} from "./brand.js";
import { parseSizes } from "./parseSizes.js";

export const FILTER_BY_BRAND = new Set([
  "dolcevitahub.com",
  "treviseparis.com",
  "chezsnowbunny.fr",
]);

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
  // Second gallery image for the desktop hover-swap. Dedup at the source:
  // Shopify occasionally re-uploads the same asset as images[1] (so
  // images[1] === images[0]); collapse that to NULL once here rather than
  // comparing URLs at every render site.
  const imageUrl2 = images[1] && images[1] !== images[0] ? images[1] : null;

  const rawDescription =
    typeof product?.body_html === "string"
      ? product.body_html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
      : null;

  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const available = variants.some((v) => v?.available === true);
  const sizes = parseSizes(product);
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
    imageUrl2,
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
    sizes,
    createdAt: product?.created_at ?? null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sync-time curation gate for FILTER_BY_BRAND stores. Pure — exported for
// tests. Decision order:
//   1. Existing curated brand row — preserved unconditionally: without it, an
//      active row whose vendor/raw-title don't match the allowlist would be
//      filtered out of this run, miss the synced_at refresh, and get deleted
//      by the cron's stale cleanup.
//   2. Vendor, only when it resolves to an allowlisted brand. Vendor is
//      free-text and Shopify pre-fills it with the shop's own name, so a
//      non-allowlisted vendor (e.g. "CHEZ SNOW BUNNY" on every row) must
//      fall through to the title check, not veto it.
//   3. Title contains an allowlisted brand.
export function passesBrandFilter(p, existing) {
  const existingBrand = existing?.brand ? normalizeBrand(existing.brand) : null;
  if (existingBrand) return isAllowedBrand(existingBrand);
  const vendorBrand = normalizeBrand(p.vendor);
  if (vendorBrand && isAllowedBrand(vendorBrand)) return true;
  return titleContainsAllowedBrand(p.name);
}

// Shopify offset pagination over a mutating catalog can return the same
// product on two pages. A repeated (handle, store_domain) inside one upsert
// batch makes Postgres reject the whole batch ("ON CONFLICT DO UPDATE command
// cannot affect row a second time"), skipping the store's entire sync — so
// collapse to one row per handle before returning. Last occurrence wins
// (freshest snapshot); null handles never conflict on the unique constraint
// and pass through untouched.
export function dedupeByHandle(products) {
  const byHandle = new Map();
  const noHandle = [];
  for (const p of products) {
    if (p.handle == null) noHandle.push(p);
    else byHandle.set(p.handle, p);
  }
  return [...byHandle.values(), ...noHandle];
}

// Pages are fetched with a hard timeout and one retry on transient failures
// (5xx, network error, timeout). After the retry fails we still THROW, never
// return partial data: returning truncated data would let the cron's
// per-fulfilled-store stale delete wipe rows on pages beyond the failure.
// Rejecting the per-store promise routes it through the same skip-cleanup
// path as a URL-length SELECT failure.
const FETCH_TIMEOUT_MS = 10_000;
// Inter-page politeness delay. These are public /products.json endpoints;
// observed 503s are origin flakiness (now retried), not throttling.
const PAGE_SLEEP_MS = 150;

export async function fetchPageWithRetry(url, { domain, page }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const lastAttempt = attempt === 1;
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (e) {
      // Network error or timeout — transient, retry once.
      if (lastAttempt) {
        throw new Error(
          `Shopify fetch failed for ${domain} page ${page}: ${e?.message ?? e}`
        );
      }
      await sleep(PAGE_SLEEP_MS);
      continue;
    }
    if (res.ok) return res;
    // Retry only server-side flakiness; a 4xx won't improve on retry.
    if (lastAttempt || res.status < 500) {
      throw new Error(
        `Shopify fetch failed for ${domain} page ${page}: ${res.status} ${res.statusText}`
      );
    }
    await sleep(PAGE_SLEEP_MS);
  }
}

export async function fetchStoreProducts(store, { deadline } = {}) {
  const base =
    store.domain === "www.dotcomme.net"
      ? "https://www.dotcomme.net/collections/paris/products.json"
      : `https://${store.domain}/products.json`;

  const allProducts = [];
  let page = 1;
  while (true) {
    // Cooperative sync deadline (see /api/cron): abandoning the store here
    // throws, so it rejects and is excluded from the scoped stale delete.
    if (deadline && Date.now() > deadline) {
      throw new Error(
        `Sync deadline exceeded for ${store.domain} (fetch page ${page})`
      );
    }
    const url = `${base}?limit=250&page=${page}&country=FR`;
    const res = await fetchPageWithRetry(url, { domain: store.domain, page });
    const data = await res.json();
    // A missing or non-array `products` field on a 200 response (e.g. a
    // Shopify maintenance payload) must throw, not silently break. Silently
    // breaking would return a truncated product list, and the cron's scoped
    // stale delete would then wipe all rows beyond the last fetched page.
    if (!Array.isArray(data?.products)) {
      throw new Error(
        `Shopify returned unexpected page shape for ${store.domain} page ${page}`
      );
    }
    const batch = data.products;
    if (batch.length === 0) break;
    allProducts.push(...batch);
    if (batch.length < 250) break;
    page++;
    await sleep(PAGE_SLEEP_MS);
  }

  // Dedupe before the curation filter: if a duplicated product changed
  // between page snapshots, the freshest occurrence must be the one the
  // brand filter judges — filtering first would let a stale, still-passing
  // earlier snapshot survive the dedupe.
  const normalized = dedupeByHandle(
    allProducts.map((p) => normalizeProduct(p, store)).filter(Boolean)
  );

  const existingByHandle = FILTER_BY_BRAND.has(store.domain)
    ? await fetchExistingEditorialByHandle(store.domain)
    : {};

  const cleaned = normalized
    .map((p) => {
      if (FILTER_BY_BRAND.has(p.storeDomain)) {
        const existing = p.handle ? existingByHandle[p.handle] : null;
        if (!passesBrandFilter(p, existing)) return null;
      }

      // Editorial fields stay null at sync time. /api/enrich runs cleanTitle
      // and then calls assignCategory with the freshly extracted brand/title,
      // which gives Pass 1 (cleaned-title classifier) a chance to run. If we
      // assigned category here from vendor-strip, the cron's editorial-
      // protective upsert would persist that and /api/enrich's null-only
      // RPC update would never re-classify with the better context —
      // locking in the lower-quality match.
      return { ...p, brand: null, title: null, category: null };
    })
    .filter(Boolean);

  return cleaned;
}
