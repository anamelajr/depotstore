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
  HAIRLINE,
  SECTION_LABEL,
  UTILITY_CAPS,
} from "./components/home/tokens";
import { fetchHomepagePicks } from "./editorial/_lib/fetchHomepagePicks.js";
import { loadHomepagePicks } from "./lib/loadHomepagePicks.js";

export const dynamic = 'force-dynamic';

export default async function Home() {
  let recentProducts = [];
  let stores = [];
try {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const { getActiveStores } = await import("./lib/stores.js");
  stores = await getActiveStores();
  const STORES = stores;

  const homepagePicks = await loadHomepagePicks();
  if (homepagePicks.length > 0) {
    try {
      recentProducts = await fetchHomepagePicks(homepagePicks);
    } catch (err) {
      console.warn("[homepage] fetchHomepagePicks failed, falling back:", err.message);
    }
  }

  if (recentProducts.length === 0) {
    // Existing date-seeded rotation — preserves current behavior when
    // no picks have been curated OR when the picks file is unreadable.
    const seed = Math.floor(Date.now() / 86400000);
    const perStore = await Promise.all(
      STORES.map(async (store) => {
        const res = await fetch(
          `${baseUrl}/api/products?limit=20&store=${store.domain}&sort=newest`,
          { next: { revalidate: 3600 } }
        );
        if (!res.ok) return [];
        const data = await res.json().catch(() => ({}));
        const products = data.products ?? [];
        if (products.length === 0) return [];
        // Pick one product per store using daily seed
        const idx = seed % products.length;
        return [products[idx]];
      })
    );
    recentProducts = perStore.flat().filter(Boolean).slice(0, 8);
  }
} catch {
  // ignore
}


  return (
    <div
      className="min-h-screen overflow-x-clip font-mono antialiased text-zinc-950"
      style={{ backgroundColor: GROUND }}
    >
      <Hero />

      <SearchBrowseRow />

      <FeaturedArchives />

      {/* Curated Selection — presentation only; the data flow above is unchanged. */}
      <section className="border-b py-16" style={{ borderColor: HAIRLINE }}>
        <div className={CONTAINER}>
          <div className="mb-10 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
            <h2 className={`${SECTION_LABEL}`}>
              <T k="home.todaysCuration" />
            </h2>
            <Link
              href="/feed"
              replace
              className={`${UTILITY_CAPS} transition-opacity hover:opacity-60`}
            >
              <T k="home.viewAll" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4">
            {recentProducts.map((p) => (
              <ProductCard
                key={`${p.productUrl ?? "unknown"}-${p.name}`}
                product={p}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Across Paris */}
      <section className="py-16">
        <div className={CONTAINER}>
          <h2 className={`${SECTION_LABEL} mb-10`}>
            <T k="home.acrossParis" />
          </h2>
          <ParisMap stores={stores} />
        </div>
      </section>

    </div>
  );
}
