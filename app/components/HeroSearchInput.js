"use client";

import { useLanguage } from "./LanguageProvider";

// Client leaf for the homepage hero search field — an <input> placeholder is a
// string attribute and can't take a <T> node, so the field itself reads the
// active language via context and swaps live on toggle, like <T>. The wrapping
// <form action="/feed"> stays server-rendered.
export default function HeroSearchInput() {
  const { t } = useLanguage();
  return (
    <>
      <label htmlFor="hero-search" className="sr-only">
        {t("home.searchAria")}
      </label>
      <input
        id="hero-search"
        name="search"
        type="search"
        placeholder={t("home.searchPlaceholder")}
        className="w-full rounded-none border-b border-zinc-300 bg-transparent py-4 font-mono text-lg text-zinc-950 placeholder:text-zinc-400 outline-none focus:border-zinc-800"
      />
    </>
  );
}
