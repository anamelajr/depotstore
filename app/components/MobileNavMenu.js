"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { NAV_TOP_LEVEL, SUBCATEGORIES_BY_SHORTKEY } from "../lib/categories.js";
import { buildFreshFeedUrl } from "../lib/feed-utils";

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
      {view === "root" && (
        <RootView onClose={onClose} onOpenShop={() => setView("shop")} />
      )}
      {view === "shop" && (
        <ShopView
          onClose={onClose}
          onBack={() => setView("root")}
          onOpenSubcategory={(sub) => setView({ type: "subcategory", ...sub })}
        />
      )}
      {typeof view === "object" && view.type === "subcategory" && (
        <SubcategoryView
          onClose={onClose}
          onBack={() => setView("shop")}
          shortKey={view.shortKey}
          label={view.label}
        />
      )}
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

function ShopView({ onClose, onBack, onOpenSubcategory }) {
  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <button onClick={onBack} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ‹ BACK
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          SHOP
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ✕
        </button>
      </header>
      <div className="flex-1 px-8 pt-10 pb-8 flex flex-col gap-6 overflow-y-auto">
        {NAV_TOP_LEVEL.map((cat) => {
          const subs = SUBCATEGORIES_BY_SHORTKEY[cat.shortKey];
          const hasSubs = !!subs;
          if (hasSubs) {
            return (
              <button
                key={cat.slug}
                onClick={() => onOpenSubcategory({ shortKey: cat.shortKey, label: cat.label })}
                className="flex items-center justify-between font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
              >
                <span>{cat.label.toUpperCase()}</span>
                <span className="text-zinc-600 text-[14px] font-light">›</span>
              </button>
            );
          }
          return (
            <Link
              key={cat.slug}
              href={buildFreshFeedUrl({ category: [cat.slug] })}
              onClick={onClose}
              className="flex items-center justify-between font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
            >
              <span>{cat.label.toUpperCase()}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function SubcategoryView({ onClose, onBack, shortKey, label }) {
  const subs = SUBCATEGORIES_BY_SHORTKEY[shortKey];
  if (!subs) return null;
  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <button onClick={onBack} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ‹ BACK
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          {label.toUpperCase()}
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-400">
          ✕
        </button>
      </header>
      <div className="flex-1 px-8 pt-10 pb-8 flex flex-col gap-6 overflow-y-auto">
        {subs.items.slice(1).map(([slug, sublabel]) => (
          <Link
            key={slug}
            href={buildFreshFeedUrl({ category: [slug] })}
            onClick={onClose}
            className="font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50"
          >
            {sublabel}
          </Link>
        ))}
      </div>
    </>
  );
}
