"use client";

import { useEffect } from "react";
import { ALL_STORES_VALUE } from "../lib/feed-utils";
import { FILTER_GROUPS } from "../lib/categories.js";

// Mobile renders each category group as a row of chips. Leaves render as a
// single chip with the parent's full label ("Bottoms"); groups render their
// children including the synthesized "All <Label>" entry first.
const CATEGORY_GROUPS = FILTER_GROUPS.map((g) => ({
  label: g.label,
  items: g.children
    ? g.children.map((c) => [c.value, c.label])
    : [[g.value, g.label]],
}));

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
    <div className="fixed inset-0 z-[9999] flex flex-col bg-[#0a0a0a]" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-[11px] uppercase tracking-widest text-zinc-400"
        >
          Cancel
        </button>
        <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-50">
          Refine
        </span>
        <button
          type="button"
          onClick={onClearAll}
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
                  onClick={() => onStoreChange(active ? ALL_STORES_VALUE : opt.value)}
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
                        onClick={() => onToggleCategory(value)}
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
          onClick={onClose}
          className="w-full rounded-none bg-zinc-50 py-4 font-mono text-[11px] uppercase tracking-widest text-zinc-950"
        >
          {activeCount > 0 ? `Apply (${activeCount})` : "Apply"}
        </button>
      </div>
    </div>
  );
}