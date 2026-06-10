import Link from "next/link";
import Price from "./Price.js";
import T from "./T";
import SaveShareRow from "./SaveShareRow";
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
  productUrl,
}) {
  const ctaHref = `https://${storeDomain}/products/${handle}?utm_source=depot`;
  // CTA text is a <T> leaf so it swaps live on language toggle.
  // The interpolated store name is a proper noun (stays as-is); the prefix is
  // prefix-structured in both languages ("Buy at X" / "Acheter chez X"), and the
  // anchor's `uppercase` class handles casing — no manual toUpperCase needed.

  const hasSizes = sizes && sizes.length > 0;
  const multiSize = hasSizes && sizes.length > 1;
  const sizeValue = hasSizes ? sizes.join(" · ") : null;

  // Heading combines brand + title; when brand is null the store label above
  // already carries the store, so the heading is just the title.
  const heading = brand ? `${brand} — ${title}` : title;

  return (
    <div className="hidden lg:block lg:sticky lg:top-[calc(var(--nav-height)+2rem)] lg:self-start lg:pt-6">
      {/* Store label */}
      <Link
        href={buildFreshFeedUrl({ store: storeDomain })}
        className="font-mono text-[11px] uppercase tracking-[0.22em] underline underline-offset-[6px] decoration-[0.5px] text-zinc-600 hover:text-zinc-900 transition-colors"
      >
        {storeName}
      </Link>

      {/* Brand + title heading */}
      <h1 className="mt-5 font-sans text-[20px] font-semibold uppercase tracking-[0.04em] leading-[1.35] text-zinc-900">
        {heading}
      </h1>

      {/* Price */}
      {price && (
        <div className="mt-4">
          <Price eur={price} className="font-mono text-[15px] text-zinc-800" />
        </div>
      )}

      {/* Single divider — the only hairline above the store block */}
      <div className="border-b border-zinc-200 mt-6 mb-5" />

      {/* Size — one quiet line */}
      {hasSizes && (
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-zinc-600">
          <T k={multiSize ? "product.sizes" : "product.size"} /> {sizeValue}
        </p>
      )}

      {/* CTA */}
      <div className="mt-7">
        <a
          href={ctaHref}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full bg-black hover:bg-zinc-800 text-white text-center py-4 font-mono text-[11px] uppercase tracking-[0.22em] transition-colors overflow-hidden text-ellipsis whitespace-nowrap"
        >
          <T k={available ? "product.buyAt" : "product.viewOn"} /> {storeName}
        </a>
      </div>

      {/* Save / Share */}
      <SaveShareRow productUrl={productUrl} title={title} className="mt-3 flex gap-6" />

      {/* Store info — name · location with a link to the store feed. */}
      <div className="mt-8">
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
          <T k="product.browseStore" /> →
        </Link>
      </div>
    </div>
  );
}
