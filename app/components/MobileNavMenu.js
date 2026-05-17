"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

const CONTACT_EMAIL = "hello@depot.paris";

export default function MobileNavMenu({ isOpen, onClose }) {
  // 'root' | 'shop' | { type: 'subcategory', shortKey: string, label: string }
  const [view, setView] = useState("root");

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      setView("root");
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  if (typeof document === "undefined") return null;
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-[#0a0a0a] text-zinc-50 flex flex-col motion-safe:[animation:navMenuEnter_150ms_ease-out]">
      {view === "root" && <RootView onClose={onClose} onOpenShop={() => setView("shop")} />}
      {/* SHOP and subcategory views land in Task 2 */}
    </div>,
    document.body
  );
}

function RootView({ onClose, onOpenShop }) {
  return (
    <>
      <header className="flex items-center justify-between h-[50px] px-5 shrink-0">
        <Link href="/" onClick={onClose} className="font-mono text-[11px] tracking-[0.32em] uppercase">
          DÉPÔT
        </Link>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ✕ CLOSE
        </button>
      </header>
      <div className="flex-1 flex flex-col px-8 pt-12 pb-8">
        <button
          onClick={onOpenShop}
          className="flex items-center justify-between py-6 font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-50"
        >
          <span>SHOP</span><span className="text-zinc-600 text-[14px] font-light">›</span>
        </button>
        <Link
          href="/stores"
          onClick={onClose}
          className="flex items-center justify-between py-6 font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-50"
        >
          <span>STORES</span><span className="text-zinc-600 text-[14px] font-light">›</span>
        </Link>
        <Link
          href="/designers"
          onClick={onClose}
          className="flex items-center justify-between py-6 font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-50"
        >
          <span>DESIGNERS</span><span className="text-zinc-600 text-[14px] font-light">›</span>
        </Link>
        <div className="mt-auto pt-8 border-t border-zinc-900 flex flex-col gap-4">
          <Link href="/about" onClick={onClose} className="font-sans text-[11px] text-zinc-500">
            About
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} onClick={onClose} className="font-sans text-[11px] text-zinc-500">
            Contact
          </a>
        </div>
      </div>
    </>
  );
}
