import BRANDS from "../brands";

export const ALL_STORES_VALUE = "ALL";
export const PAGE_SIZE = 42;

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

