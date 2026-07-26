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
no loading state at all. Filter changes / load-more / search stay
client-side; during those brief fetches the grid area is simply blank.

User-approved decisions:
- Loading treatment: **completely blank** (no skeleton grid).
- Speed approach: **server-render page 1**, with a try/catch fallback to
  today's client-fetch behavior if Supabase is unreachable (so worst case =
  current behavior, never a crash).

Environment facts: Next 16 (async `searchParams`; precedent at
`app/admin/inventory/page.js:20`). `app/feed/page.js` is already
`force-dynamic`. CLAUDE.md forbids self-HTTP fetches (`NEXT_PUBLIC_BASE_URL`
ambiguity — MoreFromStore precedent) and duplicated query logic, so the
route's query core is extracted into a shared lib both callers use.

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
supabase-import pattern from `app/lib/productQueries.js:5-8`. All sort paths
(including price sort) go through this one function — it is byte-identical
work to what the API route already runs per request.

### 2. `app/api/products/route.js` — thin parser

Keep `dynamic = "force-dynamic"` and all param parsing/clamping (page, limit
clamp, explicit-offset-wins logic + comments). Body becomes: parse → call
`fetchProductsPage` with RAW search string and RAW slug array (expansion/
resolution now live in the lib — delete those imports from the route) → on
success `Response.json({ products, total, page, limit })`, on throw the
existing 500 shape. **Response shapes must stay byte-identical**;
`app/api/products/__tests__/route.test.js` must pass unchanged.

### 3. `app/lib/feed-utils.js` — shared constant

Add `export const LOAD_SIZE = 30;`; import it in both `FeedClient.js`
(replacing its module-private constant at line 18) and `page.js`.

### 4. `app/feed/page.js` — server fetch + blank fallback

- `export default async function FeedPage({ searchParams })`, `await` it.
- Mirror FeedClient's URL parsing exactly (`FeedClient.js:31-35`):
  `search`, `store` (default `ALL_STORES_VALUE`), repeated `category` params
  normalized to an array, `sort` (default `"interleaved"`), `brand`. Compute
  `categoriesKey = urlCategories.join(",")` then split on `,` for the slug
  array (reproduces the client's getAll→join→API-split semantics for both
  `?category=a&category=b` and `?category=a,b` URLs), and
  `filterKey = `${store}|${categoriesKey}|${search}|${sort}|${brand}``
  (identical to `FeedClient.js:152`).
- `try { const { products, total } = await fetchProductsPage({ …, sort:
  SORT_MAP[urlSort] || null, limit: LOAD_SIZE, offset: 0 }); initialData =
  { products, total, filterKey }; } catch { console.warn(...); initialData
  = null; }` — null prop ⇒ FeedClient behaves exactly as today.
- Pass `initialData` to `<FeedClient>`.
- `FeedLoadingFallback` (`page.js:16-26`): keep the shell `div`/`main`,
  delete the `<p>Loading products...</p>`.

### 5. `app/feed/FeedClient.js` — consume initial data, blank loading UI

**a) Hoist + seed state.** Move the URL-derived block (lines 31-35) and
`categoriesKey`/`filterKey` (lines 151-152) above the state declarations
(pure derivations of `searchParams`; note `filterKey` is already referenced
earlier at line 75, so hoisting also removes that TDZ-by-closure quirk).
Then:

```js
const serverMatch = initialData !== null && initialData.filterKey === filterKey;
const [products, setProducts] = useState(serverMatch ? initialData.products : []);
const [total, setTotal] = useState(serverMatch ? initialData.total : 0);
const [loading, setLoading] = useState(!serverMatch);
const skipInitialFetchRef = useRef(serverMatch);
```

`serverMatch` is deterministic from props + URL ⇒ no hydration mismatch,
and the product grid is in the SSR HTML payload.

**b) One-shot fetch-skip guard** at the top of the initial-fetch effect
(line 158), after `setLoadMoreOffset(null)`:

```js
if (skipInitialFetchRef.current) {
  skipInitialFetchRef.current = false;           // only the mount run may skip
  if (restoreCountRef.current === null) return;  // server data covers this render
  // back-nav restore pending → fall through and refetch the larger count
}
```

The ref is consumed on first run so every later `filterKey` change fetches
normally. **Back-nav restore must never be skipped** (even when the saved
count ≤ LOAD_SIZE): the scroll-restore `useLayoutEffect` (line 95) re-fires
off `loading`/`products` state changes, which only happen if the restore
fetch runs — skipping it would silently break scroll restoration.

**c) Blank loading JSX:**
- Grid area (lines 373-376): `{loading ? null : error ? … }` — delete the
  grey pill; error and "No products found." branches unchanged.
- Mobile count (line 350): `{loading ? " " : …}` — a non-breaking
  space keeps the line box so the grid doesn't jump when the count arrives;
  visually blank.

## Edge cases

| Case | Behavior |
|---|---|
| First visit / category click (full navigation) | Products in SSR HTML; `loading` starts false; no loading UI ever |
| Supabase down or RPC timeout at render | `initialData = null` → today's client-fetch path (error card only if the API also fails) |
| Filter/sort/search change (router.push, no remount) | Guard already consumed → normal client fetch; grid blank while fetching |
| Back-nav restore (`restoreCountRef` set) | Guard falls through → refetch `limit=count` exactly as today; scroll restored pre-paint |
| Explicit sort URLs (`?sort=price_asc`…) | SSR'd via the same shared branches; unknown sorts → `SORT_MAP[x] || null` → interleaved, matching client |
| Load More | Untouched (separate effect, explicit offset) |

## Files

1. `app/lib/fetchProductsPage.js` — new, extracted query core
2. `app/api/products/route.js` — thin parser
3. `app/feed/page.js` — async searchParams, server fetch, blank fallback
4. `app/feed/FeedClient.js` — hoist filterKey, seeded state, skip guard, blank JSX
5. `app/lib/feed-utils.js` — `LOAD_SIZE` export

## Verification (read-only / localhost safe; NEVER hit /api/cron or /api/enrich)

1. `npx vitest run` — `app/api/products/__tests__/route.test.js` and lib
   tests pass unchanged (mocks still intercept via the new lib's dynamic
   imports).
2. `curl -s "localhost:3000/api/products?page=1&limit=5"` before vs after —
   identical JSON shape; repeat with `&sort=price_asc`, `&category=tops`,
   `&category=tops,tops_tees`, `&search=silk`, `&store=<domain>`.
3. `curl -s localhost:3000/feed` — product markup present in raw HTML; zero
   occurrences of "Loading".
4. Browser (preview pane): `/feed` first load shows products with no
   loading flash; toggle a category — grid goes blank (no pill) then
   repopulates; mobile viewport — count area blank without layout shift,
   then count; `/feed?sort=price_desc` SSRs sorted.
5. Back-nav restore: Load More once, open a product, Back — scroll position
   and full product count restored.
6. Outage fallback: run dev with an invalid `NEXT_PUBLIC_SUPABASE_URL` —
   `/feed` renders (falls back / error card), no 500.
7. `npm run build` passes (no client/server import violations).
