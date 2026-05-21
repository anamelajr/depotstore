"use client";

import { useEffect, useState } from "react";

const inputStyle = {
  width: "100%",
  background: "#0f0f10",
  border: "1px solid #2a2a2c",
  color: "#e7e7e2",
  padding: "6px 8px",
  borderRadius: 4,
  fontSize: 12,
};

export default function CuratedProductsPanel({ curatedProducts, onChange }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/search-products?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.products || []);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  function add(p) {
    const pair = { storeDomain: p.store_domain, handle: p.handle };
    if (curatedProducts.some((c) => c.storeDomain === pair.storeDomain && c.handle === pair.handle)) return;
    onChange([...curatedProducts, pair]);
  }
  function remove(i) {
    onChange(curatedProducts.filter((_, j) => j !== i));
  }
  function move(i, dir) {
    const next = curatedProducts.slice();
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <section
      style={{
        background: "#18181a",
        border: "1px solid #2a2a2c",
        borderRadius: 6,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b6b6ad", margin: "0 0 12px" }}>
        Curated products ({curatedProducts.length})
      </h3>

      {curatedProducts.map((p, i) => (
        <div
          key={`${p.storeDomain}/${p.handle}`}
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
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{ color: "#8a8a80" }}>{p.storeDomain}</span> / {p.handle}
          </span>
          <button onClick={() => move(i, -1)} disabled={i === 0} style={smallBtn}>↑</button>
          <button onClick={() => move(i, +1)} disabled={i === curatedProducts.length - 1} style={smallBtn}>↓</button>
          <button onClick={() => remove(i)} style={{ ...smallBtn, color: "#c9806b" }}>×</button>
        </div>
      ))}

      <input
        style={{ ...inputStyle, marginTop: 8 }}
        placeholder="Search products by name, title, or brand…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {searching && <div style={{ fontSize: 11, color: "#8a8a80", marginTop: 4 }}>Searching…</div>}
      {results.length > 0 && (
        <div style={{ marginTop: 6, maxHeight: 240, overflowY: "auto", border: "1px solid #2a2a2c", borderRadius: 4 }}>
          {results.map((p) => (
            <div
              key={`${p.store_domain}/${p.handle}`}
              onClick={() => add(p)}
              style={{ display: "flex", padding: "6px 8px", fontSize: 12, cursor: "pointer", alignItems: "center", gap: 8 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2a2c")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ flex: 1 }}>
                <span style={{ color: "#e7e7e2" }}>{p.title || p.name}</span>
                <span style={{ color: "#8a8a80", marginLeft: 6 }}>· {p.brand || "—"}</span>
              </span>
              <span style={{ color: "#6b6b62", fontSize: 10 }}>{p.store_domain}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const smallBtn = {
  background: "transparent",
  border: "1px solid #2a2a2c",
  color: "#b6b6ad",
  width: 22,
  height: 22,
  borderRadius: 3,
  fontSize: 11,
  cursor: "pointer",
  marginLeft: 4,
};
