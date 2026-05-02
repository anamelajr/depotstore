"use client";

import Link from "next/link";
import { buildFreshFeedUrl } from "../../lib/feed-utils";

const itemBase =
  "block py-2 font-mono text-[11px] uppercase tracking-widest transition-colors text-zinc-300 hover:text-zinc-50";
const itemActive = "text-zinc-50";
const labelStyle =
  "mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600";

export default function StoresPanel({ stores = [], searchParams }) {
  const sorted = [...stores].sort((a, b) =>
    (a.storeName || "").localeCompare(b.storeName || "")
  );
  const selectedStore = searchParams?.get("store") || "";
  const allActive = !selectedStore;

  return (
    <div>
      <div className={labelStyle}>Stores</div>
      <Link
        href="/feed"
        className={`${itemBase} ${allActive ? itemActive : ""}`}
      >
        {allActive && <span className="-ml-4 mr-1">— </span>}
        All Stores
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
        className="mt-6 inline-block font-mono text-[11px] uppercase tracking-widest text-zinc-400 hover:text-zinc-50 transition-colors"
      >
        View all stores →
      </Link>
    </div>
  );
}
