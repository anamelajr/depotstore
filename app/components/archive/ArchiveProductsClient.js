"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProductCard from "../ProductCard";
import MobileFeedActionBar from "../MobileFeedActionBar";
import MobileSortPanel from "../MobileSortPanel";
import DesktopFeedBar from "../feed/DesktopFeedBar";
import DesktopSortMenu from "../feed/DesktopSortMenu";
import DesktopFilterPanel from "../feed/DesktopFilterPanel";
import ArchiveFilterPanel from "./ArchiveFilterPanel";
import { useLanguage } from "../LanguageProvider";
import { HAIRLINE, UTILITY_CAPS } from "../home/tokens.js";
import {
  buildArchiveFilterGroups,
  filterProductsByCategories,
  sortArchiveProducts,
} from "../../lib/archiveProductFilters.js";

/**
 * Count row + product grid + the feed's floating filter/sort bars, for one
 * featured archive.
 *
 * State is plain React, deliberately not URL params: the whole archive set
 * arrives in props (tens of rows, fetched and cached server-side), so filtering
 * and sorting are in-memory and instant, and the page stays a server component
 * rendering under ISR. The initial state — no categories, "interleaved" sort —
 * reproduces the server's ordering exactly, so the first client render matches
 * the server HTML. `weekSeed` is computed once on the server and threaded in
 * for the same reason: an independent client clock read could land in a
 * different weekly bucket and reshuffle the grid on hydration.
 *
 * Filtering is category-only. An archive is already scoped to one designer, so
 * store and brand are near-constant, and search belongs to the feed.
 */
export default function ArchiveProductsClient({ products, weekSeed = 0 }) {
  const { language, t } = useLanguage();

  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedSort, setSelectedSort] = useState("interleaved");

  // Four panels, mutually exclusive per breakpoint — same as FeedClient.
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [desktopFilterOpen, setDesktopFilterOpen] = useState(false);
  const [desktopSortOpen, setDesktopSortOpen] = useState(false);

  // Close every panel when the viewport crosses the md breakpoint. Neither
  // mobile panel is gated by a Tailwind breakpoint — they're state-driven
  // portals at z-9999 — so a tablet rotated with Refine open would otherwise
  // keep them pinned over the desktop layout with body scroll locked.
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

  // Groups are derived from the full set, never the filtered one: pruning them
  // as the user selects would make a chosen category disappear from the panel.
  const groups = useMemo(
    () => buildArchiveFilterGroups(products, language),
    [products, language],
  );

  const visible = useMemo(
    () =>
      sortArchiveProducts(
        filterProductsByCategories(products, selectedCategories),
        selectedSort,
        weekSeed,
      ),
    [products, selectedCategories, selectedSort, weekSeed],
  );

  const handleToggleCategory = useCallback((value) => {
    setSelectedCategories((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value],
    );
  }, []);

  const handleSortChange = useCallback((value) => {
    setSelectedSort(value);
    setSortOpen(false);
    setDesktopSortOpen(false);
  }, []);

  const openDesktopFilter = useCallback(() => {
    setDesktopSortOpen(false);
    setDesktopFilterOpen(true);
  }, []);

  const toggleDesktopSort = useCallback(() => {
    setDesktopFilterOpen(false);
    setDesktopSortOpen((o) => !o);
  }, []);

  return (
    <>
      {/* Toolbar — the count reflects the active filter, not the archive size. */}
      <div className="border-t" style={{ borderColor: HAIRLINE }}>
        <div className="w-full px-6 py-4">
          <span className={UTILITY_CAPS}>
            {visible.length} {t("archive.items")}
          </span>
        </div>
      </div>

      {/* Feed's grid conventions, at four columns — this page has no filter
          rail to make room for, so unlike the feed the grid runs the full
          page width (reference layout) rather than the 1210px container.
          Bottom padding clears the floating bars. */}
      <div className="w-full px-6 pb-32 pt-2 md:pb-24">
        {visible.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-600">
            No products found.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-10 lg:grid-cols-4 lg:gap-x-6 lg:gap-y-10">
            {visible.map((p, i) => (
              <ProductCard
                key={`${p.storeDomain}::${p.handle}`}
                product={p}
                imageSizes="(min-width: 1024px) 25vw, 50vw"
                // Above-the-fold tier for a 4-col desktop / 2-col mobile grid:
                // the first two are the plausible LCP candidates, the next two
                // are eager but normal-priority so they don't race them.
                priority={i < 2 ? "high" : i < 4 ? "eager" : false}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── MOBILE (< md) ── */}
      <ArchiveFilterPanel
        isOpen={filterOpen}
        onClose={() => setFilterOpen(false)}
        selectedCategories={selectedCategories}
        groups={groups}
        onApply={setSelectedCategories}
      />
      <MobileSortPanel
        isOpen={sortOpen}
        onClose={() => setSortOpen(false)}
        selectedSort={selectedSort}
        onSortChange={handleSortChange}
      />
      <MobileFeedActionBar
        hasActiveFilters={selectedCategories.length > 0}
        onOpenFilters={() => { setSortOpen(false); setFilterOpen(true); }}
        onOpenSort={() => { setFilterOpen(false); setSortOpen(true); }}
      />

      {/* ── DESKTOP (≥ md) ── */}
      <div className="hidden md:block fixed bottom-6 left-1/2 -translate-x-1/2 z-30">
        <DesktopSortMenu
          isOpen={desktopSortOpen}
          onClose={() => setDesktopSortOpen(false)}
          selectedSort={selectedSort}
          onSortChange={handleSortChange}
        />
        <DesktopFeedBar
          activeFilterCount={selectedCategories.length}
          sortOpen={desktopSortOpen}
          onOpenFilters={openDesktopFilter}
          onToggleSort={toggleDesktopSort}
        />
      </div>

      <DesktopFilterPanel
        isOpen={desktopFilterOpen}
        onClose={() => setDesktopFilterOpen(false)}
        selectedCategories={selectedCategories}
        onToggleCategory={handleToggleCategory}
        categoryGroups={groups}
        showStore={false}
        storeOptions={[]}
        onClearAll={() => setSelectedCategories([])}
      />
    </>
  );
}
