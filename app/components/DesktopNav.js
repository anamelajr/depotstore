"use client";

import { useEffect, useState } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import TopBar from "./nav/TopBar";
import MenuPanel from "./nav/MenuPanel";

export default function DesktopNav({ stores = [] }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const searchParams = useSearchParams();
  const pathname = usePathname();

  useEffect(() => {
    setIsMenuOpen(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [searchParams, pathname]);

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
          {/* Columns wired in Task 5+6+7+8 */}
          <div />
          <div />
        </MenuPanel>
      </div>
    </>
  );
}
