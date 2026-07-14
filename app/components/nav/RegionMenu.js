"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrency } from "../CurrencyProvider";
import { useLanguage } from "../LanguageProvider";
import { CURRENCIES } from "../../lib/currency";
import RegionPanel from "./RegionPanel";

// Desktop header control. Trigger reads "EN · €" and flips live on selection.
// Reads BOTH useCurrency (for the symbol + setCurrency) and useLanguage (for
// the language label + setLanguage) — keeping both hooks is critical; dropping
// useCurrency would break the currency selector.
const baseLink =
  "font-mono text-[11px] uppercase tracking-widest text-zinc-600 hover:text-zinc-950 transition-colors";

export default function RegionMenu() {
  const { currency, setCurrency } = useCurrency();
  const { language, setLanguage, t } = useLanguage();
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
            t={t}
            onSelectCurrency={setCurrency}
            onSelectLanguage={setLanguage}
            onClose={() => setIsOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
