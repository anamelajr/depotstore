"use client";

import Link from "next/link";

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

const linkStyle = {
  background: "none",
  border: "none",
  padding: 0,
  fontSize: 13,
  letterSpacing: "0.025em",
  color: "rgb(212 212 216)",
  cursor: "pointer",
  textDecoration: "none",
};

export default function DesignersDropdown({
  isOpen,
  brandsByLetter,
  top,
}) {
  const lettersWithBrands = new Set(
    (brandsByLetter ?? []).map(([letter]) => letter)
  );

  if (!isOpen) return null;

  return (
    <div
      className="font-mono"
      style={{
        position: "fixed",
        top: typeof top === "number" ? top : 0,
        left: 0,
        width: "100%",
        zIndex: 9999,
        backgroundColor: "#0a0a0a",
        borderBottom: "1px solid rgb(39 39 42)",
        padding: "24px 0",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 24px",
          gap: 48,
        }}
      >
        {/* Left column: Top Designers */}
        <div>
          <h3
            style={{
              marginBottom: 12,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "rgb(113 113 122)",
            }}
          >
            Top Designers
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {TOP_DESIGNERS.map((brand) => (
              <Link
                key={brand}
                href={`/feed?brand=${encodeURIComponent(brand)}`}
                style={linkStyle}
              >
                {brand}
              </Link>
            ))}
          </div>
        </div>

        {/* Right column: Brands A-Z */}
        <div style={{ flex: 1 }}>
          <h3
            style={{
              marginBottom: 12,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "rgb(113 113 122)",
            }}
          >
            Brands A–Z
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(13, 1fr)",
              gap: "4px 12px",
            }}
          >
            {ALPHABET.map((letter) => {
              const hasBrands = lettersWithBrands.has(letter);
              return hasBrands ? (
                <Link
                  key={letter}
                  href={`/designers#${letter}`}
                  style={{
                    ...linkStyle,
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "rgb(250 250 250)",
                  }}
                >
                  {letter}
                </Link>
              ) : (
                <span
                  key={letter}
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "rgb(82 82 91)",
                  }}
                >
                  {letter}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "16px 24px 0",
          borderTop: "1px solid rgba(39 39 42 / 0.5)",
          marginTop: 16,
          paddingTop: 16,
        }}
      >
        <Link
          href="/designers"
          style={{
            ...linkStyle,
            fontSize: 12,
            color: "rgb(161 161 170)",
          }}
        >
          View all designers →
        </Link>
      </div>
    </div>
  );
}
