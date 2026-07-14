"use client";

import { useLanguage } from "../LanguageProvider";

export default function DesktopFeedBar({
  activeFilterCount,
  sortOpen,
  onOpenFilters,
  onToggleSort,
}) {
  const { t } = useLanguage();
  // Rick Owens-style bar: translucent grey, white type, each half darkens
  // toward black on hover / while its panel is open.
  return (
    <div className="flex w-[360px] h-12 bg-zinc-600/70 backdrop-blur shadow-[0_8px_28px_rgba(0,0,0,0.18)]">
      <button
        type="button"
        onClick={onOpenFilters}
        className="flex-1 px-6 text-left font-mono text-[11px] uppercase tracking-[0.28em] text-white transition-colors duration-200 hover:bg-zinc-950/90"
      >
        {t("feed.filter")}{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
      </button>
      <button
        type="button"
        data-sort-button
        onClick={onToggleSort}
        className={`flex-1 px-6 text-right font-mono text-[11px] uppercase tracking-[0.28em] text-white transition-colors duration-200 hover:bg-zinc-950/90 ${
          sortOpen ? "bg-zinc-950/90" : ""
        }`}
      >
        {t("feed.sort")}
      </button>
    </div>
  );
}
