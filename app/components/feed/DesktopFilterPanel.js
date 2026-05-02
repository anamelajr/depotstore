"use client";

import { useState, useEffect, useRef } from "react";
import { ALL_STORES_VALUE } from "../../lib/feed-utils";

// Grouped category hierarchy. Groups with `children` are collapsible;
// groups without are direct filter buttons.
const CATEGORY_GROUPS = [
  {
    value: "tops",
    label: "Tops",
    children: [
      { value: "tops",                  label: "All Tops"          },
      { value: "tops_hoodies_sweaters", label: "Hoodies & Sweaters" },
      { value: "tops_shirts_blouses",   label: "Shirts & Blouses"   },
      { value: "tops_tees",             label: "Tees"               },
      { value: "tops_knitwear",         label: "Knitwear"           },
    ],
  },
  { value: "bottoms",        label: "Bottoms"          },
  { value: "dresses_skirts", label: "Dresses & Skirts" },
  {
    value: "jackets_coats",
    label: "Jackets & Coats",
    children: [
      { value: "jackets_coats", label: "All Jackets & Coats" },
      { value: "jackets",       label: "Jackets"              },
      { value: "coats",         label: "Coats"                },
    ],
  },
  { value: "footwear", label: "Footwear" },
  {
    value: "bags_accessories",
    label: "Bags & Accessories",
    children: [
      { value: "bags_accessories", label: "All Bags & Accessories" },
      { value: "bags",             label: "Bags"                   },
      { value: "accessories",      label: "Accessories"            },
    ],
  },
  { value: "sets", label: "Sets" },
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

  // `manuallyExpanded` tracks groups the user has explicitly toggled open.
  // A group is visible if manually expanded OR if it has an active child —
  // computed inline at render so no useEffect → setState is needed.
  const [manuallyExpanded, setManuallyExpanded] = useState(new Set());

  const toggleGroup = (value) => {
    setManuallyExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const isGroupExpanded = (group) =>
    manuallyExpanded.has(group.value) ||
    Boolean(group.children?.some((c) => selectedCategories.includes(c.value)));

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

  // Focus trap: Tab cycles within the panel while it's open
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

  return (
    <>
      {/* Overlay */}
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
          {/* CATEGORY section — above store */}
          <section>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
              Category
            </p>
            {CATEGORY_GROUPS.map((group) => {
              if (!group.children) {
                // Leaf — direct filter button
                const active = selectedCategories.includes(group.value);
                return (
                  <button
                    key={group.value}
                    type="button"
                    onClick={() => onToggleCategory(group.value)}
                    className={`block w-full text-left py-2 pl-4 font-mono text-[11px] uppercase tracking-widest transition-colors ${
                      active ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50"
                    }`}
                  >
                    {active && <span className="-ml-4 mr-1">— </span>}
                    {group.label}
                  </button>
                );
              }

              // Expandable group
              const isExpanded = isGroupExpanded(group);
              const hasActiveChild = group.children.some((c) =>
                selectedCategories.includes(c.value)
              );

              return (
                <div key={group.value}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.value)}
                    className={`flex w-full items-center justify-between py-2 pl-4 pr-1 font-mono text-[11px] uppercase tracking-widest transition-colors ${
                      hasActiveChild ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50"
                    }`}
                  >
                    <span>{group.label}</span>
                    <span className="text-zinc-600 text-[13px] leading-none pr-1">
                      {isExpanded ? "−" : "+"}
                    </span>
                  </button>
                  {isExpanded && (
                    <div>
                      {group.children.map((child) => {
                        const active = selectedCategories.includes(child.value);
                        return (
                          <button
                            key={child.value}
                            type="button"
                            onClick={() => onToggleCategory(child.value)}
                            className={`block w-full text-left py-2 pl-8 font-mono text-[11px] uppercase tracking-widest transition-colors ${
                              active ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50"
                            }`}
                          >
                            {active && <span className="-ml-4 mr-1">— </span>}
                            {child.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {/* STORE section — below category */}
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
