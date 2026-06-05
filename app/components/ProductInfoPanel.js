import Link from "next/link";
import Price from "./Price.js";
import { buildFreshFeedUrl } from "../lib/feed-utils.js";

export default function ProductInfoPanel({
  brand,
  storeName,
  title,
  price,
  sizes,
  available,
  storeDomain,
  storeLocation,
  handle,
}) {
  const ctaHref = `https://${storeDomain}/products/${handle}?utm_source=depot`;
  const ctaText = available
    ? `BUY AT ${storeName.toUpperCase()}`
    : `VIEW ON ${storeName.toUpperCase()}`;

  const hasSizes = sizes && sizes.length > 0;
  const sizeLabel = hasSizes && sizes.length > 1 ? "SIZES" : "SIZE";
  const sizeValue = hasSizes ? sizes.join(" · ") : null;

  // Brand-first header: brand owns the divided tag above the title. Falls back
  // to the store name when brand is null so the slot never blanks out.
  const tag = brand ?? storeName;

  return (
    <div className="hidden lg:block lg:sticky lg:top-[calc(var(--nav-height)+2rem)] lg:self-start lg:pt-6">
      {/* Brand-as-tag + title */}
      <div className="border-b border-zinc-200 pb-4">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-900">
          {tag}
        </p>
        <h1 className="mt-3 font-sans text-[14px] font-medium uppercase tracking-[0.06em] leading-[1.45] text-zinc-900">
          {title}
        </h1>
      </div>

      {/* Price */}
      {price && (
        <div className="mt-4 border-b border-zinc-200 pb-4">
          <Price eur={price} className="font-mono text-[13px] text-zinc-700" />
        </div>
      )}

      {/* Sizes */}
      {hasSizes && (
        <div className="mt-4 border-b border-zinc-200 pb-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400">
            {sizeLabel}
          </p>
          <p className="mt-1.5 font-mono text-[12px] uppercase tracking-[0.18em] text-zinc-700">
            {sizeValue}
          </p>
        </div>
      )}

      {/* CTA */}
      <div className="mt-6">
        <a
          href={ctaHref}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full bg-black hover:bg-zinc-800 text-white text-center py-4 font-mono text-[11px] uppercase tracking-[0.22em] transition-colors overflow-hidden text-ellipsis whitespace-nowrap"
        >
          {ctaText}
        </a>
      </div>

      {/* Store info — name · location with a link to the store feed. */}
      <div className="mt-6 pt-6 border-t border-zinc-200">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-900">
          {storeName}
          {storeLocation && (
            <span className="text-zinc-400"> · {storeLocation}</span>
          )}
        </p>
        <Link
          href={buildFreshFeedUrl({ store: storeDomain })}
          className="mt-3 inline-block font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-900 underline underline-offset-[6px] decoration-[0.5px] hover:text-zinc-500"
        >
          Browse store →
        </Link>
      </div>
    </div>
  );
}
