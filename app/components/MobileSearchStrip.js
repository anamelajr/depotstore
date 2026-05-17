"use client";

export default function MobileSearchStrip({ query, onClear }) {
  if (!query) return null;
  return (
    <div className="md:hidden sticky top-[50px] z-30 flex items-center justify-between px-4 py-2 bg-zinc-950/95 backdrop-blur border-b border-zinc-800/60">
      <span className="font-mono text-[9px] tracking-[0.28em] uppercase text-zinc-400">
        Searching: <span className="text-zinc-200">&ldquo;{query}&rdquo;</span>
      </span>
      <button
        onClick={onClear}
        aria-label={`Clear search ${query}`}
        className="text-zinc-300 hover:text-zinc-50 transition-colors p-1 font-mono text-[14px] leading-none"
      >
        ×
      </button>
    </div>
  );
}
