# Right-size product images via Shopify CDN width param

## Context

Every product image renders through a plain `<img>` tag pointing at the
full-resolution Shopify master (often multi-MB). The browser downloads
~2000px+ photos and shrinks them into ~400px cards, wasting most of the
bytes. This makes the feed slow to paint, leaves the feed's `bg-zinc-950`
placeholder showing while images load, and doubles desktop bandwidth on
cards that mount a second hover image.

Fix: ask Shopify's CDN for an appropriately-sized image by appending
`&width=<px>` to the URL. Shopify resizes on demand from the master
(pixel-identical at display size) and serves a web-safe format. No
`next/image`, no data migration, no schema change.

### Verified before planning (all confirmed against live DB + code)

- **100% of 20,775 rows** have `image_url` on `cdn.shopify.com`, uniform
  shape `https://cdn.shopify.com/s/files/.../file.ext?v=<number>`. Second
  image (`image_url_2`) present on 20,611 rows, same host/shape. **Zero**
  rows already carry a `width=` param. Querystring is uniformly `?v=` only
  (no multi-param URLs).
- Master extensions: webp 13,103 / jpg 5,917 / **heic 1,634** / png 121.
- **Empirically tested a real `.heic` product URL:** bare = `image/webp`
  **3.77 MB**; with `&width=800` = `image/jpeg` **200 KB** (~19× smaller).
  `.heic` already renders today (Shopify negotiates format); the win is
  purely byte size.
- All render sites use plain `<img>` (no `next/image`). Cards go through
  `HoverSwapImage`; detail page through `ProductGallery`. Editorial
  (`EditorialHero`, `EditorialIndexCard`, `Block`) uses **local repo files**
  (`/editorial/<slug>/…`) — different pipeline, out of scope.
- Hover second image is **already** `loading="lazy"` + `fetchPriority="low"`
  and never mounted on touch devices. The cost is master size, not eager
  loading — so we keep this logic, not remove it.

### Decision: single right-sized width per surface (not srcset)

Chosen with the user. All phones in traffic are retina (DPR 2–3), so they
get the same crisp image under any approach; the only devices that would
benefit from srcset are standard-DPI **desktop** monitors — the least
bandwidth-constrained users. A single per-surface width delivers ~all the
win with zero `sizes`-misconfiguration risk. Helper stays tiny, so adding
srcset later (if ever measured worthwhile) is a small change.

Phase-2 blur-up placeholders are deferred — right-sizing alone shrinks the
black-flash window dramatically, and placeholder colors vary per surface.

## Change

### 1. New helper `app/lib/shopifyImage.js` (+ vitest test)

Pure function, safe to import from client components:

```js
// Append a Shopify CDN resize width. Passthrough for anything that isn't a
// canonical cdn.shopify.com URL (worst case = today's behavior). Idempotent.
export function shopifyImageUrl(url, width) {
  if (typeof url !== "string" || !url) return url;
  if (!url.startsWith("https://cdn.shopify.com/")) return url;   // safe fallback
  if (!Number.isFinite(width) || width <= 0) return url;
  if (/[?&]width=/.test(url)) return url;                        // idempotent
  const sep = url.includes("?") ? "&" : "?";                    // always & in practice (?v=)
  return `${url}${sep}width=${Math.round(width)}`;
}
```

Test (`app/lib/__tests__/shopifyImage.test.js`, vitest — matches repo):
appends `&width=` to a real `?v=` URL; leaves non-Shopify, empty, null,
and already-`width=`'d URLs untouched; extension-agnostic (heic/jpg/webp/png).

### 2. Apply at render sites

Keep all existing attributes (`loading`, `fetchPriority`, `decoding`,
classes, `onError`). Only the `src` value changes.

- **`app/components/HoverSwapImage.js`** — covers all four card surfaces
  (feed `ProductCard`, `MoreFromStore`, `PiecesFeatured`,
  `MoreFromDesigner`). Add optional `width` prop, **default 800**. Wrap both
  images: `src={shopifyImageUrl(imageUrl, width)}` and
  `src={shopifyImageUrl(imageUrl2, width)}`. 800px = crisp at ~400px card on
  2× retina.
- **`app/components/ProductGallery.js`** — three spots, two sizes:
  - thumbnails (line ~232): `shopifyImageUrl(src, 256)`
  - desktop hero (line ~242, `activeSrc`): `shopifyImageUrl(activeSrc, 1400)`
  - mobile swipe (line ~298): `shopifyImageUrl(src, 1400)`
  (No zoom/lightbox exists, so 1400 is the crispness ceiling needed.)
- **(Optional, skippable)** `app/admin/homepage-edit/_components/PicksEditor.js`
  — 32×40 thumb: `shopifyImageUrl(p.image_url, 80)`. Admin is 404 in prod.

### Out of scope
- Editorial artwork (local-file pipeline).
- `image_url` data migration / schema — none needed (URLs untouched in DB).
- srcset / blur-up placeholders / `format=webp` (possible later phases).

## Verification

1. **Unit:** `npm run test` — new helper test passes.
2. **Build:** `npm run build` clean (no import/SSR issues from client use).
3. **Vercel preview (not localhost):** open the feed with DevTools Network:
   - Card image requests now end `?v=…&width=800`; response sizes drop
     ~5–19× vs. master.
   - Hover a card → second image also requests `&width=800`.
   - Product detail: hero requests `&width=1400`, thumbnails `&width=256`.
4. **`.heic` smoke test:** open product
   `aw1996-prada-navy-soft-leather-italian-jacket-xs`
   (store `dolcevitahub.com`) and confirm the card + gallery render crisply
   and lightly. Spot-check one webp and one jpg product too.
5. **Quality eyeball:** feed cards and the detail hero look sharp on a
   retina screen (no visible softening).

## Workflow
Branch + Vercel preview; do not push to `main`. Merge only on explicit
instruction.
