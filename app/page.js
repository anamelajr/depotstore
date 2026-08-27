import Link from "next/link";
import ProductCard from "./components/ProductCard";
import ParisMap from "./components/ParisMap";
import T from "./components/T";
import Hero from "./components/home/Hero";
import SearchBrowseRow from "./components/home/SearchBrowseRow";
import FeaturedArchives from "./components/home/FeaturedArchives";
import {
  CONTAINER,
  GROUND,
  SECTION_LABEL,
  UTILITY_CAPS,
} from "./components/home/tokens";
import { fetchCachedHomepagePicks } from "./editorial/_lib/fetchHomepagePicks.js";
import { loadHomepagePicks } from "./lib/loadHomepagePicks.js";
import { fetchCachedDailyRotation } from "./lib/fetchDailyRotation.js";
import { getActiveStores } from "./lib/stores.js";
import { withTimeout } from "./lib/withTimeout.js";
import { Suspense } from "react";

export const dynamic = 'force-dynamic';


// Two async sections instead of one sequential await chain in the page body.
// Each is Suspense-wrapped, so Hero / SearchBrowseRow / FeaturedArchives —
// none of which need data — stream immediately instead of waiting behind a
// Supabase round-trip.
async function loadCuratedProducts() {
  // The real parallelization win: the store list and the curated picks file
  // are independent, and used to run strictly one after the other.
  const [stores, homepagePicks] = await Promise.all([
    getActiveStores(),
    // Deliberately still the fs-reading loader, never a static import of
    // homepage-edit.json — a syntax error in that file must degrade to the
    // rotation below, not crash the homepage.
    loadHomepagePicks(),
  ]);

  if (homepagePicks.length > 0) {
    try {
      const picked = await fetchCachedHomepagePicks(homepagePicks);
      if (picked.length > 0) return picked;
    } catch (err) {
      console.warn("[homepage] fetchHomepagePicks failed, falling back:", err.message);
    }
  }

  // Date-seeded rotation — preserves current behavior when no picks have
  // been curated OR when the picks file is unreadable. Reads Supabase
  // directly (see fetchDailyRotation.js) instead of fanning out one
  // self-HTTP call per store to this site's own /api/products.
  const seed = Math.floor(Date.now() / 86400000);
  return fetchCachedDailyRotation({
    storeDomains: stores.map((s) => s.domain),
    seed,
  });
}

async function CuratedSection() {
  let recentProducts = [];
  try {
    recentProducts = await withTimeout(() => loadCuratedProducts());
  } catch {
    // Empty row — the page body's previous catch-all behavior, unchanged.
  }

  return (
    <div className="-mx-6 flex gap-4 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:grid md:grid-cols-3 md:gap-6 md:overflow-visible md:px-0 lg:grid-cols-4">
      {recentProducts.map((p) => (
        <div
          key={`${p.productUrl ?? "unknown"}-${p.name}`}
          className="w-[45vw] max-w-[220px] shrink-0 md:w-auto md:max-w-none"
        >
          {/* Row is a 45vw swipe rail on mobile, 3-up from md, 4-up
              from lg — without this the srcSet has no basis to pick a
              candidate and falls back to 100vw. */}
          <ProductCard
            product={p}
            imageSizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 45vw"
          />
        </div>
      ))}
    </div>
  );
}

// Same getActiveStores call as CuratedSection's — React.cache dedupes it
// within the request, so the two sections cost one round-trip between them.
async function AcrossParis() {
  let stores = [];
  try {
    stores = await withTimeout(() => getActiveStores());
  } catch {
    // Map with no pins beats no map: the section keeps its height either way.
  }
  return <ParisMap stores={stores} />;
}

// Matches ParisMap's own 480px box and its #f4f4f5 ground exactly, so
// streaming the map in swaps one grey rectangle for another — no shift.
function MapPlaceholder() {
  return <div style={{ height: "480px", width: "100%", background: "#f4f4f5" }} />;
}

export default async function Home() {
  return (
    <div
      className="min-h-screen overflow-x-clip font-mono antialiased text-zinc-950"
      style={{ backgroundColor: GROUND }}
    >
      <Hero />

      <SearchBrowseRow />

      <FeaturedArchives />

      {/* Curated Selection — presentation only; the data flow above is unchanged. */}
      {/* No hairline below — the Curated/Across Paris seam reads through
          spacing alone; Across Paris' tightened top keeps the gap balanced. */}
      <section className="py-10 md:py-16">
        <div className={CONTAINER}>
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3 md:mb-10">
            <h2 className={`${SECTION_LABEL}`}>
              <T k="home.todaysCuration" />
            </h2>
            <Link
              href="/feed"
              replace
              // Full route+data prefetch (not just to loading.js). Cheap
              // because the default feed page is now server-cached; the router
              // dedupes the three identical /feed prefetches on this page.
              prefetch={true}
              className={`${UTILITY_CAPS} transition-opacity hover:opacity-60`}
            >
              <T k="home.viewAll" />
            </Link>
          </div>
          {/* One DOM for both breakpoints — a horizontal swipe row on mobile,
              the untouched grid from md up. Dual blocks would double-render
              eight ProductCards and their images. */}
          {/* Reserves the row's height (4:5 card + its text block) so the
              map section below doesn't jump when the products stream in. */}
          <Suspense
            fallback={
              <div className="h-[calc(45vw*1.25+72px)] max-h-[347px] w-full md:h-[380px]" />
            }
          >
            <CuratedSection />
          </Suspense>
        </div>
      </section>

      {/* Across Paris */}
      <section className="pb-10 pt-2 md:pb-16 md:pt-4">
        <div className={CONTAINER}>
          <h2 className={`${SECTION_LABEL} mb-6 md:mb-10`}>
            <T k="home.acrossParis" />
          </h2>
          <Suspense fallback={<MapPlaceholder />}>
            <AcrossParis />
          </Suspense>
        </div>
      </section>

    </div>
  );
}
