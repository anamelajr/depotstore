"use client";

import { useRef, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { buildFreshFeedUrl } from "../lib/feed-utils";
import Link from "next/link";
import { createPortal } from "react-dom";
import DesktopNav from "./DesktopNav";

const CONTACT_EMAIL = "hello@depot.paris";

const CATEGORY_ITEMS = {
  tops: [
    ["tops", "All Tops"],
    ["tops_hoodies_sweaters", "Hoodies & Sweaters"],
    ["tops_shirts_blouses", "Shirts & Blouses"],
    ["tops_tees", "Tees"],
    ["tops_knitwear", "Knitwear"],
  ],
  jackets: [
    ["jackets_coats", "All Jackets & Coats"],
    ["jackets", "Jackets"],
    ["coats", "Coats"],
  ],
  bags: [
    ["bags_accessories", "All Bags & Accessories"],
    ["bags", "Bags"],
    ["accessories", "Accessories"],
  ],
};

const MOBILE_NAV_ITEMS = [
  { label: "TOPS", href: "/feed?category=tops", key: "tops" },
  { label: "BOTTOMS", href: "/feed?category=bottoms", key: "bottoms" },
  { label: "DRESSES & SKIRTS", href: "/feed?category=dresses_skirts", key: "dresses_skirts" },
  { label: "JACKETS & COATS", href: "/feed?category=jackets_coats", key: "jackets_coats" },
  { label: "FOOTWEAR", href: "/feed?category=footwear", key: "footwear" },
  { label: "BAGS & ACCESSORIES", href: "/feed?category=bags_accessories", key: "bags_accessories" },
  { label: "SETS", href: "/feed?category=sets", key: "sets" },
];

const MOBILE_NAV_SECONDARY = [
  { label: "STORES", href: "/stores" },
  { label: "DESIGNERS", href: "/designers" },
];

function MobileNav({ isOpen, onClose, onAboutOpen, searchParams }) {
  const [expandedKey, setExpandedKey] = useState(null);
  const selectedCategories = searchParams.getAll("category");

  useEffect(() => {
    onClose();
    setExpandedKey(null);
  }, [searchParams]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9998] bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between h-[50px] px-5 border-b border-zinc-800 shrink-0">
        <Link href="/" onClick={onClose} className="font-mono text-[13px] tracking-[0.15em] text-zinc-50">
          DÉPÔT
        </Link>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-50 transition-colors p-1">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {MOBILE_NAV_ITEMS.map(({ label, href, key }) => {
          const subKey = key.split("_")[0];
          const hasSubs = !!CATEGORY_ITEMS[subKey];
          const isExpanded = expandedKey === subKey;
          return (
            <div key={key}>
              <div
                className="flex items-center justify-between px-5 py-4 border-b border-zinc-900 active:bg-zinc-900 transition-colors"
                onClick={() => {
                  if (hasSubs) {
                    setExpandedKey(isExpanded ? null : subKey);
                  } else {
                    onClose();
                    window.location.href = buildFreshFeedUrl({ category: [key] });
                  }
                }}
              >
                <span className="font-mono text-[11px] tracking-widest uppercase text-zinc-400">
                  {label}
                </span>
                {hasSubs && (
                  <svg
                    width="12" height="12" viewBox="0 0 12 12" fill="none"
                    className={`text-zinc-600 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                  >
                    <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                )}
              </div>

              {/* Sub-categories */}
              {hasSubs && isExpanded && (
                <div className="bg-zinc-950 border-b border-zinc-800">
                  {CATEGORY_ITEMS[subKey].map(([value, sublabel]) => {
                    const subIsActive = selectedCategories.includes(value);
                    return (
                      <Link
                        key={value}
                        href={buildFreshFeedUrl({ category: [value] })}
                        onClick={onClose}
                        className="flex items-center px-8 py-3 border-b border-zinc-900 last:border-0"
                      >
                        <span className={`font-mono text-[10px] tracking-widest uppercase ${subIsActive ? "text-zinc-300" : "text-zinc-600"}`}>
                          {sublabel}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Secondary nav */}
        {MOBILE_NAV_SECONDARY.map(({ label, href }) => (
          <Link
            key={label}
            href={href}
            onClick={onClose}
            className="flex items-center justify-between px-5 py-4 border-b border-zinc-900 active:bg-zinc-900 transition-colors"
          >
            <span className="font-mono text-[11px] tracking-widest uppercase text-zinc-400">
              {label}
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-zinc-700">
              <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
          </Link>
        ))}

        <Link
          href="/about"
          onClick={onClose}
          className="flex items-center justify-between px-5 py-4 border-b border-zinc-900 active:bg-zinc-900 transition-colors"
        >
          <span className="font-mono text-[11px] tracking-widest uppercase text-zinc-400">ABOUT</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-zinc-700">
            <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </Link>

        <a
          href={`mailto:${CONTACT_EMAIL}`}
          onClick={onClose}
          className="flex items-center justify-between px-5 py-4 border-b border-zinc-900 active:bg-zinc-900 transition-colors"
        >
          <span className="font-mono text-[11px] tracking-widest uppercase text-zinc-400">CONTACT</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-zinc-700">
            <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </a>
      </div>
    </div>
  );
}

export default function Nav({ onAboutOpen, stores = [] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [mobileSearchQuery, setMobileSearchQuery] = useState("");
  const mobileSearchInputRef = useRef(null);

  useEffect(() => {
    if (isMobileSearchOpen && mobileSearchInputRef.current) {
      mobileSearchInputRef.current.focus();
    }
  }, [isMobileSearchOpen]);

  return (
    <>
      {/* Mobile nav */}
      <nav className="sticky top-0 z-50 flex h-[50px] items-center border-b border-zinc-800 bg-[#0a0a0a]/95 text-zinc-50 backdrop-blur md:hidden">
        <div className="mx-auto flex w-full max-w-7xl items-center px-4">
          <div className="flex items-center justify-between w-full">
            {isMobileSearchOpen ? (
              <div className="flex items-center w-full h-[50px] px-5 gap-3">
                <input
                  ref={mobileSearchInputRef}
                  type="text"
                  value={mobileSearchQuery}
                  onChange={(e) => setMobileSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const trimmed = mobileSearchQuery.trim();
                      if (trimmed) {
                        router.push(`/feed?search=${encodeURIComponent(trimmed)}`);
                      }
                      setIsMobileSearchOpen(false);
                      setMobileSearchQuery("");
                    }
                  }}
                  placeholder="Search archive..."
                  className="font-mono tracking-widest uppercase bg-transparent text-zinc-50 placeholder-zinc-600 outline-none flex-1 origin-left"
                  style={{ fontSize: '16px', transform: 'scale(0.6875)', width: '145%' }}
                />
                <button
                  onClick={() => {
                    setMobileSearchQuery("");
                    setIsMobileSearchOpen(false);
                  }}
                  className="text-zinc-400 hover:text-zinc-50 transition-colors p-1"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                </button>
              </div>
            ) : (
              <>
                <Link href="/" className="font-mono text-[13px] tracking-[0.15em] text-zinc-50">
                  DÉPÔT
                </Link>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsMobileSearchOpen(true)}
                    className="text-zinc-300 hover:text-zinc-50 transition-colors p-1"
                    aria-label="Search"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => setIsMobileOpen(true)}
                    className="flex flex-col gap-[5px] p-1 text-zinc-300 hover:text-zinc-50 transition-colors"
                    aria-label="Open menu"
                  >
                    <span className="block w-5 h-px bg-current" />
                    <span className="block w-5 h-px bg-current" />
                    <span className="block w-3.5 h-px bg-current" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Desktop nav */}
      <DesktopNav stores={stores} />

      {/* Mobile overlay */}
      {typeof document !== "undefined" && createPortal(
        <MobileNav
          isOpen={isMobileOpen}
          onClose={() => setIsMobileOpen(false)}
          onAboutOpen={onAboutOpen}
          searchParams={searchParams}
        />,
        document.body
      )}
    </>
  );
}