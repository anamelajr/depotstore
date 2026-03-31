"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";

export default function ProductCard({ product }) {
  const {
    name,
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
  const isSold = !available;

  const internalUrl = handle && storeDomain
  ? `/product/${handle}?store=${storeDomain}&available=${!isSold}`
  : null;

  const handleClick = () => {
    track("product_click", {
      storeName: storeName ?? null,
      productName: name ?? null,
      productUrl: productUrl ?? null,
    });
  };

  const card = (
    <div className="group focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700">
      <div className="relative aspect-[4/5] overflow-hidden bg-zinc-950">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name ?? "Product image"}
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

      <div className="mt-5 flex flex-col">
        <div className="text-sm font-sans font-medium tracking-tight text-zinc-50 line-clamp-2 min-h-[40px]">
          {name ?? "Untitled"}
        </div>

        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="text-xs font-mono text-zinc-300">
            {price ?? "—"}
          </div>

          {storeName ? (
            <span className="inline-flex items-center rounded border border-zinc-800/70 px-2 py-0.5 text-[11px] font-mono text-zinc-500 max-w-[120px] truncate">
              {badgeName.toUpperCase()}
            </span>
          ) : null}
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