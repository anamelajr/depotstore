import Link from "next/link";
import { supabase } from "../lib/supabase.js";
import { getAllStores } from "../lib/stores.js";

export const dynamic = 'force-dynamic';

async function getPieceCounts() {
  const { data, error } = await supabase.rpc("count_products_by_store");
  if (error || !data) return {};
  const counts = {};
  for (const row of data) {
    if (row.store_name) counts[row.store_name] = Number(row.count);
  }
  return counts;
}

export default async function StoresPage() {
  const [allStores, pieceCounts] = await Promise.all([
    getAllStores(),
    getPieceCounts(),
  ]);
  const stores = allStores.filter((s) => s.active);

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
          style={{ fontFamily: "var(--font-general-sans), sans-serif" }}
        >
          Partner Stores
        </h1>

        <div className="divide-y divide-zinc-800">
          {stores.map((store, index) => {
            const count = pieceCounts[store.storeName] ?? 0;
            const num = String(index + 1).padStart(2, "0");
            return (
              <Link
                key={store.storeName}
                href={`/feed?store=${encodeURIComponent(store.domain)}`}
                className="group flex items-center justify-between gap-8 py-10 transition-colors"
              >
                <div className="flex items-baseline gap-8">
                  <span className="w-8 shrink-0 text-[11px] font-medium uppercase tracking-widest text-zinc-600">
                    {num}
                  </span>
                  <span
                    className="text-[clamp(24px,4vw,32px)] font-medium tracking-tight transition-colors group-hover:text-zinc-50"
                    style={{ fontFamily: "var(--font-general-sans), sans-serif" }}
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