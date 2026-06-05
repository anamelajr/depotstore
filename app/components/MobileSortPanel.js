"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { getSortOptions } from "../lib/sort-options";
import { useLanguage } from "./LanguageProvider";

export default function MobileSortPanel({ isOpen, selectedSort, onSortChange, onClose }) {
  const { language, t } = useLanguage();
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  if (typeof document === "undefined") return null;
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-[#0a0a0a] text-zinc-50 flex flex-col motion-safe:[animation:navMenuEnter_150ms_ease-out]">
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <span />
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          {t("filter.sortBy").toUpperCase()}
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ✕ {t("nav.close").toUpperCase()}
        </button>
      </header>
      <div className="flex-1 px-8 pt-12 pb-8 flex flex-col gap-8">
        {getSortOptions(language).map((opt) => {
          const isActive = opt.value === selectedSort;
          return (
            <button
              key={opt.value}
              onClick={() => { onSortChange(opt.value); onClose(); }}
              className="flex items-center font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
            >
              <span
                className={`inline-block w-[11px] h-[11px] rounded-full border border-zinc-50 mr-4 ${isActive ? "before:content-[''] before:block before:m-[1.5px] before:w-[6px] before:h-[6px] before:rounded-full before:bg-zinc-50" : ""}`}
              />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
}
