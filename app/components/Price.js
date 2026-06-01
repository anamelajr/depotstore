"use client";

import { useCurrency } from "./CurrencyProvider";
import { formatPrice } from "../lib/currency";

// Universal price node used at every price-display site. Reads the selected
// currency + rates from context and renders the converted string, so flipping
// currency updates every price live (no navigation). Renders "—" when the EUR
// input is null/unparseable.
//
// Intentional consistency change: the trailing-.00 strip now runs on ALL sites
// (was feed-cards only), so €100.00 -> €100 on product detail + editorial too.
// GBP/USD are integer multiples of 5, so the strip is a no-op there.
export default function Price({ eur, className }) {
  const { currency, rates } = useCurrency();
  const formatted = formatPrice(eur, currency, rates);

  if (formatted == null) {
    return <span className={className}>—</span>;
  }

  const display =
    currency === "EUR" ? formatted.replace(/\.00$/, "") : formatted;

  return <span className={className}>{display}</span>;
}
