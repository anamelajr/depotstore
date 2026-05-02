// Single source of truth for sort UI options.
// Consumed by MobileSortSheet (mobile) and DesktopSortMenu (desktop).
//
// SORT_OPTIONS  — what the user sees and what gets written to the URL
// SORT_MAP      — UI value → API "sort" param value (null = omit ?sort=
//                 entirely; the API treats absent ?sort= as the
//                 interleaved discovery RPC)

export const SORT_OPTIONS = [
  { value: "interleaved", label: "Default" },
  { value: "latest",      label: "Newest" },
  { value: "oldest",      label: "Oldest" },
  { value: "price_asc",   label: "Price low → high" },
  { value: "price_desc",  label: "Price high → low" },
];

export const SORT_MAP = {
  interleaved: null,
  latest:      "newest",
  oldest:      "oldest",
  price_asc:   "price_asc",
  price_desc:  "price_desc",
};
