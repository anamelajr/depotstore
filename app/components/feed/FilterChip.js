"use client";

export default function FilterChip({ label, value, onClear, clearLabel }) {
  return (
    <button
      type="button"
      onClick={onClear}
      title={`${label} ${value} — click to clear`}
      aria-label={clearLabel}
      className="group inline-flex items-center gap-2 border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-zinc-900 transition-colors hover:bg-zinc-200"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500 group-hover:text-zinc-600">
        {label}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-[0.28em] max-w-[200px] truncate">
        {value}
      </span>
      <svg
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="text-zinc-500 group-hover:text-zinc-950 transition-colors"
      >
        <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
  );
}
