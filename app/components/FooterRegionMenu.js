"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrency } from "./CurrencyProvider";
import { useLanguage } from "./LanguageProvider";
import { CURRENCIES } from "../lib/currency";
import RegionPanel from "./nav/RegionPanel";

// Footer bottom-bar region control — same behavior as the nav's RegionMenu,
// but styled for the ink ground and opening upward.
export default function FooterRegionMenu() {
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
        className="font-mono text-[10px] uppercase tracking-[0.22em] text-white transition-opacity hover:opacity-70"
      >
        {`${language.toUpperCase()} · ${symbol}`}
      </button>

      {isOpen && (
        <div className="absolute right-0 bottom-full mb-2 z-[1002]">
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
