import { generateDescription } from "./generateDescription";
import { supabase, supabaseAdmin } from "./supabase.js";
import { parseSizes } from "./parseSizes.js";

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

// Accessory-class keyword regex used by the bag/accessory ONE SIZE
// fallback. Tested against `product_type` and against each tag; one
// match is enough. Kept narrow enough that a "leather skirt" with stray
// "accessories" merchandising tags doesn't trigger — the regex requires
// a noun head, not the word "accessory" alone.
const ACCESSORY_KW =
  /\b(bag|handbag|tote|clutch|backpack|purse|wallet|cardholder|sunglasses|eyewear|glasses|hat|cap|beanie|beret|scarf|shawl|stole|belt|tie|gloves|jewel(?:lery|ry)?|necklace|bracelet|earrings?|brooch|pendant)s?\b/i;

function looksLikeAccessory(product) {
  const pt =
    typeof product?.product_type === "string" ? product.product_type : "";
  if (pt && ACCESSORY_KW.test(pt)) return true;
  const tags = Array.isArray(product?.tags)
    ? product.tags
    : typeof product?.tags === "string"
      ? product.tags.split(",").map((t) => t.trim())
      : [];
  for (const t of tags) {
    if (typeof t === "string" && ACCESSORY_KW.test(t)) return true;
  }
  return false;
}

// Render-ready sizes array for the PDP. Four layers, in order. First
// non-null wins.
//
//   L1 — Stored array: `dbRow.size` is a Postgres `text[]` (hydrated to
//        a JS array by supabase-js). Wins whenever non-empty. This is
//        the steady-state path — the cron sync writes it on every run.
//
//   L2 — Live parse: re-run `parseSizes(product)` on the live Shopify
//        payload. Covers (a) the cron-lag window when a product was
//        listed since the last hourly sync (dbRow exists but `size`
//        column is null because Step-1 wasn't yet aware of this product
//        when it last ran), and (b) any row whose sync somehow skipped
//        the column. Without this layer, brand-new products would
//        render with an empty SIZE block for up to 60 minutes — a
//        visible regression vs the pre-redesign PDP, which derived
//        sizes from variants on every load.
//
//   L3 — Accessory ONE SIZE fallback. Triggered when (a) DB category is
//        "Bags & Accessories", OR (b) the live Shopify `product_type`
//        or `tags` match the bag/accessory keyword list. Branch (b) is
//        what saves uncategorized bags (DB category=NULL because the
//        enrichment classifier hasn't run on the row yet) from
//        rendering with no SIZE block.
//
//   L4 — null (PDP hides the SIZE block — honest empty).
//
// Defensive against the pre-migration row shape: if `dbRow.size` is a
// scalar string (legacy), we ignore it rather than splitting — the
// next sync will overwrite with the correct array shape.
export function resolveSizes(dbRow, product) {
  // L1
  const raw = dbRow?.size;
  const arr = Array.isArray(raw) ? raw : [];
  const parts = arr
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);
  if (parts.length > 0) return parts;

  // L2
  const live = parseSizes(product);
  if (Array.isArray(live) && live.length > 0) return live;

  // L3
  if (dbRow?.category === "Bags & Accessories") return ["ONE SIZE"];
  if (looksLikeAccessory(product)) return ["ONE SIZE"];

  // L4
  return null;
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
      .select("brand, title, editorial_description, available, size, category")
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

  const sizes = resolveSizes(dbRow, product);
  // Source product-level availability from the cron-maintained
  // `products.available` column, not from the Shopify single-product fetch.
  // The single-product endpoint omits `variant.available`; the cron derives
  // availability from `/products.json` (the listing endpoint) where the
  // field IS populated, and writes the result to Supabase. Fall back to
  // `true` for rows that haven't been synced yet — matches the implicit
  // pre-redesign behavior of treating unknown availability as available.
  const available = dbRow?.available ?? true;

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
