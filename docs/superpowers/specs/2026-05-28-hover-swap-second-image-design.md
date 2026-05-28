# Hover-Swap to Second Product Image (Desktop)

## Context

Today every product card on Dépôt shows a single still image and a subtle 2% scale-up on hover. Curated archive shopping is a discovery-first experience — users browse long feeds looking for pieces that catch their eye, and on most premium fashion sites (SSENSE, Mr Porter, every modern Shopify theme) hovering a card crossfades to a second image from the product's gallery. It gives shoppers a free preview — usually the back of a garment, a styled look, or a detail shot — without forcing a click.

This change adds that behavior. Hovering any product card on desktop crossfades to image #2 from the Shopify gallery; moving the cursor away fades back to image #1. On touch devices nothing changes (the hover effect is gated to real pointers so it doesn't flash on tap).

The data layer currently stores only a single `image_url` per product, so this is not purely a CSS change — it requires a new column populated by the hourly Shopify cron. Backfill is automatic: the cron rewrites every product on every run, so the entire catalog has its second image within one hour of merge.

## User decisions (finalized)

- **Data source:** new `image_url_2 TEXT` column, populated from `images[1].src` by the existing cron.
- **Transition:** pure crossfade, ~350ms ease-out. **Drop** the existing `group-hover:scale-[1.02]`.
- **Scope:** 4 components — main `ProductCard.js`, `MoreFromStore.js`, `PiecesFeatured.js`, `MoreFromDesigner.js`.
- **Desktop only:** gated with `@media (hover: hover) and (pointer: fine)` so touch devices don't flash on tap.
- **Graceful fallback:** if `image_url_2 IS NULL` or `image_url_2 === image_url`, the second `<img>` is not rendered at all — behavior is identical to today.

## Phase ordering (the only safe one)

1. **Capture the live RPC bodies BEFORE writing the migration.** CLAUDE.md: *"DB objects not in git. Live only in Supabase. Confirm full column list against production before applying any change."* Anyone may have hand-edited `get_interleaved_products` / `count_interleaved_products` since the May-21 migration. Pull the current definitions via Supabase MCP `execute_sql`:
   ```sql
   SELECT pg_get_functiondef('public.get_interleaved_products'::regproc);
   SELECT pg_get_functiondef('public.count_interleaved_products'::regproc);
   ```
   Use that exact text as the base for the new RPC bodies — add only `image_url_2` to the `RETURNS TABLE` and the two `SELECT` lists. Also use the live signature to write the `DROP FUNCTION` line (don't trust the git-file's parameter order/types).
2. **Supabase SQL Editor** — apply migration (column + RPC `DROP`/`CREATE`). MCP is read-only; CLAUDE.md invariant: schema/RPC changes apply *before* dependent code merges.
3. **Branch + code edits** in this order so intermediate states stay valid:
   1. `shopifyFetch.js` — extract `images[1]` with dedup guard.
   2. `cron/route.js` — add `image_url_2` to Step-1 upsert (plain overwrite — NOT through `enrich_product` RPC).
   3. `productQueries.js` — single source of truth: SELECT, mapper, RPC column list.
   4. `app/lib/useHoverCapable.js` — new client hook gating the second image's mount to hover-capable pointers.
   5. `app/components/HoverSwapImage.js` — new `"use client"` component that owns the hook and renders both images (so the three Server-Component cards never call a hook directly).
   6. 4 card components — render `<HoverSwapImage />` inside the existing wrapper (1 client + 3 Server Components, all stay as-is).
   7. 2 test fixtures — update key/column count assertions.
4. **Vercel preview build** — confirm green.
5. **Manual cron fire on preview** — `curl -H "Authorization: Bearer $CRON_SECRET" "$PREVIEW_URL/api/cron"` to backfill `image_url_2` immediately rather than waiting an hour.
6. **Verify on preview** (desktop hover + phone tap).
7. **Merge only after explicit user instruction** (CLAUDE.md workflow).

---

## New SQL migration

**Path:** `scripts/sql/2026-05-28-add-image-url-2.sql` (new file)

