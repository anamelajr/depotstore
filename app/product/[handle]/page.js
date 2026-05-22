import BackToFeedLink from "../../components/BackToFeedLink";
import ProductGallery from "../../components/ProductGallery";
import Accordion from "../../components/Accordion";
import SaveShareRow from "../../components/SaveShareRow";
import MoreFromStore from "../../components/MoreFromStore";
import { resolveProductDetail } from "../../lib/resolveProductDetail";
import Link from "next/link";

export default async function ProductPage({ params, searchParams }) {
  const { handle } = await params;
  const { store: storeDomain, available: availableParam } = await searchParams;
  const available = availableParam !== "false";

  const detail = await resolveProductDetail({ handle, storeDomain });

  if (!detail) {
    return <div className="min-h-screen bg-white text-zinc-900 flex items-center justify-center">Product not found.</div>;
  }

  const { images, sizes, price, brand, title, storeName, storeLocation, description } = detail;

  const productUrl = `https://${storeDomain}/products/${handle}`;
  const storeFeedHref = `/feed?store=${encodeURIComponent(storeDomain)}`;

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="mx-auto max-w-[1400px] px-0 lg:px-10 lg:pt-16 lg:pb-10">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[88px_1fr_340px] lg:gap-16">

          <ProductGallery images={images} alt={title} />

          {/* Mobile info layout — order-2 on mobile, hidden on desktop */}
          <div className="order-2 lg:hidden">
            {/* Brand + title */}
            <div className="mt-6 px-6">
              {brand && (
                <p className="font-mono text-[22px] font-semibold uppercase tracking-[0.06em] leading-[1.1] text-zinc-900">
                  {brand}
                </p>
              )}
              <h1 className="mt-2.5 font-sans text-[14px] font-normal leading-[1.4] text-zinc-600">
                {title}
              </h1>
            </div>

            {/* Price + meta */}
            <div className="mt-8 px-6">
              {price && (
                <p className="font-mono text-[13px] text-zinc-700">{price}</p>
              )}
              {!available && (
                <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                  Sold
                </p>
              )}
              <Link
                href={storeFeedHref}
                className="mt-3.5 block font-mono text-[11px] text-zinc-600 hover:text-zinc-900 transition-colors"
              >
                {storeName} ›
              </Link>
              {sizes && (
                <p className="mt-2 font-mono text-[11px] text-zinc-600">
                  Size: {sizes}
                </p>
              )}
            </div>

            {/* CTA */}
            <div className="mt-9 px-6">
              <a
                href={`${productUrl}?utm_source=depot`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full bg-black text-white text-center py-[18px] font-mono text-[12px] tracking-[0.05em] hover:bg-zinc-800 transition-colors"
              >
                View at retailer ↗
              </a>
            </div>

            {/* Save / Share */}
            <SaveShareRow productUrl={productUrl} title={title} />

            {/* Accordions */}
            <div className="mt-10 px-6">
              <Accordion label="Description">
                {description ? (
                  <p>{description}</p>
                ) : (
                  <p className="text-zinc-400">No description available.</p>
                )}
              </Accordion>
              <Accordion label="Store Profile" isLast>
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-900">
                    {storeName}
                  </p>
                  {storeLocation && (
                    <p className="mt-2">{storeLocation}</p>
                  )}
                  <Link
                    href={storeFeedHref}
                    className="mt-3 inline-block font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-900 underline underline-offset-[6px] decoration-[0.5px] hover:text-zinc-500"
                  >
                    Browse store →
                  </Link>
                </div>
              </Accordion>
            </div>

            {/* More from this store */}
            <MoreFromStore
              storeDomain={storeDomain}
              currentHandle={handle}
              storeName={storeName}
            />
          </div>

          {/* Desktop info column — preserved from previous design */}
          <div className="hidden lg:block lg:order-none lg:sticky lg:top-[calc(var(--nav-height)+2rem)] lg:self-start lg:pt-6">
            {brand && (
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                {brand}
              </p>
            )}
            <h1
              className="mt-2 font-sans text-[clamp(22px,2.2vw,28px)] font-medium leading-[1.25] tracking-tight text-zinc-900"
            >
              {title}
            </h1>
            {price && (
              <p className="mt-8 font-mono text-[13px] text-zinc-700">
                {price}
              </p>
            )}
            {!available && (
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                Sold
              </p>
            )}
            {description && (
              <p
                className="mt-10 font-sans text-[13px] leading-[1.7] text-zinc-600"
              >
                {description}
              </p>
            )}
            <div className="mt-12">
              <a
                href={`${productUrl}?utm_source=depot`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-900 underline underline-offset-[6px] decoration-[0.5px] hover:text-zinc-500 hover:decoration-zinc-500 transition-colors"
              >
                Shop &rarr;
              </a>
            </div>
            <div className="mt-5">
              <BackToFeedLink
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500 underline underline-offset-[6px] decoration-[0.5px] hover:text-zinc-900 hover:decoration-zinc-900 transition-colors"
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
