import { generateDescription } from "./generateDescription";
import { supabase, supabaseAdmin } from "./supabase.js";

// Pure helpers — exported for unit tests; the page only consumes
// resolveProductDetail. Kept internal-by-convention; if anything outside the
// PDP starts importing them, consider that a smell that they belong in a
// shared formatter module.

export function stripHtml(html) {
  if (!html) return null;
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function nonEmpty(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatSizes(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const labels = variants
    .filter((v) => v?.available === true)
    .map((v) => nonEmpty(v?.title))
    .filter(Boolean)
    .filter((label) => label.toLowerCase() !== "default title");
  if (labels.length === 0) return null;
  return labels;
}

async function fetchShopifyProduct(handle, storeDomain) {
  try {
    const res = await fetch(
      `https://${storeDomain}/products/${handle}.json?country=FR`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.product ?? null;
  } catch {
    return null;
  }
}

// Returns a flat, render-ready detail object, or null when the PDP should
// fall back to the "Product not found." view (missing params, unknown/inactive
// store domain, or Shopify 404/network failure). Raw Shopify product is
// intentionally not in the return shape — every consumer field is pre-derived
// here so the page stays pure rendering.
//
// Description resolution carries one CLAUDE.md-adjacent invariant: the
// Supabase cache-back write swallows failures silently so the page still
// renders with the generated description. The try/catch only covers JS
// exceptions; Supabase's `{ data, error }` channel is ignored on purpose —
// matching the prior page behavior.
export async function resolveProductDetail({ handle, storeDomain }) {
  if (!handle || !storeDomain) return null;

  // Allowlist check — reject unknown or inactive domains before fetching
  // Shopify, preventing an attacker-controlled domain from being fetched and
  // rendered inside Dépôt's chrome.
  const { data: storeRow } = await supabase
    .from("stores")
    .select("store_name, display_name, location")
    .eq("domain", storeDomain)
    .eq("active", true)
    .maybeSingle();
  if (!storeRow) return null;

  const [product, { data: dbRow }] = await Promise.all([
    fetchShopifyProduct(handle, storeDomain),
    supabase
      .from("products")
      .select("brand, title, editorial_description")
      .eq("store_domain", storeDomain)
      .eq("handle", handle)
      .maybeSingle(),
  ]);

  if (!product) return null;

  const images = Array.isArray(product.images)
    ? product.images.map((img) => img?.src).filter(Boolean)
    : [];

  const variants = Array.isArray(product.variants) ? product.variants : [];

  const minPrice = variants.reduce((min, v) => {
    const n = parseFloat(v?.price ?? "");
    if (!isFinite(n)) return min;
    return min === null ? n : Math.min(min, n);
  }, null);
  const price = minPrice !== null ? `€${minPrice.toFixed(2)}` : null;

  const sizes = formatSizes(variants);
  const available = variants.some((v) => v?.available === true);

  const rawDescription = stripHtml(product.body_html);
  const tags = Array.isArray(product.tags)
    ? product.tags
    : typeof product.tags === "string"
      ? product.tags.split(",").map((t) => t.trim())
      : [];

  const brand = nonEmpty(dbRow?.brand) ?? nonEmpty(product.vendor);
  const title = nonEmpty(dbRow?.title) ?? nonEmpty(product.title) ?? product.title;
  const storeName =
    nonEmpty(storeRow?.display_name) ?? nonEmpty(storeRow?.store_name) ?? storeDomain;

  let description = dbRow?.editorial_description || null;

  if (!description) {
    const generated = await generateDescription({
      name: product.title,
      vendor: product.vendor ?? null,
      rawDescription,
      tags,
      price,
      storeName,
    });
    description = generated;
    if (generated) {
      try {
        await supabaseAdmin
          .from("products")
          .update({ editorial_description: generated })
          .eq("store_domain", storeDomain)
          .eq("handle", handle);
      } catch {
        // Write failure: page still renders with the generated description.
      }
    }
  }

  return {
    images,
    sizes,
    price,
    brand,
    title,
    storeName,
    storeLocation: storeRow?.location ?? null,
    description,
    available,
  };
}
