"use client";

import { useState } from "react";
import { useLanguage } from "./LanguageProvider";

export default function NewsletterForm() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(null); // null | "loading" | "success" | "error"

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setStatus("success");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <p className="text-[13px] text-zinc-600 tracking-wide">
        {t("newsletter.success")}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("newsletter.placeholder")}
        aria-label={t("newsletter.label")}
        required
        disabled={status === "loading"}
        className="w-full bg-zinc-100 px-4 py-3 font-mono text-sm text-zinc-950 placeholder:text-zinc-400 placeholder:uppercase placeholder:tracking-widest outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className="sr-only mt-3 border border-zinc-300 px-5 py-2 font-mono text-[12px] uppercase tracking-widest text-zinc-600 transition-colors hover:border-zinc-900 hover:text-zinc-950 disabled:opacity-50 focus:not-sr-only"
      >
        {status === "loading" ? "..." : t("newsletter.signUp")}
      </button>
      {status === "error" && (
        <p className="mt-2 text-[11px] text-red-600">
          {t("newsletter.error")}
        </p>
      )}
    </form>
  );
}
