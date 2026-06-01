
const ENTRIES = [];

const BY_SLUG = new Map(ENTRIES.map((e) => [e.slug, e]));

export function getAllEntries() {
  return [...ENTRIES].sort(
    (a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || "")
  );
}

export function getEntryBySlug(slug) {
  return BY_SLUG.get(slug) ?? null;
}

export function getAllSlugs() {
  return ENTRIES.map((e) => e.slug);
}
