"use client";

/**
 * StoreFilterBar component for high-end editorial archive platform.
 * Supports "light" (hero) and "dark" (feed) variants.
 */
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
      className={[
        "flex items-center gap-6 overflow-x-auto whitespace-nowrap pb-1",
        isLight ? "" : "text-[11px] uppercase tracking-widest",
      ].join(" ")}
    >
      {!isLight && <span className="text-zinc-600">Store:</span>}
      {options.map((opt) => {
        const active = opt.value === selectedValue;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              onChange(opt.value);
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
