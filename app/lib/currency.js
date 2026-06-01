// Pure currency parse / convert / round / format helpers for the region
// selector. EUR is the stored, sorted base ('€29.99' text); GBP/USD are
// derived at display time from the fx_rates snapshot. No I/O here — this
// module is imported by the client <Price> component, so it must stay pure.

export const CURRENCIES = {
  EUR: { symbol: "€", label: "EUR" },
  GBP: { symbol: "£", label: "GBP" },
  USD: { symbol: "$", label: "USD" },
};

// "€29.99" -> 29.99. Strips the symbol and thousands separators; returns
// null on anything unparseable so callers can render the "—" placeholder.
export function parseEur(raw) {
  if (raw == null) return null;
  const cleaned = String(raw)
    .replace(/[^\d.,]/g, "")
    .replace(/,/g, "");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Nearest 5, floored at 5. The Math.max(5, …) floor stops a low-EUR item
// (e.g. €2) rounding down to £0 and reading as free.
export function roundTo5(n) {
  return Math.max(5, Math.round(n / 5) * 5);
}

// Returns the display string for a price in the chosen currency, or null
// when the EUR input or the rate is missing. EUR is a passthrough of the
// raw stored string — the trailing-.00 strip is applied by <Price>. GBP/USD
// are integer multiples of 5 with no "≈" sign (e.g. "£260" / "$350").
export function formatPrice(rawEur, currency, rates) {
  if (rawEur == null) return null;
  if (currency === "EUR" || !currency) {
    return String(rawEur);
  }
  const amount = parseEur(rawEur);
  if (amount == null) return null;
  const rate = rates?.[currency];
  if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
  const converted = roundTo5(amount * rate);
  const symbol = CURRENCIES[currency]?.symbol ?? "";
  return `${symbol}${converted}`;
}
