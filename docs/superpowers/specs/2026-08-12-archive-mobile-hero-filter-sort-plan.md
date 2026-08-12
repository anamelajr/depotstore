# Featured Archive — mobile hero rework + filter/sort (mobile & desktop)

## Context

PR #111 shipped the featured-archive page (`/archives/hedi-slimane`) desktop-first. On mobile the hero stacks the copy column on top of a full-width `aspect-[4/5]` portrait, making the section far too tall (~770px before any product appears). Per the reference mock (`~/Downloads/mobile archive section reference.png`), the mobile hero should be a compact two-column band: copy left, smaller portrait right bleeding off the right edge.

The user also decided (clarified during brainstorming) to add **functional filter + sort to the archive page on both mobile and desktop**, reusing the feed's floating translucent FILTER/SORT bars — *not* the reference's inline toolbar. Filtering is **category only** (parent + leaf, only categories present in the archive set); sorting uses the feed's standard options. The archive set is small (tens of rows) and fully fetched server-side, so filter/sort is client-side in-memory.

Branch: `claude/featured-archive-mobile-c2b81c` (currently identical to main). Do not push to main.

## Key exploration findings

- Hero band: `app/archives/[slug]/page.js:61-118`. Desktop (md+) 3-track grid `md:grid-cols-[44fr_34fr_22fr]` — must stay pixel-identical. Asset is a transparent cutout PNG (`public/archives/hedi-slimane/portrait.png`, 1233×1365).
- Feed's filter/sort components are **prop-driven and reusable** — all URL machinery lives only in `app/feed/FeedClient.js`. Mobile: `MobileFeedActionBar` (floating pill, `md:hidden`), `MobileFilterPanel`, `MobileSortPanel`. Desktop: `DesktopFeedBar` in a `hidden md:block fixed bottom-6 left-1/2 -translate-x-1/2 z-30` wrapper (FeedClient.js:518), `DesktopFilterPanel` (left drawer), `DesktopSortMenu` (opens upward above the bar — default placement is correct here, no change needed).
- Archive product objects currently **lack `category`/`subcategory`/`syncedAt`**: `fetchArchiveProducts.js:27` selects `PRODUCT_ROW_SELECT + synced_at` but `mapProductRow` deliberately omits `subcategory` and drops `synced_at`. Server-side change required.
- Price parse helper exists: `parseEur` in `app/lib/currency.js` ('€29.99' → 29.99, null on unparseable). Price is TEXT (CLAUDE.md) — numeric sort in JS.
- All i18n keys needed already exist (`feed.filter`, `feed.sort`, `filter.*`, `nav.back/close`, `archive.items`, sort labels via `getSortOptions(lang)`). **No `messages.js` changes** → parity test untouched.
- Page root already has `overflow-x-clip` (never `overflow-x-hidden` — CLAUDE.md), which clips the right-edge bleed cleanly.
- Category helpers to reuse: `resolveCategoryFilter`, `CATEGORIES`, lang-aware label accessors in `app/lib/categories.js` (thread `language` explicitly — accessors default to `"en"` silently).
- Existing test `app/lib/__tests__/fetchArchiveProducts.test.js` asserts by handle only; additive fields are safe. Runner: vitest via `npm test`.

## Part A — Mobile hero rework (`app/archives/[slug]/page.js`)

Sub-md only; every `md:` class stays byte-identical. Band becomes a two-column grid, cutout bottom-anchored and bleeding off the right edge:

```jsx
<div className="grid grid-cols-[11fr_9fr] md:min-h-[320px] md:grid-cols-[44fr_34fr_22fr]">
  {/* copy cell — tightened mobile rhythm */}
  <div className="flex flex-col justify-center px-6 py-8 md:py-10 md:pl-[4.5vw] md:pr-10">
    {/* eyebrow unchanged */}
    <h1 className="mt-3 md:mt-6 text-[clamp(17px,5vw,20px)] md:text-[clamp(20px,1.95vw,30px)] font-light leading-[1.25] tracking-[0.06em] text-zinc-950" …>
    <p className="mt-3 md:mt-5 max-w-[32ch] text-[11px] md:text-[12px] leading-[1.55] md:leading-[1.6] text-zinc-600">
    {/* story link: mt-5 md:mt-8 */}
  </div>

  {/* image cell — drop aspect-[4/5]; height copy-driven with a floor */}
  <div className="relative min-h-[220px] md:min-h-full">
    {/* bleed wrapper: pushes cutout past viewport right edge on mobile;
        md:inset-0 restores today's exact geometry */}
    <div className="absolute inset-y-0 left-0 -right-[12%] md:inset-0">
      <Image src={archive.image} alt={archive.imageAlt} fill priority
        sizes="(max-width: 768px) 50vw, 34vw"
        className="object-contain object-right-bottom pt-6 md:object-bottom md:pt-0" />
    </div>
  </div>

  <div aria-hidden="true" className="hidden md:block" /> {/* unchanged */}
</div>
```

