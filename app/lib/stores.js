import { cache } from "react";
import { unstable_cache } from "next/cache";
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

// AUTHORITATIVE, uncached read. `signal` is optional (default undefined →
// existing callers unaffected). Without it a stalled Supabase connection keeps
// the HTTP response open even after the caller has given up on the promise —
// racing a timeout around this function is NOT enough to bound a render, the
// underlying request has to be aborted.
//
// Write-path / authoritative callers MUST use this, never the cached wrapper
// below: `/api/cron` picks which stores sync and scopes the stale-delete from
// this list, and the local-only admin routes act on it. A ≤600s-stale (or
// stale-while-revalidate) list would let a deactivated store keep syncing and
// would shift the stale-delete scope.
export async function fetchActiveStoresFresh({ signal } = {}) {
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

const STORES_READ_TIMEOUT_MS = 4000;

// Inner fetch for the cached variant: THROWS on error/empty. Never cache a
// fallback — unstable_cache won't cache a throw, but it WOULD cache a
// FALLBACK_STORES list for the full revalidate window.
async function fetchActiveStoresOrThrow() {
  // The cold-miss read is the root layout's only gate on first paint, and a
  // hung (non-erroring) connection would block the whole document. Bound the
  // request itself — a caller-side race would leave it running. Same shape as
  // refreshFxRates in fx.js.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORES_READ_TIMEOUT_MS);
  let data, error;
  try {
    ({ data, error } = await supabaseAdmin
      .from("stores")
      .select("domain, store_name, display_name, location, lat, lng")
      .eq("active", true)
      .order("store_name")
      .abortSignal(controller.signal));
  } finally {
    clearTimeout(timer);
  }

  // Distinct message so operators can tell a timeout from other failures.
  if (controller.signal.aborted) {
    throw new Error(`stores read timed out after ${STORES_READ_TIMEOUT_MS}ms`);
  }
  if (error) throw new Error(`stores read failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("stores read returned empty");

  return data.map(mapStoreRow);
}

const getCachedActiveStores = unstable_cache(
  fetchActiveStoresOrThrow,
  ["active-stores-v1"],
  { revalidate: 600 },
);

// RENDER-PATH callers only (`app/layout.js`, `app/feed/page.js`, `app/page.js`).
// `React.cache` dedupes within a request; `unstable_cache` shares across
// requests for 10 minutes. The catch preserves today's degradation contract
// (FALLBACK_STORES rather than a crash) — which is exactly why authoritative
// callers must not use it. The PDP authorization gate has its own
// hard-bounded TTL cache (see resolveProductDetail.js); it must stay
// fail-closed and must never come through here.
//
// `signal` is accepted and ignored: the cached path has no live request to
// abort, and the feed's 4s Promise.race still unblocks render on a cold miss.
// The React.cache'd inner is argless on purpose: React.cache keys on
// arguments, and the feed passes a fresh `{ signal }` object each call, which
// would defeat per-request dedup against layout.js's argless call.
const dedupedActiveStores = cache(async () => {
  try {
    return await getCachedActiveStores();
  } catch (e) {
    console.error("Failed to fetch stores:", e?.message ?? String(e));
    return FALLBACK_STORES;
  }
});

export async function getActiveStores(_opts = {}) {
  return dedupedActiveStores();
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
