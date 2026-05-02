"use client";

import { useEffect, useRef } from "react";
import { ALL_STORES_VALUE } from "../../lib/feed-utils";

// Flat category list. Sub-items get extra left padding via `indent: true`.
// Order and labels match MobileFilterDrawer.CATEGORY_GROUPS exactly.
const CATEGORY_ITEMS = [
  { value: "tops",                  label: "All Tops",                 indent: false },
  { value: "tops_hoodies_sweaters", label: "Hoodies & Sweaters",       indent: true  },
  { value: "tops_shirts_blouses",   label: "Shirts & Blouses",         indent: true  },
  { value: "tops_tees",             label: "Tees",                     indent: true  },
  { value: "tops_knitwear",         label: "Knitwear",                 indent: true  },
  { value: "bottoms",               label: "Bottoms",                  indent: false },
  { value: "dresses_skirts",        label: "Dresses & Skirts",         indent: false },
  { value: "jackets_coats",         label: "All Jackets & Coats",      indent: false },
  { value: "footwear",              label: "Footwear",                 indent: false },
  { value: "bags_accessories",      label: "All Bags & Accessories",   indent: false },
  { value: "sets",                  label: "Sets",                     indent: false },
];

export default function DesktopFilterPanel({
  isOpen,
  onClose,
  selectedCategories,
  onToggleCategory,
  selectedStore,
  storeOptions,
  onStoreChange,
  onClearAll,
}) {
  const closeButtonRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const panelRef = useRef(null);

  // Body scroll lock while open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Move focus into the panel on open; restore on close
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement;
      requestAnimationFrame(() => {
        closeButtonRef.current?.focus();
      });
    } else if (previouslyFocusedRef.current) {
      previouslyFocusedRef.current.focus?.();
      previouslyFocusedRef.current = null;
    }
  }, [isOpen]);

  // Escape closes
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Focus trap: while the panel is open, Tab cycles within it instead of
  // escaping into the feed/floating bar behind the overlay. Without this
  // the dialog's aria-modal would be a lie: keyboard users could tab past
  // the Reset button into product cards and trigger background navigation.
  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;

    const handleTab = (e) => {
      if (e.key !== "Tab") return;
      const focusable = panel.querySelectorAll(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [isOpen]);

  // NOTE: panel and overlay stay mounted always so the slide/fade transitions
  // can run on open AND close. Visibility is controlled via transform + opacity
  // classes plus pointer-events-none on the overlay when closed.
  //
  // The `inert` attribute on the closed panel removes its buttons from the
  // tab order AND blocks pointer events — necessary because translateX off-
  // screen leaves them keyboard-focusable. React 19 supports boolean toggling
  // of `inert` directly via the JSX boolean attribute syntax.

  return (
    <>
      {/* Overlay — dims the feed, click to close */}
      <div
        className={`hidden md:block fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Refine filters"
        aria-hidden={!isOpen}
        inert={!isOpen}
        className={`hidden md:flex flex-col fixed left-0 top-0 h-screen w-[360px] bg-[#0a0a0a] border-r border-zinc-800 z-50 transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-5 border-b border-zinc-800 shrink-0">
          <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-50">
            Refine
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="font-mono text-[18px] leading-none text-zinc-400 transition-colors hover:text-zinc-50"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-8">
          {/* STORE section */}
          <section>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
              Store
            </p>
            {storeOptions.map((opt) => {
              const active = opt.value === selectedStore;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    if (opt.value === ALL_STORES_VALUE) {
                      // Re-clicking "All Stores" while active is a no-op
                      if (!active) onStoreChange(ALL_STORES_VALUE);
                    } else {
                      onStoreChange(active ? ALL_STORES_VALUE : opt.value);
                    }
                  }}
                  className={`block w-full text-left py-2 pl-4 font-mono text-[11px] uppercase tracking-widest transition-colors ${
                    active ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50"
                  }`}
                >
                  {active && <span className="-ml-4 mr-1">— </span>}
                  {opt.label}
                </button>
              );
            })}
          </section>

          {/* CATEGORY section */}
          <section>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
              Category
            </p>
            {CATEGORY_ITEMS.map((item) => {
              const active = selectedCategories.includes(item.value);
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onToggleCategory(item.value)}
                  className={`block w-full text-left py-2 font-mono text-[11px] uppercase tracking-widest transition-colors ${
                    item.indent ? "pl-8" : "pl-4"
                  } ${
                    active ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50"
                  }`}
                >
                  {active && <span className="-ml-4 mr-1">— </span>}
                  {item.label}
                </button>
              );
            })}
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-5 py-4 shrink-0">
          <button
            type="button"
            onClick={onClearAll}
            className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 transition-colors hover:text-zinc-50"
          >
            Reset
          </button>
        </div>
      </aside>
    </>
  );
}
