# Desktop product page — editorial redesign

## Context

The current desktop product detail page (PDP) at [app/product/[handle]/page.js](app/product/[handle]/page.js) renders the right info column as: brand label · large mixed-case title · price · description · small underlined "Shop →" text link · "← Back". The user wants it closer to the editorial reference image they shared (Lost Files NYC × Raf Simons) while keeping the page on a white background and respecting Dépôt's structural reality — there is no on-domain cart; the CTA links out to the retailer's Shopify page.

Decisions locked in during brainstorming:

1. **Typography variant B** — small uppercase title (label-style, not heading-style), store name as a divided tag above it, hairline rules separating sections.
2. **Breadcrumb at top** — `HOME / BRAND / TITLE`, small uppercase mono.
3. **Prominent black CTA** — full-width "BUY AT {STORE}" button replaces the "Shop →" link; SIZE meta block above it; availability dot below.
4. **Visible prev/next arrows on the hero image** — keep existing wheel + arrow-key navigation. **No** expand / lightbox icon.
5. **Description moves below the gallery** as a full-width "ABOUT THIS PIECE" section. Right panel becomes purely transactional.
6. **Sizes render as-is** — preserve each seller-provided variant title verbatim. `formatSizes()` at [resolveProductDetail.js:20](app/lib/resolveProductDetail.js#L20) is reshaped to return a **structured array** (`string[] | null`) of variant titles instead of a comma-joined string, so the renderer never re-parses display text. A single variant title containing a comma (e.g. `"Waist 32, Inseam 30"`) stays as one entry. Label is `SIZE` when length is 1, `SIZES` when >1 (rendered with middot separator). Block is hidden when the array is null/empty.
7. **No condition line** — Dépôt has no structured condition field. Out of scope for v1.
8. **Mobile is untouched.** The user explicitly scoped this to desktop. Every new desktop component must hide itself on mobile (`hidden lg:…` on its own root) — not rely on grid columns collapsing gracefully, which would silently produce a duplicate section under the existing mobile accordion.
9. **Availability is sourced from Shopify variants, not the URL.** `resolveProductDetail` derives `available` from `variants.some(v => v?.available === true)` (the same rule used in [shopifyFetch.js:70](app/lib/shopifyFetch.js#L70) for cron sync) and returns it on the detail object. The PDP renders CTA copy and the availability dot from that field. The `?available=` query param is kept on incoming feed links for backward compatibility but **no longer consulted for rendering** — it was driving wrong-info for direct/indexed/shared URLs, which becomes loud once the CTA is the page's primary action.

## New desktop layout

```
┌──────────────────────────────────────────────────────────────┐
│  GLOBAL NAV (existing, sticky, --nav-height: 56px)           │
├──────────────────────────────────────────────────────────────┤
│  ← BACK TO FEED                  HOME / BRAND / TITLE        │  ← new top utility row
├────────┬─────────────────────────────┬──────────────────────┤
│ THUMBS │       HERO IMAGE            │  STORE NAME          │
│ (88px) │   ‹            ›  (arrows)  │  ─────────────       │
│        │                             │  PRODUCT TITLE       │
│        │                             │  €PRICE              │
│        │                             │  ─────────────       │
│        │                             │  SIZE                │
│        │                             │  M                   │
│        │                             │  ─────────────       │
│        │                             │ ┌──────────────────┐ │
│        │                             │ │ BUY AT {STORE}   │ │
│        │                             │ └──────────────────┘ │
│        │                             │  • AVAILABLE          │
├────────┴─────────────────────────────┴──────────────────────┤
│                                                              │
│  ABOUT THIS PIECE      Description body in wider column     │  ← new full-width section
│  (label, left)         (text, max-width ~60ch)              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

The 3-column grid `[88px_1fr_340px]` stays. The "About this piece" row sits below the grid, full-width inside `max-w-[1400px]`, with its own internal 2-column structure (label left, body right).

## Files to change

### `app/product/[handle]/page.js` — primary edit

Rewrite the desktop-only block (lines 119-163). Mobile block (lines 32-117) is unchanged. New desktop structure:

```jsx
<div className="hidden lg:block">
  {/* Top utility row — back link left, breadcrumb right */}
  <div className="mb-6 flex items-center justify-between">
    <BackToFeedLink className="…mono uppercase tracking-wide…" />
    <ProductBreadcrumb brand={brand} title={title} />
  </div>
</div>

<div className="grid … lg:grid-cols-[88px_1fr_340px]">
  <ProductGallery … />
  <ProductInfoPanel
    storeName={storeName}
    title={title}
    price={price}
    sizes={sizes}
    available={available}
    storeDomain={storeDomain}
    handle={handle}
  />
</div>

<DesktopAboutSection description={description} />
```

The top utility row sits above the grid, inside the same `max-w-[1400px]` container. The about section sits below the grid, same container.

### `app/components/ProductGallery.js` — additive only

Add visible prev/next arrow overlays to the desktop hero block (lines 241-248). Make the hero parent `relative`; copy the mobile arrow pattern (lines 277-299) and adapt:
- Position absolutely (`left-4 top-1/2`, `right-4 top-1/2`).
- Wire them to call the same prev/next logic as the wheel handler — set `selectedIndex` directly via the same clamp rule (`Math.max(0, …)` / `Math.min(count - 1, …)`).
- Hide when `multiple` is false.
- Subtle styling: `text-zinc-700/60 hover:text-zinc-900` with a soft circular hover background; arrows must not be visually loud.

Keep the wheel + arrow-key handlers untouched — visible arrows are additive, not a replacement.

### New components (extract for readability)

The new desktop block grows enough that inlining everything in `page.js` would push it past comfortable reading length. Extract three small client- or server-component files:

- **`app/components/ProductBreadcrumb.js`** — renders `HOME / BRAND / TITLE`. HOME → `/`. BRAND → uses `buildFreshFeedUrl({ brand })` from [app/lib/feed-utils.js:28](app/lib/feed-utils.js#L28). TITLE is non-clickable (current page). Small uppercase mono, zinc-400 separators, zinc-900 current segment. Truncate title with `truncate max-w-[...]` to avoid wrap.
- **`app/components/ProductInfoPanel.js`** — the right-column transactional panel: store name (with `border-b` hairline rule), title (uppercase label-style), price (with hairline rule below), SIZE block (hairline rule below, hidden when `sizes` is null), CTA button (`BUY AT {STORE}` or `VIEW ON {STORE}` when `!available`), availability indicator. Pure presentational. Server component is fine (no state).
- **`app/components/DesktopAboutSection.js`** — full-width "ABOUT THIS PIECE" section. Server component. Returns `null` when description is empty/null so the section disappears entirely on products without copy. Root element is **`hidden lg:grid`** (not just `lg:grid-cols-…`) so mobile never receives this section — the existing mobile Description accordion remains the only mobile surface for editorial copy. Grid: `lg:grid-cols-[1fr_1.4fr] gap-12`, label left in mono uppercase, body right in `font-sans text-[14px] leading-[1.7] text-zinc-700 max-w-[60ch]`.

### Styling specifics

Reuse existing tokens — no new fonts, no new colors:
- Sans: existing `font-sans` (Satoshi via `--font-satoshi`).
- Mono: existing `font-mono` (GeneralSans via `--font-general-sans`).
- Colors: `text-zinc-900` for primary, `text-zinc-500` / `text-zinc-400` for labels, `border-zinc-200` for hairline rules.
- CTA button: `bg-black hover:bg-zinc-800 text-white py-4 font-mono text-[11px] uppercase tracking-[0.22em]`. Same hover behavior the mobile CTA already uses at [page.js:75](app/product/%5Bhandle%5D/page.js#L75).
- Title uppercase: `font-sans text-[14px] font-medium uppercase tracking-[0.06em] leading-[1.45] text-zinc-900` — small, label-style. The mockup proved this size reads as "museum label" rather than "book heading", which is the desired register.
- SIZE label: `font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400`. Value: `font-mono text-[12px] uppercase tracking-[0.18em] text-zinc-700`.
- Availability indicator: `font-mono text-[10px] uppercase tracking-[0.18em]` with a `6×6` colored dot (green `bg-emerald-500` for available, zinc `bg-zinc-400` for sold) — flex row, `gap-2`.
- Hairline rule: `border-b border-zinc-200 pb-4` on each section (store, price, SIZE).

### Size data shape + rendering rule

**`formatSizes()` contract change.** Reshape [resolveProductDetail.js:20](app/lib/resolveProductDetail.js#L20) to return `string[] | null` — one entry per non-`"default title"` variant that is **in stock** (`v.available === true`), in source order. No joining, no separator string. Filtering to in-stock variants matches the product-level `available` flag honestly: a multi-size product with mixed stock (e.g. S sold / M in-stock / L sold) renders `SIZE: M` rather than `SIZES: S · M · L` next to AVAILABLE + BUY. Update the existing unit tests in [app/lib/__tests__/resolveProductDetail.test.js](app/lib/__tests__/resolveProductDetail.test.js) to (a) assert arrays rather than strings and (b) cover the mixed-stock case (`[{ title: "S", available: false }, { title: "M", available: true }]` → `["M"]`). Shopify's product JSON populates `variant.available` consistently — same field [shopifyFetch.js:70](app/lib/shopifyFetch.js#L70) already trusts for the cron sync.

**`resolveProductDetail` return shape.** `sizes` is now `string[] | null` on the detail object.

**Mobile consumer must be updated alongside.** The existing mobile branch at [page.js:62-66](app/product/%5Bhandle%5D/page.js#L62) renders `Size: {sizes}` inline. With `sizes` now an array, React would concatenate adjacent string children without separators (`["S","M","L"]` → `"Size: SML"`). Update that single line to `Size: {sizes.join(", ")}` to preserve the existing mobile display. This is a one-line co-located change, not a mobile redesign — the rest of the mobile layout is untouched.

**Renderer (inside `ProductInfoPanel`).**

```js
// `sizes` is a structured array of seller-provided variant titles, or null.
if (!sizes || sizes.length === 0) return null; // hide the block

const label = sizes.length > 1 ? "SIZES" : "SIZE";
const value = sizes.join(" · "); // middots read cleaner in uppercase
```

No new normalization, no per-store mapping. Each seller-provided variant title is preserved verbatim — a single variant titled `"Waist 32, Inseam 30"` renders as one entry, not two.

### CTA copy

```js
// `available` comes from resolveProductDetail (Shopify variant truth), NOT searchParams.
const ctaHref = `https://${storeDomain}/products/${handle}?utm_source=depot`;
const ctaText = available ? `BUY AT ${storeName.toUpperCase()}` : `VIEW ON ${storeName.toUpperCase()}`;
```

Open in new tab (`target="_blank" rel="noopener noreferrer"`) — same as the existing mobile CTA.

### `resolveProductDetail` availability change

Add `available` to the returned detail object:

```js
// resolveProductDetail.js — inside the function, after variants is resolved
const available = variants.some((v) => v?.available === true);
// …
return { images, sizes, price, brand, title, storeName, storeLocation, description, available };
```

The mobile branch in `page.js` currently reads `available` from `searchParams` ([page.js:11-12](app/product/%5Bhandle%5D/page.js#L11)). Switch both branches (mobile and desktop) to consume `detail.available` so the two layouts agree on truth and a sold listing renders correctly regardless of how the user arrived. The mobile "Sold" pill at `page.js:51` and `page.js:136` already uses the same variable name, so the change is a one-line source swap — no mobile redesign.

### `resolveProductDetail` storeDomain allowlist (security)

Today `storeDomain` flows from `searchParams.store` straight into `fetch(\`https://${storeDomain}/products/${handle}.json\`)` at [resolveProductDetail.js:34](app/lib/resolveProductDetail.js#L34) with no validation. Pre-redesign that surfaces only as a small "Shop →" text link; post-redesign the same untrusted value drives a prominent black `BUY AT {STORE}` CTA, which materially amplifies the phishing surface (attacker hosts a Shopify-shaped JSON, gets Dépôt to render it inside Dépôt's chrome, sends users to an arbitrary checkout).

**Fix.** Hoist the existing `stores`-table query to **before** the Shopify fetch, gate on `active = true`, and bail if the domain is unknown or offboarded:

```js
// resolveProductDetail.js — at the top of the function, after the
// missing-param guard, before fetchShopifyProduct.
const { data: storeRow } = await supabase
  .from("stores")
  .select("store_name, display_name, location")
  .eq("domain", storeDomain)
  .eq("active", true)            // defense-in-depth: reject offboarded stores
  .maybeSingle();
if (!storeRow) return null; // unknown or inactive domain — never fetch, render not-found
```

The `active` gate is defense-in-depth, mirroring [stores.js:55](app/lib/stores.js#L55) where the public store surface already filters `active = true`. As of this writing the live `stores` table has zero inactive rows (the `active = false` seed for `seyswardrobe.fr` in [supabase/schema.sql:40](supabase/schema.sql#L40) is stale — production has reactivated that store). The gate matters anyway because stores cycle between active and inactive over time, and the day a store is offboarded again, stale shared links to its products would otherwise render the new prominent CTA pointing at a defunct retailer.

The PDP route already renders "Product not found." when `resolveProductDetail` returns null ([page.js:16-18](app/product/%5Bhandle%5D/page.js#L16)) — no new error path needed.

**Consequences to keep in mind:**
- The existing `Promise.all` at [resolveProductDetail.js:84-96](app/lib/resolveProductDetail.js#L84) collapses to a single `products`-row query (since `stores` ran earlier). The Shopify fetch can still run in parallel with that products-row query.
- Adds one Supabase round-trip on every PDP load. The query is a single-row read on an indexed domain column — cheap, and saves the Shopify call when the domain is invalid (net wash on legitimate requests).
- Any test/dev workflow that relies on hitting an arbitrary Shopify domain without registering it in `stores` will need a registered row. There is no such workflow in the current codebase (grep confirms no other consumer uses an unregistered domain).

## What stays exactly the same

- Mobile layout, mobile gallery, mobile accordions, `SaveShareRow`, `MoreFromStore` — untouched (one-line `available` source swap in `page.js` is not a layout change).
- Wheel + arrow-key gallery navigation, sticky thumb rail, sticky right panel.
- Page background (white) and the global nav.
- `BackToFeedLink` component logic (sessionStorage-restoring feed URL) — just repositioned.
- `resolveProductDetail`'s callers and consumers — only `app/product/[handle]/page.js` reads this function's output, and `formatSizes` has no consumers outside the resolver + its unit tests (confirmed by repo grep).

## What changes in `resolveProductDetail`

The redesign requires three bounded changes. Each is localized — no other route or component consumes the affected fields.

- `sizes` becomes `string[] | null` (was `string | null`) and filters to in-stock variants only.
- A new `available: boolean` field is returned, derived from `variants.some(v => v?.available === true)`.
- An early storeDomain allowlist check rejects unknown domains before the Shopify fetch.

Tests in [app/lib/__tests__/resolveProductDetail.test.js](app/lib/__tests__/resolveProductDetail.test.js) need updating for the new `sizes` shape (including the mixed-stock filtering case); no new tests required for `available` or the allowlist (covered by manual verification).

## Sharp edges to respect

- **`BackToFeedLink` is a client component.** Used to be inside the desktop info column; now in the top utility row. No new behavior needed — just import + place.
- **Long store names** could overflow the 340px CTA button on names like "Dover Street Market Paris". Add `whitespace-nowrap overflow-hidden text-ellipsis` to the button text, OR shorten the copy to `BUY AT STORE` when `storeName.length > 22`. Pick one during implementation and verify against the longest name in the current store roster (`stores.display_name` in Supabase).
- **Breadcrumb title** can be very long. Truncate to one line via `truncate` + a `max-w-[clamp(...)]` constraint; the full title is already visible in the info panel.
- **CTA when `available === false`**: button still links to the retailer (the listing page may still be useful to read) but copy switches to "VIEW ON …". The availability dot turns zinc; the label reads `SOLD`.
- **Empty `sizes`** is common — many archive stores skip the variant title. Hide the whole SIZE meta block (and its hairline rule above) so the layout doesn't show a dangling section.
- **Empty `description`** is also possible (rare given the OpenAI fallback in `resolveProductDetail`, but possible if generation fails). `DesktopAboutSection` returns `null` in that case — section disappears entirely; the page just ends at the gallery.
- **Hero arrows must not capture wheel/keyboard.** They're click-only buttons; the existing wheel handler is attached to the image element, not the parent. Position the arrow buttons *over* the hero (`absolute`) but make sure they don't add a wrapper that captures wheel events before the image. Test that wheel still navigates.
- **Mobile CSS untouched.** All new desktop additions live under `hidden lg:block` / `lg:` prefixes. No regression risk to the mobile layout.

## Verification

End-to-end checks on a Vercel preview deployment (per CLAUDE.md: "Verify on Vercel, not localhost"):

1. **Smoke**: load 4 representative product URLs:
   - One with multiple images and multiple sizes (e.g. a CdG piece with S/M/L).
   - One with a single size and a single image.
   - One with no `sizes` (variant title is `null` / `Default Title`).
   - One that is **genuinely sold** at the retailer (all variants `available: false` on Shopify) — NOT a fake URL with `?available=false`. The point of finding 1's fix is that real sold products render correctly even without the query param.
2. **Layout**: confirm on desktop ≥1024px the top utility row, three-column grid, and ABOUT THIS PIECE section all render with hairline rules in the right places.
3. **Breadcrumb**: HOME → `/`. BRAND → opens `/feed?brand=...` and shows that brand's feed.
4. **Hero navigation**: wheel scroll, ←/→ keys, and clicking the new arrows all advance the image. Active thumbnail updates in the rail.
5. **CTA**: click "BUY AT {STORE}" → opens retailer page in a new tab with `?utm_source=depot`.
6. **SOLD state — authoritative source**:
   a. Visit a real sold listing **with no query string** → CTA reads "VIEW ON …", dot is zinc, label reads `SOLD`. (This is the regression that finding 1 fixes — must pass.)
   b. Visit the same sold listing with `?available=true` accidentally tacked on → still renders as SOLD (URL param ignored for rendering).
7. **No-size case**: SIZE meta block + its rule are absent (no dangling label).
8. **No-description case**: ABOUT THIS PIECE section is absent (no dangling label).
9. **Mobile unchanged**:
   a. Load a product URL at mobile width — same layout as before (visual spot-check + `MoreFromStore` still appears below).
   b. Confirm the new desktop ABOUT THIS PIECE section is **not** rendered on mobile (would appear as a duplicate below the existing accordion if the `hidden lg:grid` guard is missing).
   c. **Multi-size product on mobile**: the existing mobile size line still reads `Size: S, M, L` (comma-space separated), not `Size: SML` — confirms the `sizes.join(", ")` mobile update landed.
10. **Long-name case**: visit a product whose `storeName.toUpperCase()` is at the longest end of your roster — verify the button doesn't overflow.
11. **Variant-title with comma**: if any product in the catalog has a single variant whose title contains a comma (e.g. `"Waist 32, Inseam 30"`), confirm the SIZE block shows `SIZE` (singular) with the comma preserved in the value — not `SIZES` with a middot mid-string.
12. **Resolver unit tests**: `npm test app/lib/__tests__/resolveProductDetail.test.js` passes after the `sizes` shape change.
13. **Mixed-stock multi-size product**: visit a product with at least one sold-out variant and at least one in-stock variant. The SIZE block lists ONLY the in-stock sizes; the AVAILABLE dot is green. (If no such product exists in the live catalog, exercise this case in the unit test instead.)
14. **Unknown storeDomain rejection**: navigate to `/product/anything?store=evil-fake-store.example` — the page renders the "Product not found." view and no outbound network request is made to `evil-fake-store.example` (confirm via DevTools network panel or server logs).
15. **Inactive storeDomain rejection** (conditional — exercise only when an inactive store row exists): the live `stores` table currently has zero `active = false` rows, so this case can't be reproduced end-to-end today. When a store is next offboarded, navigating to `/product/<any-handle>?store=<that-inactive-domain>` should render the not-found view with no Shopify fetch. Until then, the `.eq("active", true)` gate is covered by code review and (optionally) a unit test that mocks the Supabase response with `active: false`.

No tests exist for this page today; this redesign doesn't add test infrastructure. Manual verification on preview is the bar, per existing project workflow.

## Out of scope

- Lightbox / fullscreen image viewer (explicitly cut).
- Mobile redesign (explicitly cut).
- Condition field (would require new data; cut).
- "Buy with Shop" / quantity stepper / pickup info (not applicable — Dépôt has no cart).
- Restyling the global nav, the feed, or any other route.
- New tests / test infrastructure.
