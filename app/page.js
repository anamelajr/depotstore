import Link from "next/link";
import ProductCard from "./components/ProductCard";
import ParisMap from "./components/ParisMap";
import T from "./components/T";
import HeroSearchInput from "./components/HeroSearchInput";
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
    <div className="min-h-screen font-mono antialiased">
      {/* Hero */}
      <section className="relative flex min-h-screen flex-col bg-[#f5f2ed] text-zinc-950">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 pt-8">
          <div className="max-w-4xl">
            <div className="text-[clamp(60px,10vw,132px)] font-medium uppercase leading-[0.9] tracking-tight">
              DÉPÔT
            </div>
            <div className="mt-6 max-w-2xl text-sm leading-6 text-zinc-800">
              <T k="home.tagline" />
            </div>
          </div>
          <div className="mt-16 max-w-3xl">
            <form action="/feed" method="GET" className="w-full">
              <HeroSearchInput />
            </form>
          </div>
        </div>
        <div className="mx-auto w-full max-w-7xl px-4 pb-12">
          <Link
            href="/feed"
            replace
            className="flex w-fit items-center gap-2 font-mono text-sm text-zinc-900/80 transition-colors hover:text-zinc-900"
          >
            <span className="underline decoration-zinc-800 underline-offset-4">
              <T k="home.browseAll" />
            </span>
            <span aria-hidden="true" className="text-lg leading-none">→</span>
          </Link>
        </div>
      </section>

      {/* Today's Edit */}
      <section className="bg-white py-24 text-zinc-950">
        <div className="mx-auto max-w-7xl px-4">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                <T k="home.selectionLabel" />
              </p>
              <h2
                className="text-[clamp(28px,4vw,40px)] font-normal leading-tight tracking-tight"
                style={{ fontFamily: "var(--font-general-sans), sans-serif" }}
              >
                <T k="home.todaysEdit" />
              </h2>
            </div>
            <Link
              href="/feed"
              replace
              className="font-mono text-sm text-zinc-500 transition-colors hover:text-zinc-950"
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
      <section className="border-t border-zinc-200 bg-white py-24 text-zinc-950">
        <div className="mx-auto max-w-7xl px-4">
          <div className="mb-12">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
              <T k="home.geographyLabel" />
            </p>
            <h2
              className="text-[clamp(28px,4vw,40px)] font-normal leading-tight tracking-tight"
              style={{ fontFamily: "var(--font-general-sans), sans-serif" }}
            >
              <T k="home.acrossParis" />
            </h2>
          </div>
          <ParisMap stores={stores} />
        </div>
      </section>

    </div>
  );
}