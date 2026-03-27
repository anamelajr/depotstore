"use client";

import { useRef, useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createPortal } from "react-dom";
import DesignersDropdown from "./DesignersDropdown";
import BRANDS from "../brands";

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

function NavLink({ href, children, active }) {
  return (
    <Link
      href={href}
      className={`font-mono text-[11px] uppercase tracking-widest transition-colors ${
        active ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50"
      }`}
    >
      {children}
    </Link>
  );
}

function MobileNav({ isOpen, onClose, onAboutOpen, searchParams }) {
  const [expandedKey, setExpandedKey] = useState(null);
  const selectedCategory = searchParams.get("category");

  // Close on route change
  useEffect(() => {
    onClose();
  }, [searchParams]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  if (!isOpen) return null;

  const hasSubcategories = (key) => CATEGORY_ITEMS[key.split("_")[0]];

  return (
    <div className="fixed inset-0 z-[9998] bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between h-[50px] px-5 border-b border-zinc-800 shrink-0">
        <Link href="/" onClick={onClose} className="font-mono text-[13px] tracking-[0.15em] text-zinc-50">
          DÉPÔT
        </Link>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-50 transition-colors p-1">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" stroke-width="1.5"/>
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Categories */}
        {MOBILE_NAV_ITEMS.map(({ label, href, key }) => {
          const subKey = key.split("_")[0];
          const hasSubs = !!CATEGORY_ITEMS[subKey];
          const isExpanded = expandedKey === subKey;
          const isActive = selectedCategory === key || selectedCategory?.startsWith(subKey);

          return (
            <div key={key}>
              <div
                className="flex items-center justify-between px-5 py-4 border-b border-zinc-900 active:bg-zinc-900 transition-colors"
                onClick={() => {
                  if (hasSubs) {
                    setExpandedKey(isExpanded ? null : subKey);
                  } else {
                    onClose();
                    window.location.href = href;
                  }
                }}
              >
                <span className={`font-mono text-[11px] tracking-widest uppercase ${isActive ? "text-zinc-50" : "text-zinc-400"}`}>
                  {label}
                </span>
                {hasSubs && (
                  <svg
                    width="12" height="12" viewBox="0 0 12 12" fill="none"
                    className={`text-zinc-600 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                  >
                    <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5"/>
                  </svg>
                )}
              </div>

              {/* Sub-categories */}
              {hasSubs && isExpanded && (
                <div className="bg-zinc-950 border-b border-zinc-800">
                  {CATEGORY_ITEMS[subKey].map(([value, sublabel]) => (
                    <Link
                      key={value}
                      href={`/feed?category=${value}`}
                      onClick={onClose}
                      className="flex items-center px-8 py-3 border-b border-zinc-900 last:border-0"
                    >
                      <span className={`font-mono text-[10px] tracking-widest uppercase ${selectedCategory === value ? "text-zinc-300" : "text-zinc-600"}`}>
                        {sublabel}
                      </span>
                    </Link>
                  ))}
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
              <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5"/>
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
    <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5"/>
  </svg>
</Link>

        
        <a href={`mailto:${CONTACT_EMAIL}`}
  onClick={onClose}
  className="flex items-center justify-between px-5 py-4 border-b border-zinc-900 active:bg-zinc-900 transition-colors"
>
          <span className="font-mono text-[11px] tracking-widest uppercase text-zinc-400">CONTACT</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-zinc-700">
            <path d="M4 2L8 6L4 10" stroke="currentColor" stroke-width="1.5"/>
          </svg>
        </a>
      </div>
    </div>
  );
}

export default function Nav({ onAboutOpen }) {
  const searchParams = useSearchParams();
  const selectedCategory = searchParams.get("category");
  const selectedBrand = searchParams.get("brand");

  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isDesignersOpen, setIsDesignersOpen] = useState(false);
  const [designersDropdownTop, setDesignersDropdownTop] = useState(0);
  const [categoryDropdown, setCategoryDropdown] = useState(null);
  const [categoryDropdownRect, setCategoryDropdownRect] = useState(null);
  const designersRef = useRef(null);
  const designersDropdownRef = useRef(null);
  const navRef = useRef(null);
  const designersCloseTimeoutRef = useRef(null);
  const categoryCloseTimeoutRef = useRef(null);
  const topsRef = useRef(null);
  const jacketsRef = useRef(null);
  const bagsRef = useRef(null);

  const brandsByLetter = useMemo(() => {
    const sorted = [...BRANDS].sort((a, b) => a.localeCompare(b));
    const grouped = new Map();
    for (const brand of sorted) {
      const letter = (brand[0] || "").toUpperCase();
      if (!letter.match(/[A-Z]/)) continue;
      if (!grouped.has(letter)) grouped.set(letter, []);
      grouped.get(letter).push(brand);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, []);

  const isCategoryActive = (key, value) => {
    if (!selectedCategory) return false;
    if (value) return selectedCategory === value;
    return selectedCategory?.startsWith(key);
  };

  const openDesignersDropdown = () => {
    if (designersCloseTimeoutRef.current) {
      clearTimeout(designersCloseTimeoutRef.current);
      designersCloseTimeoutRef.current = null;
    }
    if (navRef.current) {
      const rect = navRef.current.getBoundingClientRect();
      setDesignersDropdownTop(rect.bottom);
    }
    setIsDesignersOpen(true);
  };

  const scheduleCloseDesignersDropdown = () => {
    designersCloseTimeoutRef.current = setTimeout(() => setIsDesignersOpen(false), 100);
  };

  const closeDesignersDropdown = () => {
    if (designersCloseTimeoutRef.current) {
      clearTimeout(designersCloseTimeoutRef.current);
      designersCloseTimeoutRef.current = null;
    }
    setIsDesignersOpen(false);
  };

  const openCategoryDropdown = (key, ref) => {
    if (categoryCloseTimeoutRef.current) {
      clearTimeout(categoryCloseTimeoutRef.current);
      categoryCloseTimeoutRef.current = null;
    }
    setCategoryDropdown(key);
    if (ref?.current) {
      const rect = ref.current.getBoundingClientRect();
      setCategoryDropdownRect({ top: rect.bottom + 8, left: rect.left });
    }
  };

  const closeCategoryDropdown = () => {
    if (categoryCloseTimeoutRef.current) clearTimeout(categoryCloseTimeoutRef.current);
    setCategoryDropdown(null);
    setCategoryDropdownRect(null);
  };

  const scheduleCloseCategoryDropdown = () => {
    categoryCloseTimeoutRef.current = setTimeout(closeCategoryDropdown, 100);
  };

  return (
    <>
      <nav ref={navRef} className="sticky top-0 z-50 flex h-[50px] items-center border-b border-zinc-800 bg-[#0a0a0a]/95 text-zinc-50 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center px-4">

          {/* Mobile: logo + hamburger */}
          <div className="flex md:hidden items-center justify-between w-full">
            <Link href="/" className="font-mono text-[13px] tracking-[0.15em] text-zinc-50">
              DÉPÔT
            </Link>
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

          {/* Desktop: existing nav */}
          <div className="hidden md:flex items-center gap-5 overflow-x-auto whitespace-nowrap font-mono text-[11px] uppercase tracking-widest w-full">
            <div
              className="relative"
              onMouseEnter={() => openCategoryDropdown("tops", topsRef)}
              onMouseLeave={scheduleCloseCategoryDropdown}
            >
              <Link ref={topsRef} href="/feed?category=tops" className={isCategoryActive("tops") ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50" + " font-mono text-[11px] uppercase tracking-widest transition-colors"}>
                TOPS
              </Link>
            </div>

            <NavLink href="/feed?category=bottoms" active={selectedCategory === "bottoms"}>BOTTOMS</NavLink>
            <NavLink href="/feed?category=dresses_skirts" active={selectedCategory === "dresses_skirts"}>DRESSES & SKIRTS</NavLink>

            <div
              className="relative"
              onMouseEnter={() => openCategoryDropdown("jackets", jacketsRef)}
              onMouseLeave={scheduleCloseCategoryDropdown}
            >
              <Link ref={jacketsRef} href="/feed?category=jackets_coats" className={(isCategoryActive("jackets_coats") || isCategoryActive("jackets") || isCategoryActive("coats")) ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50" + " font-mono text-[11px] uppercase tracking-widest transition-colors"}>
                JACKETS & COATS
              </Link>
            </div>

            <NavLink href="/feed?category=footwear" active={selectedCategory === "footwear"}>FOOTWEAR</NavLink>

            <div
              className="relative"
              onMouseEnter={() => openCategoryDropdown("bags", bagsRef)}
              onMouseLeave={scheduleCloseCategoryDropdown}
            >
              <Link ref={bagsRef} href="/feed?category=bags_accessories" className={(isCategoryActive("bags_accessories") || isCategoryActive("bags") || isCategoryActive("accessories")) ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50" + " font-mono text-[11px] uppercase tracking-widest transition-colors"}>
                BAGS & ACCESSORIES
              </Link>
            </div>

            <NavLink href="/feed?category=sets" active={selectedCategory === "sets"}>SETS</NavLink>

            <Link href="/stores" className="font-mono text-[11px] uppercase tracking-widest text-zinc-300 transition-colors hover:text-zinc-50">
              STORES
            </Link>

            <div
              ref={designersRef}
              className="relative"
              onMouseEnter={openDesignersDropdown}
              onMouseLeave={scheduleCloseDesignersDropdown}
            >
              <Link href="/designers" className={(selectedBrand ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50") + " font-mono text-[11px] uppercase tracking-widest transition-colors"}>
                DESIGNERS
              </Link>
            </div>

            <Link href="/about" className="font-mono text-[11px] uppercase tracking-widest text-zinc-300 transition-colors hover:text-zinc-50">
  ABOUT
</Link>
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-mono text-[11px] uppercase tracking-widest text-zinc-300 transition-colors hover:text-zinc-50">
              CONTACT
            </a>
          </div>
        </div>

        {/* Desktop dropdowns */}
        {isDesignersOpen && typeof document !== "undefined" && createPortal(
          <div ref={designersDropdownRef} onMouseEnter={openDesignersDropdown} onMouseLeave={closeDesignersDropdown}>
            <DesignersDropdown isOpen={isDesignersOpen} brandsByLetter={brandsByLetter} top={designersDropdownTop} />
          </div>,
          document.body
        )}

        {categoryDropdown && categoryDropdownRect && typeof document !== "undefined" && (() => {
          const items = CATEGORY_ITEMS[categoryDropdown] || [];
          return createPortal(
            <div
              className="fixed z-[9999] min-w-[220px] border border-zinc-800 bg-[#0a0a0a] p-2 font-mono text-[11px] uppercase tracking-widest shadow-xl"
              style={{ top: categoryDropdownRect.top, left: categoryDropdownRect.left }}
              onMouseEnter={() => { if (categoryCloseTimeoutRef.current) { clearTimeout(categoryCloseTimeoutRef.current); categoryCloseTimeoutRef.current = null; } }}
              onMouseLeave={closeCategoryDropdown}
            >
              {items.map(([value, label]) => (
                <Link
                  key={value}
                  href={`/feed?category=${value}`}
                  className="block w-full px-2 py-1 text-left text-zinc-300 transition-colors hover:text-zinc-50"
                >
                  {label}
                </Link>
              ))}
            </div>,
            document.body
          );
        })()}
      </nav>

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