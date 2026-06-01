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

## Changes (3 files, no DB / RPC / cron / enrich changes)

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
Leave `fetchBrandPool` on `withVisibility` so "More from" and the backfill
fillers stay live-only. No other change needed:

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

## Scope guarantees (sold items stay ONLY here)

- Only `fetchCurated` uses `withCuratedVisibility`; `fetchBrandPool` (More-from +
  backfill) and every other `productQueries` consumer keep `withVisibility`.
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
in production — don't rely on them. Use a **real** sold-but-listed handle
(plentiful per the go/no-go query, e.g. pick one from dolcevitahub.com where
`available = false AND hidden = false`).

1. Pick a real `available = false, hidden = false` product and note its
   `store_domain` + `handle`. Curate it into a test editorial entry (via the
   local admin), commit the entry.
2. **Set/confirm test data first, then deploy the preview** — the editorial page
   is `revalidate = 3600`, so a fresh preview build renders current data;
   mutating data after deploy would show a stale cached page.
3. On the editorial page, confirm the sold piece **appears** in "Pieces
   featured" with the SOLD overlay, in its curated position.
4. Confirm "More from {designer}" and the general `/feed` still **omit** that
   sold item.
5. Confirm a `hidden = true` row is still excluded from Pieces featured (no leak).
6. Click the sold card → the product page renders with the "Sold" label.
