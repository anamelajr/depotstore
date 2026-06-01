"use client";

import { Suspense, useState } from "react";
import Nav from "./Nav";
import { CurrencyProvider } from "./CurrencyProvider";

export default function LayoutClient({
  children,
  stores = [],
  initialCurrency = "EUR",
  rates,
}) {
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  return (
    <CurrencyProvider initialCurrency={initialCurrency} rates={rates}>
      <Suspense fallback={null}>
        <Nav onAboutOpen={() => setIsAboutOpen(true)} stores={stores} />
      </Suspense>
      <div className="min-h-screen">{children}</div>
      {isAboutOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
          onClick={() => setIsAboutOpen(false)}
        >
          <div
            className="w-full sm:max-w-lg border-t sm:border border-zinc-800 bg-[#0a0a0a] p-8 sm:p-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-8">
              <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
                About
              </span>
              <button
                type="button"
                onClick={() => setIsAboutOpen(false)}
                className="font-mono text-[11px] uppercase tracking-widest text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                Close
              </button>
            </div>

            <p className="text-2xl sm:text-3xl font-light leading-snug tracking-tight text-zinc-100 mb-8">
              Dépôt is a curated discovery platform for archive and luxury fashion in Paris.
            </p>

            <p className="text-sm leading-7 text-zinc-400 mb-8">
              Live inventory from the city's best vintage and archive stores, in one feed. Search by designer, filter by category, get lost.
            </p>

            <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-600">
              Paris first. More cities soon.
            </p>
          </div>
        </div>
      )}
    </CurrencyProvider>
  );
}
