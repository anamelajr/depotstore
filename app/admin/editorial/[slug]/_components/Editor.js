"use client";

import { useState } from "react";
import PreviewPane from "./PreviewPane.js";

const EMPTY_ENTRY = {
  slug: "",
  publishedAt: new Date().toISOString().slice(0, 10),
  hero: {
    layout: "image-right",
    eyebrow: "Editorial",
    title: "",
    subtitle: "",
    byline: "By DÉPÔT",
    images: ["hero.webp"],
    imageAlt: [""],
  },
  brandFilter: "",
  curatedProducts: [],
  blocks: [],
};

export default function Editor({ initialEntry, slug }) {
  const [entry, setEntry] = useState(
    initialEntry ?? { ...EMPTY_ENTRY, slug: slug === "new" ? "" : slug }
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
        alignItems: "start",
      }}
    >
      <div
        style={{
          background: "#18181a",
          border: "1px solid #2a2a2c",
          borderRadius: 6,
          padding: 14,
          maxHeight: "calc(100vh - 100px)",
          overflowY: "auto",
        }}
      >
        <div style={{ fontSize: 12, color: "#8a8a80", marginBottom: 8 }}>
          editor state (read-only stub — editing controls land in Phase 5)
        </div>
        <pre
          style={{
            fontSize: 11,
            lineHeight: 1.5,
            color: "#b6b6ad",
            whiteSpace: "pre-wrap",
          }}
        >
          {JSON.stringify(entry, null, 2)}
        </pre>
      </div>
      <PreviewPane entry={entry} />
    </div>
  );
}
