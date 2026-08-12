import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import Image from "next/image";
import Link from "next/link";
import ProductCard from "../../components/ProductCard.js";
import T from "../../components/T.js";
import {
  CONTAINER,
  GROUND,
  HAIRLINE,
  HERO_GROUND,
  UTILITY_CAPS,
} from "../../components/home/tokens.js";
import { getArchiveBySlug, getLiveArchives } from "../../lib/archives.js";
import { fetchArchiveProducts } from "../../lib/fetchArchiveProducts.js";
import { getLanguage } from "../../lib/i18n/language.js";
import { t } from "../../lib/i18n/messages.js";

// Same cadence as the Shopify→Supabase sync, and the same reason as
// app/editorial/[slug]/page.js: without it, generateStaticParams would freeze
// inventory into the build artifact.
export const revalidate = 3600;

export function generateStaticParams() {
  return getLiveArchives().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const lang = await getLanguage();
  const archive = getArchiveBySlug(slug);
  if (!archive) return { title: t("meta.notFoundTitle", lang) };
  // Only the chrome suffix translates; the designer name, years and
  // description are content (app/lib/archives.js), English-only.
  return {
    title: `${archive.name} ${archive.years} · ${t("meta.archiveSuffix", lang)}`,
    description: archive.description.slice(0, 200),
  };
}

export default async function ArchivePage({ params }) {
  const { slug } = await params;
  // Inert band entries and garbage slugs alike resolve to undefined —
  // getArchiveBySlug only matches live archives.
  const archive = getArchiveBySlug(slug);
  if (!archive) notFound();

  // The root layout reads cookies() for the currency selector, which opts this
  // page into per-request rendering; caching the fetch keeps Supabase on the
  // hourly sync cadence instead of once per visitor. Explicit per-slug keyPart
  // alongside unstable_cache's own argument keying.
  const getCachedArchiveProducts = unstable_cache(
    fetchArchiveProducts,
    ["archive-products", slug],
    { revalidate: 3600 },
  );
  // Deliberately unguarded: fetchArchiveProducts throws rather than return
  // partial membership, and a thrown error is not cached — a swallowed one
  // would serve a wrong item count as authoritative for an hour.
  const products = await getCachedArchiveProducts(archive);

  return (
    <div
      className="min-h-screen overflow-x-clip font-mono antialiased text-zinc-950"
      style={{ backgroundColor: GROUND }}
    >
      {/* Hero band — copy left, portrait bleeding to the band's top, right and
          bottom. Literal bg class, not bg-[${HERO_GROUND}]: a dynamic value
          never reaches Tailwind's JIT scanner (see Hero.js). */}
      <section className="relative w-full bg-[#eceae4]">
        <div className="grid grid-cols-1 md:min-h-[400px] md:grid-cols-[55fr_45fr]">
          <div className="flex flex-col justify-center px-6 py-12 md:py-14 md:pl-[8.2vw] md:pr-14">
            <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              <T k="archive.eyebrow" />
            </span>

            <h1
              className="mt-5 text-[clamp(25px,2.3vw,33px)] font-light leading-[1.22] tracking-[0.05em] text-zinc-950"
              style={{ fontFamily: "var(--font-satoshi), sans-serif" }}
            >
              {archive.name}
              <br />
              {archive.years}
            </h1>

            <p className="mt-5 max-w-[44ch] text-[13px] leading-[1.65] text-zinc-600">
              {archive.description}
            </p>

            {archive.editorialSlug ? (
              <Link
                href={`/editorial/${archive.editorialSlug}`}
                className={`${UTILITY_CAPS} mt-8 flex w-fit items-center gap-3 transition-opacity hover:opacity-60`}
              >
                <T k="archive.viewStory" />
                <span aria-hidden="true" className="text-[15px] leading-none">
                  →
                </span>
              </Link>
            ) : null}
          </div>

          {/* Mobile mirrors home Hero's order: copy first, image below. */}
          <div className="relative aspect-[4/5] md:aspect-auto md:min-h-full">
            <Image
              src={archive.image}
              alt={archive.imageAlt}
              fill
              priority
              sizes="(max-width: 768px) 100vw, 45vw"
              className="object-cover"
            />
          </div>
        </div>
      </section>

      {/* Toolbar — count only. No FILTERS, no sort, no view toggle: an archive
          is a fixed, curated set, not a browsable feed. */}
      <div className="border-t" style={{ borderColor: HAIRLINE }}>
        <div className={`${CONTAINER} py-4`}>
          <span className={UTILITY_CAPS}>
            {products.length} <T k="archive.items" />
          </span>
        </div>
      </div>

      {/* Feed's grid conventions, at four columns — this page has no filter
          rail to make room for. Every member renders at once; the empty state
          is the "0 ITEMS" above. */}
      <div className={`${CONTAINER} pb-16 pt-2 md:pb-24`}>
        <div className="grid grid-cols-2 gap-10 lg:grid-cols-4 lg:gap-x-3.5 lg:gap-y-16">
          {products.map((p) => (
            <ProductCard
              key={`${p.storeDomain}::${p.handle}`}
              product={p}
              imageSizes="(min-width: 1024px) 25vw, 50vw"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
