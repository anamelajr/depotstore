"use client";

import { CURRENCIES } from "../../lib/currency";

// Presentational body of the region dropdown — shared so the open/positioning
// logic lives in RegionMenu. Dark panel matching DesktopSortMenu.
export default function RegionPanel({ currency, language, t, onSelectCurrency, onSelectLanguage, onClose }) {
  const sectionLabel =
    "px-4 pt-3 pb-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-600";
  const row =
    "flex w-full items-center justify-between px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors";

  return (
    <div
      role="menu"
      aria-label="Region settings"
      className="w-[240px] bg-zinc-950/85 backdrop-blur border border-zinc-800/40 shadow-[0_8px_28px_rgba(0,0,0,0.6)] py-1.5"
    >
      {/* Language */}
      <div className={sectionLabel}>{t("region.language")}</div>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={language === "en"}
        onClick={() => { onSelectLanguage("en"); onClose(); }}
        className={`${row} hover:bg-white/5 ${language === "en" ? "text-zinc-50" : "text-zinc-400 hover:text-zinc-50"}`}
      >
        <span>English</span>
        {language === "en" && <span>—</span>}
      </button>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={language === "fr"}
        onClick={() => { onSelectLanguage("fr"); onClose(); }}
        className={`${row} hover:bg-white/5 ${language === "fr" ? "text-zinc-50" : "text-zinc-400 hover:text-zinc-50"}`}
      >
        <span>Français</span>
        {language === "fr" && <span>—</span>}
      </button>

      {/* Currency */}
      <div className={`${sectionLabel} mt-1`}>{t("region.currency")}</div>
      {Object.entries(CURRENCIES).map(([code, { symbol, label }]) => {
        const active = currency === code;
        return (
          <button
            key={code}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            onClick={() => {
              onSelectCurrency(code);
              onClose();
            }}
            className={`${row} hover:bg-white/5 ${
              active ? "text-zinc-50" : "text-zinc-400 hover:text-zinc-50"
            }`}
          >
            <span>
              {symbol} {label}
            </span>
            {active && <span>—</span>}
          </button>
        );
      })}

      {/* Footer note */}
      <div className="mt-1 border-t border-zinc-800/40 px-4 pt-2.5 pb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
        {t("region.pricesFromEur")}
      </div>
    </div>
  );
}
