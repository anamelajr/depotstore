"use client";

import { useState } from "react";

const LENGTHS = [
  { value: "short",  label: "Short",  detail: "~400 words · 3-4 text blocks" },
  { value: "medium", label: "Medium", detail: "~800 words · 5-7 text blocks" },
  { value: "long",   label: "Long",   detail: "~1500 words · 8-10 text blocks" },
];

const inputStyle = {
  width: "100%",
  background: "#0f0f10",
  border: "1px solid #2a2a2c",
  color: "#e7e7e2",
  padding: "7px 9px",
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "inherit",
};

function RowList({ label, hint, values, onChange, placeholder }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a8a80", marginBottom: 4 }}>
        {label}
      </div>
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            background: "#0f0f10",
            border: "1px solid #2a2a2c",
            borderRadius: 4,
            padding: "6px 9px",
            marginBottom: 4,
            fontSize: 12,
            alignItems: "center",
          }}
        >
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
          <span
            style={{ color: "#6b6b62", cursor: "pointer", marginLeft: 8 }}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            ×
          </span>
        </div>
      ))}
      <input
        style={inputStyle}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.currentTarget.value.trim()) {
            onChange([...values, e.currentTarget.value.trim()]);
            e.currentTarget.value = "";
            e.preventDefault();
          }
        }}
      />
      {hint && <div style={{ fontSize: 11, color: "#6b6b62", marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

export default function GenerateModal({ entry, onClose, onApply }) {
  const [title, setTitle] = useState(entry.hero?.title || "");
  const [layout, setLayout] = useState(entry.hero?.layout || "image-right");
  const [sources, setSources] = useState([]);
  const [styles, setStyles] = useState([]);
  const [notes, setNotes] = useState("");
  const [length, setLength] = useState("medium");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          brand: entry.brandFilter || title,
          layout,
          sourceValues: sources,
          styleValues: styles,
          notes: notes ? [notes] : [],
          length,
          currentBlocks: entry.blocks,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      onApply(data);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#18181a",
          border: "1px solid #2a2a2c",
          borderRadius: 8,
          maxWidth: 640,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <header style={{ padding: "14px 18px", borderBottom: "1px solid #2a2a2c", display: "flex", alignItems: "center" }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "#e7e7e2" }}>✦ Generate draft</h4>
          <span onClick={onClose} style={{ marginLeft: "auto", color: "#6b6b62", fontSize: 16, cursor: "pointer" }}>×</span>
        </header>

        <div style={{ padding: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <label>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a8a80", marginBottom: 4 }}>Designer</div>
              <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a8a80", marginBottom: 4 }}>Layout</div>
              <select style={inputStyle} value={layout} onChange={(e) => setLayout(e.target.value)}>
                {["image-right", "image-left", "image-below", "image-pair-top"].map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a8a80", marginBottom: 4 }}>Length</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {LENGTHS.map((l) => (
                <div
                  key={l.value}
                  onClick={() => setLength(l.value)}
                  style={{
                    background: "#0f0f10",
                    border: `1px solid ${length === l.value ? "#d6d2c4" : "#2a2a2c"}`,
                    borderRadius: 4,
                    padding: 10,
                    textAlign: "center",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 13, color: "#e7e7e2" }}>{l.label}</div>
                  <div style={{ fontSize: 10, color: "#8a8a80" }}>{l.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <RowList
            label="Source material"
            hint="URL, file path, or pasted text. Press Enter to add a row."
            values={sources}
            onChange={setSources}
            placeholder="https://… or path/to/file.txt"
          />

          <RowList
            label="Style references"
            hint="Existing editorials whose voice you want to echo."
            values={styles}
            onChange={setStyles}
            placeholder="https://…"
          />

          <label>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a8a80", marginBottom: 4 }}>Editor notes</div>
            <textarea
              style={{ ...inputStyle, minHeight: 60, resize: "vertical", lineHeight: 1.5 }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Personal direction. Tone, what to emphasize, what to avoid."
            />
          </label>

          {error && (
            <div style={{ marginTop: 10, padding: 10, background: "#3a1e1e", borderRadius: 4, fontSize: 12, color: "#e7c0b6" }}>
              {error}
            </div>
          )}
        </div>

        <footer style={{ padding: "12px 18px", background: "#0f0f10", borderTop: "1px solid #2a2a2c", display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#6b6b62" }}>
            Will replace text blocks. Image blocks and curated products are preserved.
          </span>
          <button
            onClick={submit}
            disabled={loading || !title}
            style={{
              marginLeft: "auto",
              background: loading ? "#3a3072" : "linear-gradient(135deg, #6a4ba6, #4a3578)",
              color: "#fff",
              border: "none",
              padding: "8px 16px",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 500,
              cursor: loading || !title ? "not-allowed" : "pointer",
              opacity: !title ? 0.5 : 1,
            }}
          >
            {loading ? "Generating…" : "✦ Generate"}
          </button>
        </footer>
      </div>
    </div>
  );
}
