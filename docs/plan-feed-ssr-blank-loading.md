# Remove feed loading pill + server-render first page of products

## Context

When a user clicks into the feed or a category, the site currently shows a
two-stage loading sequence: a "Loading products..." Suspense fallback
(server), then a grey "Loading products…" pill plus a mobile "LOADING…"
label (client) while the browser makes a second round trip to
`/api/products`. The user wants **no loading text at all** (approved choice:
completely blank — no skeleton, no spinner) and products to appear as fast
as possible. The biggest speed win is server-rendering the first page of
products so they arrive inside the HTML — on a normal first visit there is
no loading state at all.

User-approved decisions:
- Loading treatment: **completely blank** (no skeleton grid).
- Speed approach: **server-render page 1**, degrading to the current
  client-fetch behavior if Supabase is slow or unreachable.

Environment facts: Next 16 (async `searchParams`; precedent at
`app/admin/inventory/page.js:20`). `app/feed/page.js` is already
`force-dynamic`. CLAUDE.md forbids self-HTTP fetches (`NEXT_PUBLIC_BASE_URL`
ambiguity — MoreFromStore precedent) and duplicated query logic, so the
route's query core is extracted into a shared lib both callers use.

### Design revisions from adversarial review

An adversarial review surfaced two real design flaws in the first draft;
this version incorporates the fixes:

1. **Soft navigations re-run the server page.** `router.push`/`replace`
   with new searchParams re-renders `FeedPage` (force-dynamic), so a
   one-shot "skip the first client fetch" guard would discard every
   subsequent server payload and re-fetch the same data through
   `/api/products` — two serial queries per filter change. **Fix: one
   request path.** Filter/sort/search changes are *server-driven*: the URL
   and the fresh `initialData` prop commit atomically in a single render
   (App Router applies the RSC response and searchParams together), so
   FeedClient consumes server data whenever `initialData.filterKey`
   matches the URL-derived `filterKey`, and client-fetches only when it
   doesn't (fallback, back-nav restore). Side benefit: during a soft nav
   React keeps the old grid on screen until the new data commits — filter
   changes no longer blank the grid at all in the common case.
