"use client";

import Link from "next/link";

const itemBase =
  "block py-2 font-mono text-[11px] uppercase tracking-widest transition-colors text-zinc-300 hover:text-zinc-50";
const labelStyle =
  "mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600";

export default function StoresPanel({ stores = [] }) {
  const sorted = [...stores].sort((a, b) =>
    (a.storeName || "").localeCompare(b.storeName || "")
  );

  return (
    <div>
      <div className={labelStyle}>Stores</div>
      {sorted.map((s) => (
        <Link
          key={s.domain}
          href={`/feed?store=${encodeURIComponent(s.domain)}`}
          className={itemBase}
        >
          {s.storeName}
        </Link>
      ))}
      <Link
        href="/stores"
        className="mt-6 inline-block font-mono text-[11px] uppercase tracking-widest text-zinc-400 hover:text-zinc-50 transition-colors"
      >
        View all stores →
      </Link>
    </div>
  );
}
