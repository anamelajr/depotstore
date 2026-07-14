"use client";

import { Suspense, useState } from "react";
import Nav from "./Nav";
import { CurrencyProvider } from "./CurrencyProvider";
import { useLanguage } from "./LanguageProvider";

export default function LayoutClient({
  children,
  stores = [],
  initialCurrency = "EUR",
  rates,
}) {
  const { t } = useLanguage();
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  return (
    <CurrencyProvider initialCurrency={initialCurrency} rates={rates}>
      <Suspense fallback={null}>
        <Nav onAboutOpen={() => setIsAboutOpen(true)} stores={stores} />
      </Suspense>
      <div className="min-h-screen">{children}</div>
      {isAboutOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
          onClick={() => setIsAboutOpen(false)}
        >
          <div
            className="w-full sm:max-w-lg border-t sm:border border-zinc-200 bg-white p-8 sm:p-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-8">
              <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
                {t("about.label")}
              </span>
              <button
                type="button"
                onClick={() => setIsAboutOpen(false)}
                className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 hover:text-zinc-950 transition-colors"
              >
                {t("about.close")}
              </button>
            </div>

            <p className="text-2xl sm:text-3xl font-light leading-snug tracking-tight text-zinc-900 mb-8">
              {t("about.lead")}
            </p>

            <p className="text-sm leading-7 text-zinc-600 mb-8">
              {t("about.body")}
            </p>

            <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400">
              {t("about.closing")}
            </p>
          </div>
        </div>
      )}
    </CurrencyProvider>
  );
}
