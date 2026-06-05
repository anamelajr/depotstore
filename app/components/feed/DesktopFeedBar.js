"use client";

import { useLanguage } from "../LanguageProvider";

export default function DesktopFeedBar({
  activeFilterCount,
  sortOpen,
  onOpenFilters,
  onToggleSort,
}) {
  const { t } = useLanguage();
  return (
    <div className="flex w-[360px] h-12 bg-zinc-950/85 backdrop-blur border border-zinc-800/40 shadow-[0_8px_28px_rgba(0,0,0,0.6)]">
      <button
        type="button"
        onClick={onOpenFilters}
        className="flex-1 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-50 transition-colors hover:bg-white/5"
      >
        {t("feed.filter")}{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
      </button>
      <button
        type="button"
        data-sort-button
        onClick={onToggleSort}
        className={`flex-1 border-l border-zinc-800/40 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-50 transition-colors hover:bg-white/5 ${
          sortOpen ? "bg-white/5" : ""
        }`}
      >
        {t("feed.sort")}
      </button>
    </div>
  );
}
