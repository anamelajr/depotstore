"use client";

import { useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ProductCard from "../components/ProductCard";
import MobileFilterDrawer from "../components/MobileFilterDrawer";
import MobileSortSheet from "../components/MobileSortSheet";
import MobileSortPanel from "../components/MobileSortPanel";
import DesktopFeedBar from "../components/feed/DesktopFeedBar";
import DesktopSortMenu from "../components/feed/DesktopSortMenu";
import DesktopFilterPanel from "../components/feed/DesktopFilterPanel";
import FilterChip from "../components/feed/FilterChip";
import MobileSearchStrip from "../components/MobileSearchStrip";
import MobileFeedActionBar from "../components/MobileFeedActionBar";
import MobileFilterPanel from "../components/MobileFilterPanel";
import { ALL_STORES_VALUE, buildFeedUrl } from "../lib/feed-utils";
import { SORT_OPTIONS, SORT_MAP } from "../lib/sort-options";

const LOAD_SIZE = 30;

export default function FeedClient({ stores = [] }) {
  const storeOptions = [
    { value: ALL_STORES_VALUE, label: "All Stores" },
    ...stores.map((s) => ({ value: s.domain, label: s.storeName })),
  ];
  const searchParams = useSearchParams();
  const router = useRouter();

  // URL-derived filter state (no page in URL anymore)
  const searchQuery = searchParams.get("search") || "";
  const selectedStore = searchParams.get("store") || ALL_STORES_VALUE;
  const urlCategories = searchParams.getAll("category");
  const urlSort = searchParams.get("sort") || "interleaved";
  const selectedBrand = searchParams.get("brand") || "";

  // Local state for instant UI feedback
  const [localCategories, setLocalCategories] = useState(urlCategories);
  const [localStore, setLocalStore] = useState(selectedStore);
  const [selectedSort, setSelectedSort] = useState(urlSort);

  // Mobile UI state
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // Desktop UI state (≥ md)
  const [desktopFilterOpen, setDesktopFilterOpen] = useState(false);
  const [desktopSortOpen, setDesktopSortOpen] = useState(false);

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
    const savedKey = sessionStorage.getItem("depot_feed_filter_key");
    if (savedScroll === null || savedCount === null) return;

    // Only restore if the current feed state matches the saved state
    if (savedKey !== null && savedKey !== filterKey) {
      sessionStorage.removeItem("depot_feed_scroll");
      sessionStorage.removeItem("depot_feed_count");
      sessionStorage.removeItem("depot_feed_filter_key");
      sessionStorage.removeItem("depot_feed_url");
      return;
    }

    const count = parseInt(savedCount, 10);
    const y = parseInt(savedScroll, 10);
    if (count > 0) {
      scrollRestoreY.current = y;
      scrollRestorePending.current = true;
      restoreCountRef.current = count;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // After the restore batch is loaded, jump to the saved position before paint.
  // useLayoutEffect fires synchronously after DOM mutations and before the browser
  // paints, so the grid is never visible at scroll=0 — no flash, no snap.
  useLayoutEffect(() => {
    if (!scrollRestorePending.current || loading || products.length === 0) return;
    scrollRestorePending.current = false;
    const y = scrollRestoreY.current;
    scrollRestoreY.current = null;
    sessionStorage.removeItem("depot_feed_scroll");
    sessionStorage.removeItem("depot_feed_count");
    sessionStorage.removeItem("depot_feed_filter_key");
    sessionStorage.removeItem("depot_feed_url");
    window.scrollTo(0, y);
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

  // Close ALL filter/sort UI on either breakpoint crossing.
  //
  // Desktop → mobile: closes the desktop panel + sort dropdown so a stuck
  // body { overflow: hidden } can't happen.
  //
  // Mobile → desktop: closes the mobile drawer/sheet so they can't persist
  // mounted at z-9998/9999 over the new desktop layout (they're not gated by
  // a Tailwind breakpoint; their visibility is purely state-driven). Without
  // this, a tablet user opening Refine in portrait and rotating to landscape
  // would see the mobile drawer pinned over the desktop bar with body scroll
  // locked.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 767px)");
    const handler = () => {
      setDesktopFilterOpen(false);
      setDesktopSortOpen(false);
      setFilterOpen(false);
      setSortOpen(false);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
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
  useEffect(() => { setSelectedSort(urlSort); }, [urlSort]);

  // ── Filter key — changes whenever filters/sort/search change ──
  const categoriesKey = urlCategories.join(",");
  const filterKey = `${selectedStore}|${categoriesKey}|${searchQuery}|${urlSort}|${selectedBrand}`;

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
    if (selectedBrand) params.set("brand", selectedBrand);
    const apiSort = SORT_MAP[urlSort];
    if (apiSort) params.set("sort", apiSort);

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
    if (selectedBrand) params.set("brand", selectedBrand);
    const apiSort = SORT_MAP[urlSort];
    if (apiSort) params.set("sort", apiSort);

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
  const handleStoreChange = useCallback((v) => {
    setLocalStore(v);
    router.push(buildFeedUrl(searchParams, { store: v }));
  }, [router, searchParams]);

  const handleClearSearch = useCallback(() => {
    router.push(buildFeedUrl(searchParams, { search: "" }));
  }, [router, searchParams]);

  const handleClearBrand = useCallback(() => {
    router.push(buildFeedUrl(searchParams, { brand: "" }));
  }, [router, searchParams]);

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

  const openDesktopFilter = useCallback(() => {
    setDesktopSortOpen(false);
    setDesktopFilterOpen(true);
  }, []);

  const toggleDesktopSort = useCallback(() => {
    setDesktopFilterOpen(false);
    setDesktopSortOpen((o) => !o);
  }, []);

  const handleClearAll = useCallback(() => {
    setLocalCategories([]);
    setLocalStore(ALL_STORES_VALUE);
    setFilterOpen(false);
    router.replace("/feed");
  }, [router]);

  const handleSortChange = useCallback((v) => {
    setSelectedSort(v);
    setSortOpen(false);
    setDesktopSortOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    if (v === "interleaved") params.delete("sort");
    else params.set("sort", v);
    const q = params.toString();
    router.replace(`/feed${q ? `?${q}` : ""}`);
  }, [searchParams, router]);

  const handleLoadMore = useCallback(() => {
    setLoadMoreOffset(products.length);
  }, [products.length]);

  const activeFilterCount =
    localCategories.length +
    (localStore !== ALL_STORES_VALUE ? 1 : 0) +
    (selectedBrand ? 1 : 0) +
    (searchQuery ? 1 : 0);
  const activeSortLabel = SORT_OPTIONS.find((o) => o.value === selectedSort)?.label ?? "Sort";
  const hasMore = !loading && products.length < total;

  return (
    <div className="min-h-screen font-mono antialiased overflow-x-hidden">
      <div className="min-h-screen bg-[#0a0a0a] text-zinc-50">

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
              {selectedSort !== "interleaved" ? activeSortLabel : "Sort"}
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
          activeFilterCount={activeFilterCount}
        />
        <MobileFilterPanel
          isOpen={filterOpen}
          onClose={() => setFilterOpen(false)}
          selectedCategories={localCategories}
          selectedStore={localStore}
          selectedBrand={selectedBrand}
          storeOptions={storeOptions}
          onApply={({ categories, store, brand }) => {
            setLocalCategories(categories);
            setLocalStore(store);
            const updates = { category: categories };
            updates.store = store !== ALL_STORES_VALUE ? store : null;
            updates.brand = brand || null;
            router.push(buildFeedUrl(searchParams, updates));
          }}
        />
        <MobileSortSheet
          isOpen={sortOpen}
          onClose={() => setSortOpen(false)}
          selectedSort={selectedSort}
          onSortChange={handleSortChange}
        />
        <MobileSortPanel
          isOpen={sortOpen}
          onClose={() => setSortOpen(false)}
          selectedSort={selectedSort}
          onSortChange={handleSortChange}
        />

        <MobileSearchStrip query={searchQuery} onClear={handleClearSearch} />
        <MobileFeedActionBar
          hasActiveFilters={activeFilterCount > 0}
          onOpenFilters={() => { setSortOpen(false); setFilterOpen(true); }}
          onOpenSort={() => { setFilterOpen(false); setSortOpen(true); }}
        />
        <main className="mx-auto max-w-7xl px-4 pb-24 md:pb-32 pt-3 md:pt-8">
          {/* Mobile product count */}
          <div className="md:hidden px-0 pt-0 pb-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              {loading ? "Loading…" : `${total} ${total === 1 ? "product" : "products"}`}
            </p>
          </div>
          {(searchQuery || selectedBrand) && (
            <div className="mb-4 md:mb-6 flex flex-wrap gap-2">
              {searchQuery && (
                <FilterChip
                  label="Search:"
                  value={`"${searchQuery}"`}
                  clearLabel={`Clear search "${searchQuery}"`}
                  onClear={handleClearSearch}
                />
              )}
              {selectedBrand && (
                <FilterChip
                  label="Brand:"
                  value={selectedBrand}
                  clearLabel={`Clear brand ${selectedBrand}`}
                  onClear={handleClearBrand}
                />
              )}
            </div>
          )}
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
                      sessionStorage.setItem("depot_feed_filter_key", filterKey);
                      sessionStorage.setItem("depot_feed_url", window.location.pathname + window.location.search);
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

        {/* ── DESKTOP: floating filter/sort bar (≥ md) ── */}
        <div className="hidden md:block fixed bottom-6 left-1/2 -translate-x-1/2 z-30">
          <DesktopSortMenu
            isOpen={desktopSortOpen}
            onClose={() => setDesktopSortOpen(false)}
            selectedSort={selectedSort}
            onSortChange={handleSortChange}
          />
          <DesktopFeedBar
            activeFilterCount={activeFilterCount}
            sortOpen={desktopSortOpen}
            onOpenFilters={openDesktopFilter}
            onToggleSort={toggleDesktopSort}
          />
        </div>

        {/* ── DESKTOP: filter panel (≥ md) ── */}
        <DesktopFilterPanel
          isOpen={desktopFilterOpen}
          onClose={() => setDesktopFilterOpen(false)}
          selectedCategories={localCategories}
          onToggleCategory={handleToggleCategory}
          selectedStore={localStore}
          storeOptions={storeOptions}
          onStoreChange={handleStoreChange}
          onClearAll={handleClearAll}
        />
      </div>
    </div>
  );
}
