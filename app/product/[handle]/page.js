import ProductGallery from "../../components/ProductGallery";
import DesktopProductGallery from "../../components/DesktopProductGallery";
import ProductInfoPanel from "../../components/ProductInfoPanel";
import Accordion from "../../components/Accordion";
import SaveShareRow from "../../components/SaveShareRow";
import MoreFromStore from "../../components/MoreFromStore";
import Price from "../../components/Price.js";
import { resolveProductDetailCore } from "../../lib/resolveProductDetail";
import ProductDescription, {
  ProductDescriptionFallback,
} from "../../components/ProductDescription";
import ClampedDescription from "../../components/ClampedDescription";
import Link from "next/link";
import ReactDOM from "react-dom";
import { Suspense } from "react";
import { shopifyImageUrl } from "../../lib/shopifyImage.js";

export default async function ProductPage({ params, searchParams }) {
  const { handle } = await params;
  const { store: storeDomain } = await searchParams;

  const detail = await resolveProductDetailCore({ handle, storeDomain });

  if (!detail) {
    return <div className="min-h-screen bg-white text-zinc-900 flex items-center justify-center">Product not found.</div>;
  }

  const { images, sizes, price, brand, title, storeName, storeLocation, description, available } = detail;

  const productUrl = `https://${storeDomain}/products/${handle}`;
  const storeFeedHref = `/feed?store=${encodeURIComponent(storeDomain)}`;

  // Start the LCP image fetch with the document instead of waiting for the
  // gallery markup to be parsed. Must be the exact URL both galleries request
  // for slide 1 (plain src at width=1600, no srcSet) or the preload is a
  // second download rather than a head start.
  if (images[0]) {
    ReactDOM.preload(shopifyImageUrl(images[0], 1600), {
      as: "image",
      fetchPriority: "high",
    });
  }

  // Steady state (row already has a description): pass the text straight
  // through — no boundary, no placeholder flash. Otherwise stream it, so an
  // OpenAI generation never blocks the shell. Both slots resolve through one
  // React.cache'd call, so the document costs at most one generation.
  const desktopDescriptionSlot = description ? (
    <ClampedDescription text={description} />
  ) : (
    <Suspense fallback={<ProductDescriptionFallback />}>
      <ProductDescription handle={handle} storeDomain={storeDomain} />
    </Suspense>
  );

  const mobileDescriptionSlot = description ? (
    <p>{description}</p>
  ) : (
    <Suspense fallback={<ProductDescriptionFallback />}>
      <ProductDescription handle={handle} storeDomain={storeDomain} plain />
    </Suspense>
  );

  return (
    <div className="min-h-screen bg-white text-zinc-900">

      {/* Desktop — full-width stacked gallery + full-height sticky panel */}
      <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(460px,40%)]">
        <DesktopProductGallery images={images} alt={title} />
        <ProductInfoPanel
          brand={brand}
          storeName={storeName}
          title={title}
          price={price}
          sizes={sizes}
          available={available}
          storeDomain={storeDomain}
          storeLocation={storeLocation}
          handle={handle}
          productUrl={productUrl}
          descriptionSlot={desktopDescriptionSlot}
        />
      </div>

      {/* Mobile layout — unchanged */}
      <div className="lg:hidden">
        <ProductGallery images={images} alt={title} />

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
            <Price eur={price} className="font-mono text-[13px] text-zinc-700" />
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
          {sizes && sizes.length > 0 && (
            <p className="mt-2 font-mono text-[11px] text-zinc-600">
              Size: {sizes.join(", ")}
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
          <Accordion label="Description">{mobileDescriptionSlot}</Accordion>
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
      </div>

      {/* More from this store — one instance serves both breakpoints */}
      <div className="mx-auto max-w-[1400px] px-0 lg:px-10 lg:pb-10">
        {/* Its Supabase read used to block the whole document; nothing above
            the fold depends on it. */}
        <Suspense fallback={null}>
          <MoreFromStore
            storeDomain={storeDomain}
            currentHandle={handle}
            storeName={storeName}
          />
        </Suspense>
      </div>

    </div>
  );
}
