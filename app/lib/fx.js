import { cache } from "react";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "./supabase.js";

// EUR->GBP/USD rates for the region selector. Read server-side from the
// single-row `fx_rates` table; refreshed hourly from Frankfurter by the cron.
// Server-only — imports supabaseAdmin (service role); never import from a
// client component.

// Safety net mirroring FALLBACK_STORES in stores.js: if the fx_rates table is
// missing/unreadable, prices still render rather than crashing. These are a
// LAST RESORT, intentionally distinct from any real seed so a fallback never
// looks like live data (see getFxRates' structured warn + the seed guard in
// scripts/sql/2026-06-01-fx-rates.sql).
export const FALLBACK_RATES = { GBP: 0.85, USD: 1.08 };

// Canonical Frankfurter host. The old api.frankfurter.app 301-redirects here;
// using .dev directly avoids a redirect hop tripping a non-following runtime.
const FRANKFURTER_URL =
  "https://api.frankfurter.dev/v1/latest?from=EUR&to=GBP,USD";

// Returns { rates: { GBP, USD }, source: "db" | "fallback" }. The nested
// `rates` object is the only thing passed to CurrencyProvider/formatPrice;
// `source` is for server-side diagnostics only — never pass the wrapper down.
// A missing / schema-drifted table is loud (console.warn), not silent, so
// stale hardcoded rates can't ship looking correct.
//
// Three layers, matching app/lib/stores.js: the inner read THROWS (a fallback
// must never be cached), `unstable_cache` shares the good value across
// requests for 10 minutes (cron refreshes fx hourly, so 10-min staleness is
// purely presentational), and `React.cache` dedupes within a request.
const FX_READ_TIMEOUT_MS = 4000;

async function fetchFxRatesOrThrow() {
  // Bound the live cold-miss request itself: this read gates the root
  // layout's first paint, and a hung connection would block the document.
  // Mirrors the abort in refreshFxRates below and in stores.js.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FX_READ_TIMEOUT_MS);
  let data, error;
  try {
    ({ data, error } = await supabaseAdmin
      .from("fx_rates")
      .select("gbp, usd")
      .eq("id", 1)
      .abortSignal(controller.signal)
      .single());
  } finally {
    clearTimeout(timer);
  }

  // Distinct message so operators can tell a timeout from other failures.
  if (controller.signal.aborted) {
    throw new Error(`fx read timed out after ${FX_READ_TIMEOUT_MS}ms`);
  }
  if (error) throw error;
  if (!data || data.gbp == null || data.usd == null) {
    throw new Error("fx_rates row 1 missing gbp/usd");
  }

  return { GBP: Number(data.gbp), USD: Number(data.usd) };
}

const getCachedFxRates = unstable_cache(fetchFxRatesOrThrow, ["fx-rates-v1"], {
  revalidate: 600,
});

const dedupedFxRates = cache(async () => {
  try {
    return { rates: await getCachedFxRates(), source: "db" };
  } catch (e) {
    console.warn(
      JSON.stringify({
        event: "fx_read_fallback",
        reason: e?.message ?? String(e),
      }),
    );
    return { rates: { ...FALLBACK_RATES }, source: "fallback" };
  }
});

export async function getFxRates() {
  return dedupedFxRates();
}

// Fetches live rates from Frankfurter and upserts row 1. Time-bounded with an
// AbortController (~5 s, mirroring cleanTitle.js) so a hung provider can never
// stall the caller. Throws on non-200 or a payload missing rates.GBP/USD —
// the caller (cron) catches and logs, leaving the last-good row intact.
export async function refreshFxRates() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(FRANKFURTER_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Frankfurter responded ${res.status}`);
    }

    const json = await res.json();
    const gbp = json?.rates?.GBP;
    const usd = json?.rates?.USD;
    if (typeof gbp !== "number" || typeof usd !== "number") {
      throw new Error("Frankfurter payload missing rates.GBP/rates.USD");
    }

    const { error } = await supabaseAdmin.from("fx_rates").upsert(
      {
        id: 1,
        base: "EUR",
        gbp,
        usd,
        // Explicit so ON CONFLICT DO UPDATE advances the freshness signal —
        // the column default now() only fires on INSERT, not on update.
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw error;

    return { GBP: gbp, USD: usd };
  } finally {
    clearTimeout(timeoutId);
  }
}
