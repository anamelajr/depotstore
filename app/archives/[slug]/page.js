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
      {/* Hero band — ink ground matching the footer's #121212 (literal bg
          class: a dynamic value never reaches Tailwind's JIT scanner, see
          Hero.js). Desktop pairs the copy column with a grayscale portrait
          fading into the ink; mobile drops the portrait entirely and lets the
          typography carry a compact band. Geometry transcribed from the
          approved canvas artboards (Option C, desktop + mobile). */}
      <section className="relative w-full bg-[#121212] text-white">
        <div className="mx-auto grid w-full max-w-[1210px] grid-cols-1 px-6 md:min-h-[600px] md:grid-cols-[minmax(0,57fr)_43fr]">
          <div className="flex flex-col items-start justify-center pb-10 pt-11 md:py-12 md:pr-16">
            <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">
              <T k="archive.eyebrow" />
            </span>

            <h1 className="mt-[18px] text-[34px] font-medium uppercase leading-[1.1] tracking-[0.04em] text-white md:mt-7 md:text-[72px] md:font-bold md:leading-[1.04] md:tracking-[0.01em]">
              {archive.name}
            </h1>

            {/* House + years pairs: one line on desktop, one pair per line on
                mobile. Falls back to the bare year ranges for archives without
                a tenureLine. */}
            <div
              className="mt-3.5 text-[9px] uppercase tracking-[0.15em] text-white md:mt-6 md:text-[11px]"
              style={{ fontFamily: "var(--font-satoshi), sans-serif" }}
            >
              {(archive.tenureLine ?? archive.years).split(" · ").map((part, i) => (
                <span key={part} className="block md:inline">
                  {i === 0 ? null : (
                    <span aria-hidden="true" className="hidden md:inline">
                      {"  ·  "}
                    </span>
                  )}
                  {part}
                </span>
              ))}
            </div>

            <div aria-hidden="true" className="mt-5 h-px w-12 bg-[#262626] md:mt-7 md:w-14" />

            <p
              className="mt-5 max-w-[34ch] text-[12px] font-light leading-[1.65] text-[#F7F7FB] md:mt-7 md:max-w-[40ch] md:leading-[1.7]"
              style={{ fontFamily: "var(--font-satoshi), sans-serif" }}
            >
              {archive.description}
            </p>

            {archive.editorialSlug ? (
              <Link
                href={`/editorial/${archive.editorialSlug}`}
                className={`${UTILITY_CAPS} mt-7 flex w-fit items-center gap-3 !text-white transition-opacity hover:opacity-60 md:mt-9`}
              >
                <T k="archive.viewStory" />
                <span aria-hidden="true" className="text-[15px] leading-none">
                  →
                </span>
              </Link>
            ) : null}
          </div>

          {/* Portrait column, md+ only. The transparent cutout is grayscaled,
              bottom-anchored just shy of the band's full height, and a gradient
              dissolves its base into the ink so the crop line never shows. */}
          <div className="relative hidden md:block">
            <div className="absolute inset-x-0 bottom-0 top-[6.5%]">
              <Image
                src={archive.image}
                alt={archive.imageAlt}
                fill
                priority
                sizes="(max-width: 768px) 0px, 43vw"
                className="object-contain object-right-bottom [filter:grayscale(1)_brightness(0.92)_contrast(1.08)]"
              />
            </div>
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#121212] from-[8%] to-transparent"
            />
          </div>
        </div>
      </section>

      {/* Count row, grid and the feed's floating FILTER/SORT bars. Client-side
          because the whole set is already here: filtering and sorting are
          in-memory, so this page stays a server component under ISR. */}
      <ArchiveProductsClient products={products} />
    </div>
  );
}
