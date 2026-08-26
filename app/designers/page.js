"use client";

import Link from "next/link";
import { useMemo } from "react";
import BRANDS from "../brands";
import { useLanguage } from "../components/LanguageProvider";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export default function DesignersPage() {
  const { t } = useLanguage();
  const brandsByLetter = useMemo(() => {
    const grouped = new Map();
    const sorted = [...BRANDS].sort((a, b) => a.localeCompare(b));
    for (const brand of sorted) {
      const letter = (brand[0] || "").toUpperCase();
      if (!letter.match(/[A-Z]/)) continue;
      if (!grouped.has(letter)) grouped.set(letter, []);
      grouped.get(letter).push(brand);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, []);

  const lettersWithBrands = new Set(brandsByLetter.map(([letter]) => letter));

  return (
    <div
      className="font-mono"
      style={{
        minHeight: "100vh",
        color: "rgb(9 9 11)",
        padding: "48px 24px 80px",
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <Link
          href="/feed"
          style={{
            display: "inline-block",
            marginBottom: 48,
            fontSize: 13,
            letterSpacing: "0.025em",
            color: "rgb(113 113 122)",
            textDecoration: "none",
          }}
        >
          {t("designers.backToFeed")}
        </Link>

        <h1
          style={{
            fontSize: "clamp(48px, 8vw, 96px)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 0.95,
            marginBottom: 64,
          }}
        >
          {t("nav.designers")}
        </h1>

        {/* A-Z anchor row */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px 16px",
            marginBottom: 48,
            paddingBottom: 32,
            borderBottom: "1px solid rgb(228 228 231)",
          }}
        >
          {ALPHABET.map((letter) => {
            const hasBrands = lettersWithBrands.has(letter);
            return hasBrands ? (
              <a
                key={letter}
                href={`#${letter}`}
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "rgb(9 9 11)",
                  textDecoration: "none",
                }}
              >
                {letter}
              </a>
            ) : (
              <span
                key={letter}
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "rgb(212 212 216)",
                }}
              >
                {letter}
              </span>
            );
          })}
        </div>

        {/* Brand sections */}
        {brandsByLetter.map(([letter, brands]) => (
          <section
            key={letter}
            id={letter}
            style={{ marginBottom: 48 }}
          >
            <h2
              style={{
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                marginBottom: 16,
                color: "rgb(9 9 11)",
              }}
            >
              {letter}
            </h2>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px 24px",
              }}
            >
              {brands.map((brand) => (
                <Link
                  key={brand}
                  href={`/feed?brand=${encodeURIComponent(brand)}`}
                  style={{
                    fontSize: 15,
                    letterSpacing: "0.025em",
                    color: "rgb(82 82 91)",
                    textDecoration: "none",
                  }}
                >
                  {brand}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
