import Link from "next/link";
import { getAllStores } from "../lib/stores.js";
import T from "../components/T";

export const dynamic = 'force-dynamic';

export default async function StoresPage() {
  const allStores = await getAllStores();
  const stores = allStores.filter((s) => s.active);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-50">
      <div className="mx-auto max-w-4xl px-8 py-16 sm:py-20">
        <h1 className="mb-6 font-mono text-[10px] font-normal uppercase tracking-[0.22em] text-zinc-600">
          <T k="stores.label" />
        </h1>

        <div>
          {stores.map((store) => (
            <Link
              key={store.storeName}
              href={`/feed?store=${encodeURIComponent(store.domain)}`}
              className="group block py-2 font-mono text-[11px] uppercase tracking-widest text-zinc-300 transition-colors hover:text-zinc-50"
            >
              <span className="-ml-4 mr-1 opacity-0 transition-opacity group-hover:opacity-100">
                —{" "}
              </span>
              {store.displayName}
              {store.location ? (
                <span className="ml-3 whitespace-nowrap text-[9px] tracking-[0.22em] text-zinc-600">
                  {store.location}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
