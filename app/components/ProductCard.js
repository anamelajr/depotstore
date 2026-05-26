"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";

export default function ProductCard({ product }) {
  const {
    name,
    title,
    brand,
    price: rawPrice,
    imageUrl,
    storeName,
    productUrl,
    available,
    handle,
    storeDomain,
  } = product ?? {};
  const price = rawPrice?.replace(/\.00$/, "") ?? null;
  const SHORT_NAMES = {
    "Les Archives Paris": "Les Archives",
    "Numero 13 Vintage": "Numero 13",
  };
  const badgeName = SHORT_NAMES[storeName] ?? storeName;
  const displayTitle = title ?? name ?? "Untitled";
  const isSold = !available;

  const internalUrl = handle && storeDomain
    ? `/product/${handle}?store=${storeDomain}&available=${!isSold}`
    : null;

  const handleClick = () => {
    track("product_click", {
      storeName: storeName ?? null,
      productName: displayTitle ?? null,
      productUrl: productUrl ?? null,
    });
  };

  const card = (
    <div className="group focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700">
      {/* Image */}
      <div className="relative aspect-[4/5] overflow-hidden bg-zinc-950">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={displayTitle}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 text-xs text-zinc-600">
            No image
          </div>
        )}
        {isSold ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45">
            <div className="text-[11px] font-mono uppercase tracking-widest text-white">
              SOLD
            </div>
          </div>
        ) : null}
      </div>

      {/* Info */}
      <div className="mt-4">
        {/* Mobile */}
        <div className="md:hidden">
          {brand ? (
            <div className="font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-100">
              {brand}
            </div>
          ) : null}
          <div className={`font-sans text-[13px] leading-snug text-zinc-400 line-clamp-2 min-h-[2lh]${brand ? " mt-0.5" : ""}`}>
            {displayTitle}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <div className="font-mono text-[12px] text-zinc-200">
              {price ?? "—"}
            </div>
            {storeName ? (
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500 whitespace-nowrap">
                {badgeName}
              </span>
            ) : null}
          </div>
        </div>

        {/* Desktop */}
        <div className="hidden md:flex md:justify-between md:gap-4">
          <div className="flex flex-col min-w-0">
            {brand ? (
              <div className="font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-100">
                {brand}
              </div>
            ) : null}
            <div className={`font-sans text-[13px] leading-snug text-zinc-400 line-clamp-2${brand ? " mt-0.5" : ""}`}>
              {displayTitle}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end justify-between">
            <div className="font-mono text-[12px] text-zinc-200 whitespace-nowrap">
              {price ?? "—"}
            </div>
            {storeName ? (
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500 whitespace-nowrap">
                {badgeName}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  if (!internalUrl) return card;

  return (
    <Link
      href={internalUrl}
      className="block focus:outline-none"
      onClick={handleClick}
    >
      {card}
    </Link>
  );
}