"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { getNavTopLevel, getSubcategoriesByShortKey } from "../lib/categories.js";
import { buildFreshFeedUrl } from "../lib/feed-utils";
import { useCurrency } from "./CurrencyProvider";
import { useLanguage } from "./LanguageProvider";
import { CURRENCIES } from "../lib/currency";

const CONTACT_EMAIL = "hello@depot.paris";

export default function MobileNavMenu({ isOpen, onClose, stores = [] }) {
  // 'root' | 'shop' | 'stores' | { type: 'subcategory', shortKey: string, label: string }
  const [view, setView] = useState("root");

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      setView("root");
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  if (typeof document === "undefined") return null;
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-white text-zinc-950 flex flex-col motion-safe:[animation:navMenuEnter_150ms_ease-out]">
      {view === "root" && (
        <RootView
          onClose={onClose}
          onOpenShop={() => setView("shop")}
          onOpenStores={() => setView("stores")}
        />
      )}
      {view === "stores" && (
        <StoresView onClose={onClose} onBack={() => setView("root")} stores={stores} />
      )}
      {view === "shop" && (
        <ShopView
          onClose={onClose}
          onBack={() => setView("root")}
          onOpenSubcategory={(sub) => setView({ type: "subcategory", ...sub })}
        />
      )}
      {typeof view === "object" && view.type === "subcategory" && (
        <SubcategoryView
          onClose={onClose}
          onBack={() => setView("shop")}
          shortKey={view.shortKey}
          label={view.label}
        />
      )}
    </div>,
    document.body
  );
}

