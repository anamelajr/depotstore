"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ALL_STORES_VALUE } from "../lib/feed-utils";
import { getNavTopLevel, getSubcategoriesByShortKey } from "../lib/categories.js";
import { useLanguage } from "./LanguageProvider";

export default function MobileFilterPanel({
  isOpen,
  onClose,
  selectedCategories,
  selectedStore,
  selectedBrand,
  storeOptions,
  onApply,        // (next: { categories, store, brand }) => void  — all three commit atomically
}) {
  const { t } = useLanguage();
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
    <div className="fixed inset-0 z-[9999] bg-white text-zinc-950 flex flex-col motion-safe:[animation:navMenuEnter_150ms_ease-out]">
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
      {view === "store" && (
        <StoreView
          onBack={() => setView("root")}
          onClose={onClose}
          draftStore={draftStore}
          setDraftStore={setDraftStore}
          storeOptions={storeOptions}
        />
      )}

      <footer className="absolute bottom-0 left-0 right-0 h-14 grid grid-cols-2 bg-white/95 backdrop-blur border-t border-zinc-200">
        <button
          onClick={handleReset}
          className="font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-500 border-r border-zinc-200"
        >
          {t("filter.reset").toUpperCase()}
        </button>
        <button
          onClick={handleApply}
          className="font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-950"
        >
          {t("filter.apply").toUpperCase()}{totalActive > 0 ? ` (${totalActive})` : ""}
        </button>
      </footer>
    </div>,
    document.body
  );
}

function CategoryView({ onBack, onClose, draftCategories, setDraftCategories }) {
  const { language, t } = useLanguage();
  const navTopLevel = getNavTopLevel(language);
  const subcatByShortKey = getSubcategoriesByShortKey(language);
  const [expanded, setExpanded] = useState(null); // shortKey or null

  const toggle = (slug) => {
    setDraftCategories((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <button onClick={onBack} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-500">
          ‹ {t("nav.back").toUpperCase()}
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          {t("filter.filters").toUpperCase()}
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-500">
          ✕ {t("nav.close").toUpperCase()}
        </button>
      </header>
      <div className="flex-1 px-8 pt-2 pb-20 overflow-y-auto">
        {navTopLevel.map((cat) => {
          const isExpanded = expanded === cat.shortKey;
          const subs = subcatByShortKey[cat.shortKey];
          return (
            <div key={cat.slug}>
              <button
                onClick={() => setExpanded(isExpanded ? null : cat.shortKey)}
                className="flex items-center justify-between w-full py-4 border-b border-zinc-200 font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-950"
              >
                <span>{cat.label.toUpperCase()}</span>
                <span className="text-zinc-950 text-[15px] font-extralight leading-none">
                  {isExpanded ? "−" : "+"}
                </span>
              </button>
              {isExpanded && (
                <div className="py-3 flex flex-col gap-3 border-b border-zinc-200">
                  <OptionRow
                    label={subs ? subs.items[0][1] : `${t("filter.viewAll")} ${cat.label}`}
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
      className="flex items-center font-mono text-[9px] tracking-[0.28em] uppercase text-zinc-950"
    >
      <span
        className={`inline-block w-[11px] h-[11px] mr-3.5 border border-zinc-950 ${checked ? "bg-zinc-950" : ""}`}
      />
      {label}
    </button>
  );
}

function StoreView({ onBack, onClose, draftStore, setDraftStore, storeOptions }) {
  const { t } = useLanguage();
  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <button onClick={onBack} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-500">
          ‹ {t("nav.back").toUpperCase()}
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          {t("filter.filters").toUpperCase()}
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-500">
          ✕ {t("nav.close").toUpperCase()}
        </button>
      </header>
      <div className="flex-1 px-8 pt-6 pb-20 overflow-y-auto flex flex-col gap-3">
        <OptionRow
          label={t("filter.allStores")}
          checked={draftStore === ALL_STORES_VALUE}
          onChange={() => setDraftStore(ALL_STORES_VALUE)}
        />
        {storeOptions
          .filter((s) => s.value !== ALL_STORES_VALUE)
          .map((s) => (
            <OptionRow
              key={s.value}
              label={s.label}
              checked={draftStore === s.value}
              onChange={() => setDraftStore(s.value)}
            />
          ))}
      </div>
    </>
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
  const { t } = useLanguage();
  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <span />
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          {t("filter.filters").toUpperCase()}
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-500">
          ✕ {t("nav.close").toUpperCase()}
        </button>
      </header>
      <div className="flex-1 px-8 pt-6 pb-20 overflow-y-auto">
        {draftBrand && (
          <>
            <p className="font-mono text-[8.5px] tracking-[0.32em] uppercase text-zinc-400 mb-2 mt-1">
              {t("filter.active")}
            </p>
            <div className="flex items-center justify-between py-3 border-b border-zinc-200">
              <span className="font-mono text-[10px] tracking-[0.28em] uppercase text-zinc-950">
                <span className="text-zinc-400 mr-2">{t("filter.brand")}</span>{draftBrand}
              </span>
              <button onClick={onClearDraftBrand} aria-label={t("filter.clearBrand")} className="text-zinc-500 text-[14px] leading-none">×</button>
            </div>
            <div className="h-4" />
          </>
        )}
        <button
          onClick={onOpenCategory}
          className="flex items-center justify-between w-full py-4 border-b border-zinc-200 font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-950"
        >
          <span>
            {t("filter.category").toUpperCase()}
            {categoryCount > 0 && (
              <span className="ml-2 text-zinc-400 tracking-[0.18em]">· {categoryCount}</span>
            )}
          </span>
          <span className="text-zinc-400 text-[14px] font-light">›</span>
        </button>
        <button
          onClick={onOpenStore}
          className="flex items-center justify-between w-full py-4 border-b border-zinc-200 font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-950"
        >
          <span>
            {t("filter.store").toUpperCase()}
            {storeCount > 0 && (
              <span className="ml-2 text-zinc-400 tracking-[0.18em]">· {storeCount}</span>
            )}
          </span>
          <span className="text-zinc-400 text-[14px] font-light">›</span>
        </button>
      </div>
    </>
  );
}
