"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import ProductCard from "../components/ProductCard";
import StoreFilterBar from "../components/StoreFilterBar";
import {
  ALL_STORES_VALUE,
  PAGE_SIZE,
  normalizeText,
  classifyProduct,
} from "../lib/feed-utils";

// Maps raw URL category keys to display labels
const CATEGORY_LABELS = {
  tops: "Tops",
  bottoms: "Bottoms",
  dresses_skirts: "Dresses & Skirts",
  jackets_coats: "Jackets & Coats",
  footwear: "Footwear",
  bags_accessories: "Bags & Accessories",
  sets: "Sets",
};

export default function FeedClient({ products }) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const searchQuery = searchParams.get("search") || "";
  const selectedStore = searchParams.get("store") || ALL_STORES_VALUE;
  const selectedBrand = searchParams.get("brand") || null;
  const selectedCategory = searchParams.get("category") || null;
  const rawPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10));

  // Controlled search input — local state stays in sync with URL
  const [inputValue, setInputValue] = useState(searchQuery);

  // Keep local input in sync if URL search param changes externally
  // (e.g. user clicks nav category which clears search)
  useEffect(() => {
    setInputValue(searchQuery);
  }, [searchQuery]);

  const [loading] = useState(false);
  const [error] = useState(null);

  const storeOptions = useMemo(() => {
    const stores = Array.from(new Set(products.map((p) => p?.storeName).filter(Boolean)));
    return [
      { value: ALL_STORES_VALUE, label: "All Stores" },
      ...stores.map((s) => ({ value: s, label: s })),
    ];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = normalizeText(searchQuery).trim();
    const hasQuery = q.length > 0;
    const hasBrand = typeof selectedBrand === "string" && selectedBrand.length > 0;
    const selectedBrandNorm = hasBrand ? normalizeText(selectedBrand) : null;

    return products.filter((p) => {
      const classification = classifyProduct(p);
      if (selectedStore !== ALL_STORES_VALUE && p?.storeName !== selectedStore) return false;
      if (hasQuery && !normalizeText(p?.name ?? "").includes(q)) return false;
      if (hasBrand && !normalizeText(p?.name ?? "").includes(selectedBrandNorm)) return false;
      if (selectedCategory && !classification.categories.has(selectedCategory)) return false;
      return true;
    });
  }, [products, selectedStore, searchQuery, selectedBrand, selectedCategory]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const currentPage = Math.min(rawPage, totalPages);
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredProducts.slice(start, start + PAGE_SIZE);
  }, [filteredProducts, currentPage]);

  const paginationItems = useMemo(() => {
    if (totalPages <= 1) return [];
    const pages = new Set([1, totalPages]);
    for (let p = currentPage - 2; p <= currentPage + 2; p++) {
      if (p >= 1 && p <= totalPages) pages.add(p);
    }
    const sorted = Array.from(pages).sort((a, b) => a - b);
    const items = [];
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const prev = sorted[i - 1];
      if (i > 0 && p - prev > 1) items.push("…");
      items.push(p);
    }
    return items;
  }, [currentPage, totalPages]);

  const buildFeedUrl = useCallback((updates, resetPage = false) => {
    const params = new URLSearchParams(searchParams.toString());
    if (resetPage) params.delete("page");
    Object.entries(updates || {}).forEach(([k, v]) => {
      if (v == null || v === "" || v === ALL_STORES_VALUE) params.delete(k);
      else params.set(k, String(v));
    });
    const q = params.toString();
    return `/feed${q ? `?${q}` : ""}`;
  }, [searchParams]);

  const handleStoreChange = useCallback((v) => {
    router.push(buildFeedUrl({ store: v }, true));
  }, [router, buildFeedUrl]);

  const handleClearCategory = useCallback(() => {
    router.push(buildFeedUrl({ category: null }, true));
  }, [router, buildFeedUrl]);

  // Controlled search submit
  const handleSearchSubmit = useCallback((e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (selectedStore && selectedStore !== ALL_STORES_VALUE) {
      params.set("store", selectedStore);
    }
    if (inputValue.trim()) {
      params.set("search", inputValue.trim());
    }
    // Intentionally drops brand and category — new search = fresh context
    const q = params.toString();
    router.push(`/feed${q ? `?${q}` : ""}`);
  }, [inputValue, selectedStore, router]);

  const categoryLabel = selectedCategory
    ? (CATEGORY_LABELS[selectedCategory] ?? selectedCategory)
    : null;

  return (
    <div className="min-h-screen font-mono antialiased">
      <div className="min-h-screen bg-[#0a0a0a] text-zinc-50">
        <header className="sticky z-10 -mt-[2px] border-b border-zinc-800/70 bg-[#0a0a0a]/95 backdrop-blur" style={{ top: "calc(var(--nav-height) - 1px)" }}>
          <div className="mx-auto max-w-7xl space-y-4 px-4 py-4">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1 space-y-3">
                <h1 className="font-serif text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl" style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}>
                  Dépôt
                </h1>
                <form onSubmit={handleSearchSubmit} className="block">
                  <input
                    name="search"
                    type="search"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Search..."
                    className="w-full border-none bg-transparent p-0 font-mono text-[11px] uppercase tracking-widest text-zinc-50 placeholder:text-zinc-500 outline-none"
                  />
                </form>
              </div>
              <Link
                href="/"
                className="shrink-0 font-mono text-[11px] uppercase tracking-widest text-zinc-50 transition-colors hover:text-zinc-300"
              >
                ← BACK TO HOME
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
              <StoreFilterBar
                options={storeOptions}
                selectedValue={selectedStore}
                onChange={handleStoreChange}
              />
            </div>

            {selectedCategory && (
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  CATEGORY:
                </span>
                <button
                  onClick={handleClearCategory}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-600 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-300 transition-colors hover:border-zinc-400 hover:text-zinc-50 whitespace-nowrap"
                >
                  <span>{categoryLabel}</span>
                  <span className="text-zinc-500 leading-none">×</span>
                </button>
              </div>
            )}

            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              SHOWING {paginatedProducts.length} OF {filteredProducts.length} PRODUCTS
            </p>
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
              No products found.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-10 lg:grid-cols-3">
                {paginatedProducts.map((p) => (
                  <ProductCard
                    key={`${p.productUrl ?? "unknown"}-${p.name}`}
                    product={p}
                  />
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex justify-center gap-3 pt-2">
                  <Link
                    href={currentPage <= 1 ? "#" : buildFeedUrl({ page: currentPage - 1 }, false)}
                    className={`font-mono text-xs uppercase tracking-widest transition-colors ${
                      currentPage <= 1 ? "cursor-not-allowed text-zinc-600" : "text-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    ←
                  </Link>
                  {paginationItems.map((item, idx) =>
                    item === "…" ? (
                      <span key={`ellipsis-${idx}`} className="font-mono text-xs uppercase tracking-widest text-zinc-600">…</span>
                    ) : (
                      <Link
                        key={item}
                        href={buildFeedUrl({ page: item }, false)}
                        className={`font-mono text-xs uppercase tracking-widest transition-colors ${
                          item === currentPage ? "text-zinc-50 underline decoration-zinc-700 underline-offset-4" : "text-zinc-500 hover:text-zinc-200"
                        }`}
                      >
                        {item}
                      </Link>
                    )
                  )}
                  <Link
                    href={currentPage >= totalPages ? "#" : buildFeedUrl({ page: currentPage + 1 }, false)}
                    className={`font-mono text-xs uppercase tracking-widest transition-colors ${
                      currentPage >= totalPages ? "cursor-not-allowed text-zinc-600" : "text-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    →
                  </Link>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}