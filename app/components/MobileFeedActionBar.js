"use client";

import { useLanguage } from "./LanguageProvider";

export default function MobileFeedActionBar({
  hasActiveFilters,
  onOpenFilters,
  onOpenSort,
}) {
  const { t } = useLanguage();
  return (
    <div className="md:hidden fixed bottom-4 left-4 right-4 z-30 grid grid-cols-2 h-11 rounded-sm bg-zinc-950/85 backdrop-blur shadow-[0_10px_30px_rgba(0,0,0,0.45)] border border-zinc-800/40">
      <button
        type="button"
        onPointerDown={onOpenFilters}
        className="flex items-center justify-center gap-2 font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-50 border-r border-zinc-800/40"
      >
        {t("feed.filter")}
        {hasActiveFilters && (
          <span className="inline-block w-1 h-1 rounded-full bg-zinc-50" aria-hidden />
        )}
      </button>
      <button
        type="button"
        onPointerDown={onOpenSort}
        className="flex items-center justify-center font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-50"
      >
        {t("feed.sort")}
      </button>
    </div>
  );
}
