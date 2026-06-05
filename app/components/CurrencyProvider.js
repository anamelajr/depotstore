"use client";

import { createContext, useCallback, useContext, useState } from "react";

const CurrencyContext = createContext(null);

const ALLOWED = ["EUR", "GBP", "USD"];

// Holds the selected currency + the server-seeded FX rates so every <Price>
// reads from one context (no per-site cookie/rate reads, live updates on flip).
//
// `currency` MUST seed from the server-passed `initialCurrency` prop, never a
// client document.cookie read in the initializer — otherwise SSR renders EUR
// and the client flips on hydration (the exact flash we're avoiding, plus a
// hydration-mismatch warning).
export function CurrencyProvider({ initialCurrency = "EUR", rates, children }) {
  const [currency, setCurrencyState] = useState(
    ALLOWED.includes(initialCurrency) ? initialCurrency : "EUR",
  );

  const setCurrency = useCallback((next) => {
    if (!ALLOWED.includes(next)) return;
    setCurrencyState(next);
    // Max-Age is in SECONDS (31536000 = 1 year), not "1y". samesite=lax.
    document.cookie = `depot_currency=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, rates }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return ctx;
}
