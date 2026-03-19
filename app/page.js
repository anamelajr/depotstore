"use client";

import { useEffect, useMemo, useState } from "react";
import ProductCard from "./components/ProductCard";
import StoreFilterBar from "./components/StoreFilterBar";
import BRANDS from "./brands";

const ALL_STORES_VALUE = "ALL";
const PAGE_SIZE = 40;

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractBrandTags(title) {
  const t = normalizeText(title);
  const matches = [];

  for (const brand of BRANDS) {
    const nb = normalizeText(brand);
    if (!nb) continue;
    if (t.includes(nb)) matches.push(brand);
  }

  // De-dupe while keeping first occurrence order.
  return Array.from(new Set(matches));
}

export default function Home() {
  const [products, setProducts] = useState([]);
  const [selectedStore, setSelectedStore] = useState(ALL_STORES_VALUE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBrand, setSelectedBrand] = useState(null);
  const [isUnlocked, setIsUnlocked] = useState(false);

  const unlockAndScroll = () => {
    setIsUnlocked(true);
    // Use a small timeout to ensure the overflow:hidden is removed before scrolling
    setTimeout(() => {
      document.getElementById("feed")?.scrollIntoView({ behavior: "smooth" });
    }, 10);
  };

  useEffect(() => {
    let cancelled = false;

    async function loadProducts() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/products");
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status} ${res.statusText}`);
        }

        const data = await res.json();
        if (!cancelled) setProducts(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e?.message ?? "Failed to load products");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProducts();
    return () => {
      cancelled = true;
    };
  }, []);

  const storeOptions = useMemo(() => {
    const stores = Array.from(
      new Set(products.map((p) => p?.storeName).filter(Boolean))
    );

    return [
      { value: ALL_STORES_VALUE, label: "All Stores" },
      ...stores.map((s) => ({ value: s, label: s })),
    ];
  }, [products]);

  // Extract brands from all inventory (not affected by store selection).
  const brandOptions = useMemo(() => {
    const counts = new Map(); // brand -> match count across the current inventory

    for (const p of products) {
      const title = p?.name ?? "";
      const brandsInTitle = extractBrandTags(title);
      for (const b of brandsInTitle) {
        counts.set(b, (counts.get(b) ?? 0) + 1);
      }
    }

    // Only show brands that actually match at least one product title.
    // Keep the curated list order as a baseline, then fall back to count.
    return BRANDS.filter((b) => counts.has(b)).sort((a, b) => {
      const ca = counts.get(a) ?? 0;
      const cb = counts.get(b) ?? 0;
      return cb - ca || a.localeCompare(b);
    });
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = normalizeText(searchQuery).trim();
    const hasQuery = q.length > 0;
    const hasBrand = typeof selectedBrand === "string" && selectedBrand.length > 0;
    const selectedBrandNorm = hasBrand ? normalizeText(selectedBrand) : null;

    return products.filter((p) => {
      if (selectedStore !== ALL_STORES_VALUE) {
        if (p?.storeName !== selectedStore) return false;
      }

      if (hasQuery) {
        const titleNorm = normalizeText(p?.name ?? "");
        if (!titleNorm.includes(q)) return false;
      }

      if (hasBrand) {
        const titleNorm = normalizeText(p?.name ?? "");
        if (!titleNorm.includes(selectedBrandNorm)) return false;
      }

      return true;
    });
  }, [products, selectedStore, searchQuery, selectedBrand]);

  // Reset pagination any time the backing dataset or store changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [selectedStore, products, searchQuery, selectedBrand]);

  const paginatedProducts = useMemo(() => {
    return filteredProducts.slice(0, visibleCount);
  }, [filteredProducts, visibleCount]);

  return (
    <div
      className={[
        "min-h-screen font-mono antialiased",
        !isUnlocked ? "h-screen overflow-hidden" : "",
      ].join(" ")}
    >
      <section className="relative flex min-h-screen flex-col bg-[#f5f2ed] text-zinc-950">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 pt-12">
          <div className="max-w-4xl">
            <div className="text-[clamp(60px,10vw,132px)] font-bold uppercase leading-[0.9] tracking-tight">
              DÉPÔT
            </div>
            <div className="mt-6 max-w-2xl text-sm leading-6 text-zinc-800">
              Paris. Archive. One feed.
            </div>
          </div>

          <div className="mt-16 max-w-3xl">
            <div className="">
              <label htmlFor="hero-search" className="sr-only">
                Search products
              </label>
              <input
                id="hero-search"
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!isUnlocked) unlockAndScroll();
                }}
                placeholder="Search name, brand, keyword…"
                className="w-full rounded-none border-b border-zinc-300 bg-transparent py-4 text-lg text-zinc-950 placeholder:text-zinc-400 outline-none focus:border-zinc-800"
              />
            </div>

            {brandOptions.length > 0 ? (
              <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
                {brandOptions.slice(0, 12).map((brand) => {
                  const active = brand === selectedBrand;
                  return (
                    <button
                      key={brand}
                      type="button"
                      onClick={() => {
                        setSelectedBrand((current) =>
                          current === brand ? null : brand
                        );
                        if (!isUnlocked) unlockAndScroll();
                      }}
                      aria-pressed={active}
                      className={[
                        "text-[11px] font-mono uppercase tracking-widest transition-colors",
                        active
                          ? "text-zinc-950 underline decoration-zinc-800 underline-offset-4"
                          : "text-zinc-500 hover:text-zinc-900",
                      ].join(" ")}
                    >
                      {brand}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-8">
              <StoreFilterBar
                variant="light"
                options={storeOptions}
                selectedValue={selectedStore}
                onChange={setSelectedStore}
                onInteraction={() => {
                  if (!isUnlocked) unlockAndScroll();
                }}
              />
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-7xl px-4 pb-12">
          <button
            type="button"
            onClick={unlockAndScroll}
            className="flex w-fit items-center gap-2 text-sm text-zinc-900/80 transition-colors hover:text-zinc-900"
          >
            <span className="underline decoration-zinc-800 underline-offset-4">
              Browse
            </span>
            <span aria-hidden="true" className="text-lg leading-none">
              ↓
            </span>
          </button>
        </div>
      </section>

      <div id="feed" className="min-h-screen bg-[#0a0a0a] text-zinc-50">
        <header className="sticky top-0 z-10 border-b border-zinc-800/70 bg-[#0a0a0a]/85 backdrop-blur">
          <div className="mx-auto max-w-7xl px-4 py-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-sans text-[20px] font-medium tracking-tight">
                  Dépôt
                </h2>
              </div>

              <div className="flex items-center gap-8">
                <button
                  type="button"
                  onClick={() => {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-200"
                >
                  Back to top ↑
                </button>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-zinc-800/50 pt-6">
              <div className="flex-1 min-w-[240px]">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter grid..."
                  className="w-full border-none bg-transparent p-0 text-sm text-zinc-50 placeholder:text-zinc-600 outline-none"
                />
              </div>

              <StoreFilterBar
                options={storeOptions}
                selectedValue={selectedStore}
                onChange={setSelectedStore}
              />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 pb-24 pt-12">
          {loading ? (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950 p-6 text-sm text-zinc-300">
              Loading products…
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950 p-6 text-sm text-red-300">
              {error}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950 p-6 text-sm text-zinc-300">
              No products found for this store.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-3">
                {paginatedProducts.map((p) => (
                  <ProductCard
                    key={`${p.productUrl ?? "unknown"}-${p.name}`}
                    product={p}
                  />
                ))}
              </div>

              {visibleCount < filteredProducts.length ? (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                    className="rounded-full px-3 py-2 text-sm text-zinc-50/90 underline decoration-zinc-800 underline-offset-4 transition hover:text-zinc-50 hover:decoration-zinc-500"
                  >
                    Load more{" "}
                    <span className="text-zinc-400">
                      ({Math.min(
                        PAGE_SIZE,
                        filteredProducts.length - visibleCount
                      )}{" "}
                      more)
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
