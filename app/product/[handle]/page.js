import Link from "next/link";
import { generateDescription } from "../../lib/generateDescription";

async function getProduct(handle, storeDomain) {
  try {
    const res = await fetch(
      `https://${storeDomain}/products/${handle}.json`,
      { cache: "no-store" }
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
    const { store: storeDomain } = await searchParams;

  if (!handle || !storeDomain) {
    return <div className="min-h-screen bg-[#0a0a0a] text-zinc-50 flex items-center justify-center">Product not found.</div>;
  }

  const product = await getProduct(handle, storeDomain);

  if (!product) {
    return <div className="min-h-screen bg-[#0a0a0a] text-zinc-50 flex items-center justify-center">Product not found.</div>;
  }

  const images = Array.isArray(product.images)
    ? product.images.map((img) => img?.src).filter(Boolean)
    : [];

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const available = variants.some((v) => v?.available === true || v?.available === "true");
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

  const description = await generateDescription(productData);

  const productUrl = `https://${storeDomain}/products/${handle}`;
  const storeName = storeDomain.replace(".com", "").replace(".fr", "").replace(".net", "");

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-50 font-mono">
      <div className="mx-auto max-w-6xl px-6 py-16">
        
        {/* Back link */}
        <Link
          href="/feed"
          className="mb-12 block text-[13px] tracking-wide text-zinc-400 transition-colors hover:text-zinc-50"
        >
          ← Back to feed
        </Link>

        <div className="grid grid-cols-1 gap-16 lg:grid-cols-2">
          
          {/* Images */}
          <div className="space-y-4">
            {images.length > 0 ? (
              images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={product.title}
                  className="w-full rounded-2xl object-cover"
                />
              ))
            ) : (
              <div className="aspect-[4/5] rounded-2xl bg-zinc-900 flex items-center justify-center text-zinc-600 text-sm">
                No image
              </div>
            )}
          </div>

          {/* Product info */}
          <div className="lg:sticky lg:top-16 lg:self-start">
            
            {/* Title */}
            <h1
              className="text-[clamp(24px,3vw,36px)] font-medium leading-tight tracking-tight mb-4"
              style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
            >
              {product.title}
            </h1>

            {/* Price */}
            {price && (
              <p className="text-xl font-mono text-zinc-300 mb-8">
                {price}
              </p>
            )}

            {/* Editorial description */}
            {description && (
              <p className="text-sm leading-relaxed text-zinc-400 mb-10">
                {description}
              </p>
            )}

            {/* Sold indicator */}
            {available === false && (
  <p className="text-[11px] uppercase tracking-widest text-zinc-500 mb-6">
    Sold
  </p>
)}

            {/* Shop button */}
           <a 
            href={`${productUrl}?utm_source=depot`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block border border-zinc-700 px-6 py-3 text-[13px] tracking-wide text-zinc-300 transition-colors hover:border-zinc-400 hover:text-zinc-50 mb-8"
            >
              Shop at {storeDomain} →
            </a>

            {/* Store tag */}
            <p className="mt-8 text-[11px] uppercase tracking-widest text-zinc-600">
              {storeDomain}
            </p>

          </div>
        </div>
      </div>
    </div>
  );
}