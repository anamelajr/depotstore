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
      <p className="font-mono text-[13px] uppercase tracking-[0.14em] text-white">
        {t("newsletter.success")}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("newsletter.placeholder")}
        aria-label={t("newsletter.label")}
        required
        disabled={status === "loading"}
        className="w-full bg-transparent border-b border-[#3a3833] pb-3 font-mono text-[13px] uppercase tracking-[0.14em] text-white placeholder:text-white placeholder:uppercase placeholder:tracking-[0.14em] outline-none focus:border-white disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className="sr-only left-0 mt-3 border border-[#3a3833] px-5 py-2 font-mono text-[12px] uppercase tracking-widest text-white transition-colors hover:border-white disabled:opacity-50 focus:not-sr-only"
      >
        {status === "loading" ? "..." : t("newsletter.signUp")}
      </button>
      {status === "error" && (
        <p className="mt-2 text-[11px] text-red-400">
          {t("newsletter.error")}
        </p>
      )}
    </form>
  );
}
