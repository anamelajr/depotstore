# Sold "artifact" overlay for editorial *Pieces featured* (live-row)

## Context

Editorial entries hand-curate pieces tied to the article — e.g. an entry on
"Margiela 2004" hand-selects pieces from that era to promote. Today those pieces
**vanish** from the "Pieces featured" grid the moment they sell, because the
curated fetch filters `available = true`. The user wants hand-picked curated
pieces to **remain** in this section after selling, shown with a **SOLD**
overlay, so they persist as editorial artifacts relevant to the writing.

This must be **exclusive to the editorial "Pieces featured" section.** The
"More from {designer}" grid and the general product feed keep today's behavior:
sold items disappear.

**Chosen approach: live-row** (the smaller of two options the user weighed). It
shows a sold piece for as long as its store keeps the listing up (the row still
exists, just flips to `available = false`). It does **not** survive a store
fully deleting the listing — Dépôt's hourly stale-delete removes the row, so
there'd be nothing to render. That "permanent even if delisted" case (snapshot)
is a deliberate, documented future follow-up; it layers on top of this with no
rework.

**Go/no-go gate — validated against production (read-only).** Live-row only
pays off if stores keep sold pieces *listed*. They overwhelmingly do: sold-yet-
visible rows (`available = false AND hidden = false`) are abundant —
e.g. dolcevitahub.com ≈9,615 (~63% of catalog), lobscur.com ≈2,286 (~91%),
lesarchivesparis.com ≈321 (~88%), escoparis.com ≈470 (~66%). So sold curated
pieces will persist as rows for a long time. **Gate passes.**

**Store-specific caveat — `www.dotcomme.net`.** It alone has **0** sold-listed
rows, because it syncs from `/collections/paris/products.json`, which appears to
drop sold items. A curated *dot COMME* piece would therefore be stale-deleted
when it sells, and live-row can't preserve it (only snapshot could). Acceptable
for now; note it to the user.

## Current behavior (verified)

- `fetchEditorialProducts` → `fetchCurated` wraps its query in `withVisibility`
  (`available=true AND hidden=false`), so sold curated items are dropped
  ([fetchEditorialProducts.js:35](app/editorial/_lib/fetchEditorialProducts.js:35)).
- `mapProductRow` already returns `available`; `PRODUCT_ROW_SELECT` already
  selects it ([productQueries.js](app/lib/productQueries.js)).
- `PiecesFeatured` renders the curated array; `MoreFromDesigner` renders the
  brand pool. **Each file has its own copy of `EditorialProductCard`**
  ([PiecesFeatured.js](app/editorial/_components/PiecesFeatured.js),
  [MoreFromDesigner.js](app/editorial/_components/MoreFromDesigner.js)).
- An existing SOLD overlay pattern lives at
  [ProductCard.js:59](app/components/ProductCard.js:59) (`bg-black/45` + centered
  "SOLD") — reuse it, don't invent a new one.
- The product detail page renders sold items (shows a "Sold" label, no 404), so
  a sold card can still link to a working page.

## Changes (3 source files + tests; no DB / RPC / cron / enrich changes)

### 1. Curated-only visibility helper — `app/lib/productQueries.js`

Add a named sibling to `withVisibility` that excludes hidden rows but **not**
sold ones:

```js
// Editorial curated artifacts intentionally include SOLD pieces (available=false)
// so they persist with a SOLD overlay. Hidden rows (allowlist-rejected /
// self-branded) are still excluded. DO NOT use outside curated editorial reads:
// every other product read MUST use withVisibility (available=true + hidden=false).
export function withCuratedVisibility(query) {
  return query.eq("hidden", false);
}
```

Rationale: keep this as an explicit, documented exception in the single
source of truth for product reads, rather than mutating `withVisibility`
(which would leak sold items into the feed, More-from, and everywhere — the
top review risk).

> **CLAUDE.md note:** this is a deliberate carve-out from the invariant
> "every `available = true` read must also filter `hidden = false` via
> `withVisibility`." When CLAUDE.md is next refreshed, record that
> `withCuratedVisibility` exists and is the *only* sanctioned sold-inclusive
> read, scoped to editorial curated artifacts.

### 2. Use it in the curated fetch only — `app/editorial/_lib/fetchEditorialProducts.js`

In `fetchCurated`, swap `withVisibility(...)` → `withCuratedVisibility(...)`.
`withVisibility` is currently used **only** in `fetchCurated`, so update the
import accordingly (drop `withVisibility`, add `withCuratedVisibility`) to avoid
an unused-import lint error. Note `fetchBrandPool` does **not** use
`withVisibility` — it calls the `get_interleaved_products` RPC, whose visibility
(`available + hidden`) is enforced server-side in SQL — so "More from" and the
backfill fillers stay live-only with no change here. No other change needed:

