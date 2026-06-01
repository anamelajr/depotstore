"use client";

import { CURRENCIES } from "../../lib/currency";

// Presentational body of the region dropdown — shared so the open/positioning
// logic lives in RegionMenu. Dark panel matching DesktopSortMenu. Language row
// is a phase-1 shell: English is active, Français is rendered but inert
// (aria-disabled, no-op). Currency row flips the selection and closes.
export default function RegionPanel({ currency, language, onSelectCurrency, onClose }) {
  const sectionLabel =
    "px-4 pt-3 pb-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-600";
  const row =
    "flex w-full items-center justify-between px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors";

  return (
    <div
      role="menu"
      aria-label="Region settings"
      className="w-[240px] bg-zinc-900 border border-zinc-800 shadow-[0_8px_28px_rgba(0,0,0,0.6)] py-1.5"
    >
      {/* Language — shell only; FR is inert in phase 1 */}
      <div className={sectionLabel}>Language</div>
      <div
        role="menuitemradio"
        aria-checked={language === "EN"}
        className={`${row} text-zinc-50`}
      >
        <span>English</span>
        {language === "EN" && <span>—</span>}
      </div>
      <div
        role="menuitemradio"
        aria-checked={false}
        aria-disabled="true"
        className={`${row} text-zinc-600 cursor-default`}
      >
        <span>Français</span>
      </div>

      {/* Currency */}
      <div className={`${sectionLabel} mt-1`}>Currency</div>
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
      <div className="mt-1 border-t border-zinc-800 px-4 pt-2.5 pb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
        Prices are converted from EUR
      </div>
    </div>
  );
}
