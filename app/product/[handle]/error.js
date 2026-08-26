"use client";

import Link from "next/link";

// Catches everything fetchShopifyProduct now throws instead of flattening into
// a false "Product not found": merchant timeouts, transport failures, non-404
// upstream statuses, malformed responses. All of those are transient, so the
// only useful affordance is a retry — reset() re-runs the server render.
//
// There is no partial degrade to offer: Shopify is the sole image source, so a
// DB-row-only page would be a product page with no product photos.
export default function ProductError({ reset }) {
  return (
    <div className="min-h-screen text-zinc-900 flex flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-900">
        Something went wrong
      </p>
      <p className="font-sans text-[13px] leading-relaxed text-zinc-600 max-w-sm">
        We couldn&apos;t load this piece just now. The store may be temporarily
        unreachable.
      </p>
      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={reset}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-900 underline underline-offset-4"
        >
          Try again
        </button>
        <Link
          href="/feed"
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500 underline underline-offset-4"
        >
          Back to feed
        </Link>
      </div>
    </div>
  );
}
