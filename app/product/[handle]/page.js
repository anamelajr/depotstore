import { Inter } from "next/font/google";
import BackToFeedLink from "../../components/BackToFeedLink";
import ProductGallery from "../../components/ProductGallery";
import Accordion from "../../components/Accordion";
import SaveShareRow from "../../components/SaveShareRow";
import MoreFromStore from "../../components/MoreFromStore";
import { generateDescription } from "../../lib/generateDescription";
import { supabase, supabaseAdmin } from "../../lib/supabase.js";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

async function getProduct(handle, storeDomain) {
  try {
    const res = await fetch(
      `https://${storeDomain}/products/${handle}.json?country=FR`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.product ?? null;
  } catch {
    return null;
  }
}

function stripHtml(html) {
  if (!html) return null;
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function nonEmpty(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatSizes(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const labels = variants
    .map((v) => nonEmpty(v?.title))
    .filter(Boolean)
    .filter((label) => label.toLowerCase() !== "default title");
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0];
  return labels.join(", ");
}

export default async function ProductPage({ params, searchParams }) {
  const { handle } = await params;
  const { store: storeDomain, available: availableParam } = await searchParams;
  const available = availableParam !== "false";

  if (!handle || !storeDomain) {
    return <div className="min-h-screen bg-white text-zinc-900 flex items-center justify-center">Product not found.</div>;
  }

  const product = await getProduct(handle, storeDomain);

  if (!product) {
    return <div className="min-h-screen bg-white text-zinc-900 flex items-center justify-center">Product not found.</div>;
  }

  const images = Array.isArray(product.images)
    ? product.images.map((img) => img?.src).filter(Boolean)
    : [];

  const variants = Array.isArray(product.variants) ? product.variants : [];

  const minPrice = variants.reduce((min, v) => {
    const n = parseFloat(v?.price ?? "");
    if (!isFinite(n)) return min;
    return min === null ? n : Math.min(min, n);
  }, null);
  const price = minPrice !== null ? `€${minPrice.toFixed(2)}` : null;

  const sizes = formatSizes(variants);

  const rawDescription = stripHtml(product.body_html);
  const tags = Array.isArray(product.tags) ? product.tags :
    typeof product.tags === "string" ? product.tags.split(",").map(t => t.trim()) : [];

  const [{ data: dbRow }, { data: storeRow }] = await Promise.all([
    supabase
      .from("products")
      .select("brand, title, editorial_description")
      .eq("store_domain", storeDomain)
      .eq("handle", handle)
      .maybeSingle(),
    supabase
      .from("stores")
      .select("store_name, display_name, location")
      .eq("domain", storeDomain)
      .maybeSingle(),
  ]);

  const brand = nonEmpty(dbRow?.brand) ?? nonEmpty(product.vendor);
  const title = nonEmpty(dbRow?.title) ?? nonEmpty(product.title) ?? product.title;
  const storeName = nonEmpty(storeRow?.display_name) ?? nonEmpty(storeRow?.store_name) ?? storeDomain;

  const productData = {
    name: product.title,
    vendor: product.vendor ?? null,
    rawDescription,
    tags,
    price,
    storeName: storeDomain,
  };

  let description = dbRow?.editorial_description || null;

  if (!description) {
    const generated = await generateDescription(productData);
    description = generated;
    if (generated) {
      try {
        await supabaseAdmin
          .from("products")
          .update({ editorial_description: generated })
          .eq("store_domain", storeDomain)
          .eq("handle", handle);
      } catch {
        // Write failure: page still renders with the generated description
      }
    }
  }

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
              <h1 className={`${inter.className} mt-2.5 font-sans text-[14px] font-normal leading-[1.4] text-zinc-600`}>
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
                  {storeRow?.location && (
                    <p className="mt-2">{storeRow.location}</p>
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
              className={`${inter.className} mt-2 text-[clamp(22px,2.2vw,28px)] font-medium leading-[1.25] tracking-tight text-zinc-900`}
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
                className={`${inter.className} mt-10 text-[13px] leading-[1.7] text-zinc-600`}
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
