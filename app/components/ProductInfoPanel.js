import Link from "next/link";
import Price from "./Price.js";
import T from "./T";
import SaveShareRow from "./SaveShareRow";
import ClampedDescription from "./ClampedDescription";
import { buildFreshFeedUrl } from "../lib/feed-utils.js";

// Full-height sticky panel for the desktop PDP (YSL-style). The sticky
// element itself is the scroll container; the inner wrapper's `my-auto`
// centers the content when it fits and collapses to zero when it overflows —
// never `justify-center` on the scroll container, which would push overflow
// above the reachable top edge.
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
  description,
}) {
  const ctaHref = `https://${storeDomain}/products/${handle}?utm_source=depot`;
  // CTA text is a <T> leaf so it swaps live on language toggle.
  // The interpolated store name is a proper noun (stays as-is); the prefix is
  // prefix-structured in both languages ("Buy at X" / "Acheter chez X"), and the
  // anchor's `uppercase` class handles casing — no manual toUpperCase needed.

  const hasSizes = sizes && sizes.length > 0;
  const multiSize = hasSizes && sizes.length > 1;
  const sizeValue = hasSizes ? sizes.join(" · ") : null;

  return (
    <div className="sticky top-[var(--nav-height)] flex h-[calc(100vh-var(--nav-height))] flex-col overflow-y-auto px-12">
      <div className="my-auto w-full max-w-[320px] mx-auto py-12">
        {/* Store label */}
        <Link
          href={buildFreshFeedUrl({ store: storeDomain })}
          className="font-mono text-[10px] uppercase tracking-[0.22em] underline underline-offset-[6px] decoration-[0.5px] text-zinc-500 hover:text-zinc-900 transition-colors"
        >
          {storeName}
        </Link>

        {/* Brand + title heading — subtle tracked uppercase, no display type */}
        <h1 className="mt-6 font-mono text-[13px] font-semibold uppercase tracking-[0.06em] leading-[1.5] text-zinc-900">
          {brand && <span className="block">{brand}</span>}
          <span className={brand ? "block font-normal text-zinc-500" : "block"}>
            {title}
          </span>
        </h1>

        {/* Price */}
        {price && (
          <div className="mt-4">
            <Price eur={price} className="font-mono text-[13px] text-zinc-800" />
          </div>
        )}

        {/* Hairline */}
        <div className="border-b border-zinc-200 mt-6 mb-6" />

        {/* Size — one quiet line */}
        {hasSizes && (
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-zinc-600">
            <T k={multiSize ? "product.sizes" : "product.size"} /> — {sizeValue}
          </p>
        )}

        {/* Description */}
        {description && (
          <div className={hasSizes ? "mt-5" : ""}>
            <ClampedDescription text={description} />
          </div>
        )}

        {/* Sold token */}
        {!available && (
          <p className="mt-7 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400">
            <T k="product.sold" />
          </p>
        )}

        {/* CTA */}
        <div className={available ? "mt-7" : "mt-3"}>
          <a
            href={ctaHref}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full bg-black hover:bg-zinc-800 text-white text-center py-4 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors overflow-hidden text-ellipsis whitespace-nowrap"
          >
            <T k={available ? "product.buyAt" : "product.viewOn"} /> {storeName}
          </a>
        </div>

        {/* Save / Share */}
        <SaveShareRow productUrl={productUrl} title={title} className="mt-4 flex gap-6" />

        {/* Store info — name · location with a link to the store feed. */}
        <div className="mt-9">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-900">
            {storeName}
            {storeLocation && (
              <span className="text-zinc-400"> · {storeLocation}</span>
            )}
          </p>
          <Link
            href={buildFreshFeedUrl({ store: storeDomain })}
            className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-900 underline underline-offset-[6px] decoration-[0.5px] hover:text-zinc-500"
          >
            <T k="product.browseStore" /> →
          </Link>
        </div>
      </div>
    </div>
  );
}
