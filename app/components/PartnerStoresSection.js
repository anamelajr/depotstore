"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const STORES = [
  { storeName: "L'OBSCUR", displayName: "L'Obscur", location: "Le Marais" },
  { storeName: "Dolce Vita Hub", displayName: "Dolce Vita Hub", location: "Le Marais" },
  { storeName: "Seys Wardrobe", displayName: "Seys Wardrobe", location: "Paris" },
  { storeName: "Numero 13 Vintage", displayName: "Numero 13 Vintage", location: "Le Marais" },
  { storeName: "Les Archives Paris", displayName: "Les Archives Paris", location: "Saint-Germain-des-Prés" },
  { storeName: "at dawn paris", displayName: "AT Dawn Paris", location: "Le Marais" },
  { storeName: "Nuovo Paris", displayName: "Nuovo Paris", location: "Le Marais" },
  { storeName: "yourgarmentz", displayName: "yourgarmentz", location: "Paris" },
  {storeName: "dot COMME", displayName: "dot COMME", location: "Paris"},
];

export default function PartnerStoresSection() {
  const [pieceCounts, setPieceCounts] = useState({});

  useEffect(() => {
    let cancelled = false;
    async function fetchCounts() {
      try {
        const res = await fetch("/api/products");
        if (!res.ok) return;
        const products = await res.json();
        if (cancelled || !Array.isArray(products)) return;
        const counts = {};
        for (const p of products) {
          const name = p?.storeName;
          if (name) counts[name] = (counts[name] ?? 0) + 1;
        }
        setPieceCounts(counts);
      } catch {
        // ignore
      }
    }
    fetchCounts();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="divide-y divide-zinc-800">
      {STORES.slice(0, 5).map((store, index) => {
        const count = pieceCounts[store.storeName] ?? 0;
        const num = String(index + 1).padStart(2, "0");
        return (
          <Link
            key={store.storeName}
            href={`/feed?store=${encodeURIComponent(store.storeName)}`}
            className="group flex items-center justify-between gap-8 py-10 transition-colors"
          >
            <div className="flex items-baseline gap-8">
              <span className="w-8 shrink-0 font-mono text-[11px] font-medium uppercase tracking-widest text-zinc-600">
                {num}
              </span>
              <span
                className="font-medium tracking-tight transition-colors group-hover:text-zinc-50"
                style={{
                  fontFamily: "var(--font-playfair), Georgia, serif",
                  fontSize: "clamp(20px, 3vw, 28px)",
                }}
              >
                {store.displayName}
              </span>
            </div>
            <div className="flex shrink-0 items-baseline gap-8 text-right">
              <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
                {store.location}
              </span>
              <span className="w-16 text-right font-mono text-[11px] text-zinc-600">
                {count} pcs
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
