"use client";

import Link from "next/link";
import { buildFreshFeedUrl } from "../../lib/feed-utils";
import { useLanguage } from "../LanguageProvider";

const itemBase =
  "block py-2 font-mono text-[11px] uppercase tracking-widest transition-colors text-zinc-600 hover:text-zinc-950";
const itemActive = "text-zinc-950";
const labelStyle =
  "mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400";

export default function StoresPanel({ stores = [], searchParams }) {
  const { t } = useLanguage();
  const sorted = [...stores].sort((a, b) =>
    (a.storeName || "").localeCompare(b.storeName || "")
  );
  const selectedStore = searchParams?.get("store") || "";
  const allActive = !selectedStore;

  return (
    <div>
      <div className={labelStyle}>{t("nav.stores")}</div>
      <Link
        href="/feed"
        className={`${itemBase} ${allActive ? itemActive : ""}`}
      >
        {allActive && <span className="-ml-4 mr-1">— </span>}
        {t("filter.allStores")}
      </Link>
      {sorted.map((s) => {
        const active = selectedStore === s.domain;
        return (
          <Link
            key={s.domain}
            href={buildFreshFeedUrl({ store: s.domain })}
            className={`${itemBase} ${active ? itemActive : ""}`}
          >
            {active && <span className="-ml-4 mr-1">— </span>}
            {s.storeName}
          </Link>
        );
      })}
      <Link
        href="/stores"
        className="mt-6 inline-block font-mono text-[11px] uppercase tracking-widest text-zinc-500 hover:text-zinc-950 transition-colors"
      >
        {t("nav.viewAllStores")} →
      </Link>
    </div>
  );
}
