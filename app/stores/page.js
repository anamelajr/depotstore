import Link from "next/link";

const STORES = [
  { storeName: "L'OBSCUR", displayName: "L'Obscur", location: "Le Marais" },
  { storeName: "Dolce Vita Hub", displayName: "Dolce Vita Hub", location: "Le Marais" },
  { storeName: "Seys Wardrobe", displayName: "Seys Wardrobe", location: "Paris" },
  { storeName: "Numero 13 Vintage", displayName: "Numero 13 Vintage", location: "Le Marais" },
  { storeName: "Les Archives Paris", displayName: "Les Archives Paris", location: "Saint-Germain-des-Prés" },
  { storeName: "at dawn paris", displayName: "AT Dawn Paris", location: "Le Marais" },
  { storeName: "Nuovo Paris", displayName: "Nuovo Paris", location: "Le Marais" },
  { storeName: "yourgarmentz", displayName: "yourgarmentz", location: "Paris" },
  { storeName: "dot COMME", displayName: "dot COMME", location: "Le Marais" },
  { storeName: "ESCO", displayName: "ESCO", location: "Paris" },
{ storeName: "Grain de sell", displayName: "Grain de sell", location: "Paris" },
];

async function getPieceCounts() {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/api/products`, { cache: "no-store" });
    if (!res.ok) return {};
    const products = await res.json();
    const counts = {};
    for (const p of products) {
      const name = p?.storeName;
      if (name) counts[name] = (counts[name] ?? 0) + 1;
    }
    return counts;
  } catch {
    return {};
  }
}

export default async function StoresPage() {
  const pieceCounts = await getPieceCounts();

  return (
    <div
      className="min-h-screen bg-[#0a0a0a] font-mono"
      style={{ color: "rgb(250 250 250)" }}
    >
      <div className="mx-auto max-w-4xl px-6 py-16">
        <Link
          href="/feed"
          className="mb-12 block text-[13px] tracking-wide text-zinc-400 transition-colors hover:text-zinc-50"
        >
          ← Back to feed
        </Link>

        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
          Directory
        </p>
        <h1
          className="mb-16 text-[clamp(36px,6vw,56px)] font-medium leading-tight tracking-tight"
          style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
        >
          Partner Stores
        </h1>

        <div className="divide-y divide-zinc-800">
          {STORES.map((store, index) => {
            const count = pieceCounts[store.storeName] ?? 0;
            const num = String(index + 1).padStart(2, "0");
            return (
              <Link
                key={store.storeName}
                href={`/feed?store=${encodeURIComponent(store.storeName)}`}
                className="group flex items-center justify-between gap-8 py-10 transition-colors"
              >
                <div className="flex items-baseline gap-8">
                  <span className="w-8 shrink-0 text-[11px] font-medium uppercase tracking-widest text-zinc-600">
                    {num}
                  </span>
                  <span
                    className="text-[clamp(24px,4vw,32px)] font-medium tracking-tight transition-colors group-hover:text-zinc-50"
                    style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
                  >
                    {store.displayName}
                  </span>
                </div>
                <div className="flex shrink-0 items-baseline gap-8 text-right">
                  <span className="text-[11px] uppercase tracking-widest text-zinc-500">
                    {store.location}
                  </span>
                  <span className="w-16 text-right text-[11px] text-zinc-600">
                    {count} pcs
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}