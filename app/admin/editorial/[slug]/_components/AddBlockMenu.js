"use client";

import { useState } from "react";

const TYPES = [
  { type: "text",            label: "Text paragraph",     factory: () => ({ type: "text", width: "narrow", body: "" }) },
  { type: "section-heading", label: "Section heading",    factory: () => ({ type: "section-heading", text: "" }) },
  { type: "pullquote",       label: "Pullquote",          factory: () => ({ type: "pullquote", text: "", attribution: "" }) },
  { type: "image",           label: "Image — single",     factory: () => ({ type: "image", src: "", width: "wide", alt: "" }) },
  { type: "image-pair",      label: "Image — pair",       factory: () => ({ type: "image-pair", images: [{ src: "", alt: "" }, { src: "", alt: "" }] }) },
];

export default function AddBlockMenu({ onAdd }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: 8,
          background: "transparent",
          border: "1px dashed #2a2a2c",
          color: "#8a8a80",
          borderRadius: 4,
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        + Add block
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: "#18181a",
            border: "1px solid #2a2a2c",
            borderRadius: 6,
            padding: 6,
            zIndex: 10,
          }}
        >
          {TYPES.map((t) => (
            <div
              key={t.type}
              onClick={() => {
                onAdd(t.factory());
                setOpen(false);
              }}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                color: "#e7e7e2",
                cursor: "pointer",
                borderRadius: 3,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2a2c")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {t.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