// Compact Language/Currency control for the mobile menu footer. Mirrors the
// desktop RegionPanel: active language/currency are highlighted, selection
// closes the menu so the updated UI behind it is immediately visible.
function RegionSection({ onClose }) {
  const { currency, setCurrency } = useCurrency();
  const { language, setLanguage, t } = useLanguage();
  const sectionLabel = "font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-400";
  const langBtn = (lang) =>
    `font-mono text-[10px] uppercase tracking-[0.18em] ${
      language === lang ? "text-zinc-950" : "text-zinc-400"
    }`;

  return (
    <div className="flex flex-col gap-3 pb-1">
      <div className="flex items-center gap-4">
        <span className={sectionLabel}>{t("region.language")}</span>
        <button
          type="button"
          aria-pressed={language === "en"}
          onClick={() => { setLanguage("en"); onClose(); }}
          className={langBtn("en")}
        >
          English
        </button>
        <button
          type="button"
          aria-pressed={language === "fr"}
          onClick={() => { setLanguage("fr"); onClose(); }}
          className={langBtn("fr")}
        >
          Français
        </button>
      </div>
      <div className="flex items-center gap-4">
        <span className={sectionLabel}>{t("region.currency")}</span>
        {Object.entries(CURRENCIES).map(([code, { symbol, label }]) => {
          const active = currency === code;
          return (
            <button
              key={code}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setCurrency(code);
                onClose();
              }}
              className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
                active ? "text-zinc-950" : "text-zinc-400"
              }`}
            >
              {symbol} {label}
            </button>
          );
        })}
      </div>
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-400">
        {t("region.pricesFromEur")}
      </span>
    </div>
  );
}

function RootView({ onClose, onOpenShop, onOpenStores }) {
  const { t } = useLanguage();
  return (
    <>
      <header className="flex items-center justify-between h-[50px] px-5 shrink-0">
        <Link href="/" onClick={onClose} className="font-mono text-[11px] tracking-[0.32em] uppercase">
          DÉPÔT
        </Link>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-500">
          ✕ {t("nav.close").toUpperCase()}
        </button>
      </header>
      <div className="flex-1 flex flex-col px-8 pt-12 pb-8">
        <button
          onClick={onOpenShop}
          className="flex items-center justify-between py-6 font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-950"
        >
          <span>{t("nav.shop").toUpperCase()}</span><span className="text-zinc-400 text-[14px] font-light">›</span>
        </button>
        <button
          onClick={onOpenStores}
          className="flex items-center justify-between py-6 font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-950"
        >
          <span>{t("nav.stores").toUpperCase()}</span><span className="text-zinc-400 text-[14px] font-light">›</span>
        </button>
        <Link
          href="/designers"
          onClick={onClose}
          className="flex items-center justify-between py-6 font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-950"
        >
          <span>{t("nav.designers").toUpperCase()}</span><span className="text-zinc-400 text-[14px] font-light">›</span>
        </Link>
        <Link
          href="/editorial"
          onClick={onClose}
          className="flex items-center justify-between py-6 font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-950"
        >
          <span>{t("nav.editorial").toUpperCase()}</span><span className="text-zinc-400 text-[14px] font-light">›</span>
        </Link>
        <div className="mt-auto pt-8 border-t border-zinc-200 flex flex-col gap-4">
          <RegionSection onClose={onClose} />
          <Link href="/about" onClick={onClose} className="font-sans text-[11px] text-zinc-500 hover:text-zinc-950 transition-colors">
            {t("nav.about")}
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} onClick={onClose} className="font-sans text-[11px] text-zinc-500 hover:text-zinc-950 transition-colors">
            {t("nav.contact")}
          </a>
        </div>
      </div>
    </>
  );
}

function ShopView({ onClose, onBack, onOpenSubcategory }) {
  const { language, t } = useLanguage();
  const navTopLevel = getNavTopLevel(language);
  const subcatByShortKey = getSubcategoriesByShortKey(language);
  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <button onClick={onBack} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-500">
          ‹ {t("nav.back").toUpperCase()}
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          {t("nav.shop").toUpperCase()}
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-500">
          ✕
        </button>
      </header>
      <div className="flex-1 px-8 pt-10 pb-8 flex flex-col gap-6 overflow-y-auto">
        {navTopLevel.map((cat) => {
          const subs = subcatByShortKey[cat.shortKey];
          const hasSubs = !!subs;
          if (hasSubs) {
            return (
              <button
                key={cat.slug}
                onClick={() => onOpenSubcategory({ shortKey: cat.shortKey, label: cat.label })}
                className="flex items-center justify-between font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-950"
              >
                <span>{cat.label.toUpperCase()}</span>
                <span className="text-zinc-400 text-[14px] font-light">›</span>
              </button>
            );
          }
          return (
            <Link
              key={cat.slug}
              href={buildFreshFeedUrl({ category: [cat.slug] })}
              onClick={onClose}
              className="flex items-center justify-between font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-950"
            >
              <span>{cat.label.toUpperCase()}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function StoresView({ onClose, onBack, stores }) {
  const { t } = useLanguage();
  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <button onClick={onBack} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-500">
          ‹ {t("nav.back").toUpperCase()}
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          {t("nav.stores").toUpperCase()}
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-500">
          ✕
        </button>
      </header>
      <div className="flex-1 px-8 pt-10 pb-8 flex flex-col gap-6 overflow-y-auto">
        {stores.map((store) => (
          <Link
            key={store.domain}
            href={buildFreshFeedUrl({ store: store.domain })}
            onClick={onClose}
            className="font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-950"
          >
            {(store.displayName || store.storeName).toUpperCase()}
          </Link>
        ))}
      </div>
    </>
  );
}

function SubcategoryView({ onClose, onBack, shortKey, label }) {
  const { language, t } = useLanguage();
  const subs = getSubcategoriesByShortKey(language)[shortKey];
  if (!subs) return null;
  return (
    <>
      <header className="relative flex items-center justify-between h-[50px] px-5 shrink-0">
        <button onClick={onBack} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-500">
          ‹ {t("nav.back").toUpperCase()}
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-[0.32em] uppercase">
          {subs.heading.toUpperCase()}
        </span>
        <button onClick={onClose} className="font-mono text-[9px] tracking-[0.32em] uppercase text-zinc-500">
          ✕
        </button>
      </header>
      <div className="flex-1 px-8 pt-10 pb-8 flex flex-col gap-6 overflow-y-auto">
        {subs.items.map(([slug, sublabel]) => (
          <Link
            key={slug}
            href={buildFreshFeedUrl({ category: [slug] })}
            onClick={onClose}
            className="font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-950"
          >
            {sublabel}
          </Link>
        ))}
      </div>
    </>
  );
}
