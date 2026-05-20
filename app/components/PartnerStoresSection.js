import Link from "next/link";

export default function PartnerStoresSection({ products = [], stores = [] }) {
  const counts = {};
  for (const p of products) {
    const name = p?.storeName;
    if (name) counts[name] = (counts[name] ?? 0) + 1;
  }
  const pieceCounts = counts;

  return (
    <div className="divide-y divide-zinc-800">
      {stores.slice(0, 5).map((store, index) => {
        const count = pieceCounts[store.storeName] ?? 0;
        const num = String(index + 1).padStart(2, "0");
        return (
          <Link
            key={store.storeName}
            href={`/feed?store=${encodeURIComponent(store.domain)}`}
            className="group flex items-center justify-between gap-8 py-10 transition-colors"
          >
            <div className="flex items-baseline gap-8">
              <span className="w-8 shrink-0 font-mono text-[11px] font-medium uppercase tracking-widest text-zinc-600">
                {num}
              </span>
              <span
                className="font-medium tracking-tight transition-colors group-hover:text-zinc-50"
                style={{
                  fontFamily: "var(--font-general-sans), sans-serif",
                  fontSize: "clamp(20px, 3vw, 28px)",
                }}
              >
                {store.displayName}
              </span>
            </div>
            <div className="flex shrink-0 items-baseline gap-8 text-right">
              <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
                {store.location}
              </span>
              <span className="w-16 text-right font-mono text-[11px] text-zinc-600">
                {count} pcs
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
