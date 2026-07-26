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
} = {}) // → Promise<{ products, total }>; THROWS on Supabase/RPC error
```

Alias expansion and category resolution happen inside the function so both
callers get identical semantics. Use the dynamic `getDefaultClient()`
supabase-import pattern from `app/lib/productQueries.js:5-8`. All sort
paths (including price sort) go through this one function.

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
  - `const stores = await getActiveStores();`
  - Bounded product fetch:

    ```js
    const SERVER_FETCH_TIMEOUT_MS = 4000;
    let initialData = null;
    try {
      const result = await Promise.race([
        fetchProductsPage({ store: …, categorySlugs, search, brand,
          sort: SORT_MAP[urlSort] || null, limit: LOAD_SIZE, offset: 0 }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("server fetch timeout")), SERVER_FETCH_TIMEOUT_MS)),
      ]);
      initialData = { products: result.products, total: result.total, filterKey };
    } catch (err) {
      console.warn(`[FeedLoader] server fetch failed, falling back to client fetch: ${err.message}`);
    }
    ```

    (The race doesn't cancel the underlying query — acceptable: PostgREST's
    own 8s statement_timeout reaps it.)
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

**d) Blank loading JSX:**
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
| Supabase down / slow (> 4s) at render | Race rejects → `initialData = null` → client fetch path (one retry, as today); worst case ≈ 4s + today's single client attempt |
| Server data stale vs URL (any mismatch) | `serverMatch` false → normal client fetch, grid blank while fetching |
| Back-nav restore (`restoreCountRef` set) | Apply-effect and skip-guard both defer → refetch `limit=count` exactly as today; scroll restored pre-paint |
| Explicit sort URLs (`?sort=price_asc`…) | SSR'd via the same shared branches; unknown sorts → `SORT_MAP[x] || null` → interleaved, matching client |
| Load More | Untouched (separate effect, explicit offset); pending batch cancelled on filter change by the apply-effect's `setLoadMoreOffset(null)` |

## Files

1. `app/lib/fetchProductsPage.js` — new, extracted query core
2. `app/api/products/route.js` — thin parser
3. `app/feed/page.js` — streaming shell, async `FeedLoader` inside Suspense, bounded fetch
4. `app/feed/FeedClient.js` — hoist filterKey, seeded state, apply-server-data effect, fetch guard, blank JSX
5. `app/lib/feed-utils.js` — `LOAD_SIZE` export

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
   total wait bounded ≈ 4s + one client attempt.
8. `npm run build` passes (no client/server import violations).
