import Link from "next/link";
import ProductCard from "./components/ProductCard";
import NewsletterForm from "./components/NewsletterForm";
import ParisMap from "./components/ParisMap";

export const dynamic = 'force-dynamic';

export default async function Home() {
  let products = [];
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/products`, { next: { revalidate: 3600 } });
    if (res.ok) {
      const data = await res.json();
      products = data.products ?? [];
    }
  } catch {
    // ignore
  }
  const seed = Math.floor(Date.now() / 86400000); // changes once per day
const shuffled = [...products].sort((a, b) => {
  const hashA = ((a.productUrl ?? "").split("").reduce((acc, c) => acc + c.charCodeAt(0), seed)) % 1000;
  const hashB = ((b.productUrl ?? "").split("").reduce((acc, c) => acc + c.charCodeAt(0), seed)) % 1000;
  return hashA - hashB;
});
const storesSeen = {};
const recentProducts = shuffled.filter(p => {
  if (!p.available) return false;
  if (storesSeen[p.storeName]) return false;
  storesSeen[p.storeName] = true;
  return true;
}).slice(0, 8);

  return (
    <div className="min-h-screen font-mono antialiased">
      {/* Hero */}
      <section className="relative flex min-h-screen flex-col bg-[#f5f2ed] text-zinc-950">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 pt-8">
          <div className="max-w-4xl">
            <div className="text-[clamp(60px,10vw,132px)] font-bold uppercase leading-[0.9] tracking-tight">
              DÉPÔT
            </div>
            <div className="mt-6 max-w-2xl text-sm leading-6 text-zinc-800">
              Paris. Archive. One feed.
            </div>
          </div>
          <div className="mt-16 max-w-3xl">
            <form action="/feed" method="GET" className="w-full">
              <label htmlFor="hero-search" className="sr-only">
                Search products
              </label>
              <input
                id="hero-search"
                name="search"
                type="search"
                placeholder="Search name, brand, keyword…"
                className="w-full rounded-none border-b border-zinc-300 bg-transparent py-4 font-mono text-lg text-zinc-950 placeholder:text-zinc-400 outline-none focus:border-zinc-800"
              />
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
              Browse all
            </span>
            <span aria-hidden="true" className="text-lg leading-none">→</span>
          </Link>
        </div>
      </section>

      {/* Today's Edit */}
      <section className="bg-[#0a0a0a] py-24 text-zinc-50">
        <div className="mx-auto max-w-7xl px-4">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                Selection
              </p>
              <h2
                className="text-[clamp(28px,4vw,40px)] font-medium leading-tight tracking-tight"
                style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
              >
                Today&apos;s Edit
              </h2>
            </div>
            <Link
              href="/feed"
              replace
              className="font-mono text-sm text-zinc-400 transition-colors hover:text-zinc-50"
            >
              View All →
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
      <section className="border-t border-zinc-800 bg-[#0a0a0a] py-24 text-zinc-50">
        <div className="mx-auto max-w-7xl px-4">
          <div className="mb-12">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
              Geography
            </p>
            <h2
              className="text-[clamp(28px,4vw,40px)] font-medium leading-tight tracking-tight"
              style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
            >
              Across Paris
            </h2>
          </div>
          <ParisMap products={products} />
        </div>
      </section>

      {/* Footer / Newsletter */}
      <footer className="border-t border-zinc-800 bg-[#0a0a0a] py-24 text-zinc-50">
        <div className="mx-auto max-w-4xl px-6">
          <div className="flex flex-col items-start gap-12 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[clamp(32px,5vw,56px)] font-bold uppercase leading-none tracking-tight">
                DÉPÔT
              </p>
              <p className="mt-3 text-[13px] text-zinc-500">
                Paris. Archive. One feed.
              </p>
            </div>
            <div className="w-full max-w-sm">
              <NewsletterForm />
            </div>
          </div>
          <div className="mt-16 border-t border-zinc-800 pt-8 flex flex-col gap-2 md:flex-row md:justify-between text-[11px] text-zinc-600 uppercase tracking-widest">
            <span>© 2026 Dépôt</span>
            <span>Paris</span>
          </div>
        </div>
      </footer>
    </div>
  );
}