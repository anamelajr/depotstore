"use client";

import { useEffect, useState } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import TopBar from "./nav/TopBar";
import MenuPanel from "./nav/MenuPanel";
import Column1 from "./nav/Column1";
import Column2 from "./nav/Column2";

export default function DesktopNav({ stores = [] }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [expandedKey, setExpandedKey] = useState(null);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const selectedBrand = searchParams.get("brand");
  const selectedStore = searchParams.get("store");

  useEffect(() => {
    setIsMenuOpen(false); // eslint-disable-line react-hooks/set-state-in-effect
    setExpandedKey(null);
  }, [searchParams, pathname]);

  useEffect(() => {
    if (!isMenuOpen) setExpandedKey(null); // eslint-disable-line react-hooks/set-state-in-effect
  }, [isMenuOpen]);

  return (
    <>
      <nav className="sticky top-0 z-50 hidden md:flex h-[56px] border-b border-zinc-800 bg-[#0a0a0a]/95 text-zinc-50 backdrop-blur">
        <TopBar
          isMenuOpen={isMenuOpen}
          onMenuClick={() => setIsMenuOpen(true)}
          onCloseClick={() => setIsMenuOpen(false)}
          onSearchClick={() => {
            /* wired in Task 9 */
          }}
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
