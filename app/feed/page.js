import { Suspense } from "react";
import FeedClient from "./FeedClient";
import { getActiveStores } from "../lib/stores.js";

export const dynamic = 'force-dynamic';

export default async function FeedPage() {
  const stores = await getActiveStores();
  return (
    <Suspense fallback={<FeedLoadingFallback />}>
      <FeedClient stores={stores} />
    </Suspense>
  );
}

function FeedLoadingFallback() {
  return (
    <div className="min-h-screen bg-white font-mono text-zinc-950">
      <main className="mx-auto max-w-7xl px-4 pb-24 pt-3 md:pb-32 md:pt-8">
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          Loading products...
        </p>
      </main>
    </div>
  );
}
