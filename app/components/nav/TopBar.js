"use client";

import Link from "next/link";

function MenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const baseLink =
  "font-mono text-[11px] uppercase tracking-widest text-zinc-300 hover:text-zinc-50 transition-colors";

export default function TopBar({
  isMenuOpen,
  onMenuClick,
  onCloseClick,
  onSearchClick,
}) {
  return (
    <div className="mx-auto flex h-[56px] w-full items-center px-6">
      {/* Left */}
      <div className="flex flex-1 items-center gap-6">
        {isMenuOpen ? (
          <>
            <button type="button" onClick={onCloseClick} className={`${baseLink} flex items-center gap-2`}>
              <CloseIcon /> Close
            </button>
            <button type="button" onClick={onSearchClick} className={`${baseLink} flex items-center gap-2`}>
              <SearchIcon /> Search the archive
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onMenuClick} className={`${baseLink} flex items-center gap-2`}>
              <MenuIcon /> Menu
            </button>
            <button type="button" onClick={onSearchClick} className={`${baseLink} flex items-center gap-2`}>
              <SearchIcon /> Search
            </button>
          </>
        )}
      </div>

      {/* Center */}
      <Link href="/" className="font-mono text-[13px] tracking-[0.22em] text-zinc-50">
        DÉPÔT
      </Link>

      {/* Right */}
      <div className="flex flex-1 items-center justify-end gap-6">
        {!isMenuOpen && (
          <>
            <a href="/#newsletter" className={baseLink}>
              Newsletter
            </a>
            <Link href="/saved" className={baseLink}>
              Saved
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
