import PrefetchLink from "../../components/PrefetchLink.js";
import HoverSwapImage from "../../components/HoverSwapImage.js";
import Price from "../../components/Price.js";
import {
  pdpSlide1Src,
  pdpSlide1SrcSet,
  PDP_SLIDE1_SIZES,
} from "../../lib/shopifyImage.js";

function EditorialProductCard({ product }) {
  const href =
    product.handle && product.storeDomain
      ? `/product/${product.handle}?store=${product.storeDomain}`
      : null;
  const displayTitle = product.title ?? product.name ?? "Untitled";
  const card = (
    <div className="group">
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-zinc-200">
        {product.imageUrl ? (
          <HoverSwapImage
            imageUrl={product.imageUrl}
            imageUrl2={product.imageUrl2}
            alt={displayTitle}
            // Matches the 4-col desktop / 2-col mobile grid below. Without a
            // `sizes` these cards got no srcSet at all — every one of them
            // downloaded the flat width=800 derivative.
            sizes="(min-width: 1024px) 25vw, 50vw"
          />
        ) : null}
      </div>
      {product.brand ? (
        <p className="mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-900">
          {product.brand}
        </p>
      ) : null}
      <p className={`font-sans text-[13px] leading-snug text-zinc-700 line-clamp-2${product.brand ? " mt-0.5" : " mt-3"}`}>
        {displayTitle}
      </p>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <Price eur={product.price} className="font-mono text-[11px] text-zinc-800" />
        {product.storeName ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500 whitespace-nowrap">
            {product.storeName}
          </span>
        ) : null}
      </div>
    </div>
  );
  if (!href) return card;
  return (
    <PrefetchLink
      href={href}
      heroImage={
        product.imageUrl
          ? {
              src: pdpSlide1Src(product.imageUrl),
              srcSet: pdpSlide1SrcSet(product.imageUrl),
              sizes: PDP_SLIDE1_SIZES,
            }
          : null
      }
      className="block focus:outline-none"
    >
      {card}
    </PrefetchLink>
  );
}

export default function MoreFromDesigner({ designerName, products }) {
  if (!products?.length) return null;
  return (
    <section className="px-6 md:px-10 pt-14 md:pt-20 pb-16 md:pb-24 border-t border-zinc-900/10">
      <header className="flex items-baseline justify-between mb-7 md:mb-10">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-950 font-medium">
          More from {designerName}
        </h2>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-600">
          Live inventory · {products.length} in stock
        </span>
      </header>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 md:gap-x-6 gap-y-9 md:gap-y-11">
        {products.map((p) => (
          <EditorialProductCard key={`${p.storeDomain}::${p.handle}`} product={p} />
        ))}
      </div>
    </section>
  );
}
