"use client";

import { useState } from "react";
import Nav from "./Nav";

export default function LayoutClient({ children }) {
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  return (
    <>
      <Nav onAboutOpen={() => setIsAboutOpen(true)} />
      {children}
      {isAboutOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md border border-zinc-800 bg-[#0a0a0a] p-6 text-zinc-200">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-sm uppercase tracking-widest text-zinc-50">About Dépôt</h3>
              <button
                type="button"
                onClick={() => setIsAboutOpen(false)}
                className="font-mono text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-200"
              >
                Close
              </button>
            </div>
            <p className="mt-4 text-sm leading-6 text-zinc-400">
              Dépôt aggregates inventory from the best Paris archive and vintage stores into one editorial feed.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