- `grid-cols-[11fr_9fr]` ≈ 55/45 split; band height becomes copy-driven (~280–320px at 375px vs ~770px today).
- Cutout stays bottom-anchored so its crop line sits on the band's bottom hairline (same trick as desktop).
- Update the hero comment block to describe the new mobile behavior.
- **These exact values are a starting point, not the spec.** The user asked for meticulous visual iteration: screenshot at 375px, compare side-by-side against the reference, and tune split ratio, bleed amount, type scale, and spacing by judgment until balanced (see Verification).

## Part B — Filter + sort

### Architecture

- **State: local React state** in one client component (no URL params, no `useSearchParams`). Page is ISR (`revalidate=3600`); full set already in props; initial state (no filters, `"interleaved"` sort) matches server HTML → no hydration issues.
- `page.js` **stays a server component**; toolbar row + grid move into a new client component: `<ArchiveProductsClient products={products} />`.

### New files

1. **`app/lib/archiveProductFilters.js`** — pure helpers (vitest target):
   - `buildArchiveFilterGroups(products, lang)` — CATEGORIES → `DesktopFilterPanel`'s `{value, label, children}` shape, keeping only parents/children with ≥1 matching product; parent with present children gets the "All <Label>" first child (mirror `getFilterGroups`); parent present only via null-subcategory rows renders as a leaf. Thread `language`.
   - `filterProductsByCategories(products, slugs)` — `[]` → all; else `resolveCategoryFilter(slugs)`, keep rows matching parent OR (category+subcategory) leaf — same OR semantics as the feed.
   - `sortArchiveProducts(products, sort)` — `"interleaved"|"latest"` → `syncedAt` desc; `"oldest"` → asc; `"price_asc"/"price_desc"` → `parseEur`, nulls last, tie-break `syncedAt`. Null/unparseable `syncedAt` sorts **last in both directions** (same contract as price; production has zero null `synced_at` today, but the fetch contract test deliberately ships a null fixture, so the comparator's null behavior must be pinned). Deterministic tie-break (e.g. `storeDomain::handle`) for equal keys. Returns a copy.

2. **`app/components/archive/ArchiveProductsClient.js`** (`"use client"`) — owns `selectedCategories`, `selectedSort`, and open/close state for four panels (mutually exclusive like FeedClient). Renders:
   - Toolbar row (same hairline + `UTILITY_CAPS` markup as today) showing **filtered** count: `{filtered.length} <T k="archive.items" />`.
   - Product grid (markup identical to today) with `pb-32 md:pb-24` bottom clearance for the floating bars (mirrors FeedClient.js:444). Empty state: match the feed's "No products found." box (FeedClient.js:477-480, hardcoded English there too).
   - `<MobileFeedActionBar />` — verbatim (`hasActiveFilters={selectedCategories.length > 0}`).
   - `<MobileSortPanel />` — verbatim.
   - `<ArchiveFilterPanel />` — new, below.
   - Desktop: `hidden md:block fixed bottom-6 left-1/2 -translate-x-1/2 z-30` wrapper containing `DesktopSortMenu` (default upward placement) + `DesktopFeedBar` — same structure as FeedClient.js:518-533.
   - `<DesktopFilterPanel categoryGroups={groups} showStore={false} … />`.
   - Replicate FeedClient's breakpoint-crossing close effect (FeedClient.js:167-178, `matchMedia("(max-width: 767px)")` closing all panels) — avoids the stuck `body{overflow:hidden}` hazard on tablet rotation.

3. **`app/components/archive/ArchiveFilterPanel.js`** — mobile filter panel (~110 lines). Copies `MobileFilterPanel`'s shell (portal, `z-[9999]` full-screen white, `navMenuEnter` animation — keyframes global in `globals.css` — body scroll lock, `h-[50px]` header, `h-14` APPLY/RESET footer) but opens **directly into the category list** (no root CATEGORY/STORE menu — pointless with one dimension), driven by the `groups` prop with expandable parents. **Preserves the atomic-commit invariant** (CLAUDE.md): `draftCategories` re-seeded from `selectedCategories` on open; APPLY = single `onApply(draft)`; RESET clears draft without committing. Props: `{ isOpen, onClose, selectedCategories, groups, onApply }`. Reuse the checkbox row by adding a named `export { OptionRow }` to `MobileFilterPanel.js`.

### Modified files

| File | Change |
|---|---|
| `app/archives/[slug]/page.js` | Hero mobile classes (Part A); replace toolbar+grid (lines 120–143) with `<ArchiveProductsClient/>`; bump `unstable_cache` keyPart to `"archive-products-v2"` |
| `app/lib/fetchArchiveProducts.js` | `ROW_SELECT` += `category, subcategory` (build on `PRODUCT_ROW_SELECT_WITH_CATEGORY` — note plain `PRODUCT_ROW_SELECT` lacks `category` even though `mapProductRow` emits it); final map: `{ ...mapProductRow(row), subcategory: row.subcategory ?? null, syncedAt: row.synced_at ?? null }` — do **not** widen `mapProductRow` itself |
| `app/lib/__tests__/fetchArchiveProducts.test.js` | Fetch-layer contract test (adversarial-review finding, see below) |
| `app/components/MobileFilterPanel.js` | Named `export { OptionRow }` only |
| `app/components/feed/DesktopFilterPanel.js` | Optional props `categoryGroups = null` (falls back to `getFilterGroups(language)`) and `showStore = true` — defaults preserve feed behavior exactly |

Reused verbatim: `MobileFeedActionBar`, `MobileSortPanel`, `DesktopFeedBar`, `DesktopSortMenu` (no changes), `ProductCard`, `parseEur`, `resolveCategoryFilter`, `getSortOptions`, `T`, tokens.

### Cache-staleness mitigation

Bump the `unstable_cache` keyPart (`"archive-products"` → `"archive-products-v2"`): without it, up to an hour post-deploy the cached payload lacks `subcategory`/`syncedAt` and leaf filters/sorts silently no-op.

### Fetch-layer contract test (from adversarial review — confirmed gap)

The existing test stub is select-blind (`select: () => builder` at `fetchArchiveProducts.test.js:31`) and returns whole fixture rows, so a `ROW_SELECT` missing `category`/`subcategory` — or a final map dropping a field — is invisible to the suite while silently emptying every category filter in production (PostgREST returns only selected columns; `mapProductRow` emits `category: row.category` without complaint). Fix at the behavior level, keeping the file's stated philosophy (membership semantics, not call-chain shape):

- Make the stub's `select(cols)` **project returned rows onto the selected columns**, simulating PostgREST — a missing column then surfaces as `undefined` in output exactly as in production.
- Add `category`/`subcategory`/`synced_at` values to fixture rows and assert mapped products carry `category`, `subcategory`, `syncedAt` with real values plus the `?? null` normalization (row with null subcategory → `subcategory: null`, missing synced_at → `syncedAt: null`).

This catches both a wrong select constant and a dropped field in the final map. Do **not** assert on the select string itself (brittle, contradicts the stub's design comment).

## Implementation order

1. `fetchArchiveProducts.js` fields + cache keyPart bump, **with the fetch-layer contract test above** (test first — it fails against today's select-blind stub setup, then passes with the widened select + map).
2. `archiveProductFilters.js` + unit tests.
3. `DesktopFilterPanel` prop additions + `MobileFilterPanel` `OptionRow` export.
4. `ArchiveFilterPanel` → `ArchiveProductsClient` → wire into `page.js`.
5. Hero rework + meticulous visual iteration (below).

## Verification

**Unit (vitest, `npm test`)**: new `app/lib/__tests__/archiveProductFilters.test.js` — group derivation (absent categories excluded, null-subcategory parent as leaf, **fr labels** — catches silent-English drift), parent/leaf OR filtering, price sort with null/malformed prices, latest/oldest ordering **including null-`syncedAt` rows sorting last in both directions**. Extend `fetchArchiveProducts.test.js` with the select-projection contract test (above). Confirm the i18n parity test still passes.

**Visual iteration loop (explicitly requested by user — do not skip)**: start the dev server via preview tools (read-path only is safe; never trigger `/api/cron` or `/api/enrich`), open `/archives/hedi-slimane`:
- Resize to mobile (375×812), screenshot, and compare side-by-side against `~/Downloads/mobile archive section reference.png`. Iterate on column split, bleed amount, portrait scale, type sizes, and vertical rhythm until the band reads balanced like the reference (accounting for our cutout asset vs the reference's rectangular photo). Multiple rounds expected; use judgment, not one-shot.
- Use the `visual-compare` skill at the end to publish a reference-vs-built comparison artifact for the user.
- Check: no horizontal scrollbar (bleed clipped), floating pill clears the last grid row, filter panel APPLY/RESET atomicity (draft changes discarded on close-without-APPLY), count updates when filtered, all sorts correct, empty-filter state renders.
- Desktop (1280×800): hero **pixel-identical** to before (screenshot diff), floating bar centered bottom, filter drawer has no STORE section, sort menu opens upward.
- Cross-breakpoint: resize across 767px with a panel open → panels close, body scroll restored.
- Regression: `/feed` mobile + desktop still work (shared components touched).
- FR toggle: panel/category/sort labels flip to French.

## Risks

- Feed regressions from `DesktopFilterPanel` edits — all new props defaulted; manual feed pass required.
- Silent English on FR if `language` not threaded into group building — covered by fr unit test.
- Unenriched rows (`category` null) vanish under any category filter — correct feed-equivalent behavior; expect counts to reflect it.
- Longer future archive descriptions grow the mobile band vertically — acceptable (copy-driven height, YAGNI).
