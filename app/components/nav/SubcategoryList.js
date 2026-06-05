"use client";

import Link from "next/link";
import { buildFreshFeedUrl } from "../../lib/feed-utils";
import { getSubcategoriesByShortKey } from "../../lib/categories.js";
import { useLanguage } from "../LanguageProvider";

const itemBase =
  "block py-2 font-mono text-[11px] uppercase tracking-widest transition-colors text-zinc-300 hover:text-zinc-50";
const itemActive = "text-zinc-50";
const labelStyle =
  "mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600";

export default function SubcategoryList({ expandKey, searchParams }) {
  const { language } = useLanguage();
  const data = getSubcategoriesByShortKey(language)[expandKey];
  if (!data) return null;
  const { heading, items } = data;
  const selectedCategories = searchParams.getAll("category");

  return (
    <div>
      <div className={labelStyle}>{heading}</div>
      {items.map(([value, label]) => {
        const active = selectedCategories.includes(value);
        return (
          <Link
            key={value}
            href={buildFreshFeedUrl({ category: [value] })}
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
