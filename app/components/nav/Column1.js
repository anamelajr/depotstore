"use client";

import Link from "next/link";

const CONTACT_EMAIL = "hello@depot.paris";

const CATEGORY_ITEMS = [
  { key: "tops",            label: "Tops",                 expandable: true  },
  { key: "bottoms",         label: "Bottoms",              expandable: false },
  { key: "dresses_skirts",  label: "Dresses & Skirts",     expandable: false },
  { key: "jackets_coats",   label: "Jackets & Coats",      expandable: true, expandKey: "jackets" },
  { key: "footwear",        label: "Footwear",             expandable: false },
  { key: "bags_accessories",label: "Bags & Accessories",   expandable: true, expandKey: "bags" },
  { key: "sets",            label: "Sets",                 expandable: false },
];

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

function isCategoryActive(selectedCategories, key) {
  return selectedCategories.some(
    (c) => c === key || c.startsWith(key + "_") || key.startsWith(c + "_")
  );
}

const itemBase =
  "block py-2 font-mono text-[11px] uppercase tracking-widest transition-colors text-zinc-300 hover:text-zinc-50";
const itemActive = "text-zinc-50";
const labelStyle =
  "mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600";

export default function Column1({
  searchParams,
  expandedKey,
  selectedBrand,
  onExpand,
  onClose,
}) {
  const selectedCategories = searchParams.getAll("category");

  return (
    <div className="px-8 py-8">
      <div>
        <div className={labelStyle}>Categories</div>
        {CATEGORY_ITEMS.map((item) => {
          const active = isCategoryActive(selectedCategories, item.key);
          const expandKey = item.expandKey || item.key;
          const isExpanded = item.expandable && expandedKey === expandKey;

          if (item.expandable) {
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onExpand(isExpanded ? null : expandKey)}
                className={`${itemBase} text-left w-full ${active ? itemActive : ""}`}
              >
                {(active || isExpanded) && <span className="-ml-4 mr-1">— </span>}
                {item.label}
              </button>
            );
          }

          return (
            <Link
              key={item.key}
              href={buildToggleCategoryUrl(searchParams, item.key)}
              className={`${itemBase} ${active ? itemActive : ""}`}
            >
              {active && <span className="-ml-4 mr-1">— </span>}
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-8">
        <div className={labelStyle}>Browse</div>
        <button
          type="button"
          onClick={() => onExpand(expandedKey === "designers" ? null : "designers")}
          className={`${itemBase} text-left w-full ${selectedBrand || expandedKey === "designers" ? itemActive : ""}`}
        >
          {(selectedBrand || expandedKey === "designers") && <span className="-ml-4 mr-1">— </span>}
          Designers
        </button>
        <button
          type="button"
          onClick={() => onExpand(expandedKey === "stores" ? null : "stores")}
          className={`${itemBase} text-left w-full ${expandedKey === "stores" ? itemActive : ""}`}
        >
          {expandedKey === "stores" && <span className="-ml-4 mr-1">— </span>}
          Stores
        </button>
      </div>

      <div className="mt-8">
        <div className={labelStyle}>Dépôt</div>
        <Link href="/about" className={itemBase}>About</Link>
        <a href={`mailto:${CONTACT_EMAIL}`} onClick={onClose} className={itemBase}>Contact</a>
      </div>
    </div>
  );
}
