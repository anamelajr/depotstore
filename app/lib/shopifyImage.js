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
