import BackToFeedLink from "../../components/BackToFeedLink";
import ProductGallery from "../../components/ProductGallery";
import { generateDescription } from "../../lib/generateDescription";
import { supabase, supabaseAdmin } from "../../lib/supabase.js";

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
      .select("store_name")
      .eq("domain", storeDomain)
      .maybeSingle(),
  ]);

  const brand = nonEmpty(dbRow?.brand) ?? nonEmpty(product.vendor);
  const title = nonEmpty(dbRow?.title) ?? nonEmpty(product.title) ?? product.title;

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
  const storeName =
    nonEmpty(storeRow?.store_name) ??
    storeDomain.replace(".com", "").replace(".fr", "").replace(".net", "");

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="mx-auto max-w-[1400px] px-0 lg:px-10 py-0 lg:pt-16 lg:pb-10">

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[88px_1fr_340px] lg:gap-16">

          <ProductGallery images={images} alt={title} />

          {/* Product info */}
          <div className="order-2 lg:order-none px-5 lg:px-0 lg:sticky lg:top-[calc(var(--nav-height)+2rem)] lg:self-start">
            <div className="lg:pt-6">

              {/* Brand — category-style label */}
              {brand && (
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  {brand}
                </p>
              )}

              {/* Title — serif, Title Case */}
              <h1
                className="mt-3 text-[clamp(26px,2.4vw,34px)] font-normal leading-[1.2] tracking-tight text-zinc-900"
                style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
              >
                {title}
              </h1>

              {/* Price */}
              {price && (
                <p className="mt-8 font-mono text-[13px] text-zinc-700">
                  {price}
                </p>
              )}

              {/* Sold indicator */}
              {!available && (
                <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                  Sold
                </p>
              )}

              {/* Editorial description */}
              {description && (
                <p className="mt-10 text-[13px] leading-[1.8] text-zinc-600">
                  {description}
                </p>
              )}

              {/* Shop link */}
              <div className="mt-12">
                <a
                  href={`${productUrl}?utm_source=depot`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-900 underline underline-offset-[6px] decoration-[0.5px] hover:text-zinc-500 hover:decoration-zinc-500 transition-colors"
                >
                  Shop at {storeName} &rarr;
                </a>
              </div>

              {/* Back to feed */}
              <div className="mt-5">
                <BackToFeedLink
                  className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500 underline underline-offset-[6px] decoration-[0.5px] hover:text-zinc-900 hover:decoration-zinc-900 transition-colors"
                />
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
