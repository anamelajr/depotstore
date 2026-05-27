"use client";

import { useState } from "react";

export default function BackfillSizesPage() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function run() {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/backfill-sizes", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setResult(data);
    } catch (e) {
      setError(e?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main
      style={{
        padding: 24,
        maxWidth: 720,
        margin: "0 auto",
        fontFamily: "monospace",
        color: "#111",
      }}
    >
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>Backfill sizes</h1>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: "#444" }}>
        One-shot: re-fetch every active store via the products listing endpoint
        and write the parsed size into <code>products.size</code>. Safe to
        re-run. Touches only the <code>size</code> column.
      </p>

      <button
        onClick={run}
        disabled={running}
        style={{
          marginTop: 16,
          padding: "10px 20px",
          fontFamily: "inherit",
          fontSize: 12,
          border: "1px solid #111",
          background: running ? "#eee" : "#111",
          color: running ? "#888" : "#fff",
          cursor: running ? "default" : "pointer",
        }}
      >
        {running ? "Running…" : "Start backfill"}
      </button>

      {error && (
        <pre
          style={{
            marginTop: 16,
            padding: 12,
            background: "#fee",
            color: "#900",
            fontSize: 12,
          }}
        >
          {error}
        </pre>
      )}

      {result && (
        <div style={{ marginTop: 24 }}>
          <p style={{ fontSize: 13 }}>
            <strong>{result.totalUpdated}</strong> / {result.totalProcessed}{" "}
            products updated · {result.totalErrors} errors
          </p>
          <table
            style={{
              marginTop: 12,
              fontSize: 12,
              borderCollapse: "collapse",
              width: "100%",
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                <th style={{ padding: "6px 8px" }}>Domain</th>
                <th style={{ padding: "6px 8px" }}>Processed</th>
                <th style={{ padding: "6px 8px" }}>Updated</th>
                <th style={{ padding: "6px 8px" }}>Errors</th>
              </tr>
            </thead>
            <tbody>
              {result.results.map((r) => (
                <tr
                  key={r.domain}
                  style={{ borderBottom: "1px solid #eee" }}
                  title={r.fetchError || ""}
                >
                  <td style={{ padding: "6px 8px" }}>{r.domain}</td>
                  <td style={{ padding: "6px 8px" }}>{r.processed}</td>
                  <td style={{ padding: "6px 8px" }}>{r.updated}</td>
                  <td
                    style={{
                      padding: "6px 8px",
                      color: r.errors > 0 ? "#900" : "#444",
                    }}
                  >
                    {r.errors}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
