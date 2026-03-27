"use client";

import { useEffect } from "react";
import { ALL_STORES_VALUE } from "../lib/feed-utils";

const CATEGORY_LABELS = {
  tops: "Tops",
  tops_hoodies_sweaters: "Hoodies & Sweaters",
  tops_shirts_blouses: "Shirts & Blouses",
  tops_tees: "Tees",
  tops_knitwear: "Knitwear",
  bottoms: "Bottoms",
  dresses_skirts: "Dresses & Skirts",
  jackets_coats: "Jackets & Coats",
  footwear: "Footwear",
  bags_accessories: "Bags & Accessories",
  sets: "Sets",
};

const CATEGORY_GROUPS = [
  {
    label: "Tops",
    items: [
      ["tops", "All Tops"],
      ["tops_hoodies_sweaters", "Hoodies & Sweaters"],
      ["tops_shirts_blouses", "Shirts & Blouses"],
      ["tops_tees", "Tees"],
      ["tops_knitwear", "Knitwear"],
    ],
  },
  {
    label: "Bottoms",
    items: [["bottoms", "Bottoms"]],
  },
  {
    label: "Dresses & Skirts",
    items: [["dresses_skirts", "Dresses & Skirts"]],
  },
  {
    label: "Jackets & Coats",
    items: [["jackets_coats", "All Jackets & Coats"]],
  },
  {
    label: "Footwear",
    items: [["footwear", "Footwear"]],
  },
  {
    label: "Bags & Accessories",
    items: [["bags_accessories", "All Bags & Accessories"]],
  },
  {
    label: "Sets",
    items: [["sets", "Sets"]],
  },
];

export default function MobileFilterDrawer({
  isOpen,
  onClose,
  selectedCategories,
  onToggleCategory,
  selectedStore,
  storeOptions,
  onStoreChange,
  onClearAll,
}) {
  // Lock body scroll when open
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

  if (!isOpen) return null;

  const activeCount = selectedCategories.length + (selectedStore !== ALL_STORES_VALUE ? 1 : 0);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4 shrink-0">
        <button
          type="button"
          onPointerDown={onClose}
          className="font-mono text-[11px] uppercase tracking-widest text-zinc-400"
        >
          Cancel
        </button>
        <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-50">
          Refine
        </span>
        <button
          type="button"
          onPointerDown={onClearAll}
          className="font-mono text-[11px] uppercase tracking-widest text-zinc-400"
        >
          Clear
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-32">
        {/* Store filter */}
        <div className="border-b border-zinc-800 px-5 py-5">
          <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            Store
          </p>
          <div className="flex flex-wrap gap-2">
            {storeOptions.map((opt) => {
              const active = opt.value === selectedStore;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onPointerDown={() => onStoreChange(active ? ALL_STORES_VALUE : opt.value)}
                  className={`rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                    active
                      ? "border-zinc-50 text-zinc-50"
                      : "border-zinc-700 text-zinc-400"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Category filter */}
        <div className="px-5 py-5">
          <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            Category
          </p>
          <div className="space-y-6">
            {CATEGORY_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="flex flex-wrap gap-2">
                  {group.items.map(([value, label]) => {
                    const active = selectedCategories.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        onPointerDown={() => onToggleCategory(value)}
                        className={`rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                          active
                            ? "border-zinc-50 text-zinc-50"
                            : "border-zinc-700 text-zinc-400"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Apply button */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-zinc-800 bg-[#0a0a0a] px-5 py-5">
        <button
          type="button"
          onPointerDown={onClose}
          className="w-full rounded-none bg-zinc-50 py-4 font-mono text-[11px] uppercase tracking-widest text-zinc-950"
        >
          {activeCount > 0 ? `Apply (${activeCount})` : "Apply"}
        </button>
      </div>
    </div>
  );
}