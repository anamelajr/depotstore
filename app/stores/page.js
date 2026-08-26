import Link from "next/link";
import { getActiveStores } from "../lib/stores.js";
import T from "../components/T";

export const dynamic = 'force-dynamic';

export default async function StoresPage() {
  // getActiveStores, not getAllStores + a filter: this was the last uncached
  // full-table stores read on the site, and the layout has already warmed this
  // cache for the request.
  //
  // Deliberate contract change: the page inherits the 600s SWR staleness (a
  // deactivated store can linger listed for up to ~10 minutes) and the
  // FALLBACK_STORES degrade on a DB outage — where today it silently renders
  // an empty directory. Both are the right trade for a public marketing page.
  // This is NOT an authorization surface; the PDP store gate is untouched and
  // remains the authoritative allowlist.
  const stores = await getActiveStores();

  return (
    <div className="min-h-screen text-zinc-950">
      <div className="mx-auto max-w-4xl px-8 py-16 sm:py-20">
        <h1 className="mb-6 font-mono text-[10px] font-normal uppercase tracking-[0.22em] text-zinc-400">
          <T k="stores.label" />
        </h1>

        <div>
          {stores.map((store) => (
            <Link
              key={store.storeName}
              href={`/feed?store=${encodeURIComponent(store.domain)}`}
              className="group block py-2 font-mono text-[11px] uppercase tracking-widest text-zinc-600 transition-colors hover:text-zinc-950"
            >
              <span className="-ml-4 mr-1 opacity-0 transition-opacity group-hover:opacity-100">
                —{" "}
              </span>
              {/* FALLBACK_STORES rows carry no displayName. */}
              {store.displayName ?? store.storeName}
              {store.location ? (
                <span className="ml-3 whitespace-nowrap text-[9px] tracking-[0.22em] text-zinc-400">
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
