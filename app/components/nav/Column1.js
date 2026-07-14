"use client";

import Link from "next/link";
import { buildFreshFeedUrl } from "../../lib/feed-utils";
import { getNavTopLevel } from "../../lib/categories.js";
import { useLanguage } from "../LanguageProvider";

const CONTACT_EMAIL = "hello@depot.paris";

const itemBase =
  "block py-2 font-mono text-[11px] uppercase tracking-widest transition-colors text-zinc-600 hover:text-zinc-950";
const itemActive = "text-zinc-950";
const labelStyle =
  "mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400";

export default function Column1({ expandedKey, onExpand, onClose }) {
  const { language, t } = useLanguage();
  const CATEGORY_ITEMS = getNavTopLevel(language).map((c) => ({
    key: c.slug,
    label: c.label,
    expandable: c.expandable,
    expandKey: c.shortKey,
    aliases: c.childSlugs,
  }));

  return (
    <div className="px-8 py-8">
      <div>
        <div className={labelStyle}>{t("nav.categories")}</div>
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
        <div className={labelStyle}>{t("nav.browse")}</div>
        <button
          type="button"
          onClick={() => onExpand(expandedKey === "designers" ? null : "designers")}
          className={`${itemBase} text-left w-full ${expandedKey === "designers" ? itemActive : ""}`}
        >
          {expandedKey === "designers" && <span className="-ml-4 mr-1">— </span>}
          {t("nav.designers")}
        </button>
        <button
          type="button"
          onClick={() => onExpand(expandedKey === "stores" ? null : "stores")}
          className={`${itemBase} text-left w-full ${expandedKey === "stores" ? itemActive : ""}`}
        >
          {expandedKey === "stores" && <span className="-ml-4 mr-1">— </span>}
          {t("nav.stores")}
        </button>
        <Link
          href="/editorial"
          onClick={onClose}
          className={itemBase}
        >
          {t("nav.editorial")}
        </Link>
      </div>

      <div className="mt-8">
        <div className={labelStyle}>Dépôt</div>
        <Link href="/about" onClick={onClose} className={itemBase}>{t("nav.about")}</Link>
        <a href={`mailto:${CONTACT_EMAIL}`} onClick={onClose} className={itemBase}>{t("nav.contact")}</a>
      </div>
    </div>
  );
}
