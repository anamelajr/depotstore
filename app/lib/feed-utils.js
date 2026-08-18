import BRANDS from "../brands";

export const ALL_STORES_VALUE = "ALL";
export const PAGE_SIZE = 42;
// Feed page size — shared by FeedClient (client fetches / Load More) and
// the server-rendered first page so the SSR payload matches exactly what
// the client would have fetched.
export const LOAD_SIZE = 30;

export function buildFeedUrl(current, updates) {
  const seed =
    current == null
      ? ""
      : typeof current === "string"
      ? current
      : current.toString();
  const params = new URLSearchParams(seed);
  params.delete("page");
  Object.entries(updates || {}).forEach(([k, v]) => {
    if (k === "category") {
      params.delete("category");
      if (Array.isArray(v)) v.forEach((cat) => params.append("category", cat));
    } else {
      if (v == null || v === "" || v === ALL_STORES_VALUE) params.delete(k);
      else params.set(k, String(v));
    }
  });
  const q = params.toString();
  return `/feed${q ? `?${q}` : ""}`;
}

export function buildFreshFeedUrl(updates) {
  const params = new URLSearchParams();
  Object.entries(updates || {}).forEach(([k, v]) => {
    if (k === "category") {
      (Array.isArray(v) ? v : [v]).filter(Boolean).forEach((c) => params.append("category", c));
    } else if (v != null && v !== "" && v !== ALL_STORES_VALUE) {
      params.set(k, String(v));
    }
  });
  const q = params.toString();
  return `/feed${q ? `?${q}` : ""}`;
}

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function extractBrandTags(title) {
  const t = normalizeText(title);
  const matches = [];
  for (const brand of BRANDS) {
    const nb = normalizeText(brand);
    if (!nb) continue;
    if (t.includes(nb)) matches.push(brand);
  }
  return Array.from(new Set(matches));
}


// ── Load More append ──────────────────────────────────────────────────────
// Offset pagination against a catalog that mutates hourly can return a row the
// grid already shows (rows inserted or removed between the two reads); the
// 120s cache on the default first page widens that window. Identity uses the
// MAPPED field names — `mapProductRow` emits `storeDomain`, not `store_domain`.
//
// Skipped rows remain an accepted, pre-existing property of offset pagination:
// this fixes the visible duplicate, not the pagination model.
function productIdentity(p) {
  return `${p?.handle}|${p?.storeDomain}`;
}

export function appendDedupedProducts(prev, rows) {
  if (!rows || rows.length === 0) return prev;
  const seen = new Set(prev.map(productIdentity));
  const fresh = rows.filter((p) => !seen.has(productIdentity(p)));
  if (fresh.length === rows.length) return [...prev, ...rows];
  return [...prev, ...fresh];
}

// The next server offset advances by the RAW fetched-page length, BEFORE
// dedupe. Deriving it from the rendered `products.length` breaks once dedupe
// drops rows: a partially-duplicate page would overlap the next request, and
// an all-duplicate page would re-request the same offset forever — Load More
// stalls permanently while `hasMore` is still true.
export function nextServerOffset(requestedOffset, rows) {
  return requestedOffset + (rows ? rows.length : 0);
}
