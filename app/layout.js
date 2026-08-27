import { cookies } from "next/headers";
import localFont from "next/font/local";
import { preconnect } from "react-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import LayoutClient from "./components/LayoutClient";
import Footer from "./components/Footer";
import { LanguageProvider } from "./components/LanguageProvider";
import { getActiveStores, FALLBACK_STORES } from "./lib/stores.js";
import { getFxRates, FALLBACK_RATES } from "./lib/fx.js";
import { withTimeout, LAYOUT_GUARD_TIMEOUT_MS } from "./lib/withTimeout.js";
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
  // Every product photo on the site comes from cdn.shopify.com, so open the
  // connection (DNS + TCP + TLS) with the document instead of paying for it
  // when the first <img> is discovered. React 19 hoists this into <head>;
  // same idiom as the PDP's ReactDOM.preload. No crossOrigin — the imgs are
  // plain no-cors requests, and a mismatched mode would open a second,
  // unused connection.
  preconnect("https://cdn.shopify.com");

  // All four were sequential awaits; nothing here depends on anything else,
  // so the two DB reads and the two cookie reads overlap. Reading cookies at
  // all opts the tree into dynamic rendering — that is deliberate, so the
  // first server paint already carries the visitor's currency and language
  // (no flash). `source` is server-side diagnostics only — pass the nested
  // `rates` down, never the wrapper (CurrencyProvider/formatPrice expect
  // { GBP, USD }).
  //
  // The two network members also get a defensive 6s race. It is deliberately
  // later than the 4s aborts inside the cached fetchers, so in a routine stall
  // those fire first and degrade through their own logged catches; these fire
  // ONLY if that machinery failed to reject at all. Each .catch is attached
  // BEFORE Promise.all — an uncaught rejection here would crash the root
  // layout instead of degrading, which is strictly worse than fallback
  // nav/rates, so nothing is rethrown.
  const storesPromise = withTimeout(
    () => getActiveStores(),
    LAYOUT_GUARD_TIMEOUT_MS,
  ).catch((e) => {
    console.error(
      JSON.stringify({
        event: "layout_stores_fallback",
        reason: e?.message ?? String(e),
      }),
    );
    return FALLBACK_STORES;
  });
  const fxPromise = withTimeout(
    () => getFxRates(),
    LAYOUT_GUARD_TIMEOUT_MS,
  ).catch((e) => {
    console.error(
      JSON.stringify({
        event: "layout_fx_fallback",
        reason: e?.message ?? String(e),
      }),
    );
    return { rates: { ...FALLBACK_RATES }, source: "fallback" };
  });

  const [stores, { rates, source }, cookieStore, initialLanguage] =
    await Promise.all([storesPromise, fxPromise, cookies(), getLanguage()]);

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
            footer={<Footer />}
          >
            {children}
          </LayoutClient>
        </LanguageProvider>
      </body>
      <Analytics />
      <SpeedInsights />
    </html>
  );
}
