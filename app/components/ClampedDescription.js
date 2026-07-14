"use client";

import { useEffect, useRef, useState } from "react";
import T from "./T";

// ~10-line clamp with a quiet More/Less toggle, shown only when the text
// actually overflows. Small client leaf so ProductInfoPanel stays a server
// component.
export default function ClampedDescription({ text }) {
  const ref = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // ResizeObserver fires once on observe, so no synchronous initial check.
    const ro = new ResizeObserver(() =>
      setOverflowing(el.scrollHeight > el.clientHeight + 1),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  if (!text) return null;

  return (
    <div>
      <p
        ref={ref}
        className="font-sans text-[13px] leading-[1.7] text-zinc-600"
        style={
          expanded
            ? undefined
            : {
                display: "-webkit-box",
                WebkitLineClamp: 10,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }
        }
      >
        {text}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 underline underline-offset-[5px] decoration-[0.5px] hover:text-zinc-900 transition-colors"
        >
          <T k={expanded ? "product.readLess" : "product.readMore"} />
        </button>
      )}
    </div>
  );
}