- Sold-but-listed curated items now return with `available = false`.
- Author ordering, the `curatedKeys` dedupe, and the `minCurated`/backfill logic
  are unchanged. Sold items now simply count toward the curated set, so a
  deliberately-curated set of ≥4 is preserved exactly; a thin set (<4) still
  pads with live brand matches when `brandFilter` is set (those fillers remain
  live-only and still vanish when sold — correct, they're not hand-picked).

### 3. SOLD overlay in *Pieces featured* only — `app/editorial/_components/PiecesFeatured.js`

In this file's `EditorialProductCard`, inside the `relative aspect-[4/5]` image
container, add the overlay when sold (reusing the ProductCard treatment):

```jsx
{product.available === false ? (
  <div className="absolute inset-0 flex items-center justify-center bg-black/45">
    <span className="font-mono text-[11px] uppercase tracking-widest text-white">SOLD</span>
  </div>
) : null}
```

Do **not** touch `MoreFromDesigner.js` — its cards are always live, and leaving
it untouched guarantees the feature is exclusive to *Pieces featured*. The
existing href already encodes `available`, so the sold card links to a product
page that shows "Sold" — keep it clickable.

### 4. Tests (required — the original plan wrongly said "no other change")

An existing test encodes the old contract and must change, and the new helper
needs its own coverage. Verified facts that shape this:

- [fetchEditorialProducts.test.mjs:52-60](app/editorial/_lib/fetchEditorialProducts.test.mjs:52)
  currently asserts the curated query applies **both** `eq:available === true`
  and `eq:hidden === false` (passes 3/3 today via `node --test`). The swap drops
  the `available` filter, so this assertion would fail — the test must be updated.
- **Caveat — this file is not run by `npm test`.** `vitest run` reports "No test
  files found" for it: the vitest `include` is `app/**/__tests__/**/*.test.{js,mjs}`,
  but this file sits at `app/editorial/_lib/` and uses the `node:test` API, not
  vitest. It only runs via `node --test <file>`. There is also **no test CI**
  (the only workflow, `.github/workflows/sync.yml`, just pings `/api/cron`). So
  the breakage is latent, not a CI failure — but still a real broken test.

Test work (all **required** and all must run under `npm test`):

1. **Convert + relocate the editorial integration test so `npm test` runs it.**
   Move `app/editorial/_lib/fetchEditorialProducts.test.mjs` →
   `app/editorial/_lib/__tests__/fetchEditorialProducts.test.mjs` (matches the
   vitest `include` glob `app/**/__tests__/**`), and swap the runner from
   `node:test` to vitest: `import test from "node:test"` →
   `import { test } from "vitest"`, and fix the relative import to
   `../fetchEditorialProducts.js`. The `node:assert/strict` assertions can stay —
   they throw on failure, which vitest reports as a failed test. This is the
   only way the actual `fetchCurated` behavior is enforced by the default test
   command; today it has **zero** `npm test` coverage. ~5 mechanical lines.
2. **Update that test's curated assertions** for the new behavior:
   - Change the curated-query assertion to expect `eq:hidden === false` and that
     `eq:available` is **not** applied (absent); rename it accordingly
     (e.g. "curated query filters hidden only, includes sold").
   - Add a case: a curated product with `available: false` (via the `row(...)`
     `extras` arg) is still returned in `fetchEditorialProducts`'s curated output.
   - **Hidden exclusion is asserted at the *filter* level, not the row level.**
     The `eq:hidden === false` check above is the meaningful assertion. Do **not**
     add a `hidden: true` row and expect row-level exclusion: the fake client only
     records filters and returns whatever rows the test supplies (it does not
     simulate PostgREST filtering), and production relies on the server-side
     `.eq("hidden", false)` — `hidden` is not in `PRODUCT_ROW_SELECT`, so it is
     never selected or mapped. Do **not** add client-side `hidden` handling to
     force such a test green; that would be wrong. (If a row-level proof is ever
     wanted, enhance the fake builder to apply its recorded `eq` filters before
     returning — optional, not required here.)
   - Keep the existing "more-from calls `get_interleaved_products` RPC" assertion.
     That is the *testable* guarantee for More-from/backfill staying live-only:
     a JS unit test can prove fetchCurated uses the sold-inclusive direct query
     while More-from goes through the RPC (whose `available + hidden` filtering is
     enforced server-side in SQL and therefore **cannot** be asserted here — note
     this explicitly so no one mistakes RPC visibility for untested).
3. **Add** a `withCuratedVisibility` unit test to
   [app/lib/__tests__/productQueries.test.js](app/lib/__tests__/productQueries.test.js),
   mirroring the existing `withVisibility` test: assert it applies `hidden=false`,
   does **not** touch `available`, and returns the chained builder.
4. The existing `withVisibility` test
   ([productQueries.test.js:153](app/lib/__tests__/productQueries.test.js:153))
   stays green and **unchanged** because we add a sibling helper rather than
   mutating it — and it remains the guard against a site-wide sold-row leak (any
   change dropping `available` from `withVisibility` fails `npm test`).

Run `npm test` and confirm green before opening the PR.

## Scope guarantees (sold items stay ONLY here)

- Only `fetchCurated` uses `withCuratedVisibility`. `fetchBrandPool` (More-from +
  backfill) goes through the `get_interleaved_products` RPC (visibility enforced
  in SQL), and every other `productQueries` consumer keeps `withVisibility` — all
  stay live-only.
- The overlay is added only to PiecesFeatured's card copy.
- General feed, interleaved RPCs, and `/api/products` are untouched.

## Out of scope (deliberate, future, additive)

- **Snapshot / permanent artifact:** surviving a fully-deleted listing requires
  capturing image/title/price/brand into the entry at save time
  ([save/route.js](app/api/admin/save/route.js)) plus a snapshot-fallback render
  path. Not built now. Live-row is a strict subset, so this adds on later with
  no rework.

## Verification (Vercel preview, not localhost)

Note: the `rick-owens` curated handles are seed `.example` data and don't exist
in production — don't rely on them. Pick a brand `X` that has **both** sold and
live inventory (e.g. query for a brand with rows at `available = false` and rows
at `available = true`, `hidden = false`), and use a test entry whose
`brandFilter = X` so "More from X" is populated. From that brand pick:
- **Item A** — sold (`available = false, hidden = false`), will be curated.
- **Item B** — sold (`available = false, hidden = false`), brand `X`, **not**
  curated. This is the exclusivity probe.

1. Add **Item A**'s `{ storeDomain, handle }` pair **directly** to the test
   entry's `curatedProducts` (do not use the admin picker — its search goes
   through `/api/admin/search-products`, which filters `available = true`
   ([search-products/route.js:26](app/api/admin/search-products/route.js:26)), so
   a sold row never appears there). **This is a throwaway fixture — see the
   cleanup gate; it must never reach `main`.** Keep it on a scratch commit you
   will drop, or stash it.
