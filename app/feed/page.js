import { Suspense } from "react";
import FeedClient from "./FeedClient";
import { getActiveStores, FALLBACK_STORES } from "../lib/stores.js";
import { fetchProductsPage } from "../lib/fetchProductsPage.js";
import { ALL_STORES_VALUE, LOAD_SIZE } from "../lib/feed-utils";
import { SORT_MAP } from "../lib/sort-options";

export const dynamic = 'force-dynamic';

// Bound on the whole loader (stores + products). Past this the render
// unblocks with initialData = null and the client fetch path takes over,
// keeping worst-case latency at or below the pre-SSR behavior.
const SERVER_FETCH_TIMEOUT_MS = 4000;

export default async function FeedPage({ searchParams }) {
  const sp = await searchParams;
  return (
    <Suspense fallback={<FeedShellFallback />}>
      <FeedLoader sp={sp} />
    </Suspense>
  );
}

// All awaiting happens inside the Suspense boundary so the blank shell
// streams immediately.
async function FeedLoader({ sp }) {
  // Mirrors FeedClient's URL-derived block so `filterKey` matches exactly.
  const search = typeof sp?.search === "string" ? sp.search : "";
  const store = typeof sp?.store === "string" ? sp.store : ALL_STORES_VALUE;
  const rawCategory = sp?.category;
  const urlCategories = rawCategory == null
    ? []
    : Array.isArray(rawCategory)
    ? rawCategory
    : [rawCategory];
  const urlSort = typeof sp?.sort === "string" ? sp.sort : "interleaved";
  const brand = typeof sp?.brand === "string" ? sp.brand : "";

  // join→split reproduces the client's getAll→join→API-split semantics for
  // both `?category=a&category=b` and `?category=a,b`.
  const categoriesKey = urlCategories.join(",");
  const categorySlugs = categoriesKey ? categoriesKey.split(",").filter(Boolean) : [];
  const filterKey = `${store}|${categoriesKey}|${search}|${urlSort}|${brand}`;

  let stores = FALLBACK_STORES;
  let initialData = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_FETCH_TIMEOUT_MS);
  try {
    const [storesResult, productsResult] = await Promise.race([
      Promise.all([
        getActiveStores(), // degrades internally to FALLBACK_STORES on { error }
        fetchProductsPage({
          store: store !== ALL_STORES_VALUE ? store : null,
          categorySlugs,
          search: search || null,
          brand: brand || null,
          sort: SORT_MAP[urlSort] || null,
          limit: LOAD_SIZE,
          offset: 0,
          signal: controller.signal,
        }),
      ]),
      new Promise((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error("server fetch timeout")),
          { once: true },
        );
      }),
    ]);
    stores = storesResult;
    initialData = {
      products: productsResult.products,
      total: productsResult.total,
      filterKey,
    };
  } catch (err) {
    console.warn(
      `[FeedLoader] server fetch failed, falling back to client fetch: ${err.message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  return <FeedClient stores={stores} initialData={initialData} />;
}

function FeedShellFallback() {
  return (
    <div className="min-h-screen bg-white font-mono text-zinc-950">
      <main className="px-4 md:px-6 pb-24 pt-3 md:pb-32 md:pt-8" />
    </div>
  );
}
