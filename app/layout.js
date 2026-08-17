import { cookies } from "next/headers";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import LayoutClient from "./components/LayoutClient";
import Footer from "./components/Footer";
import { LanguageProvider } from "./components/LanguageProvider";
import { getActiveStores } from "./lib/stores.js";
import { getFxRates } from "./lib/fx.js";
import { getLanguage } from "./lib/i18n/language.js";
import { t } from "./lib/i18n/messages.js";
import "./globals.css";

const ALLOWED_CURRENCIES = ["EUR", "GBP", "USD"];

const satoshi = localFont({
  src: [
    { path: "./fonts/Satoshi-300.woff2", weight: "300", style: "normal" },
    { path: "./fonts/Satoshi-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Satoshi-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Satoshi-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-satoshi",
  display: "swap",
});

const generalSans = localFont({
  src: [
    { path: "./fonts/GeneralSans-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/GeneralSans-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/GeneralSans-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/GeneralSans-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-general-sans",
  display: "swap",
});

// Language-aware default metadata (applies to the homepage and any page without
// its own generateMetadata). Resolves server-side from the depot_lang cookie —
// the one place visible text is allowed to read the language on the server,
// since <head> can't host a <T> leaf. Updates on the next navigation.
export async function generateMetadata() {
  const lang = await getLanguage();
  return {
    title: t("meta.homeTitle", lang),
    description: t("meta.homeDesc", lang),
  };
}

export default async function RootLayout({ children }) {
  // All four were sequential awaits; nothing here depends on anything else,
  // so the two DB reads and the two cookie reads overlap. Reading cookies at
  // all opts the tree into dynamic rendering — that is deliberate, so the
  // first server paint already carries the visitor's currency and language
  // (no flash). `source` is server-side diagnostics only — pass the nested
  // `rates` down, never the wrapper (CurrencyProvider/formatPrice expect
  // { GBP, USD }).
  const [stores, { rates, source }, cookieStore, initialLanguage] =
    await Promise.all([
      getActiveStores(),
      getFxRates(),
      cookies(),
      getLanguage(),
    ]);

  const cookieCurrency = cookieStore.get("depot_currency")?.value;
  const initialCurrency = ALLOWED_CURRENCIES.includes(cookieCurrency)
    ? cookieCurrency
    : "EUR";

  if (source === "fallback") {
    console.warn(
      JSON.stringify({ event: "fx_layout_fallback", note: "serving FALLBACK_RATES" }),
    );
  }

  return (
    <html
      lang={initialLanguage}
      className={`h-full antialiased ${satoshi.variable} ${generalSans.variable}`}
    >
      <body className="min-h-full flex flex-col">
        <LanguageProvider initialLanguage={initialLanguage}>
          <LayoutClient
            stores={stores}
            initialCurrency={initialCurrency}
            rates={rates}
          >
            {children}
          </LayoutClient>
          <Footer />
        </LanguageProvider>
      </body>
      <Analytics />
      <SpeedInsights />
    </html>
  );
}
