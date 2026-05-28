"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteEntryButton({ slug, title }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (busy) return;
    const ok = confirm(
      `Delete "${title}"? Removes the entry, its file, and its images. This cannot be undone.`
    );
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch("/api/admin/delete-editorial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        alert(data.error || `Delete failed (${res.status})`);
        return;
      }

      if (data.imagesRemoved === false) {
        alert(
          `Deleted "${title}", but its image folder (public/editorial/${slug}/) couldn't be removed — clean it up manually.`
        );
      }
      router.refresh();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      style={{
        marginLeft: 8,
        padding: "6px 12px",
        background: "transparent",
        border: "1px solid #2a2a2c",
        borderRadius: 6,
        color: "#c9806b",
        fontSize: 12,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
