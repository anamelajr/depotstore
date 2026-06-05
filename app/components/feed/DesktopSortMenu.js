"use client";

import { useEffect, useRef } from "react";
import { getSortOptions } from "../../lib/sort-options";
import { useLanguage } from "../LanguageProvider";

export default function DesktopSortMenu({
  isOpen,
  onClose,
  selectedSort,
  onSortChange,
}) {
  const { language } = useLanguage();
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      // Don't fire on the SORT bar button — its own onClick toggles the menu
      if (e.target.closest && e.target.closest("[data-sort-button]")) return;
      onClose();
    };

    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Sort options"
      className="absolute bottom-full right-0 mb-2 w-[220px] bg-zinc-900 border border-zinc-800 shadow-[0_8px_28px_rgba(0,0,0,0.6)] py-1.5"
    >
      {getSortOptions(language).map((opt) => {
        const active = selectedSort === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="menuitem"
            onClick={() => {
              onSortChange(opt.value);
              onClose();
            }}
            className={`flex w-full items-center justify-between px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors hover:bg-white/5 ${
              active ? "text-zinc-50" : "text-zinc-400 hover:text-zinc-50"
            }`}
          >
            <span>{opt.label}</span>
            {active && <span>—</span>}
          </button>
        );
      })}
    </div>
  );
}
