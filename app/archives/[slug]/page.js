import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import Image from "next/image";
import Link from "next/link";
import ArchiveProductsClient from "../../components/archive/ArchiveProductsClient.js";
import T from "../../components/T.js";
import { GROUND, UTILITY_CAPS } from "../../components/home/tokens.js";
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
    // v2: the payload gained category / subcategory / syncedAt for the
    // client-side filter and sort. Without the bump, an already-warm cache
    // would serve the old shape for up to an hour after deploy and every leaf
    // filter would silently match nothing.
    ["archive-products-v2", slug],
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
        {/* Three tracks on md+: copy | portrait | empty band ground. The
            trailing spacer pulls the figure off the right edge so it reads
            as central-right (~62% of the page), matching the reference. */}
        <div className="grid grid-cols-[11fr_9fr] md:min-h-[320px] md:grid-cols-[44fr_34fr_22fr]">
          <div className="flex flex-col justify-center px-6 py-8 md:py-10 md:pl-[4.5vw] md:pr-10">
            <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              <T k="archive.eyebrow" />
            </span>

            <h1
              className="mt-3 md:mt-6 text-[clamp(17px,5vw,20px)] md:text-[clamp(20px,1.95vw,30px)] font-light leading-[1.25] tracking-[0.06em] text-zinc-950"
              style={{ fontFamily: "var(--font-satoshi), sans-serif" }}
            >
              {archive.name}
              <br />
              {archive.years}
            </h1>

            <p className="mt-3 md:mt-5 max-w-[32ch] text-[11px] md:text-[12px] leading-[1.55] md:leading-[1.6] text-zinc-600">
              {archive.description}
            </p>

            {archive.editorialSlug ? (
              <Link
                href={`/editorial/${archive.editorialSlug}`}
                className={`${UTILITY_CAPS} mt-5 md:mt-8 flex w-fit items-center gap-3 transition-opacity hover:opacity-60`}
              >
                <T k="archive.viewStory" />
                <span aria-hidden="true" className="text-[15px] leading-none">
                  →
                </span>
              </Link>
            ) : null}
          </div>

          {/* The asset is a transparent-background cutout (see reference
              mockup): contained on the band ground and bottom-anchored, so its
              crop line reads as the figure bleeding off the band's bottom edge.
              On md+ the cutout bleeds the band's full height, top to bottom.

              On mobile the figure sits beside the copy rather than under it —
              a stacked full-width portrait pushed the first product ~770px down
              the page. No aspect ratio: the band's height is copy-driven with a
              floor, and the inner wrapper pushes the cutout past the viewport's
              right edge (clipped by the page's overflow-x-clip) so it reads as
              cropped rather than shrunk. md:inset-0 restores the exact desktop
              geometry. */}
          <div className="relative min-h-[220px] md:min-h-full">
            <div className="absolute inset-y-0 left-0 -right-[34%] md:inset-0">
              <Image
                src={archive.image}
                alt={archive.imageAlt}
                fill
                priority
                sizes="(max-width: 768px) 50vw, 34vw"
                className="object-contain object-right-bottom pt-6 md:object-bottom md:pt-0"
              />
            </div>
          </div>

          <div aria-hidden="true" className="hidden md:block" />
        </div>
      </section>

      {/* Count row, grid and the feed's floating FILTER/SORT bars. Client-side
          because the whole set is already here: filtering and sorting are
          in-memory, so this page stays a server component under ISR. */}
      <ArchiveProductsClient products={products} />
    </div>
  );
}
