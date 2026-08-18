"use client";

import { useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ProductCard from "../components/ProductCard";
import MobileSortPanel from "../components/MobileSortPanel";
import DesktopFeedBar from "../components/feed/DesktopFeedBar";
import DesktopSortMenu from "../components/feed/DesktopSortMenu";
import DesktopFilterPanel from "../components/feed/DesktopFilterPanel";
import FilterChip from "../components/feed/FilterChip";
import MobileSearchStrip from "../components/MobileSearchStrip";
import MobileFeedActionBar from "../components/MobileFeedActionBar";
import MobileFilterPanel from "../components/MobileFilterPanel";
import { ALL_STORES_VALUE, LOAD_SIZE, buildFeedUrl, appendDedupedProducts, nextServerOffset } from "../lib/feed-utils";
import { SORT_MAP } from "../lib/sort-options";
import { useLanguage } from "../components/LanguageProvider";

// How many leading cards opt out of lazy loading: two desktop rows at 3-col,
// three mobile rows at 2-col. Of those, only the first row's worth get
// fetchPriority=high — they're the plausible LCP candidates, and cards 3–6
// staying at normal priority is what keeps them from racing the LCP for
// bandwidth on a constrained connection.
const EAGER_COUNT = 6;
const HIGH_COUNT = 2;

export default function FeedClient({ stores = [], initialData = null }) {
  const storeOptions = [
    { value: ALL_STORES_VALUE, label: "All Stores" },
    ...stores.map((s) => ({ value: s.domain, label: s.storeName })),
  ];
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t, language } = useLanguage();
  const numberLocale = language === "fr" ? "fr-FR" : "en-US";

  // URL-derived filter state (no page in URL anymore)
  const searchQuery = searchParams.get("search") || "";
  const selectedStore = searchParams.get("store") || ALL_STORES_VALUE;
  const urlCategories = searchParams.getAll("category");
  const urlSort = searchParams.get("sort") || "interleaved";
  const selectedBrand = searchParams.get("brand") || "";

  // ── Filter key — changes whenever filters/sort/search change ──
  // Hoisted above state: it's a pure derivation of searchParams and both the
  // sessionStorage-restore effect and the seeded state below read it.
  const categoriesKey = urlCategories.join(",");
  const filterKey = `${selectedStore}|${categoriesKey}|${searchQuery}|${urlSort}|${selectedBrand}`;

  // The server rendered page 1 for this exact filter → consume it instead of
  // re-fetching through /api/products. Deterministic from props + URL, so no
  // hydration mismatch and the grid ships inside the SSR HTML.
  const serverMatch = initialData !== null && initialData.filterKey === filterKey;

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
  const [products, setProducts] = useState(serverMatch ? initialData.products : []);
  const [total, setTotal] = useState(serverMatch ? initialData.total : 0);
  // Pagination is driven by the SERVER's hasMore, never by comparing the
  // appended row count against `total`: past the first page the API no longer
  // computes an exact count (it probes with limit+1 instead), and the catalog
  // mutates hourly, so a page-1 total is not a safe stopping condition.
  // `total` stays purely a display number.
  const [serverHasMore, setServerHasMore] = useState(
    serverMatch ? initialData.hasMore === true : false,
  );
  const [loading, setLoading] = useState(!serverMatch);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  // Load More: offset to fetch next batch from (null = idle)
  const [loadMoreOffset, setLoadMoreOffset] = useState(null);
  // Deliberately NOT the shared `error` state. That one is rendered *instead
  // of* the grid, so routing an append failure into it blanked every card the
  // user had already loaded. This one renders beneath the grid and leaves it
  // standing.
  const [loadMoreError, setLoadMoreError] = useState(false);

  // Next server offset to request, advanced by the RAW row count of each
  // fetched page (pre-dedupe). It must NOT be derived from `products.length`:
  // once the append below drops rows already in the grid, rendered length
  // diverges from server rows consumed, and a partially-duplicate page would
  // overlap the next request while an all-duplicate page would re-request the
  // same offset forever — Load More stalls while `hasMore` is still true.
  const serverOffsetRef = useRef(serverMatch ? initialData.products.length : 0);

  // Whether grid items may skip offscreen rendering work. On by default (fresh
  // loads want it from the first frame); turned off for the restore frame so
  // the pre-paint scroll jump measures real card heights, then back on after
  // one painted frame. Both writes are idempotent, so StrictMode's
  // double-invoke is harmless.
  const [cvEnabled, setCvEnabled] = useState(true);

  // Scroll restore refs
  const scrollRestoreY = useRef(null);
  const scrollRestorePending = useRef(false);
  // How many products to load on first fetch when restoring (null = normal LOAD_SIZE).
  // Cleared only once the restore batch has actually settled — NOT when the
  // fetch is issued. With server-seeded state the fetch effect can re-run
  // (StrictMode double-invoke, or any re-render before the batch lands), and a
  // ref consumed at issue time would make the re-run see `null` + `serverMatch`
  // and skip the restore entirely, leaving the grid at the seeded first page.
  const restoreCountRef = useRef(null);
  // Set once the restore batch has been applied (or failed). Gates the
  // scroll-restore layout effect, which would otherwise fire immediately:
  // server-seeded state means `loading` starts false with a full first page,
  // so the pre-paint jump would run against the short grid and clamp.
  const restoreDoneRef = useRef(false);
  // A restored grid lands mid-scroll, so index-based priority would eager the
  // cards at the top of the document — the ones the user has already scrolled
  // past. Set on the restore path, cleared on every fresh/soft-nav render.
  const suppressPriorityRef = useRef(false);

  // On mount: check sessionStorage for back-navigation scroll restore.
  // Runs before the filter fetch effect so restoreCountRef is set in time.
  //
  // useLayoutEffect, not useEffect: with server-seeded state `loading` starts
  // false, so a passive effect would let the first paint show the seeded
  // 30-product grid before the restore state is even read — a visible flash
  // (grid → blank → restored grid) plus a clamped browser scroll. Reading the
  // saved state pre-paint and synchronously flipping `loading` back on keeps
  // the first paint blank, exactly like the pre-SSR behavior. The read must
  // NOT move earlier still (into a useState initializer): that would diverge
  // from the server-rendered HTML during hydration.
  useLayoutEffect(() => {
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
      restoreDoneRef.current = false;
      // Read strictly after this write: the restored grid only renders once
      // the restore fetch settles (the same ordering guarantee restoreCountRef
      // relies on).
      suppressPriorityRef.current = true;
      setCvEnabled(false); // the restore frame must lay out every card for real
      setLoading(true); // pre-paint: hide the seeded grid until the restore batch lands
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Apply server-rendered data ──
  // Declared after the restore effect so restore refs are set first on mount.
  // On mount this is a no-op re-commit of the seeded state; on every soft nav
  // (filter/sort/search change) it applies the fresh server payload, which
  // commits in the same render as the new searchParams — the old grid stays
  // visible until the swap, so no blank frame and no client fetch.
  useEffect(() => {
    if (!serverMatch) return;
    if (restoreCountRef.current !== null || scrollRestorePending.current) return; // restore path refetches
    // Soft-nav filter changes render fresh from the top, so index-based
    // priority is correct again.
    suppressPriorityRef.current = false;
    setLoadMoreOffset(null); // cancel pending Load More for the old filter
    setLoadMoreError(false); // an old filter's append failure isn't this grid's
    setProducts(initialData.products);
    serverOffsetRef.current = initialData.products.length;
    setTotal(initialData.total);
    setServerHasMore(initialData.hasMore === true);
    setError(null);
    setLoading(false);
  }, [initialData]); // eslint-disable-line react-hooks/exhaustive-deps

  // After the restore batch is loaded, jump to the saved position before paint.
  // useLayoutEffect fires synchronously after DOM mutations and before the browser
  // paints, so the grid is never visible at scroll=0 — no flash, no snap.
  useLayoutEffect(() => {
    if (!scrollRestorePending.current || loading || products.length === 0) return;
    // A restore is pending but its batch hasn't landed yet — jumping now would
    // scroll against the seeded first page and clamp to its (shorter) height.
    if (restoreCountRef.current !== null && !restoreDoneRef.current) return;
    scrollRestorePending.current = false;
    const y = scrollRestoreY.current;
    scrollRestoreY.current = null;
    sessionStorage.removeItem("depot_feed_scroll");
    sessionStorage.removeItem("depot_feed_count");
    sessionStorage.removeItem("depot_feed_filter_key");
    sessionStorage.removeItem("depot_feed_url");
    window.scrollTo(0, y);
    // Double rAF = after one fully painted frame, by which point every card
    // has a browser-recorded last-remembered size. Only then is it safe to let
    // offscreen cards stop rendering: doing it any earlier would have made the
    // jump above land against estimated heights.
    requestAnimationFrame(() => requestAnimationFrame(() => setCvEnabled(true)));
  }, [loading, products]);

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

  // ── Initial / reset fetch ──
  // Runs on mount and whenever filterKey changes.
  // On mount it respects restoreCountRef (set above) for back-nav restore.
  // On filter change it cancels any in-flight Load More and resets state.
  useEffect(() => {
    // Server payload already covers this filterKey — the apply-effect above
    // seeded/committed it. Only fetch when it doesn't: initialData null
    // (server fetch failed or timed out — this is the recovery path), a
    // stale key, or a pending back-nav restore (which must never be skipped:
    // the scroll-restore useLayoutEffect fires off loading/products changes,
    // which only happen if this fetch runs).
    if (serverMatch && restoreCountRef.current === null) return;

    setLoadMoreOffset(null); // cancel any pending Load More for the old filter
    setLoadMoreError(false); // an old filter's append failure isn't this grid's

    // Read, don't consume: the ref is cleared in `finally` once the batch has
    // actually settled, so a re-run of this effect before then still restores.
    const restoreCount = restoreCountRef.current;
    const limit = restoreCount !== null ? restoreCount : LOAD_SIZE;

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    // Tracks whether a restore fetch actually delivered products. A restore
    // that fails or comes back empty never satisfies the scroll-restore
    // layout effect's `products.length > 0` guard, so `scrollRestorePending`
    // would stay true forever — and a stale pending flag makes the
    // apply-server-data effect skip every later soft-nav payload while this
    // effect skips too (serverMatch + consumed ref): a permanently stuck
    // feed. When the restore settles without products, abandon it fully.
    let restoreDelivered = false;

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
        serverOffsetRef.current = (data.products || []).length;
        setTotal(data.total ?? 0);
        setServerHasMore(data.hasMore === true);
        setError(null);
        restoreDelivered = (data.products || []).length > 0;
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError("Failed to load products.");
          setProducts([]);
          serverOffsetRef.current = 0;
          setTotal(0);
          setServerHasMore(false);
        }
      })
      .finally(() => {
        // Aborted = this run was superseded (effect re-run or unmount). Leave
        // the restore state intact so the replacement run still restores.
        if (controller.signal.aborted) return;
        setLoading(false);
        if (restoreCount !== null) {
          restoreCountRef.current = null;   // restore consumed
          restoreDoneRef.current = true;    // unblocks the scroll-restore jump
          if (!restoreDelivered) {
            // Failed/empty restore: the layout effect will never run its
            // cleanup, so do it here — drop the pending jump and the saved
            // state so later navigations aren't blocked. cvEnabled must come
            // back on too: the layout effect's double-rAF is the only other
            // writer, and it's gated behind the pending flag cleared here —
            // without this, every grid a later soft nav renders into this
            // mounted feed keeps offscreen skipping disabled.
            scrollRestorePending.current = false;
            scrollRestoreY.current = null;
            setCvEnabled(true);
            sessionStorage.removeItem("depot_feed_scroll");
            sessionStorage.removeItem("depot_feed_count");
            sessionStorage.removeItem("depot_feed_filter_key");
            sessionStorage.removeItem("depot_feed_url");
          }
        }
      });

    return () => controller.abort();
  }, [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kept current every render so the Load More effect can compare the key a
  // request was issued under against the live one when the response lands.
  // Declared before the Load More effect so it commits first: effects run in
  // declaration order, and the Load More effect reads this ref to stamp the
  // request it issues.
  const filterKeyRef = useRef(filterKey);
  useEffect(() => { filterKeyRef.current = filterKey; }, [filterKey]);

  // ── Load More fetch ──
  // Fetches the next LOAD_SIZE products at loadMoreOffset and appends them.
  // Aborted automatically when loadMoreOffset resets to null (filter change).
  useEffect(() => {
    if (loadMoreOffset === null) return;

    const controller = new AbortController();
    const requestFilterKey = filterKeyRef.current; // captured at request start
    setLoadingMore(true);

    // Use explicit offset, not page math: loadMoreOffset isn't guaranteed
    // to be a multiple of LOAD_SIZE after a restore from the final partial
    // batch when new rows have been synced in between.
    const params = new URLSearchParams();
    params.set("offset", String(loadMoreOffset));
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
        // Stale: the filter moved on while this batch was in flight. Nothing
        // overwrites `products` wholesale on the server-driven path, so an
        // unguarded append would leave old-filter cards in the new grid.
        if (filterKeyRef.current !== requestFilterKey) return;
        const rows = data.products || [];
        // Raw page length, before dedupe — see serverOffsetRef.
        serverOffsetRef.current = nextServerOffset(loadMoreOffset, rows);
        setProducts((prev) => appendDedupedProducts(prev, rows));
        // `total` is intentionally NOT updated here: past offset 0 the API
        // returns null for it, and the displayed count should stay the number
        // the user was shown for this filter.
        setServerHasMore(data.hasMore === true);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          if (filterKeyRef.current !== requestFilterKey) return;
          setLoadMoreError(true);
          // Reset to null so a retry can re-request the SAME offset. Without
          // this, handleLoadMore sets loadMoreOffset to the value it already
          // holds (the failure never advanced serverOffsetRef), the state
          // doesn't change, the effect never re-runs, and Load More is dead
          // for the rest of the session. Re-requesting the same offset skips
          // nothing — it was never consumed.
          setLoadMoreOffset(null);
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

  const handleApplyFilters = useCallback(({ categories, store, brand }) => {
    setLocalCategories(categories);
    setLocalStore(store);
    const updates = { category: categories };
    updates.store = store !== ALL_STORES_VALUE ? store : null;
    // Brand is buffered inside the panel; this is the only commit path for it.
    // Empty string and undefined both clear the param via buildFeedUrl.
    updates.brand = brand || null;
    router.push(buildFeedUrl(searchParams, updates));
  }, [router, searchParams]);

  const handleLoadMore = useCallback(() => {
    setLoadMoreError(false);
    setLoadMoreOffset(serverOffsetRef.current);
  }, []);

  const activeFilterCount =
    localCategories.length +
    (localStore !== ALL_STORES_VALUE ? 1 : 0) +
    (selectedBrand ? 1 : 0) +
    (searchQuery ? 1 : 0);
  const hasMore = !loading && serverHasMore;

  // Read during render on purpose, and a ref rather than state: it's false on
  // both server and client for a fresh load, so the first 6 cards ship eager
  // inside the SSR HTML — the whole win, since the preload scanner fires
  // before hydration — with no mismatch to reconcile. As state it would cost a
  // second render, which is exactly what the priority tier exists to beat.
  const priorityDisabled = suppressPriorityRef.current;

  return (
    <div className="min-h-screen font-mono antialiased overflow-x-clip">
      <div className="min-h-screen bg-white text-zinc-950">

        {/* Mobile panels */}
        <MobileFilterPanel
          isOpen={filterOpen}
          onClose={() => setFilterOpen(false)}
          selectedCategories={localCategories}
          selectedStore={localStore}
          selectedBrand={selectedBrand}
          storeOptions={storeOptions}
          onApply={handleApplyFilters}
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
        <main className="px-4 md:px-6 pb-32 md:pb-32 pt-3 md:pt-8">
          {/* Mobile product count */}
          <div className="md:hidden px-0 pt-0 pb-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              {/* Non-breaking space keeps the line box so the grid doesn't
                  shift when the count arrives; visually blank. */}
              {loading ? " " : `${total} ${total === 1 ? "product" : "products"}`}
            </p>
          </div>
          {(searchQuery || selectedBrand) && (
            <div className="hidden md:flex mb-4 md:mb-6 flex-wrap gap-2">
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
          {loading ? null : error ? (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-sm text-red-600">
              {error}
            </div>
          ) : products.length === 0 ? (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-600">
              No products found.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-10 lg:grid-cols-3 lg:gap-x-3.5 lg:gap-y-16">
                {
                  // eslint-disable-next-line react-hooks/refs -- priorityDisabled is a deliberate render-time ref read; see its declaration
                  products.map((p, i) => (
                    <div
                      key={`${p.productUrl ?? "unknown"}-${p.name}`}
                      className={`feed-card-cv${cvEnabled ? " feed-card-cv--on" : ""}`}
                      onClick={() => {
                        sessionStorage.setItem("depot_feed_scroll", String(window.scrollY));
                        sessionStorage.setItem("depot_feed_count", String(products.length));
                        sessionStorage.setItem("depot_feed_filter_key", filterKey);
                        sessionStorage.setItem("depot_feed_url", window.location.pathname + window.location.search);
                      }}
                    >
                      {/* Load More appends are all i >= 30, hence lazy. */}
                      <ProductCard
                        product={p}
                        imageSizes="(min-width: 1024px) 33vw, 50vw"
                        priority={
                          priorityDisabled
                            ? false
                            : i < HIGH_COUNT
                              ? "high"
                              : i < EAGER_COUNT
                                ? "eager"
                                : false
                        }
                      />
                    </div>
                  ))}
              </div>
              <div className="flex flex-col items-center gap-4 pt-10">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                  {products.length.toLocaleString(numberLocale)} {t("feed.countOf")} {total.toLocaleString(numberLocale)} {t("feed.countItems")}
                </p>
                {loadMoreError && (
                  <p className="font-mono text-[10px] uppercase tracking-widest text-red-600">
                    {t("feed.loadMoreFailed")}
                  </p>
                )}
                {hasMore && (
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="w-full border border-zinc-300 py-4 px-6 font-mono text-[11px] uppercase tracking-[0.3em] text-zinc-500 transition-all duration-200 hover:border-zinc-900 hover:text-zinc-950 disabled:opacity-40 disabled:cursor-not-allowed active:bg-zinc-100"
                  >
                    {loadingMore ? "—" : loadMoreError ? t("feed.retry") : t("feed.loadMore")}
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
