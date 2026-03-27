"use client";

export default function StoreFilterBar({
  options,
  selectedValue,
  onChange,
  onInteraction,
  variant = "dark",
}) {
  const isLight = variant === "light";

  return (
    <div
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      className={[
        "store-filter-bar flex overflow-x-auto whitespace-nowrap font-mono",
        isLight
          ? "items-center gap-6 pb-1"
          : "items-center gap-8 text-[11px] uppercase tracking-widest leading-none",
      ].join(" ")}
    >
      
      {!isLight && <span className="shrink-0 text-zinc-500">STORE:</span>}
      {options.map((opt) => {
        const active = opt.value === selectedValue;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              // If already selected, clicking again deselects (back to All Stores)
              const next = active ? "ALL" : opt.value;
              onChange(next);
              if (onInteraction) onInteraction();
            }}
            aria-current={active ? "page" : undefined}
            className={[
              "transition-colors",
              isLight
                ? [
                    "text-sm",
                    active
                      ? "text-zinc-950 underline decoration-zinc-800 underline-offset-4"
                      : "text-zinc-500 hover:text-zinc-950",
                  ].join(" ")
                : [
                    active
                      ? "text-zinc-50 underline underline-offset-4"
                      : "text-zinc-500 hover:text-zinc-300",
                  ].join(" "),
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}