Contains a single `BEGIN; … COMMIT;` block:
1. `ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url_2 TEXT;`
2. `DROP FUNCTION IF EXISTS public.get_interleaved_products(…)` then `CREATE OR REPLACE` with `image_url_2 text` added to the `RETURNS TABLE` shape and to both inner `SELECT` lists (in `ranked` CTE and final `SELECT`). DROP is required because `CREATE OR REPLACE FUNCTION` rejects return-type changes.
3. **`count_interleaved_products` is NOT touched.** Its `bigint` return and signature are unchanged (no `image_url_2`), so it needs no migration. Do **not** DROP/recreate it "for parity" — that only risks resetting its grants/owner for zero benefit. (Earlier draft proposed a parity DROP; removed per round-1 review.)

**Grant/owner assumption (sharp edge).** `DROP`+`CREATE` on `get_interleaved_products` resets the function's ACL and owner to defaults. This is safe **only because** no SQL migration in `scripts/sql/` defines any `GRANT`/`REVOKE` on these functions — the feed relies on Postgres's default `EXECUTE` grant to `PUBLIC` (which `anon`/`authenticated` inherit), restored automatically on `CREATE`. This matches the proven May-21 migration. Before applying: confirm production has no manually-added custom grant or `REVOKE PUBLIC` on `get_interleaved_products` (e.g. `\df+` in the SQL editor, or check `pg_proc.proacl`). If a custom grant exists, capture and re-apply it inside the same transaction.

**RPC body source: the live production definition, NOT the git file.** Use the `pg_get_functiondef()` output captured in Phase 1 as the base. The git file `scripts/sql/2026-05-21-interleaved-rpcs.sql` is one possible historical state; the live function may have been hand-edited since (CLAUDE.md: "DB objects not in git. Confirm full column list against production before applying any change"). Apply only the minimum delta: add `image_url_2 text` to the `RETURNS TABLE`, add `image_url_2` to both `SELECT` lists (`ranked` CTE + final SELECT), and match the live parameter signature in the `DROP FUNCTION` line.

After applying, verify via Supabase MCP `list_tables` → `public.products` shows `image_url_2 text`.

---

## Code edits

### `app/lib/shopifyFetch.js` — `normalizeProduct`

After the existing `images = …; imageUrl = images[0] ?? null;` lines (~line 60), add:

```js
const imageUrl2 = images[1] && images[1] !== images[0] ? images[1] : null;
```

Include `imageUrl2,` in the returned object. The dedup guard at the source means we don't have to compare URLs at every render site — Shopify's occasional `images[1] === images[0]` (re-upload artifact) becomes `NULL` here, once.

### `app/api/cron/route.js` — Step-1 upsert

In the `syncRows` projection (~line 34-53), add `image_url_2: p.imageUrl2,` right after `image_url: p.imageUrl,`. **Step-2's `enrich_product` RPC is NOT touched** — `image_url_2` is mechanical, not editorial. Adding it to the COALESCE block would prevent re-sync from picking up gallery reorders. Make this explicit in the commit message.

### `app/lib/productQueries.js` — single source of truth

Three small edits:
1. `PRODUCT_ROW_SELECT` (line 32-33): append `image_url_2` to the comma-list.
2. `mapProductRow` (line 50-64): add `imageUrl2: row.image_url_2,` next to `imageUrl: row.image_url,`.
3. `INTERLEAVED_RPC_RETURN_COLUMNS` (line 71-85): insert `"image_url_2",` after `"image_url"`. Update the comment about source-of-truth to reference both migration files.

`PRODUCT_ROW_SELECT_WITH_CATEGORY` composes from the base string — no edit needed.

### Client boundary: why a shared `HoverSwapImage` component, not a per-card hook

**Round-2 review correction.** An earlier draft said "all four card components are already `"use client"`, so each can call `useHoverCapable()` directly." That is false and would not build. The actual boundary in the repo:

- **`app/components/ProductCard.js`** — `"use client"` (the only one).
- **`app/components/MoreFromStore.js`** — **Server Component**, and it is `export default async function` that fetches Supabase directly.
- **`app/editorial/_components/PiecesFeatured.js`** — **Server Component** (no `"use client"`).
- **`app/editorial/_components/MoreFromDesigner.js`** — **Server Component** (no `"use client"`).

