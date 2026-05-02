"use client";

import Link from "next/link";

const SUBCATEGORIES = {
  tops: [
    ["tops",                  "All Tops"],
    ["tops_hoodies_sweaters", "Hoodies & Sweaters"],
    ["tops_shirts_blouses",   "Shirts & Blouses"],
    ["tops_tees",             "Tees"],
    ["tops_knitwear",         "Knitwear"],
  ],
  jackets: [
    ["jackets_coats", "All Jackets & Coats"],
    ["jackets",       "Jackets"],
    ["coats",         "Coats"],
  ],
  bags: [
    ["bags_accessories", "All Bags & Accessories"],
    ["bags",             "Bags"],
    ["accessories",      "Accessories"],
  ],
};

const HEADINGS = {
  tops:    "Tops",
  jackets: "Jackets & Coats",
  bags:    "Bags & Accessories",
};

function buildToggleCategoryUrl(searchParams, categoryValue) {
  const current = searchParams.getAll("category");
  const next = current.includes(categoryValue)
    ? current.filter((c) => c !== categoryValue)
    : [...current, categoryValue];
  const params = new URLSearchParams();
  next.forEach((c) => params.append("category", c));
  const store = searchParams.get("store");
  if (store) params.set("store", store);
  const q = params.toString();
  return `/feed${q ? `?${q}` : ""}`;
}

const itemBase =
  "block py-2 font-mono text-[11px] uppercase tracking-widest transition-colors text-zinc-300 hover:text-zinc-50";
const itemActive = "text-zinc-50";
const labelStyle =
  "mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600";

export default function SubcategoryList({ expandKey, searchParams }) {
  const items = SUBCATEGORIES[expandKey];
  if (!items) return null;
  const selectedCategories = searchParams.getAll("category");

  return (
    <div>
      <div className={labelStyle}>{HEADINGS[expandKey]}</div>
      {items.map(([value, label]) => {
        const active = selectedCategories.includes(value);
        return (
          <Link
            key={value}
            href={buildToggleCategoryUrl(searchParams, value)}
            className={`${itemBase} ${active ? itemActive : ""}`}
          >
            {active && <span className="-ml-4 mr-1">— </span>}
            {label}
          </Link>
        );
      })}
    </div>
  );
}
