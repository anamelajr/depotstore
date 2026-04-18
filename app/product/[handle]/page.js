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
  const vendor = product.vendor ?? null;
  const tags = Array.isArray(product.tags) ? product.tags : 
    typeof product.tags === "string" ? product.tags.split(",").map(t => t.trim()) : [];

  const productData = {
    name: product.title,
    vendor,
    rawDescription,
    tags,
    price,
    storeName: storeDomain,
  };

  const { data: dbRow } = await supabase
    .from("products")
    .select("editorial_description")
    .eq("store_domain", storeDomain)
    .eq("handle", handle)
    .maybeSingle();

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
  const storeName = storeDomain.replace(".com", "").replace(".fr", "").replace(".net", "");

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="mx-auto max-w-[1400px] px-0 lg:px-10 py-0 lg:pt-16 lg:pb-10">

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[88px_1fr_340px] lg:gap-12">

          <ProductGallery images={images} alt={product.title} />

          {/* Product info */}
          <div className="order-2 lg:order-none px-5 lg:px-0 lg:sticky lg:top-[calc(var(--nav-height)+2rem)] lg:self-start">
            <div className="space-y-8">

              {/* Vendor / brand */}
              {vendor && (
                <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
                  {vendor}
                </p>
              )}

              {/* Title */}
              <h1
                className="text-[clamp(22px,2.2vw,30px)] font-normal leading-snug tracking-tight text-zinc-900"
                style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
              >
                {product.title}
              </h1>

              {/* Price */}
              {price && (
                <p className="font-mono text-[14px] text-zinc-700">
                  {price}
                </p>
              )}

              {/* Sold indicator */}
              {!available && (
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                  Sold
                </p>
              )}

              {/* Editorial description */}
              {description && (
                <p className="text-[13px] leading-relaxed text-zinc-600">
                  {description}
                </p>
              )}

              {/* Shop button */}
              <div>
                <a
                  href={`${productUrl}?utm_source=depot`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 border-b border-zinc-900 pb-1 font-mono text-[11px] uppercase tracking-widest text-zinc-900 hover:text-zinc-500 hover:border-zinc-500 transition-colors"
                >
                  Shop at {storeName}
                  <span aria-hidden="true">&rarr;</span>
                </a>
              </div>

              {/* Back to feed */}
              <BackToFeedLink
                className="mt-12 block font-mono text-[11px] uppercase tracking-widest text-zinc-500 hover:text-zinc-900 transition-colors"
              />

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}