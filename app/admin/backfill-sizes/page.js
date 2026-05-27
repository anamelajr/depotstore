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

  // Color palette matches the admin shell (app/admin/layout.js):
  //   bg #0f0f10, text #e7e7e2, muted #8a8a80, borders #2a2a2c.
  // The earlier light-on-light pass made the page unreadable inside
  // the dark admin layout (codex round-3 finding).
  return (
    <main
      style={{
        padding: 24,
        maxWidth: 720,
        margin: "0 auto",
        fontFamily: "monospace",
        color: "#e7e7e2",
      }}
    >
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>Backfill sizes</h1>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: "#8a8a80" }}>
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
          border: "1px solid #2a2a2c",
          background: running ? "#18181a" : "#e7e7e2",
          color: running ? "#8a8a80" : "#0f0f10",
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
            background: "#2a0f10",
            color: "#fcb6b6",
            fontSize: 12,
            border: "1px solid #5a1a1c",
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
              <tr
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #2a2a2c",
                  color: "#8a8a80",
                }}
              >
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
                  style={{ borderBottom: "1px solid #18181a" }}
                  title={r.fetchError || ""}
                >
                  <td style={{ padding: "6px 8px" }}>{r.domain}</td>
                  <td style={{ padding: "6px 8px" }}>{r.processed}</td>
                  <td style={{ padding: "6px 8px" }}>{r.updated}</td>
                  <td
                    style={{
                      padding: "6px 8px",
                      color: r.errors > 0 ? "#fcb6b6" : "#8a8a80",
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