2. **Awaiting the query before returning `<Suspense>` blocks streaming and
   doubles worst-case outage latency** (8s server timeout, then the client
   repeats the same failing query). **Fix:** move all data fetching into an
   async `FeedLoader` child *inside* the Suspense boundary (the blank shell
   streams immediately), and bound the server product fetch with a
   `Promise.race` timeout of ~4s — on timeout/failure `initialData` is
   null and the client path takes over, keeping worst-case latency at or
   below today's.

   (Alternative considered and rejected: switching filter handlers to the
   native History API to keep filtering purely client-side. It avoids the
   server re-render but forks the data path in two, loses SSR'd filter
   URLs, and fights the framework's model.)

A second review round added three hardening fixes (adopted in cheap form;
the review's heavier remedies — full AbortSignal propagation through all
shared query helpers, deterministic race-timing test harnesses — were
judged disproportionate and skipped):

3. **Bound the whole loader, not just the product fetch.** `getActiveStores`
   already degrades to `FALLBACK_STORES` on Supabase `{ error }` returns,
   but the loader now runs stores + products concurrently under one 4s
   deadline with a try/catch around everything — a throw or stall in
   either degrades to `FALLBACK_STORES` + `initialData = null` instead of
   an error page or an indefinite blank shell.
4. **Actually cancel the timed-out server query.** `fetchProductsPage`
   accepts an optional `signal` applied via `.abortSignal()` at its query
   call sites, and the loader aborts it when the deadline fires (timer
   cleared on success) — no orphaned query racing the client retry during
   a slowdown. The two interleaved RPC helpers gain an optional trailing
   `signal` param (backwards-compatible) so the default feed path is
   covered too.
5. **Guard Load More against a now-persistent stale-response race.** Today
   a stale Load More response landing during a filter change is papered
   over by the follow-up client refetch replacing `products` wholesale;
   under the new server-driven path nothing overwrites it, so the append
   would persist. Each Load More response is now discarded unless the
   `filterKey` it was issued under still matches the current one.

## Steps

### 1. NEW `app/lib/fetchProductsPage.js` — extracted query core

Move from `app/api/products/route.js`: `escapePostgrestValue`,
`applyCategoryOrFilter`, `applySearchFilter`, and all three query branches
(interleaved RPC via `fetchInterleavedProducts`/`countInterleavedProducts`,
price-sort fetch-all + JS sort, direct newest/oldest), including the
`effectiveLeafFilters` / mixed-shape normalization and existing comments.

```js
export async function fetchProductsPage({
  store = null,        // store_domain or null
  categorySlugs = [],  // raw slugs; resolveCategoryFilter applied INSIDE
  search = null,       // raw string; expandSearchAliases applied INSIDE
  brand = null,
  sort = null,         // null | "newest" | "oldest" | "price_asc" | "price_desc"
  limit,
  offset = 0,
  signal = undefined,  // optional AbortSignal; applied via .abortSignal() at query call sites
} = {}) // → Promise<{ products, total }>; THROWS on Supabase/RPC error or abort
```

Alias expansion and category resolution happen inside the function so both
callers get identical semantics. Use the dynamic `getDefaultClient()`
supabase-import pattern from `app/lib/productQueries.js:5-8`. All sort
paths (including price sort) go through this one function.

When `signal` is provided, chain `.abortSignal(signal)` onto the queries
this function builds directly (price-sort and direct-sort branches). For
the interleaved branch, add an optional trailing `signal` parameter to
`fetchInterleavedProducts` / `countInterleavedProducts` in
`app/lib/productQueries.js` (default `undefined` — existing callers
unaffected) and chain `.abortSignal()` there when set. The API route
passes no signal, so its behavior is unchanged.

### 2. `app/api/products/route.js` — thin parser

Keep `dynamic = "force-dynamic"` and all param parsing/clamping (page,
limit clamp, explicit-offset-wins logic + comments). Body becomes: parse →
call `fetchProductsPage` with RAW search string and RAW slug array
(expansion/resolution now live in the lib — delete those imports from the
route) → on success `Response.json({ products, total, page, limit })`, on
throw the existing 500 shape. **Response shapes must stay byte-identical**;
`app/api/products/__tests__/route.test.js` must pass unchanged.

### 3. `app/lib/feed-utils.js` — shared constant

Add `export const LOAD_SIZE = 30;`; import it in both `FeedClient.js`
(replacing its module-private constant at line 18) and `page.js`.

### 4. `app/feed/page.js` — streaming shell + bounded server fetch

```js
export const dynamic = 'force-dynamic';

export default async function FeedPage({ searchParams }) {
  const sp = await searchParams;
  return (
    <Suspense fallback={<FeedShellFallback />}>
      <FeedLoader sp={sp} />
    </Suspense>
  );
}
```

- `FeedShellFallback` = the current `FeedLoadingFallback` shell `div`/`main`
  with the `<p>Loading products...</p>` deleted — a blank shell that
  streams immediately (getActiveStores no longer blocks it either; today
  it runs before the boundary).
- `FeedLoader` (async server component, same file) does ALL awaiting
  *inside* the boundary:
  - Parse params mirroring `FeedClient.js:31-35`: `search`, `store`
    (default `ALL_STORES_VALUE`), repeated `category` params normalized to
    an array, `sort` (default `"interleaved"`), `brand`. Compute
    `categoriesKey = urlCategories.join(",")` then split on `,` for the
    slug array (reproduces the client's getAll→join→API-split semantics
    for both `?category=a&category=b` and `?category=a,b` URLs), and
    `filterKey = `${store}|${categoriesKey}|${search}|${sort}|${brand}``
    (identical to `FeedClient.js:152`).
  - Concurrent, bounded, cancellable fetch of stores + products — the
    entire loader body is covered, so a throw or stall in either
    dependency degrades instead of erroring or hanging:

    ```js
    const SERVER_FETCH_TIMEOUT_MS = 4000;
    let stores = FALLBACK_STORES;   // newly exported from app/lib/stores.js
    let initialData = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SERVER_FETCH_TIMEOUT_MS);
    try {
      const [storesResult, productsResult] = await Promise.race([
        Promise.all([
          getActiveStores(),        // degrades internally to FALLBACK_STORES on { error }
          fetchProductsPage({ store: …, categorySlugs, search, brand,
            sort: SORT_MAP[urlSort] || null, limit: LOAD_SIZE, offset: 0,
            signal: controller.signal }),
        ]),
        new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new Error("server fetch timeout")), { once: true });
        }),
      ]);
      stores = storesResult;
      initialData = { products: productsResult.products, total: productsResult.total, filterKey };
    } catch (err) {
      console.warn(`[FeedLoader] server fetch failed, falling back to client fetch: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
    ```

    The abort actually cancels the in-flight product query (via
    `.abortSignal()` in `fetchProductsPage`), so the client retry never
    races an orphaned server query during a slowdown. The stores query has
    no signal, but the outer race stops it from holding the render past
    the deadline, and its own `{ error }` path already returns fallbacks.
  - `return <FeedClient stores={stores} initialData={initialData} />;`

### 5. `app/feed/FeedClient.js` — server-driven data, blank loading UI

**a) Hoist + seed state.** Move the URL-derived block (lines 31-35) and
`categoriesKey`/`filterKey` (lines 151-152) above the state declarations
(pure derivations of `searchParams`; `filterKey` is already referenced
earlier at line 75, so hoisting also removes that closure quirk). Then:

```js
const serverMatch = initialData !== null && initialData.filterKey === filterKey;
const [products, setProducts] = useState(serverMatch ? initialData.products : []);
const [total, setTotal] = useState(serverMatch ? initialData.total : 0);
const [loading, setLoading] = useState(!serverMatch);
```

`serverMatch` is deterministic from props + URL ⇒ no hydration mismatch,
and the product grid is in the SSR HTML payload.

**b) Apply-server-data effect** (declared after the sessionStorage restore
effect at lines 68-90, so restore refs are set first on mount):

```js
useEffect(() => {
  if (!serverMatch) return;
  if (restoreCountRef.current !== null || scrollRestorePending.current) return; // restore path refetches
  setLoadMoreOffset(null);   // cancel pending Load More for the old filter
  setProducts(initialData.products);
  setTotal(initialData.total);
  setError(null);
  setLoading(false);
}, [initialData]); // eslint-disable-line react-hooks/exhaustive-deps
```

On mount this is a no-op re-commit of the seeded state; on every soft nav
it applies the fresh server payload. Because the RSC response and the new
searchParams commit in the same render, `serverMatch` holds and the old
grid stays visible until the swap — no blank, no pill.

**c) Client-fetch guard** at the top of the initial-fetch effect (line
158), *replacing* nothing else in the effect body:

```js
if (serverMatch && restoreCountRef.current === null) return; // server data covers this filterKey
```

The effect still runs on every `filterKey` change (dep unchanged), but
only actually fetches when the server payload doesn't cover the current
URL: `initialData` null (fetch failed/timed out — the client retry is the
recovery path, bounded to one attempt as today), stale key, or a back-nav
restore pending. **Back-nav restore must never be skipped** (even when the
saved count ≤ LOAD_SIZE): the scroll-restore `useLayoutEffect` (line 95)
re-fires off `loading`/`products` state changes, which only happen if the
restore fetch runs — skipping it would silently break scroll restoration.

**d) Load More stale-response guard.** The Load More effect (lines
203-239) keeps its structure, but each request captures the `filterKey` it
was issued under and the response is discarded if the key has moved on.
Add a ref kept current every render (`const filterKeyRef = useRef(filterKey);
filterKeyRef.current = filterKey;`), then in the effect:

```js
const requestFilterKey = filterKeyRef.current;   // captured at request start
…
.then((data) => {
  if (filterKeyRef.current !== requestFilterKey) return; // stale: filter changed mid-flight
  setProducts((prev) => [...prev, ...(data.products || [])]);
  setTotal(data.total ?? 0);
})
```

Why: today a stale Load More response landing during a filter change is
overwritten moments later by the client refetch's wholesale
`setProducts(data.products)`. The server-driven path removes that
overwrite, so an unguarded stale append (old-filter products mixed into
the new grid) would persist. The abort-on-cleanup stays as-is; this guard
covers the window where the response handler has already run before
cleanup fires.

**e) Blank loading JSX:**
- Grid area (lines 373-376): `{loading ? null : error ? … }` — delete the
  grey pill; error and "No products found." branches unchanged.
- Mobile count (line 350): `{loading ? " " : …}` — a non-breaking
  space keeps the line box so the grid doesn't jump when the count
  arrives; visually blank.

## Edge cases

| Case | Behavior |
|---|---|
| First visit / category click (full navigation) | Blank shell streams, then products arrive in SSR HTML; `loading` starts false; no loading UI ever |
| Filter/sort/search change (router.push, no remount) | Server re-render carries new `initialData`; ONE query (server-side); old grid stays visible until the new data commits — no blank, no client fetch |
| Supabase down / slow (> 4s) at render | Deadline aborts the product query (no orphaned work) and the race unblocks the render → `FALLBACK_STORES` + `initialData = null` → client fetch path (one retry, as today); worst case ≈ 4s + today's single client attempt; a thrown/stalled stores query degrades identically instead of erroring |
| Stale Load More response lands during a filter change | Response's captured `filterKey` no longer matches → discarded; no mixed-filter grid |
| Server data stale vs URL (any mismatch) | `serverMatch` false → normal client fetch, grid blank while fetching |
| Back-nav restore (`restoreCountRef` set) | Apply-effect and skip-guard both defer → refetch `limit=count` exactly as today; scroll restored pre-paint |
| Explicit sort URLs (`?sort=price_asc`…) | SSR'd via the same shared branches; unknown sorts → `SORT_MAP[x] || null` → interleaved, matching client |
| Load More | Untouched (separate effect, explicit offset); pending batch cancelled on filter change by the apply-effect's `setLoadMoreOffset(null)` |

## Files

1. `app/lib/fetchProductsPage.js` — new, extracted query core (+ optional `signal`)
2. `app/api/products/route.js` — thin parser
3. `app/feed/page.js` — streaming shell, async `FeedLoader` inside Suspense, bounded + cancellable fetch
4. `app/feed/FeedClient.js` — hoist filterKey, seeded state, apply-server-data effect, fetch guard, Load More stale guard, blank JSX
5. `app/lib/feed-utils.js` — `LOAD_SIZE` export
6. `app/lib/stores.js` — export `FALLBACK_STORES` (used by the loader's catch path)
7. `app/lib/productQueries.js` — optional trailing `signal` param on `fetchInterleavedProducts` / `countInterleavedProducts` (backwards-compatible)

## Verification (read-only / localhost safe; NEVER hit /api/cron or /api/enrich)

1. `npx vitest run` — `app/api/products/__tests__/route.test.js` and lib
   tests pass unchanged (mocks still intercept via the new lib's dynamic
   imports).
2. `curl -s "localhost:3000/api/products?page=1&limit=5"` before vs after —
   identical JSON shape; repeat with `&sort=price_asc`, `&category=tops`,
   `&category=tops,tops_tees`, `&search=silk`, `&store=<domain>`.
3. `curl -s localhost:3000/feed` — product markup present in raw HTML;
   zero occurrences of "Loading".
4. **Request-count check (review finding #1):** in the browser network
   panel, toggle a category / change sort — exactly ONE request (the RSC
   navigation), ZERO `/api/products` calls; old grid visible until swap.
   Then Load More — exactly one `/api/products` call.
5. Browser: `/feed` first load shows products with no loading flash;
   mobile viewport — count area blank without layout shift, then count;
   `/feed?sort=price_desc` SSRs sorted.
6. Back-nav restore: Load More once, open a product, Back — scroll
   position and full product count restored (this path DOES issue one
   `/api/products` call — expected).
7. **Outage fallback (review finding #2):** run dev with an invalid
   `NEXT_PUBLIC_SUPABASE_URL` — `/feed` streams the blank shell promptly,
   falls back to the client path (error card if that also fails), no 500;
   total wait bounded ≈ 4s + one client attempt; store dropdown shows the
   `FALLBACK_STORES` list.
8. **Stale Load More guard:** with devtools network throttled, start a
   Load More then immediately toggle a category — the new grid must
   contain only new-filter products (no appended old-filter batch).
9. `npm run build` passes (no client/server import violations).
