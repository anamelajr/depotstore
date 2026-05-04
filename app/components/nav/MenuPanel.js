"use client";

import { useEffect } from "react";

export default function MenuPanel({ isOpen, onClose, children }) {
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-x-0 top-[var(--nav-height)] bottom-0 z-[1100] bg-[#0a0a0a] text-zinc-50 overflow-y-auto motion-safe:[animation:navMenuEnter_150ms_ease-out]"
    >
      <div className="mx-auto grid w-full max-w-7xl grid-cols-[320px_1fr]">
        {children}
      </div>
    </div>
  );
}
