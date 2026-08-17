import ClampedDescription from "./ClampedDescription";
import { resolveDescription } from "../lib/resolveProductDetail";

// Async server component holding the one awaited thing on the PDP that can
// take seconds: an OpenAI generation for a product whose
// `editorial_description` is still NULL. Wrapped in <Suspense> by the caller,
// so the shell (gallery, price, CTA) paints immediately and the text streams
// in behind it.
//
// In the steady state — a row that already has a description — the caller
// passes the string directly and this component never renders, so there is no
// placeholder flash for the 99% case once the backfill has run.
// `plain` renders the mobile Accordion shape (no clamp — the accordion is
// already a disclosure); the default renders the desktop panel's clamped form.
export default async function ProductDescription({
  handle,
  storeDomain,
  plain = false,
}) {
  const description = await resolveDescription(handle, storeDomain);

  if (!description) {
    return plain ? (
      <p className="text-zinc-400">No description available.</p>
    ) : null;
  }

  return plain ? <p>{description}</p> : <ClampedDescription text={description} />;
}

// Shared skeleton for the Suspense fallback — two quiet text bars, sized to
// the clamp so the block doesn't jump when the real text lands.
export function ProductDescriptionFallback() {
  return (
    <div aria-hidden="true" className="animate-pulse">
      <div className="h-[11px] w-full rounded-[2px] bg-zinc-100" />
      <div className="mt-2.5 h-[11px] w-11/12 rounded-[2px] bg-zinc-100" />
      <div className="mt-2.5 h-[11px] w-3/5 rounded-[2px] bg-zinc-100" />
    </div>
  );
}
