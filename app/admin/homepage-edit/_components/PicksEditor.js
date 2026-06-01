"use client";

import { useEffect, useState } from "react";
import PublishButton from "../../_components/PublishButton.js";
import { shopifyImageUrl } from "../../../lib/shopifyImage.js";

const inputStyle = {
  width: "100%",
  background: "#0f0f10",
  border: "1px solid #2a2a2c",
  color: "#e7e7e2",
  padding: "6px 8px",
  borderRadius: 4,
  fontSize: 12,
};

export default function PicksEditor({ initialPicks }) {
  const [picks, setPicks] = useState(initialPicks);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const h = setTimeout(async () => {
      const res = await fetch(`/api/admin/search-products?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data.products || []);
    }, 300);
    return () => clearTimeout(h);
  }, [query]);

  function add(p) {
    if (picks.length >= 8) return;
    if (picks.some((c) => c.storeDomain === p.store_domain && c.handle === p.handle)) return;
    setPicks([...picks, { storeDomain: p.store_domain, handle: p.handle, _preview: p }]);
  }
  function remove(i) { setPicks(picks.filter((_, j) => j !== i)); }
  function move(i, dir) {
    const next = picks.slice();
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setPicks(next);
  }
  async function save() {
    setSaving(true);
    const payload = picks.map((p) => ({ storeDomain: p.storeDomain, handle: p.handle }));
    const res = await fetch("/api/admin/save-homepage-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picks: payload }),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) alert(`Save failed: ${data.error || res.status}`);
    else alert(`Saved ${data.count} pick(s) → content/homepage-edit.json`);
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: 0 }}>Today's Edit</h1>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8a8a80" }}>{picks.length}/8 picks</span>
        <button
          onClick={save}
          disabled={saving}
          style={{
            marginLeft: 12,
            background: "#d6d2c4",
            color: "#18181a",
            border: "none",
            padding: "6px 14px",
            borderRadius: 4,
            fontSize: 12,
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <PublishButton
          files={["content/homepage-edit.json"]}
          label="todays-edit"
        />
      </header>

      <section style={{ background: "#18181a", border: "1px solid #2a2a2c", borderRadius: 6, padding: 14, marginBottom: 14 }}>
        <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b6b6ad", margin: "0 0 10px" }}>
          Current picks
        </h3>
        {picks.length === 0 && <div style={{ fontSize: 12, color: "#8a8a80" }}>No picks yet — homepage will fall back to the date-seeded rotation.</div>}
        {picks.map((p, i) => (
          <div
            key={`${p.storeDomain}/${p.handle}`}
            style={{
              display: "flex",
              alignItems: "center",
              background: "#0f0f10",
              border: "1px solid #2a2a2c",
              borderRadius: 4,
              padding: "6px 9px",
              marginBottom: 4,
              fontSize: 12,
              gap: 8,
            }}
          >
            <span style={{ flex: 1 }}>
              <span style={{ color: "#8a8a80" }}>{p.storeDomain}</span> / {p.handle}
            </span>
            <button onClick={() => move(i, -1)} disabled={i === 0} style={smallBtn}>↑</button>
            <button onClick={() => move(i, +1)} disabled={i === picks.length - 1} style={smallBtn}>↓</button>
            <button onClick={() => remove(i)} style={{ ...smallBtn, color: "#c9806b" }}>×</button>
          </div>
        ))}
      </section>

      <section style={{ background: "#18181a", border: "1px solid #2a2a2c", borderRadius: 6, padding: 14 }}>
        <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b6b6ad", margin: "0 0 10px" }}>
          Search products
        </h3>
        <input
          style={inputStyle}
          placeholder="Name, title, or brand…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length > 0 && (
          <div style={{ marginTop: 6, maxHeight: 280, overflowY: "auto", border: "1px solid #2a2a2c", borderRadius: 4 }}>
            {results.map((p) => (
              <div
                key={`${p.store_domain}/${p.handle}`}
                onClick={() => add(p)}
                style={{ display: "flex", padding: "6px 8px", fontSize: 12, cursor: "pointer", alignItems: "center", gap: 8 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2a2c")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {p.image_url && (
                  <img src={shopifyImageUrl(p.image_url, 80)} alt="" style={{ width: 32, height: 40, objectFit: "cover", borderRadius: 2 }} />
                )}
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
    </div>
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
};