A React hook (`useState`/`useEffect`) cannot run inside a Server Component, so calling `useHoverCapable()` in three of the four cards fails the Next build. The naive fix — add `"use client"` to `MoreFromStore` — is **illegal**: a client component may not be `async`, and `MoreFromStore` is an async data-fetching Server Component (CLAUDE.md: "`MoreFromStore` queries Supabase directly … Don't consolidate it back to HTTP" — it must stay a Server Component).

**Resolution:** extract the entire hover-swap behavior into one client-only child component, `HoverSwapImage`. The four cards stay exactly the kind of component they are today (one client, three server); each renders the existing wrapper `<div>` (which owns `group`, the aspect ratio, and the sold overlay) and drops `<HoverSwapImage … />` inside it, passing only **plain serializable props** (`imageUrl`, `imageUrl2`, `alt`). No card needs converting; no Server Component becomes a client component.

### New file: `app/lib/useHoverCapable.js`

A small client hook — `"use client"`-internal, consumed **only** by `HoverSwapImage`, never by the cards. Returns whether the device is a real hover-capable, fine-pointer device, which gates the **mount** of the second `<img>` so mobile/touch devices never insert it into the DOM and therefore never fetch `image_url_2` (the bandwidth fix from round-1 review).

```js
"use client";
import { useEffect, useState } from "react";

const QUERY = "(hover: hover) and (pointer: fine)";

export function useHoverCapable() {
  // Must start false so SSR and first client paint agree (no hydration mismatch).
  // Image 2 is decorative, so deferring its mount to post-hydration on desktop is fine.
  const [hoverCapable, setHoverCapable] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const update = () => setHoverCapable(mql.matches);
    update();
    mql.addEventListener("change", update); // handles tablet + mouse plugged in/out
    return () => mql.removeEventListener("change", update);
  }, []);
  return hoverCapable;
}
```

### New file: `app/components/HoverSwapImage.js` (`"use client"`)

Owns `useHoverCapable`, renders the base image plus the gated, crossfading second image with the broken-image fallback. This is the single place the hook lives, so it works identically under all four cards regardless of their server/client status.

```jsx
"use client";
import { useHoverCapable } from "@/app/lib/useHoverCapable";

export default function HoverSwapImage({ imageUrl, imageUrl2, alt }) {
  const hoverCapable = useHoverCapable();
  const showSecond = hoverCapable && imageUrl2 && imageUrl2 !== imageUrl;
  return (
    <>
      <img
        src={imageUrl}
        alt={alt}
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
      />
      {showSecond ? (
        <img
          src={imageUrl2}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
          className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-[350ms] ease-out [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100"
        />
      ) : null}
    </>
  );
}
```

The `hoverCapable` mount gate is the **primary** desktop-only mechanism (it prevents the mobile fetch). The `[@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100` CSS variant is retained as belt-and-braces: it keeps image 2 hidden during the brief post-hydration window before `useEffect` runs, and guards the edge case where the media-query state flips between renders. Keeping both is intentional, not redundant cruft.

**Broken-image fallback (`onError`).** A stale Shopify CDN URL or transient 404 on `image_url_2` would otherwise reveal a blank/broken image on hover — and because image 2 is hidden until interaction, it evades page-load smoke checks. The `onError` handler hides the second `<img>` outright; image 1 (the base layer underneath) then shows through unchanged on hover. It now lives inside `HoverSwapImage`, so every card gets it for free. It is a DOM-node hide (`e.currentTarget.style.display`), not React state — fine, because the node is recreated on each remount. No `onLoad`/load-success gate is needed: an *unloaded* (not errored) image 2 at `opacity-100` simply renders transparent and image 1 shows through until it finishes loading, so only the genuine error case requires handling.

### Card components (wire up `HoverSwapImage`, 4 sites)

Each card keeps its existing wrapper `<div>` and replaces the single `<img>` with `<HoverSwapImage imageUrl={…} imageUrl2={…} alt={…} />`. The wrapper must have `relative` (so the absolutely-positioned images fill it), `group` (so the CSS hover variant fires), and `overflow-hidden`. The sold overlay, where present, stays the **last** sibling inside the wrapper so it paints over both images.

