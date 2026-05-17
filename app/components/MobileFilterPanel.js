"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ALL_STORES_VALUE } from "../lib/feed-utils";
import { NAV_TOP_LEVEL, SUBCATEGORIES_BY_SHORTKEY } from "../lib/categories.js";

export default function MobileFilterPanel({
  isOpen,
  onClose,
  selectedCategories,
  selectedStore,
  selectedBrand,
  storeOptions,
  onApply,        // (next: { categories, store, brand }) => void  — all three commit atomically
}) {
  const [view, setView] = useState("root"); // 'root' | 'category' | 'store'
  const [draftCategories, setDraftCategories] = useState(selectedCategories);
  const [draftStore, setDraftStore] = useState(selectedStore);
  const [draftBrand, setDraftBrand] = useState(selectedBrand);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      setDraftCategories(selectedCategories);
      setDraftStore(selectedStore);
      setDraftBrand(selectedBrand);
      setView("root");
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen, selectedCategories, selectedStore, selectedBrand]);

  if (typeof document === "undefined") return null;
  if (!isOpen) return null;

  const handleApply = () => {
    onApply({ categories: draftCategories, store: draftStore, brand: draftBrand });
    onClose();
  };
  const handleReset = () => {
    setDraftCategories([]);
    setDraftStore(ALL_STORES_VALUE);
    setDraftBrand("");
  };

  const totalActive =
    draftCategories.length +
    (draftStore !== ALL_STORES_VALUE ? 1 : 0) +
    (draftBrand ? 1 : 0);

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-[#0a0a0a] text-zinc-50 flex flex-col motion-safe:[animation:navMenuEnter_150ms_ease-out]">
      {view === "root" && (
        <FilterRoot
          onClose={onClose}
          onOpenCategory={() => setView("category")}
          onOpenStore={() => setView("store")}
          draftBrand={draftBrand}
          onClearDraftBrand={() => setDraftBrand("")}
          categoryCount={draftCategories.length}
          storeCount={draftStore !== ALL_STORES_VALUE ? 1 : 0}
        />
      )}
      {view === "category" && (
        <CategoryView
          onBack={() => setView("root")}
          onClose={onClose}
          draftCategories={draftCategories}
          setDraftCategories={setDraftCategories}
        />
      )}

      <footer className="absolute bottom-0 left-0 right-0 h-14 grid grid-cols-2 bg-zinc-950/95 backdrop-blur border-t border-zinc-800/60">
        <button
          onClick={handleReset}
          className="font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-300 border-r border-zinc-800/60"
        >
          RESET
        </button>
        <button
          onClick={handleApply}
          className="font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
        >
          APPLY{totalActive > 0 ? ` (${totalActive})` : ""}
        </button>
      </footer>
    </div>,
    document.body
  );
}

function CategoryView({ onBack, onClose, draftCategories, setDraftCategories }) {
  const [expanded, setExpanded] = useState(null); // shortKey or null

  const toggle = (slug) => {
    setDraftCategories((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <button onClick={onBack} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ‹ BACK
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          FILTERS
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ✕ CLOSE
        </button>
      </header>
      <div className="flex-1 px-8 pt-2 pb-20 overflow-y-auto">
        {NAV_TOP_LEVEL.map((cat) => {
          const isExpanded = expanded === cat.shortKey;
          const subs = SUBCATEGORIES_BY_SHORTKEY[cat.shortKey];
          return (
            <div key={cat.slug}>
              <button
                onClick={() => setExpanded(isExpanded ? null : cat.shortKey)}
                className="flex items-center justify-between w-full py-4 border-b border-zinc-900 font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
              >
                <span>{cat.label.toUpperCase()}</span>
                <span className="text-zinc-50 text-[15px] font-extralight leading-none">
                  {isExpanded ? "−" : "+"}
                </span>
              </button>
              {isExpanded && (
                <div className="py-3 flex flex-col gap-3 border-b border-zinc-900">
                  <OptionRow
                    label={`View All ${cat.label}`}
                    checked={draftCategories.includes(cat.slug)}
                    onChange={() => toggle(cat.slug)}
                  />
                  {subs && subs.items.slice(1).map(([slug, sublabel]) => (
                    <OptionRow
                      key={slug}
                      label={sublabel}
                      checked={draftCategories.includes(slug)}
                      onChange={() => toggle(slug)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function OptionRow({ label, checked, onChange }) {
  return (
    <button
      onClick={onChange}
      className="flex items-center font-mono text-[9px] tracking-[0.28em] uppercase text-zinc-50"
    >
      <span
        className={`inline-block w-[11px] h-[11px] mr-3.5 border border-zinc-50 ${checked ? "bg-zinc-50" : ""}`}
      />
      {label}
    </button>
  );
}

function FilterRoot({
  onClose,
  onOpenCategory,
  onOpenStore,
  draftBrand,
  onClearDraftBrand,
  categoryCount,
  storeCount,
}) {
  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <span />
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          FILTERS
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ✕ CLOSE
        </button>
      </header>
      <div className="flex-1 px-8 pt-6 pb-20 overflow-y-auto">
        {draftBrand && (
          <>
            <p className="font-mono text-[8.5px] tracking-[0.32em] uppercase text-zinc-500 mb-2 mt-1">
              Active
            </p>
            <div className="flex items-center justify-between py-3 border-b border-zinc-900">
              <span className="font-mono text-[10px] tracking-[0.28em] uppercase text-zinc-50">
                <span className="text-zinc-500 mr-2">Brand</span>{draftBrand}
              </span>
              <button onClick={onClearDraftBrand} aria-label="Clear brand" className="text-zinc-300 text-[14px] leading-none">×</button>
            </div>
            <div className="h-4" />
          </>
        )}
        <button
          onClick={onOpenCategory}
          className="flex items-center justify-between w-full py-4 border-b border-zinc-900 font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
        >
          <span>
            CATEGORY
            {categoryCount > 0 && (
              <span className="ml-2 text-zinc-500 tracking-[0.18em]">· {categoryCount}</span>
            )}
          </span>
          <span className="text-zinc-600 text-[14px] font-light">›</span>
        </button>
        <button
          onClick={onOpenStore}
          className="flex items-center justify-between w-full py-4 border-b border-zinc-900 font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
        >
          <span>
            STORE
            {storeCount > 0 && (
              <span className="ml-2 text-zinc-500 tracking-[0.18em]">· {storeCount}</span>
            )}
          </span>
          <span className="text-zinc-600 text-[14px] font-light">›</span>
        </button>
      </div>
    </>
  );
}
