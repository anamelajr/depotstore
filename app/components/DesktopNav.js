"use client";

import { useState } from "react";
import TopBar from "./nav/TopBar";

export default function DesktopNav({ stores = [] }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 hidden md:flex border-b border-zinc-800 bg-[#0a0a0a]/95 text-zinc-50 backdrop-blur">
      <TopBar
        isMenuOpen={isMenuOpen}
        onMenuClick={() => setIsMenuOpen(true)}
        onCloseClick={() => setIsMenuOpen(false)}
        onSearchClick={() => {
          /* wired in Task 9 */
        }}
      />
    </nav>
  );
}
