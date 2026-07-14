import ProductGallery from "../../components/ProductGallery";
import DesktopProductGallery from "../../components/DesktopProductGallery";
import ProductInfoPanel from "../../components/ProductInfoPanel";
import Accordion from "../../components/Accordion";
import SaveShareRow from "../../components/SaveShareRow";
import MoreFromStore from "../../components/MoreFromStore";
import Price from "../../components/Price.js";
import { resolveProductDetail } from "../../lib/resolveProductDetail";
import Link from "next/link";

export default async function ProductPage({ params, searchParams }) {
  const { handle } = await params;
  const { store: storeDomain } = await searchParams;

  const detail = await resolveProductDetail({ handle, storeDomain });

  if (!detail) {
    return <div className="min-h-screen bg-white text-zinc-900 flex items-center justify-center">Product not found.</div>;
  }

  const { images, sizes, price, brand, title, storeName, storeLocation, description, available } = detail;

  const productUrl = `https://${storeDomain}/products/${handle}`;
  const storeFeedHref = `/feed?store=${encodeURIComponent(storeDomain)}`;

  return (
    <div className="min-h-screen bg-white text-zinc-900">

      {/* Desktop — full-width stacked gallery + full-height sticky panel */}
      <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_420px]">
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
          description={description}
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
      </div>

      {/* More from this store — one instance serves both breakpoints */}
      <div className="mx-auto max-w-[1400px] px-0 lg:px-10 lg:pb-10">
        <MoreFromStore
          storeDomain={storeDomain}
          currentHandle={handle}
          storeName={storeName}
        />
      </div>

    </div>
  );
}
