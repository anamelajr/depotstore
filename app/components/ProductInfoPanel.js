import Link from "next/link";
import Price from "./Price.js";
import T from "./T";
import SaveShareRow from "./SaveShareRow";
import { buildFreshFeedUrl } from "../lib/feed-utils.js";

const CONTACT_EMAIL = "hello@depot.paris";

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
  descriptionSlot,
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
    <div className="sticky top-[var(--nav-height)] flex h-[calc(100vh-var(--nav-height))] flex-col overflow-y-auto pl-8 pr-6">
      <div className="my-auto w-full max-w-[400px] py-12">
        {/* Brand + title heading with price directly beneath (YSL block) */}
        <h1 className="font-mono text-[13px] font-semibold uppercase tracking-[0.08em] leading-[1.6] text-zinc-900">
          {brand && <span className="block">{brand}</span>}
          <span className={brand ? "block font-normal" : "block"}>{title}</span>
        </h1>
        {price && (
          <div className="mt-2">
            <Price
              eur={price}
              className="font-mono text-[13px] tracking-[0.06em] text-zinc-600"
            />
          </div>
        )}

        {/* Store line — sits where YSL places the colour name */}
        <div className="mt-12">
          <Link
            href={buildFreshFeedUrl({ store: storeDomain })}
            className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-900 hover:text-zinc-500 transition-colors"
          >
            {storeName}
            {storeLocation && (
              <span className="text-zinc-400"> · {storeLocation}</span>
            )}
          </Link>
        </div>

        {/* Size row — one clean black hairline, YSL-style */}
        {hasSizes && (
          <div className="mt-10 flex items-baseline justify-between border-b border-zinc-900 pb-3.5">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-900">
              <T k={multiSize ? "product.sizes" : "product.size"} />
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-zinc-900">
              {sizeValue}
            </span>
          </div>
        )}

        {/* Description — a node, not a string: the PDP passes either a
            rendered ClampedDescription (row already has one) or a Suspense
            boundary that streams a freshly generated one. */}
        {descriptionSlot && <div className="mt-10">{descriptionSlot}</div>}

        {/* Sold token */}
        {!available && (
          <p className="mt-10 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400">
            <T k="product.sold" />
          </p>
        )}

        {/* CTA */}
        <div className={available ? "mt-10" : "mt-4"}>
          <a
            href={ctaHref}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full bg-black hover:bg-zinc-800 text-white text-center py-4 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors overflow-hidden text-ellipsis whitespace-nowrap"
          >
            <T k={available ? "product.buyAt" : "product.viewOn"} /> {storeName}
          </a>
        </div>

        {/* Save / Share */}
        <SaveShareRow
          productUrl={productUrl}
          title={title}
          variant="inline"
          className="mt-5 flex gap-8"
        />

        {/* Detail links — YSL-style chevron list under the buy button */}
        <div className="mt-12 space-y-3.5">
          <a
            href={`${productUrl}?utm_source=depot`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-fit font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-900 hover:text-zinc-500 transition-colors"
          >
            <T k="product.moreDetails" /> <span aria-hidden="true">›</span>
          </a>
          <Link
            href={buildFreshFeedUrl({ store: storeDomain })}
            className="block w-fit font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-900 hover:text-zinc-500 transition-colors"
          >
            <T k="product.browseStore" /> <span aria-hidden="true">›</span>
          </Link>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="block w-fit font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-900 hover:text-zinc-500 transition-colors"
          >
            <T k="product.contact" /> <span aria-hidden="true">›</span>
          </a>
        </div>
      </div>
    </div>
  );
}
