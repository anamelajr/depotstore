"use client";

import { track } from "@vercel/analytics";

function addUtmSource(url, utmSource) {
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", utmSource);
    return u.toString();
  } catch {
    // Fallback for unexpected URL shapes.
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}utm_source=${encodeURIComponent(utmSource)}`;
  }
}

export default function ProductCard({ product }) {
  const { name, price, imageUrl, storeName, productUrl, available } =
    product ?? {};
  const isSold = available === false;
  const productHref = productUrl
    ? addUtmSource(productUrl, "depot")
    : null;

  const handleClick = () => {
    if (!productUrl) return;
    track("product_click", {
      storeName: storeName ?? null,
      productName: name ?? null,
      productUrl: productUrl ?? null,
    });
  };

  const card = (
    <div className="group rounded-2xl focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-700">
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-zinc-950">
        {imageUrl ? (
          // Use a plain <img> to avoid needing remote domain config for Next Image.
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

      <div className="mt-5">
        <div className="text-sm font-sans font-medium tracking-tight text-zinc-50">
          {name ?? "Untitled"}
        </div>

        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="text-xs font-mono text-zinc-300">
            {price ?? "—"}
          </div>

          {storeName ? (
            <span className="inline-flex items-center rounded border border-zinc-800/70 px-2 py-0.5 text-[11px] font-mono text-zinc-500">
              {storeName}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (!productUrl) return card;

  return (
    <a
      href={productHref ?? productUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block focus:outline-none"
      onClick={handleClick}
    >
      {card}
    </a>
  );
}

