"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import RegionMenu from "./RegionMenu";
import { useLanguage } from "../LanguageProvider";

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
  "font-mono text-[11px] uppercase tracking-widest text-zinc-600 hover:text-zinc-950 transition-colors";

export default function TopBar({
  isMenuOpen,
  isSearchMode,
  searchQuery,
  onSearchQueryChange,
  onMenuClick,
  onCloseClick,
  onSearchClick,
  onSearchSubmit,
  onSearchClose,
}) {
  const inputRef = useRef(null);
  const { t } = useLanguage();

  useEffect(() => {
    if (isSearchMode) inputRef.current?.focus();
  }, [isSearchMode]);

  if (isSearchMode) {
    return (
      <div className="mx-auto flex h-[56px] w-full items-center gap-4 px-6">
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              const trimmed = searchQuery.trim();
              if (trimmed) onSearchSubmit(trimmed);
              else onSearchClose();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              onSearchClose();
            }
          }}
          placeholder={t("nav.searchPlaceholder")}
          className="flex-1 bg-transparent font-mono text-[13px] uppercase tracking-widest text-zinc-950 placeholder-zinc-400 outline-none"
        />
        <button
          type="button"
          onClick={onSearchClose}
          className={`${baseLink} flex items-center gap-2`}
        >
          <CloseIcon /> {t("nav.close")}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[56px] w-full items-center px-6">
      <div className="flex flex-1 items-center gap-6">
        {isMenuOpen ? (
          <>
            <button type="button" onClick={onCloseClick} className={`${baseLink} flex items-center gap-2`}>
              <CloseIcon /> {t("nav.close")}
            </button>
            <button type="button" onClick={onSearchClick} className={`${baseLink} flex items-center gap-2`}>
              <SearchIcon /> {t("nav.searchTheArchive")}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onMenuClick} className={`${baseLink} flex items-center gap-2`}>
              <MenuIcon /> {t("nav.menu")}
            </button>
            <button type="button" onClick={onSearchClick} className={`${baseLink} flex items-center gap-2`}>
              <SearchIcon /> {t("nav.search")}
            </button>
          </>
        )}
      </div>

      <Link href="/" className="font-mono text-[13px] tracking-[0.22em] text-zinc-950">
        DÉPÔT
      </Link>

      <div className="flex flex-1 items-center justify-end gap-6">
        {!isMenuOpen && (
          <>
            <RegionMenu />
            <Link href="/saved" className={baseLink}>
              {t("nav.saved")}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