```jsx
<div className="relative aspect-[4/5] … overflow-hidden …">
  <HoverSwapImage imageUrl={imageUrl} imageUrl2={imageUrl2} alt={…} />
  {/* sold overlay, if any, stays last */}
</div>
```

> **React API note:** this project runs React 19.2.4 (`package.json`). Use camelCase `fetchPriority`, NOT lowercase `fetchpriority` — React 19 ignores the lowercase form (passes through with deprecation warning on every card render).

Per-file notes (none of these import `useHoverCapable` — they only render `HoverSwapImage`, so the three Server Components stay Server Components):

- **`app/components/ProductCard.js`** (lines 49-69): client component. Destructure `imageUrl2` from `product` on line 12. Wrapper already has `relative` and the parent already has `group`. Replace image 1's `<img>` with `<HoverSwapImage … />`; drop the old `transition-transform duration-500 group-hover:scale-[1.02]` (the scale is removed per the transition decision). Sold overlay stays last so it paints over both images.
- **`app/components/MoreFromStore.js`** (lines 49-58): **async Server Component — keep it that way.** `imageUrl2` already flows in via the shared mapper (confirmed: file imports `PRODUCT_ROW_SELECT` + `mapProductRow` on lines 5-6). **The card wrapper does NOT have `group` today** — change line 49 from `<div className="block">` to `<div className="group block">`. Add `relative` to the image wrapper (keep its `aspect-[3/4]`, not `aspect-[4/5]`) and render `<HoverSwapImage … />` inside it. Do **not** add `"use client"` here.
- **`app/editorial/_components/PiecesFeatured.js`** (lines 11-20): Server Component. Wrapper already has `aspect-[4/5] w-full overflow-hidden bg-zinc-200` — add `relative`. Parent (line 10) already has `group`. Render `<HoverSwapImage … />`; `imageUrl2` flows in via the same productQueries path (confirmed: `fetchEditorialProducts.js` lines 5-6 import `PRODUCT_ROW_SELECT` + `mapProductRow`). Do **not** add `"use client"`.
- **`app/editorial/_components/MoreFromDesigner.js`** (lines 11-20): identical edit to PiecesFeatured.

**Hover gate — two layers:** the `useHoverCapable` JS hook (inside `HoverSwapImage`) is the **primary** gate (controls whether image 2 mounts at all → no mobile fetch). The CSS arbitrary variant `[@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100` is the **secondary/visual** gate (controls the crossfade). The CSS variant lives on the second `<img>` inside `HoverSwapImage` and depends on the **card wrapper** carrying `group` — so every wrapper must have `group` (see per-file notes; `MoreFromStore` is the one that needs it added). The variant is used inline, not as a global `tailwind.config` change: this project uses Tailwind v4 with CSS-first config (no `tailwind.config.js`), so changing global hover behavior would silently affect every existing `hover:` utility across the app. Inline keeps the gate obvious at the call site. The `_` inside `[…]` is Tailwind's escape for spaces inside arbitrary variants — required syntax.

### Test fixtures that will break

Both need updating in the same commit so CI stays green:

- **`app/lib/__tests__/productQueries.test.js`**:
  - Test message on line 117 (`"emits the exact 11 camelCase keys"`) → 12.
  - Add `"image_url_2"` to the column array around lines 106-113.
  - Add `image_url_2: "u2"` to the fixture around lines 119-122.
  - Add `"imageUrl2"` to the expected keys array on line 123.
- **`app/api/products/__tests__/route.test.js`** (line 12): append `,image_url_2` to the mocked `PRODUCT_ROW_SELECT_WITH_CATEGORY` string, matching the production format.

---

## Verification

1. **Schema applied** — Supabase MCP `list_tables`: confirm `image_url_2 text` on `public.products`.
2. **RPC swap successful** — Supabase MCP `execute_sql`:
   `SELECT image_url_2 FROM get_interleaved_products(p_limit => 1) LIMIT 1;` returns a row (likely NULL on day one — fine).
