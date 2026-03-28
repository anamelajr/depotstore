"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import ProductCard from "../components/ProductCard";
import StoreFilterBar from "../components/StoreFilterBar";
import MobileFilterDrawer from "../components/MobileFilterDrawer";
import MobileSortSheet from "../components/MobileSortSheet";
import { SORT_OPTIONS } from "../components/MobileSortSheet";
import {
  ALL_STORES_VALUE,
  PAGE_SIZE,
  normalizeText,
  classifyProduct,
} from "../lib/feed-utils";

const CATEGORY_LABELS = {
  tops: "Tops",
  tops_hoodies_sweaters: "Hoodies & Sweaters",
  tops_shirts_blouses: "Shirts & Blouses",
  tops_tees: "Tees",
  tops_knitwear: "Knitwear",
  bottoms: "Bottoms",
  dresses_skirts: "Dresses & Skirts",
  jackets_coats: "Jackets & Coats",
  jackets: "Jackets",
  coats: "Coats",
  footwear: "Footwear",
  bags_accessories: "Bags & Accessories",
  bags: "Bags",
  accessories: "Accessories",
  sets: "Sets",
};

export default function FeedClient({ products }) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const searchQuery = searchParams.get("search") || "";
  const selectedStore = searchParams.get("store") || ALL_STORES_VALUE;
  const selectedBrand = searchParams.get("brand") || null;
  const urlCategories = searchParams.getAll("category");
  const rawPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10));

  // Local state — updates instantly without waiting for router
  const [localCategories, setLocalCategories] = useState(urlCategories);
  const [localStore, setLocalStore] = useState(selectedStore);
  const [selectedSort, setSelectedSort] = useState("latest");
  const [inputValue, setInputValue] = useState(searchQuery);

  // Mobile UI state
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // Scroll hide/show for mobile bar
  const [barVisible, setBarVisible] = useState(true);
  const lastScrollY = useRef(0);
  useEffect(() => {
    const handleScroll = () => {
      const current = window.scrollY;
      if (current < 60) {
        setBarVisible(true);
      } else if (current < lastScrollY.current) {
        setBarVisible(true); // scrolling up
      } else if (current > lastScrollY.current + 8) {
        setBarVisible(false); // scrolling down
      }
      lastScrollY.current = current;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Sync local state when URL changes externally
  const prevUrlCatsRef = useRef(JSON.stringify(urlCategories));
  useEffect(() => {
    const next = JSON.stringify(urlCategories);
    if (next !== prevUrlCatsRef.current) {
      prevUrlCatsRef.current = next;
      setLocalCategories(urlCategories);
    }
  }, [searchParams]);

  useEffect(() => {
    if (urlCategories.length === 0 && localCategories.length > 0) {
      setLocalCategories([]);
    }
  }, [searchParams]);

  useEffect(() => {
    setLocalStore(selectedStore);
  }, [selectedStore]);

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
    const hasCategories = localCategories.length > 0;

    let results = products.filter((p) => {
      const classification = classifyProduct(p);
      if (localStore !== ALL_STORES_VALUE && p?.storeName !== localStore) return false;
      if (hasQuery && !normalizeText(p?.name ?? "").includes(q)) return false;
      if (hasBrand && !normalizeText(p?.name ?? "").includes(selectedBrandNorm)) return false;
      if (hasCategories && !localCategories.some((cat) => classification.categories.has(cat))) return false;
      return true;
    });

    // Sort
    const parsePrice = (val) => {
        if (!val) return 0;
        return parseFloat(String(val).replace(/[^0-9.]/g, "")) || 0;
      };
      
      if (selectedSort === "price_asc") {
        results = [...results].sort((a, b) => {
          if (!a.available && b.available) return 1;
          if (a.available && !b.available) return -1;
          return parsePrice(a.price) - parsePrice(b.price);
        });
      } else if (selectedSort === "price_desc") {
        results = [...results].sort((a, b) => {
          if (!a.available && b.available) return 1;
          if (a.available && !b.available) return -1;
          return parsePrice(b.price) - parsePrice(a.price);
        });
      }
    // "latest" = default order from API

    return results;
  }, [products, localStore, searchQuery, selectedBrand, localCategories, selectedSort]);

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
      if (k === "category") {
        params.delete("category");
        if (Array.isArray(v)) {
          v.forEach((cat) => params.append("category", cat));
        }
      } else {
        if (v == null || v === "" || v === ALL_STORES_VALUE) params.delete(k);
        else params.set(k, String(v));
      }
    });
    const q = params.toString();
    return `/feed${q ? `?${q}` : ""}`;
  }, [searchParams]);

  const handleStoreChange = useCallback((v) => {
    setLocalStore(v);
    router.push(buildFeedUrl({ store: v }, true));
  }, [router, buildFeedUrl]);

  const handleToggleCategory = useCallback((cat) => {
    const next = localCategories.includes(cat)
      ? localCategories.filter((c) => c !== cat)
      : [...localCategories, cat];
    setLocalCategories(next);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.delete("category");
    next.forEach((c) => params.append("category", c));
    const q = params.toString();
    router.replace(`/feed${q ? `?${q}` : ""}`);
  }, [localCategories, searchParams, router]);

  const handleClearAll = useCallback(() => {
    setLocalCategories([]);
    setLocalStore(ALL_STORES_VALUE);
    setFilterOpen(false);
    router.replace("/feed");
  }, [router]);

  const handleSearchSubmit = useCallback((e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (localStore && localStore !== ALL_STORES_VALUE) {
      params.set("store", localStore);
    }
    if (inputValue.trim()) {
      params.set("search", inputValue.trim());
    }
    const q = params.toString();
    router.push(`/feed${q ? `?${q}` : ""}`);
  }, [inputValue, localStore, router]);

  const activeFilterCount = localCategories.length + (localStore !== ALL_STORES_VALUE ? 1 : 0);
  const activeSortLabel = SORT_OPTIONS.find((o) => o.value === selectedSort)?.label ?? "Sort";

  return (
    <div className="min-h-screen font-mono antialiased overflow-x-hidden">
      <div className="min-h-screen bg-[#0a0a0a] text-zinc-50">

        {/* ── DESKTOP HEADER (md and above) ── */}
        <header className="sticky z-10 border-b border-zinc-800/70 bg-[#0a0a0a]/95 backdrop-blur hidden md:block" style={{ top: "var(--nav-height)", marginTop: "-24px" }}>
        <div className="mx-auto max-w-7xl space-y-2 px-4 pt-0 pb-2">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1 space-y-1">
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
                selectedValue={localStore}
                onChange={handleStoreChange}
              />
            </div>
            {localCategories.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  CATEGORY:
                </span>
                {localCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onPointerDown={() => handleToggleCategory(cat)}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-600 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-300 transition-colors hover:border-zinc-400 hover:text-zinc-50 whitespace-nowrap active:bg-zinc-800"
                  >
                    <span>{CATEGORY_LABELS[cat] ?? cat}</span>
                    <span className="text-zinc-400 leading-none text-[14px] pl-1">×</span>
                  </button>
                ))}
              </div>
            )}
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              SHOWING {paginatedProducts.length} OF {filteredProducts.length} PRODUCTS
            </p>
          </div>
        </header>

        {/* ── MOBILE: sticky Refine / Sort (below md) ── */}
        <header
          className="md:hidden sticky z-10 border-b border-zinc-800/60 bg-[#0a0a0a]/95 backdrop-blur transition-transform duration-300 ease-out"
          style={{
            top: "var(--nav-height)",
            transform: barVisible ? "translateY(0)" : "translateY(-100%)",
            marginTop: "-20px",
          }}
        >
          <div className="flex w-full">
            <button
              type="button"
              onPointerDown={() => setFilterOpen(true)}
              className="flex min-h-[52px] flex-1 items-center justify-center gap-2 border-r border-zinc-800/40 px-4 py-5 font-mono text-[12px] uppercase tracking-[0.2em] text-zinc-300 transition-colors active:bg-zinc-900/80"
            >
              Refine
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-zinc-50 px-2 py-0.5 font-mono text-[10px] leading-none text-zinc-950">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onPointerDown={() => setSortOpen(true)}
              className="flex min-h-[52px] flex-1 items-center justify-center gap-2 px-4 py-5 font-mono text-[12px] uppercase tracking-[0.2em] text-zinc-300 transition-colors active:bg-zinc-900/80"
            >
              {selectedSort !== "latest" ? activeSortLabel : "Sort"}
            </button>
          </div>
        </header>

        {/* Product count */}
        <div className="px-4 pb-2 pt-4 md:pt-2">
          <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">
            {filteredProducts.length} products
          </p>
        </div>

          

        {/* Mobile drawers */}
        <MobileFilterDrawer
          isOpen={filterOpen}
          onClose={() => setFilterOpen(false)}
          selectedCategories={localCategories}
          onToggleCategory={handleToggleCategory}
          selectedStore={localStore}
          storeOptions={storeOptions}
          onStoreChange={handleStoreChange}
          onClearAll={handleClearAll}
        />
        <MobileSortSheet
          isOpen={sortOpen}
          onClose={() => setSortOpen(false)}
          selectedSort={selectedSort}
          onSortChange={setSelectedSort}
        />

<main className="mx-auto max-w-7xl px-4 pb-24 pt-16 md:pt-32">
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