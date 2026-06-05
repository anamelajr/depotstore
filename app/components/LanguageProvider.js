"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { t as tFn, MESSAGES } from "../lib/i18n/messages";

const LanguageContext = createContext(null);

const ALLOWED = ["en", "fr"];

// Language context — mirrors CurrencyProvider's pattern exactly.
//
// `language` MUST seed from the server-passed `initialLanguage` prop, never a
// client document.cookie read — otherwise SSR renders "en" and the client
// flips on hydration (flash + hydration-mismatch warning).
//
// setLanguage writes the cookie but does NOT call router.refresh() — a blanket
// refresh on a PDP re-enters resolveProductDetail which can trigger OpenAI
// generateDescription writes. Client-context swapping avoids this entirely.
export function LanguageProvider({ initialLanguage = "en", children }) {
  const [language, setLanguageState] = useState(
    ALLOWED.includes(initialLanguage) ? initialLanguage : "en",
  );

  const setLanguage = useCallback((next) => {
    if (!ALLOWED.includes(next)) return;
    setLanguageState(next);
    document.cookie = `depot_lang=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  // Keep <html lang> current on live toggle (server seed covers first paint).
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t = useCallback((key) => tFn(key, language), [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
