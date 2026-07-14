"use client";

import { useLanguage } from "./LanguageProvider";

export default function MobileFeedActionBar({
  hasActiveFilters,
  onOpenFilters,
  onOpenSort,
}) {
  const { t } = useLanguage();
  // Rick Owens-style bar: translucent grey over the feed, white type;
  // each half flashes to black on press.
  return (
    <div className="md:hidden fixed bottom-4 left-4 right-4 z-30 grid grid-cols-2 h-11 bg-zinc-600/70 backdrop-blur">
      <button
        type="button"
        onPointerDown={onOpenFilters}
        className="flex items-center justify-start gap-2 pl-6 font-mono text-[10px] tracking-[0.34em] uppercase text-white transition-colors active:bg-zinc-950/90"
      >
        {t("feed.filter")}
        {hasActiveFilters && (
          <span className="inline-block w-1 h-1 rounded-full bg-white" aria-hidden />
        )}
      </button>
      <button
        type="button"
        onPointerDown={onOpenSort}
        className="flex items-center justify-end pr-6 font-mono text-[10px] tracking-[0.34em] uppercase text-white transition-colors active:bg-zinc-950/90"
      >
        {t("feed.sort")}
      </button>
    </div>
  );
}
