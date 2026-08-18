// Append a Shopify CDN resize width. Shopify resizes on demand from the
// stored master (pixel-identical at display size) and negotiates a web-safe
// format, so a ~2000px master rendered into a ~400px card stops shipping the
// full multi-MB original. Passthrough for anything that isn't a canonical
// cdn.shopify.com URL (worst case = today's behavior). Idempotent.
//
// Pure function with no browser/Node APIs — safe to import from client
// components.
export function shopifyImageUrl(url, width) {
  if (typeof url !== "string" || !url) return url;
  if (!url.startsWith("https://cdn.shopify.com/")) return url; // safe fallback
  if (!Number.isFinite(width) || width <= 0) return url;
  if (/[?&]width=/.test(url)) return url; // idempotent
  const sep = url.includes("?") ? "&" : "?"; // always & in practice (?v=)
  return `${url}${sep}width=${Math.round(width)}`;
}

// The one resize ladder used everywhere we build a srcSet. Kept here rather
// than inline at each call site so the feed card, the hover image, the PDP
// hero and the feed→PDP hover warm all emit *identical* candidate lists —
// candidate identity is what makes a warmed URL a cache hit later, so a stray
// extra rung in one place silently costs a second download.
export const SHOPIFY_SRCSET_LADDER = [400, 600, 800, 1200, 1600];

// Same passthrough guard as shopifyImageUrl: non-CDN hosts can't be resized,
// so they get no srcSet at all and the caller's bare src stands.
function isShopifyCdnUrl(url) {
  return typeof url === "string" && url.startsWith("https://cdn.shopify.com/");
}

export function shopifySrcSet(url) {
  if (!isShopifyCdnUrl(url)) return undefined;
  return SHOPIFY_SRCSET_LADDER.map((w) => `${shopifyImageUrl(url, w)} ${w}w`).join(", ");
}

// ── PDP slide-1 contract ──
// ONE source of truth for the src/srcSet/sizes trio on the product hero,
// shared by BOTH galleries (mobile + desktop ship in the same HTML), the
// document preload, and the feed's hover warm. Dedup across those four is no
// longer "everyone hardcodes width=1600" — it is "everyone declares the same
// sizes against the same ladder", so every one of them resolves the same
// media condition to the same candidate and the browser fetches once.
//
// 40vw on desktop is the honest measure of DesktopProductGallery's slide:
// object-contain at 3/4 inside max-h-86vh ⇒ ~0.65 × viewport height wide,
// ≈ 40vw at typical window proportions. Mobile is a true full-bleed slide.
export const PDP_SLIDE1_SIZES = "(min-width: 1024px) 40vw, 100vw";

export function pdpSlide1SrcSet(url) {
  return shopifySrcSet(url);
}

// Fallback src for browsers that ignore srcSet, and the href the preload
// carries as its base. 1200 is the middle rung: never blurry on a 2× desktop
// slide, never the 1600 every phone used to be forced to download.
export function pdpSlide1Src(url) {
  return shopifyImageUrl(url, 1200);
}
