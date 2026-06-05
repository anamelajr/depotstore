"use client";

import { useMemo } from "react";
import Link from "next/link";
import BRANDS from "../../brands";
import { buildFeedUrl } from "../../lib/feed-utils";
import { useLanguage } from "../LanguageProvider";

const TOP_DESIGNERS = [
  "Margiela",
  "Rick Owens",
  "Helmut Lang",
  "Yohji Yamamoto",
  "Comme des Garçons",
  "Raf Simons",
  "Ann Demeulemeester",
  "Jil Sander",
  "Dries Van Noten",
  "Issey Miyake",
];

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const itemBase =
  "block py-1 font-mono text-[11px] uppercase tracking-widest transition-colors text-zinc-300 hover:text-zinc-50";
const labelStyle =
  "mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600";
const letterBase =
  "font-mono text-[11px] uppercase tracking-widest";

export default function DesignersPanel({ searchParams }) {
  const { t } = useLanguage();
  const lettersWithBrands = useMemo(() => {
    const set = new Set();
    for (const brand of BRANDS) {
      const letter = (brand[0] || "").toUpperCase();
      if (letter.match(/[A-Z]/)) set.add(letter);
    }
    return set;
  }, []);

  return (
    <div className="grid grid-cols-[200px_1fr] gap-12">
      <div>
        <div className={labelStyle}>{t("nav.topDesigners")}</div>
        {TOP_DESIGNERS.map((brand) => (
          <Link
            key={brand}
            href={buildFeedUrl(searchParams, { brand })}
            className={itemBase}
          >
            {brand}
          </Link>
        ))}
      </div>

      <div>
        <div className={labelStyle}>{t("nav.brandsAZ")}</div>
        <div
          className="grid gap-x-3 gap-y-1"
          style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}
        >
          {ALPHABET.map((letter) => {
            const has = lettersWithBrands.has(letter);
            return has ? (
              <Link
                key={letter}
                href={`/designers#${letter}`}
                className={`${letterBase} text-zinc-50`}
              >
                {letter}
              </Link>
            ) : (
              <span
                key={letter}
                className={`${letterBase} text-zinc-700`}
              >
                {letter}
              </span>
            );
          })}
        </div>
        <Link
          href="/designers"
          className="mt-6 inline-block font-mono text-[11px] uppercase tracking-widest text-zinc-400 hover:text-zinc-50 transition-colors"
        >
          {t("nav.viewAllDesigners")} →
        </Link>
      </div>
    </div>
  );
}
