import Link from "next/link";
import { getAllStores } from "../lib/stores.js";
import T from "../components/T";

export const dynamic = 'force-dynamic';

export default async function StoresPage() {
  const allStores = await getAllStores();
  const stores = allStores.filter((s) => s.active);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-50">
      <div className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
        <h1 className="mb-12 font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-zinc-500 sm:mb-16">
          <T k="stores.label" />
        </h1>

        <div className="stores-spotlight flex flex-col">
          {stores.map((store) => (
            <Link
              key={store.storeName}
              href={`/feed?store=${encodeURIComponent(store.domain)}`}
              className="py-1 text-[clamp(36px,7vw,72px)] font-medium leading-[1.15] tracking-tight text-zinc-50 transition-colors duration-200"
              style={{ fontFamily: "var(--font-general-sans), sans-serif" }}
            >
              {store.displayName}
              {store.location ? (
                <sup className="ml-2 inline-block whitespace-nowrap align-super font-mono text-[10px] font-normal uppercase tracking-[0.2em] text-zinc-500 sm:ml-3">
                  {store.location}
                </sup>
              ) : null}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
