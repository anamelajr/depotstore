// Single source of truth for sort UI options.
// Consumed by MobileSortPanel (mobile) and DesktopSortMenu (desktop).
//
// getSortOptions(lang) — language-aware accessor (replaces static SORT_OPTIONS)
// SORT_MAP            — UI value → API "sort" param value (null = omit ?sort=
//                       entirely; the API treats absent ?sort= as the
//                       interleaved discovery RPC)

const SORT_ENTRIES = [
  { value: "interleaved", label: "Default",         labelFr: "Par défaut"     },
  { value: "latest",      label: "Newest",          labelFr: "Plus récent"    },
  { value: "oldest",      label: "Oldest",          labelFr: "Plus ancien"    },
  { value: "price_asc",   label: "Price low → high", labelFr: "Prix croissant" },
  { value: "price_desc",  label: "Price high → low", labelFr: "Prix décroissant" },
];

export function getSortOptions(lang = "en") {
  return SORT_ENTRIES.map(({ value, label, labelFr }) => ({
    value,
    label: lang === "fr" ? labelFr : label,
  }));
}

export const SORT_MAP = {
  interleaved: null,
  latest:      "newest",
  newest:      "newest",  // alias: tolerate ?sort=newest in the wild
  oldest:      "oldest",
  price_asc:   "price_asc",
  price_desc:  "price_desc",
};
