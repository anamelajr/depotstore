"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import ProductCard from "../components/ProductCard";
import StoreFilterBar from "../components/StoreFilterBar";
import MobileFilterDrawer from "../components/MobileFilterDrawer";
import MobileSortSheet from "../components/MobileSortSheet";
import { SORT_OPTIONS } from "../components/MobileSortSheet";
import { ALL_STORES_VALUE } from "../lib/feed-utils";
import { STORES } from "../lib/stores";

const LOAD_SIZE = 30;

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

const SORT_MAP = { latest: "newest", price_asc: "price_asc", price_desc: "price_desc" };

const storeOptions = [
  { value: ALL_STORES_VALUE, label: "All Stores" },
  ...STORES.map((s) => ({ value: s.domain, label: s.storeName })),
];

export default function FeedClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // URL-derived filter state (no page in URL anymore)
  const searchQuery = searchParams.get("search") || "";
  const selectedStore = searchParams.get("store") || ALL_STORES_VALUE;
  const urlCategories = searchParams.getAll("category");
  const urlSort = searchParams.get("sort") || "latest";

  // Local state for instant UI feedback
  const [localCategories, setLocalCategories] = useState(urlCategories);
  const [localStore, setLocalStore] = useState(selectedStore);
  const [selectedSort, setSelectedSort] = useState(urlSort);
  const [inputValue, setInputValue] = useState(searchQuery);

  // Mobile UI state
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // Fetch state
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  // Load More: offset to fetch next batch from (null = idle)
  const [loadMoreOffset, setLoadMoreOffset] = useState(null);

  // Scroll restore refs
  const scrollRestoreY = useRef(null);
  const scrollRestorePending = useRef(false);
  // How many products to load on first fetch when restoring (null = normal LOAD_SIZE)
  const restoreCountRef = useRef(null);

  // On mount: check sessionStorage for back-navigation scroll restore.
  // Runs before the filter fetch effect so restoreCountRef is set in time.
  useEffect(() => {
    const savedScroll = sessionStorage.getItem("depot_feed_scroll");
    const savedCount = sessionStorage.getItem("depot_feed_count");
    if (savedScroll === null || savedCount === null) return;

    const count = parseInt(savedCount, 10);
    const y = parseInt(savedScroll, 10);
    if (count > 0) {
      scrollRestoreY.current = y;
      scrollRestorePending.current = true;
      restoreCountRef.current = Math.min(count, 100); // API caps limit at 100
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // After the restore batch is loaded and rendered, jump to the saved position.
  useEffect(() => {
    if (!scrollRestorePending.current || loading || products.length === 0) return;
    scrollRestorePending.current = false;
    const y = scrollRestoreY.current;
    scrollRestoreY.current = null;
    sessionStorage.removeItem("depot_feed_scroll");
    sessionStorage.removeItem("depot_feed_count");
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [loading, products]);

  // Scroll hide/show for mobile bar
  const [barVisible, setBarVisible] = useState(true);
  const lastScrollY = useRef(0);
  useEffect(() => {
    const handleScroll = () => {
      const current = window.scrollY;
      if (current < 60) {
        setBarVisible(true);
      } else if (current < lastScrollY.current) {
        setBarVisible(true);
      } else if (current > lastScrollY.current + 8) {
        setBarVisible(false);
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

  useEffect(() => { setLocalStore(selectedStore); }, [selectedStore]);
  useEffect(() => { setInputValue(searchQuery); }, [searchQuery]);
  useEffect(() => { setSelectedSort(urlSort); }, [urlSort]);

  // ── Filter key — changes whenever filters/sort/search change ──
  const categoriesKey = urlCategories.join(",");
  const filterKey = `${selectedStore}|${categoriesKey}|${searchQuery}|${urlSort}`;

  // ── Initial / reset fetch ──
  // Runs on mount and whenever filterKey changes.
  // On mount it respects restoreCountRef (set above) for back-nav restore.
  // On filter change it cancels any in-flight Load More and resets state.
  useEffect(() => {
    setLoadMoreOffset(null); // cancel any pending Load More for the old filter

    const limit = restoreCountRef.current !== null ? restoreCountRef.current : LOAD_SIZE;
    restoreCountRef.current = null; // consume

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    params.set("page", "1");
    params.set("limit", String(limit));
    if (selectedStore !== ALL_STORES_VALUE) params.set("store", selectedStore);
    if (categoriesKey) params.set("category", categoriesKey);
    if (searchQuery) params.set("search", searchQuery);
    if (urlSort && urlSort !== "latest") params.set("sort", SORT_MAP[urlSort] || "newest");

    fetch(`/api/products?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data) => {
        setProducts(data.products || []);
        setTotal(data.total ?? 0);
        setError(null);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError("Failed to load products.");
          setProducts([]);
          setTotal(0);
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load More fetch ──
  // Fetches the next LOAD_SIZE products at loadMoreOffset and appends them.
  // Aborted automatically when loadMoreOffset resets to null (filter change).
  useEffect(() => {
    if (loadMoreOffset === null) return;

    const controller = new AbortController();
    setLoadingMore(true);

    const page = Math.floor(loadMoreOffset / LOAD_SIZE) + 1;
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(LOAD_SIZE));
    if (selectedStore !== ALL_STORES_VALUE) params.set("store", selectedStore);
    if (categoriesKey) params.set("category", categoriesKey);
    if (searchQuery) params.set("search", searchQuery);
    if (urlSort && urlSort !== "latest") params.set("sort", SORT_MAP[urlSort] || "newest");

    fetch(`/api/products?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data) => {
        setProducts((prev) => [...prev, ...(data.products || [])]);
        setTotal(data.total ?? 0);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError("Failed to load products.");
        }
      })
      .finally(() => setLoadingMore(false));

    return () => controller.abort();
  }, [loadMoreOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── URL builders & handlers ──
  const buildFeedUrl = useCallback((updates) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    Object.entries(updates || {}).forEach(([k, v]) => {
      if (k === "category") {
        params.delete("category");
        if (Array.isArray(v)) v.forEach((cat) => params.append("category", cat));
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
    router.push(buildFeedUrl({ store: v }));
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
    if (localStore && localStore !== ALL_STORES_VALUE) params.set("store", localStore);
    if (inputValue.trim()) params.set("search", inputValue.trim());
    if (selectedSort !== "latest") params.set("sort", selectedSort);
    const q = params.toString();
    router.push(`/feed${q ? `?${q}` : ""}`);
  }, [inputValue, localStore, selectedSort, router]);

  const handleSortChange = useCallback((v) => {
    setSelectedSort(v);
    setSortOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    if (v === "latest") params.delete("sort");
    else params.set("sort", v);
    const q = params.toString();
    router.replace(`/feed${q ? `?${q}` : ""}`);
  }, [searchParams, router]);

  const handleLoadMore = useCallback(() => {
    setLoadMoreOffset(products.length);
  }, [products.length]);

  const activeFilterCount = localCategories.length + (localStore !== ALL_STORES_VALUE ? 1 : 0);
  const activeSortLabel = SORT_OPTIONS.find((o) => o.value === selectedSort)?.label ?? "Sort";
  const hasMore = !loading && products.length < total;

  return (
    <div className="min-h-screen font-mono antialiased overflow-x-hidden">
      <div className="min-h-screen bg-[#0a0a0a] text-zinc-50">

        {/* ── DESKTOP HEADER (md and above) ── */}
        <header className="sticky z-10 border-b border-zinc-800/70 bg-[#0a0a0a]/95 backdrop-blur hidden md:block" style={{ top: "var(--nav-height)", marginTop: "-24px" }}>
          <div className="mx-auto max-w-7xl space-y-3 px-4 pt-0 pb-4">
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
          </div>
        </header>

        {/* ── MOBILE: sticky Refine / Sort (below md) ── */}
        <header
          className="md:hidden sticky z-20 border-b border-zinc-800/60 bg-[#0a0a0a]/95 backdrop-blur transition-transform duration-300 ease-out"
          style={{
            top: 0,
            transform: barVisible ? "translateY(0)" : "translateY(-100%)",
          }}
        >
          <div className="flex w-full h-[44px]">
            <button
              type="button"
              onPointerDown={() => setFilterOpen(true)}
              className="flex h-full flex-1 items-center justify-center gap-2 border-r border-zinc-800/40 px-4 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-300 active:bg-zinc-900/80"
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
              className="flex h-full flex-1 items-center justify-center gap-2 px-4 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-300 active:bg-zinc-900/80"
            >
              {selectedSort !== "latest" ? activeSortLabel : "Sort"}
            </button>
          </div>
        </header>

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
          onSortChange={handleSortChange}
        />

        <main className="mx-auto max-w-7xl px-4 pb-24 pt-3 md:pt-32">
          {/* Mobile product count */}
          <div className="md:hidden px-0 pt-0 pb-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              {loading ? "Loading…" : `${total} ${total === 1 ? "product" : "products"}`}
            </p>
          </div>
          {loading ? (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950 p-6 text-sm text-zinc-300">
              Loading products…
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950 p-6 text-sm text-red-300">
              {error}
            </div>
          ) : products.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950 p-6 text-sm text-zinc-300">
              No products found.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-10 lg:grid-cols-3">
                {products.map((p) => (
                  <div
                    key={`${p.productUrl ?? "unknown"}-${p.name}`}
                    onClick={() => {
                      sessionStorage.setItem("depot_feed_scroll", String(window.scrollY));
                      sessionStorage.setItem("depot_feed_count", String(products.length));
                    }}
                  >
                    <ProductCard product={p} />
                  </div>
                ))}
              </div>
              <div className="flex flex-col items-center gap-4 pt-10">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                  {products.length.toLocaleString()} of {total.toLocaleString()} products
                </p>
                {hasMore && (
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="w-full border border-zinc-700 py-4 px-6 font-mono text-[11px] uppercase tracking-[0.3em] text-zinc-400 transition-all duration-200 hover:border-zinc-400 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed active:bg-zinc-900/40"
                  >
                    {loadingMore ? "—" : "Load More"}
                  </button>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
