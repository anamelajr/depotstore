// Instant click feedback for the PDP. Without a loading boundary, clicking a
// feed card shows nothing at all until the full dynamic server render lands
// (Shopify fetch + DB row + MoreFromStore) — the "clicking products feels
// laggy" complaint. The skeleton mirrors page.js' two shells: a stacked
// gallery + sticky text panel from lg up, a full-bleed image + stacked text
// below it.
function Bar({ className = "" }) {
  return <div className={`animate-pulse rounded-[2px] bg-zinc-100 ${className}`} />;
}

export default function ProductLoading() {
  return (
    <div className="min-h-screen bg-white text-zinc-900">
      {/* Desktop — matches the lg:grid-cols-[minmax(0,1fr)_minmax(460px,40%)] shell */}
      <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(460px,40%)]">
        <div className="animate-pulse bg-zinc-100" style={{ aspectRatio: "4 / 5" }} />
        <div className="px-10 pt-16">
          <Bar className="h-[22px] w-1/2" />
          <Bar className="mt-3 h-[14px] w-3/4" />
          <Bar className="mt-8 h-[13px] w-24" />
          <Bar className="mt-4 h-[11px] w-40" />
          <Bar className="mt-9 h-[54px] w-full" />
          <Bar className="mt-10 h-[11px] w-full" />
          <Bar className="mt-3 h-[11px] w-5/6" />
        </div>
      </div>

      {/* Mobile */}
      <div className="lg:hidden">
        <div className="animate-pulse bg-zinc-100" style={{ aspectRatio: "4 / 5" }} />
        <div className="mt-6 px-6">
          <Bar className="h-[22px] w-2/3" />
          <Bar className="mt-2.5 h-[14px] w-5/6" />
        </div>
        <div className="mt-8 px-6">
          <Bar className="h-[13px] w-20" />
          <Bar className="mt-3.5 h-[11px] w-36" />
        </div>
        <div className="mt-9 px-6">
          <Bar className="h-[54px] w-full" />
        </div>
        <div className="mt-10 px-6">
          <Bar className="h-[11px] w-full" />
          <Bar className="mt-3 h-[11px] w-4/5" />
        </div>
      </div>
    </div>
  );
}
