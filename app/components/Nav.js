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

export default function Nav({ onAboutOpen }) {
  const searchParams = useSearchParams();
  const selectedCategory = searchParams.get("category");
  const selectedBrand = searchParams.get("brand");

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
    <nav ref={navRef} className="sticky top-0 z-50 flex h-[50px] items-center border-b border-zinc-800 bg-[#0a0a0a]/95 text-zinc-50 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-5 overflow-x-auto whitespace-nowrap px-4 font-mono text-[11px] uppercase tracking-widest">
        <div
          className="relative"
          onMouseEnter={() => openCategoryDropdown("tops", topsRef)}
          onMouseLeave={scheduleCloseCategoryDropdown}
        >
          <Link ref={topsRef} href="/feed?category=tops" className={isCategoryActive("tops") ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50" + " font-mono text-[11px] uppercase tracking-widest transition-colors"}>
            TOPS
          </Link>
        </div>

        <NavLink href="/feed?category=bottoms" active={selectedCategory === "bottoms"}>
          BOTTOMS
        </NavLink>

        <NavLink href="/feed?category=dresses_skirts" active={selectedCategory === "dresses_skirts"}>
          DRESSES & SKIRTS
        </NavLink>

        <div
          className="relative"
          onMouseEnter={() => openCategoryDropdown("jackets", jacketsRef)}
          onMouseLeave={scheduleCloseCategoryDropdown}
        >
          <Link ref={jacketsRef} href="/feed?category=jackets_coats" className={(isCategoryActive("jackets_coats") || isCategoryActive("jackets") || isCategoryActive("coats")) ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50" + " font-mono text-[11px] uppercase tracking-widest transition-colors"}>
            JACKETS & COATS
          </Link>
        </div>

        <NavLink href="/feed?category=footwear" active={selectedCategory === "footwear"}>
          FOOTWEAR
        </NavLink>

        <div
          className="relative"
          onMouseEnter={() => openCategoryDropdown("bags", bagsRef)}
          onMouseLeave={scheduleCloseCategoryDropdown}
        >
          <Link ref={bagsRef} href="/feed?category=bags_accessories" className={(isCategoryActive("bags_accessories") || isCategoryActive("bags") || isCategoryActive("accessories")) ? "text-zinc-50" : "text-zinc-300 hover:text-zinc-50" + " font-mono text-[11px] uppercase tracking-widest transition-colors"}>
            BAGS & ACCESSORIES
          </Link>
        </div>

        <NavLink href="/feed?category=sets" active={selectedCategory === "sets"}>
          SETS
        </NavLink>

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

        <button
          type="button"
          onClick={onAboutOpen}
          className="font-mono text-[11px] uppercase tracking-widest text-zinc-300 transition-colors hover:text-zinc-50"
        >
          ABOUT
        </button>
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-mono text-[11px] uppercase tracking-widest text-zinc-300 transition-colors hover:text-zinc-50">
          CONTACT
        </a>
      </div>

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
  );
}
