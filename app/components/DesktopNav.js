"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import TopBar from "./nav/TopBar";
import MenuPanel from "./nav/MenuPanel";
import Column1 from "./nav/Column1";
import Column2 from "./nav/Column2";

export default function DesktopNav({ stores = [] }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [expandedKey, setExpandedKey] = useState(null);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const selectedBrand = searchParams.get("brand");
  const selectedStore = searchParams.get("store");

  useEffect(() => {
    setIsMenuOpen(false); // eslint-disable-line react-hooks/set-state-in-effect
    setExpandedKey(null);
    setIsSearchMode(false);
    setSearchQuery("");
  }, [searchParams, pathname]);

  useEffect(() => {
    if (!isMenuOpen) setExpandedKey(null); // eslint-disable-line react-hooks/set-state-in-effect
  }, [isMenuOpen]);

  const openSearch = () => setIsSearchMode(true);
  const closeSearch = () => {
    setIsSearchMode(false);
    setSearchQuery("");
  };
  const submitSearch = (q) => {
    setIsSearchMode(false);
    setSearchQuery("");
    setIsMenuOpen(false);
    router.push(`/feed?search=${encodeURIComponent(q)}`);
  };

  return (
    <>
      <nav className="sticky top-0 z-50 hidden md:flex h-[56px] border-b border-zinc-800 bg-[#0a0a0a]/95 text-zinc-50 backdrop-blur">
        <TopBar
          isMenuOpen={isMenuOpen}
          isSearchMode={isSearchMode}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onMenuClick={() => setIsMenuOpen(true)}
          onCloseClick={() => setIsMenuOpen(false)}
          onSearchClick={openSearch}
          onSearchSubmit={submitSearch}
          onSearchClose={closeSearch}
        />
      </nav>

      <div className="hidden md:block">
        <MenuPanel isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)}>
          <Column1
            searchParams={searchParams}
            expandedKey={expandedKey}
            selectedBrand={selectedBrand}
            selectedStore={selectedStore}
            onExpand={setExpandedKey}
            onClose={() => setIsMenuOpen(false)}
          />
          <Column2
            expandedKey={expandedKey}
            searchParams={searchParams}
            stores={stores}
          />
        </MenuPanel>
      </div>
    </>
  );
}
