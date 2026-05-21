"use client";

import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 18; // ~90s total

const buttonStyle = {
  background: "#d6d2c4",
  color: "#18181a",
  border: "none",
  padding: "6px 14px",
  borderRadius: 4,
  fontSize: 12,
  cursor: "pointer",
  fontWeight: 500,
};

const disabledStyle = { ...buttonStyle, opacity: 0.6, cursor: "wait" };

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle = {
  background: "#18181a",
  border: "1px solid #2a2a2c",
  borderRadius: 8,
  padding: 20,
  width: "min(520px, 90vw)",
  color: "#e7e7e2",
  position: "relative",
};

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  padding: "10px 0",
  borderTop: "1px solid #2a2a2c",
};

const labelStyle = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#8a8a80",
  minWidth: 110,
};

const linkStyle = {
  color: "#d6d2c4",
  textDecoration: "none",
  wordBreak: "break-all",
  flex: 1,
};

const smallBtnStyle = {
  background: "transparent",
  border: "1px solid #2a2a2c",
  color: "#b6b6ad",
  padding: "3px 8px",
  borderRadius: 3,
  fontSize: 11,
  cursor: "pointer",
};

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      style={smallBtnStyle}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // ignore — clipboard may not be available
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function PublishButton({ files, label, disabled }) {
  const [state, setState] = useState({ phase: "idle" });
  const pollAttemptsRef = useRef(0);
  const pollTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  async function publish({ newSession = false } = {}) {
    setState({ phase: "publishing" });
    let payload;
    try {
      const res = await fetch("/api/admin/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, label, newSession }),
      });
      payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ phase: "error", error: payload, status: res.status });
        return;
      }
    } catch (err) {
      setState({
        phase: "error",
        error: { error: `network error: ${err?.message || err}` },
        status: 0,
      });
      return;
    }

    setState({ phase: "success", result: payload, previewUrl: null });
    pollAttemptsRef.current = 0;
    if (payload.prNumber) {
      schedulePreviewPoll(payload.prNumber);
    }
  }

  function schedulePreviewPoll(prNumber) {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(
      () => pollPreviewOnce(prNumber),
      POLL_INTERVAL_MS
    );
  }

  async function pollPreviewOnce(prNumber) {
    pollAttemptsRef.current += 1;
    try {
      const res = await fetch(
        `/api/admin/publish/preview-url?pr=${prNumber}`
      );
      if (res.status === 200) {
        const data = await res.json();
        if (data.url) {
          setState((s) =>
            s.phase === "success" ? { ...s, previewUrl: data.url } : s
          );
          return;
        }
      }
    } catch {
      // swallow — we'll just try again
    }
    if (pollAttemptsRef.current < POLL_MAX_ATTEMPTS) {
      schedulePreviewPoll(prNumber);
    } else {
      setState((s) =>
        s.phase === "success" ? { ...s, pollTimedOut: true } : s
      );
    }
  }

  function close() {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    setState({ phase: "idle" });
  }

  const inFlight = state.phase === "publishing";

  return (
    <>
      <button
        onClick={() => publish()}
        disabled={disabled || inFlight}
        style={inFlight ? disabledStyle : buttonStyle}
      >
        {inFlight ? "Publishing…" : "Publish →"}
      </button>

      {state.phase === "success" && (
        <SuccessModal
          result={state.result}
          previewUrl={state.previewUrl}
          pollTimedOut={state.pollTimedOut}
          onClose={close}
        />
      )}

      {state.phase === "error" && (
        <ErrorModal
          error={state.error}
          status={state.status}
          onClose={close}
          onRetryNewSession={
            state.error?.suggestion === "newSession"
              ? () => publish({ newSession: true })
              : null
          }
        />
      )}
    </>
  );
}

function SuccessModal({ result, previewUrl, pollTimedOut, onClose }) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            background: "transparent",
            border: "none",
            color: "#8a8a80",
            fontSize: 20,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          ×
        </button>

        <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 500 }}>
          Published to preview
        </h3>

        <div style={rowStyle}>
          <span style={labelStyle}>Pull request</span>
          <a
            href={result.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={linkStyle}
          >
            {result.prUrl}
          </a>
          <CopyButton text={result.prUrl} />
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Preview deploy</span>
          {previewUrl ? (
            <>
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={linkStyle}
              >
                {previewUrl}
              </a>
              <CopyButton text={previewUrl} />
            </>
          ) : pollTimedOut ? (
            <span style={{ flex: 1, color: "#c9806b", fontSize: 12 }}>
              Vercel didn&apos;t comment within 90s — check the PR.
            </span>
          ) : result.vercelInspectorUrl ? (
            <span style={{ flex: 1, fontSize: 12, color: "#b6b6ad" }}>
              Vercel is building…{" "}
              <a
                href={result.vercelInspectorUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#d6d2c4" }}
              >
                open inspector
              </a>
            </span>
          ) : (
            <span style={{ flex: 1, fontSize: 12, color: "#b6b6ad" }}>
              Waiting for Vercel…
            </span>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 16,
            paddingTop: 12,
            borderTop: "1px solid #2a2a2c",
            fontSize: 11,
            color: "#8a8a80",
          }}
        >
          <span>
            {result.prAction} · {result.branch} · {result.commitSha}
          </span>
          <button onClick={onClose} style={buttonStyle}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorModal({ error, status, onClose, onRetryNewSession }) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            background: "transparent",
            border: "none",
            color: "#8a8a80",
            fontSize: 20,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          ×
        </button>

        <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 500 }}>
          Publish failed
        </h3>

        <div
          style={{
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            color: "#e7c08c",
            background: "#0f0f10",
            border: "1px solid #2a2a2c",
            borderRadius: 4,
            padding: 10,
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
          }}
        >
          {status ? `${status} · ` : ""}
          {error?.error || "Unknown error"}
        </div>

        {error?.mergedPrUrl && (
          <div style={{ marginTop: 10, fontSize: 12 }}>
            Merged PR:{" "}
            <a
              href={error.mergedPrUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#d6d2c4" }}
            >
              {error.mergedPrUrl}
            </a>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
            paddingTop: 12,
            borderTop: "1px solid #2a2a2c",
          }}
        >
          {onRetryNewSession && (
            <button onClick={onRetryNewSession} style={buttonStyle}>
              Start new editing session
            </button>
          )}
          <button
            onClick={onClose}
            style={{ ...buttonStyle, background: "#2a2a2c", color: "#e7e7e2" }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