3. **Tests pass** — `npm test` (or whatever the project runs) — both fixture updates from above must land.
4. **Preview build green** on Vercel — this is the gate that catches a Server/Client boundary mistake: if a hook leaks into a Server Component (e.g. `useHoverCapable` called outside `HoverSwapImage`), the Next build fails with "You're importing a component that needs `useState`/`useEffect`. It only works in a Client Component." Confirm `MoreFromStore.js`, `PiecesFeatured.js`, `MoreFromDesigner.js` still have **no** `"use client"` and `MoreFromStore` is still `async`.
5. **Manual cron fire** — `curl -H "Authorization: Bearer $CRON_SECRET" "$PREVIEW_URL/api/cron"` returns `{ totalUpserted: N, ... }` with empty `summary.errors[]`.
6. **Backfill spot-check** — Supabase MCP:
   ```sql
   SELECT handle, image_url IS NOT NULL AS has1, image_url_2 IS NOT NULL AS has2
   FROM products
   WHERE store_domain = '<a-multi-image-store>'
   ORDER BY synced_at DESC LIMIT 20;
   ```
   Expect ~50%+ of rows with `has2 = true` (varies by store).
7. **Desktop hover** — open preview feed in Chrome, hover a card with `image_url_2`; expect ~350ms crossfade to image 2, fade back on mouse-leave, no scale.
8. **Touch fallback (mount + bandwidth gate)** — open preview on a phone (or Chrome devtools device emulation with touch + coarse pointer). Inspect the DOM: the second `<img>` must be **absent** from every card (the `useHoverCapable` gate returned false). Check the Network panel while scrolling the feed: there must be **zero requests for `image_url_2` URLs**. Also tap a card without navigating — no flash of image 2. If image 2 appears in the DOM or fetches, the `useHoverCapable` gate failed — check the SSR-false initial state and the `matchMedia` query string.
9. **Single-image fallback** — find a row where `image_url_2 IS NULL`, hover it; expect current single-image behavior, no console errors. Inspect DOM: the second `<img>` should not be in the tree at all.
10. **Sold overlay** — find a card with `available = false` AND `image_url_2 IS NOT NULL`; hover; SOLD overlay stays on top of both images.

---

## Invariants respected

- **`productQueries.js` is the single source of truth** — every consumer (feed RPC, MoreFromStore direct query, editorial queries) gets `image_url_2` via the shared SELECT + mapper.
- **`enrich_product` RPC untouched** — `image_url_2` is not editorial; cron's Step-1 plain upsert is the right path. Adding it to the COALESCE block would freeze Shopify gallery reorders.
- **Schema-before-code merge order** — SQL applied in Supabase before code merges.
- **`get_interleaved_products` returns `name`** — preserved (ProductCard falls back to it).
- **DROP-then-CREATE on the RPC** — Postgres rejects `CREATE OR REPLACE FUNCTION` when `RETURNS TABLE` shape changes.
- **No Redis/Upstash** introduced.
- **Stale-delete scope unchanged** — adding a column doesn't affect `successfulDomains`.
- **Branch + Vercel preview, no direct push to main.**

## Open risks

- **Bandwidth on mobile lazy lists — addressed.** Earlier draft accepted ~2× image bandwidth on mobile (image 2 rendered everywhere, opacity-gated). Round-1 review flagged this as a real regression on the core feed. Resolved by the `useHoverCapable` mount gate: mobile/touch devices never insert the second `<img>`, so they never fetch `image_url_2`. Verify with mobile network inspection (no `image_url_2` requests) — see verification step 8. Residual desktop cost: image 2 mounts post-hydration (decorative, acceptable).
- **Aspect-ratio drift** — all four card sites use `aspect-[4/5]` (or `aspect-[3/4]` on MoreFromStore) with `object-cover`, so no layout shift on hover. If a future card switches to `object-contain`, image 2's intrinsic aspect could differ from image 1's and produce a perceptible jump — out of scope today, but flagged.
- **Shopify gallery reorders** — if a merchant reorders their gallery between syncs, the "second image" silently changes within an hour. This is correct behavior (we mirror Shopify), but worth knowing.
