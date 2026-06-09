"use client";

import { useRef, useState, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { buildFeedUrl } from "../lib/feed-utils";
import Link from "next/link";
import DesktopNav from "./DesktopNav";
import MobileNavMenu from "./MobileNavMenu";

export default function Nav({ onAboutOpen, stores = [] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Suppress the mobile nav's bottom border only on /feed when ?search= is
  // set — that is the only place MobileSearchStrip is rendered to provide
  // a replacement divider. Anywhere else, the nav keeps its own border.
  const hasMobileSearchBanner =
    pathname === "/feed" && Boolean(searchParams.get("search"));
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
      <nav className={`sticky top-0 z-50 flex h-[50px] items-center ${hasMobileSearchBanner ? "" : "border-b border-zinc-800"} bg-[#0a0a0a]/95 text-zinc-50 backdrop-blur md:hidden`}>
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
                        router.push(buildFeedUrl(searchParams, { search: trimmed }));
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
      <MobileNavMenu isOpen={isMobileOpen} onClose={() => setIsMobileOpen(false)} stores={stores} />
    </>
  );
}