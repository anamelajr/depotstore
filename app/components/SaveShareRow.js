"use client";

import { useState } from "react";

function BookmarkIcon({ filled }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
    >
      <path d="M3.5 2h9v12l-4.5-3-4.5 3V2z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
    >
      <path d="M8 2v8M5 5l3-3 3 3M3 9v4a1 1 0 001 1h8a1 1 0 001-1V9" />
    </svg>
  );
}

export default function SaveShareRow({ productUrl, title }) {
  // v1: visual-only toggle. No persistence — see spec for rationale.
  const [saved, setSaved] = useState(false);
  const [shareLabel, setShareLabel] = useState("Share");

  async function handleShare() {
    if (!productUrl) return;
    const data = { title: title ?? "Dépôt", url: productUrl };
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share(data);
        return;
      } catch {
        // User cancelled or share failed — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(productUrl);
      setShareLabel("Copied");
      setTimeout(() => setShareLabel("Share"), 2000);
    } catch {
      // Clipboard unavailable (e.g. http) — silent failure is acceptable.
    }
  }

  return (
    <div className="mt-5 px-6 flex gap-6">
      <button
        type="button"
        onClick={() => setSaved((v) => !v)}
        aria-pressed={saved}
        className="flex-1 inline-flex items-center justify-center gap-2.5 py-2.5 font-mono text-[11px] text-zinc-900 hover:text-zinc-600 transition-colors"
      >
        <BookmarkIcon filled={saved} />
        <span>{saved ? "Saved" : "Save"}</span>
      </button>
      <button
        type="button"
        onClick={handleShare}
        className="flex-1 inline-flex items-center justify-center gap-2.5 py-2.5 font-mono text-[11px] text-zinc-900 hover:text-zinc-600 transition-colors"
      >
        <ShareIcon />
        <span>{shareLabel}</span>
      </button>
    </div>
  );
}
