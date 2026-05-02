"use client";

import { useEffect } from "react";
import { SORT_OPTIONS } from "../lib/sort-options";

export default function MobileSortSheet({ isOpen, onClose, selectedSort, onSortChange }) {
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

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[9998] bg-black/60"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[9999] bg-[#0a0a0a] border-t border-zinc-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-px w-8 bg-zinc-700" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-50">
            Sort
          </span>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] uppercase tracking-widest text-zinc-400"
          >
            Cancel
          </button>
        </div>

        {/* Options */}
        <div className="px-5 py-2 pb-10">
          {SORT_OPTIONS.map((opt) => {
            const active = selectedSort === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onSortChange(opt.value);
                  onClose();
                }}
                className="flex w-full items-center justify-between border-b border-zinc-900 py-4 last:border-0"
              >
                <span className={`font-mono text-[11px] uppercase tracking-widest ${active ? "text-zinc-50" : "text-zinc-400"}`}>
                  {opt.label}
                </span>
                {active && (
                  <span className="font-mono text-[11px] text-zinc-50">—</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}