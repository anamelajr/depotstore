"use client";

import { useState, useEffect, useRef } from "react";

const BTN_STYLE = {
  background: "#d6d2c4",
  color: "#18181a",
  border: "none",
  padding: "6px 14px",
  borderRadius: 4,
  fontSize: 12,
  cursor: "pointer",
  fontWeight: 500,
  minWidth: 80,
};

const OVERLAY_STYLE = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const MODAL_STYLE = {
  background: "#18181a",
  border: "1px solid #2a2a2c",
  borderRadius: 6,
  padding: 24,
  maxWidth: 480,
  width: "90%",
  position: "relative",
};

const ROW_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 10,
  fontSize: 13,
};

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{ background: "#2a2a2c", border: "none", color: "#b6b6ad", borderRadius: 3, padding: "2px 7px", fontSize: 11, cursor: "pointer" }}
    >
      {copied ? "✓" : "Copy"}
    </button>
  );
}

export default function PublishButton({ files, label, disabled }) {
  const [publishing, setPublishing] = useState(false);
  const [modal, setModal] = useState(null); // null | { type: "success", data } | { type: "error", data }
  const [previewUrl, setPreviewUrl] = useState(null);
  const pollRef = useRef(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => () => stopPolling(), []);

  function closeModal() {
    stopPolling();
    setModal(null);
    setPreviewUrl(null);
  }

  function startPolling(prNumber) {
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 18) { stopPolling(); return; }
      try {
        const res = await fetch(`/api/admin/publish/preview-url?pr=${prNumber}`);
        if (res.status === 200) {
          const { url } = await res.json();
          if (url) { setPreviewUrl(url); stopPolling(); }
        }
      } catch { /* ignore */ }
    }, 5000);
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      const res = await fetch("/api/admin/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, label, newSession: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setModal({ type: "error", data });
      } else {
        setPreviewUrl(null);
        setModal({ type: "success", data });
        if (data.prNumber) startPolling(data.prNumber);
      }
    } catch (err) {
      setModal({ type: "error", data: { error: err.message } });
    } finally {
      setPublishing(false);
    }
  }

  async function handleNewSession() {
    closeModal();
    setPublishing(true);
    try {
      const res = await fetch("/api/admin/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, label, newSession: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setModal({ type: "error", data });
      } else {
        setPreviewUrl(null);
        setModal({ type: "success", data });
        if (data.prNumber) startPolling(data.prNumber);
      }
    } catch (err) {
      setModal({ type: "error", data: { error: err.message } });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      <button
        onClick={handlePublish}
        disabled={disabled || publishing}
        style={{ ...BTN_STYLE, opacity: (disabled || publishing) ? 0.6 : 1, cursor: (disabled || publishing) ? "not-allowed" : "pointer" }}
      >
        {publishing ? "Publishing…" : "Publish →"}
      </button>

      {modal && (
        <div style={OVERLAY_STYLE} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div style={MODAL_STYLE}>
            <button
              onClick={closeModal}
              style={{ position: "absolute", top: 10, right: 12, background: "none", border: "none", color: "#8a8a80", fontSize: 18, cursor: "pointer", lineHeight: 1 }}
            >
              ×
            </button>

            {modal.type === "success" && (
              <>
                <h2 style={{ fontSize: 14, fontWeight: 600, color: "#e7e7e2", margin: "0 0 16px" }}>Published to preview</h2>

                <div style={ROW_STYLE}>
                  <span style={{ color: "#8a8a80", minWidth: 90 }}>Pull request</span>
                  <a href={modal.data.prUrl} target="_blank" rel="noreferrer" style={{ color: "#7fb3f5", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {modal.data.prUrl}
                  </a>
                  <CopyBtn text={modal.data.prUrl} />
                </div>

                <div style={ROW_STYLE}>
                  <span style={{ color: "#8a8a80", minWidth: 90 }}>Preview deploy</span>
                  {previewUrl ? (
                    <>
                      <a href={previewUrl} target="_blank" rel="noreferrer" style={{ color: "#7fb3f5", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {previewUrl}
                      </a>
                      <CopyBtn text={previewUrl} />
                    </>
                  ) : (
                    <span style={{ color: "#8a8a80", fontSize: 12 }}>
                      {modal.data.vercelInspectorUrl ? (
                        <>Vercel is building… <a href={modal.data.vercelInspectorUrl} target="_blank" rel="noreferrer" style={{ color: "#7fb3f5" }}>open inspector</a></>
                      ) : (
                        "Waiting for Vercel…"
                      )}
                    </span>
                  )}
                </div>

                <div style={{ textAlign: "right", marginTop: 16 }}>
                  <button onClick={closeModal} style={{ ...BTN_STYLE, minWidth: 60 }}>Done</button>
                </div>
              </>
            )}

            {modal.type === "error" && (
              <>
                <h2 style={{ fontSize: 14, fontWeight: 600, color: "#e7e7e2", margin: "0 0 12px" }}>Publish failed</h2>
                <pre style={{ background: "#0f0f10", border: "1px solid #2a2a2c", borderRadius: 4, padding: "8px 10px", fontSize: 11, color: "#c9806b", overflowX: "auto", whiteSpace: "pre-wrap", margin: "0 0 16px" }}>
                  {modal.data.error || "Unknown error"}
                </pre>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  {modal.data.suggestion === "newSession" && (
                    <button
                      onClick={handleNewSession}
                      style={{ ...BTN_STYLE, background: "#7fb3f5", color: "#0f0f10" }}
                    >
                      Start new editing session
                    </button>
                  )}
                  <button onClick={closeModal} style={{ ...BTN_STYLE, background: "#2a2a2c", color: "#b6b6ad" }}>Dismiss</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
