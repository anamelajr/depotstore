"use client";

export default function MobileSearchStrip({ query, onClear }) {
  if (!query) return null;
  return (
    <div className="md:hidden sticky top-[50px] z-30 flex items-center justify-between px-4 py-2 bg-white/95 backdrop-blur border-b border-zinc-200">
      <span className="font-mono text-[9px] tracking-[0.28em] uppercase text-zinc-500">
        Searching: <span className="text-zinc-900">&ldquo;{query}&rdquo;</span>
      </span>
      <button
        onClick={onClear}
        aria-label={`Clear search ${query}`}
        className="text-zinc-500 hover:text-zinc-950 transition-colors p-1 font-mono text-[14px] leading-none"
      >
        ×
      </button>
    </div>
  );
}
