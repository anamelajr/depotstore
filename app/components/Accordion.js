"use client";

import { useState } from "react";

export default function Accordion({ label, children, isLast = false }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`border-t border-zinc-100 ${isLast ? "border-b" : ""}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between py-[22px] font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-900"
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-zinc-400 text-[14px] leading-none">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div className="pb-6 font-sans text-[13px] leading-[1.7] text-zinc-600">
          {children}
        </div>
      )}
    </div>
  );
}
