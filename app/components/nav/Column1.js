"use client";

import Link from "next/link";
import { buildFreshFeedUrl } from "../../lib/feed-utils";
import { NAV_TOP_LEVEL } from "../../lib/categories.js";

const CONTACT_EMAIL = "hello@depot.paris";

const CATEGORY_ITEMS = NAV_TOP_LEVEL.map((c) => ({
  key: c.slug,
  label: c.label,
  expandable: c.expandable,
  expandKey: c.shortKey,
  aliases: c.childSlugs,
}));

const itemBase =
  "block py-2 font-mono text-[11px] uppercase tracking-widest transition-colors text-zinc-300 hover:text-zinc-50";
const itemActive = "text-zinc-50";
const labelStyle =
  "mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600";

export default function Column1({ expandedKey, onExpand, onClose }) {
  return (
    <div className="px-8 py-8">
      <div>
        <div className={labelStyle}>Categories</div>
        {CATEGORY_ITEMS.map((item) => {
          const expandKey = item.expandKey || item.key;
          const isExpanded = item.expandable && expandedKey === expandKey;

          if (item.expandable) {
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onExpand(isExpanded ? null : expandKey)}
                className={`${itemBase} text-left w-full ${isExpanded ? itemActive : ""}`}
              >
                {isExpanded && <span className="-ml-4 mr-1">— </span>}
                {item.label}
              </button>
            );
          }

          return (
            <Link
              key={item.key}
              href={buildFreshFeedUrl({ category: [item.key] })}
              className={itemBase}
            >
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
          className={`${itemBase} text-left w-full ${expandedKey === "designers" ? itemActive : ""}`}
        >
          {expandedKey === "designers" && <span className="-ml-4 mr-1">— </span>}
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
        <Link href="/about" onClick={onClose} className={itemBase}>About</Link>
        <a href={`mailto:${CONTACT_EMAIL}`} onClick={onClose} className={itemBase}>Contact</a>
      </div>
    </div>
  );
}
