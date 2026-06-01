"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrency } from "../CurrencyProvider";
import { CURRENCIES } from "../../lib/currency";
import RegionPanel from "./RegionPanel";

// Desktop header control replacing the Newsletter link. Self-contained
// open/close state (TopBar is presentational, so threading state through
// DesktopNav would be more invasive). Mirrors DesktopSortMenu's outside-click
// + Escape dismissal. Trigger reads "EN · €" and flips live on selection.
const baseLink =
  "font-mono text-[11px] uppercase tracking-widest text-zinc-300 hover:text-zinc-50 transition-colors";

export default function RegionMenu() {
  const { currency, setCurrency, language } = useCurrency();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e) => {
      if (containerRef.current && containerRef.current.contains(e.target)) return;
      setIsOpen(false);
    };
    const handleEscape = (e) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const symbol = CURRENCIES[currency]?.symbol ?? "€";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`${baseLink} flex items-center gap-1.5`}
      >
        <span>{`${language.toUpperCase()} · ${symbol}`}</span>
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 z-[1002]">
          <RegionPanel
            currency={currency}
            language={language}
            onSelectCurrency={setCurrency}
            onClose={() => setIsOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