2. **Set/confirm test data first, then deploy the preview** — the editorial page
   is `revalidate = 3600`, so a fresh preview build renders current data;
   mutating data after deploy would show a stale cached page.
3. On the editorial page, confirm **Item A appears** in "Pieces featured" with
   the SOLD overlay, in its curated position.
4. **Exclusivity — test it correctly, not tautologically.** Item A is auto-
   deduped out of More-from regardless of visibility (`fetchBrandPool` excludes
   `curatedKeys`), so its absence there proves nothing. Instead probe the *live*
   path that both More-from and the feed share — `get_interleaved_products` — with
   a targeted query rather than eyeballing a page: hit
   `/api/products?brand=X` (or call the RPC with `p_brand = X`) and confirm
   **Item B does not appear** (it's sold). That proves the More-from/feed path
   still excludes sold rows after the change. Eyeballing one item in a
   thousand-row feed is not a valid check.
5. Confirm hidden stays excluded end-to-end: temporarily add a `hidden = true`
   row to `curatedProducts` and confirm it's **absent** from Pieces featured on
   the preview (real Supabase applies `.eq("hidden", false)`; this is testable
   here even though the unit test asserts it only at the filter level). Also a
   throwaway fixture — revert it per the cleanup gate.
6. Click Item A's card → the product page renders with the "Sold" label.

### Cleanup gate (do not ship verification fixtures)

The curated-products edits from steps 1 and 5 (Item A, and the temporary
`hidden = true` row) are **test scaffolding, not deliverables.**
Before merge:

- Drop/revert the scratch commit (or `git restore`/`git checkout` the touched
  `content/editorial/*` file) so no verification fixture remains.
- **The final PR diff must contain zero `content/editorial/*` changes.** This
  change ships only code + tests (`app/lib/productQueries.js`,
  `app/editorial/_lib/fetchEditorialProducts.js` + its relocated test,
  `app/editorial/_components/PiecesFeatured.js`,
  `app/lib/__tests__/productQueries.test.js`). Real curated-content edits are a
  separate, intentional author action — never a side effect of this PR.
- Sanity check before opening the PR: `git diff main...HEAD --name-only` should
  list none of `content/editorial/`.
