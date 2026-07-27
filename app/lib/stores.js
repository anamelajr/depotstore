import { supabaseAdmin } from "./supabase.js";

// Re-exports from the modules this file used to contain. Kept for one
// release cycle so existing callers (`/api/enrich`, `/api/cron`, scripts/,
// tests/) don't all change at once. The next pass should update the
// importers to point at the new modules directly and drop these.
export {
  normalizeBrand,
  isAllowedBrand,
  canonicalBrand,
  BRAND_SET_NORMALIZED,
  brandFromHandle,
} from "./brand.js";
export { SELF_BRANDED_STORES, isSelfBranded } from "./selfBranded.js";
export { assignCategory } from "./category-classifier.js";
export {
  FILTER_BY_BRAND,
  toAbsoluteUrl,
  normalizeProduct,
  fetchStoreProducts,
} from "./shopifyFetch.js";

// Safety net used by getActiveStores() when Supabase is unreachable.
// Intentionally minimal: domain + storeName only. Downstream consumers
// like ParisMap filter by `lat != null` so fallback rows are silently
// omitted from the map — preferred over crashing or showing stale geo.
export const FALLBACK_STORES = [
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

// `signal` is optional (default undefined → existing callers unaffected).
// Without it a stalled Supabase connection keeps the HTTP response open even
// after the caller has given up on the promise — racing a timeout around this
// function is NOT enough to bound a render, the underlying request has to be
// aborted.
export async function getActiveStores({ signal } = {}) {
  let query = supabaseAdmin
    .from("stores")
    .select("domain, store_name, display_name, location, lat, lng")
    .eq("active", true)
    .order("store_name");
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;

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
