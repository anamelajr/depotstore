# Mobile Stores → in-menu view

## Context

On mobile, tapping STORES in the nav menu navigates to `/stores` — an early standalone page (big General Sans headline, numbered rows, piece counts, no site nav, hardcoded English) that doesn't match the current mobile design. Brainstormed with the user; approved direction: **Stores becomes a subview inside `MobileNavMenu`, exactly like the Shop → categories pattern.** No numbers, no piece counts. The `/stores` page itself stays untouched (desktop still uses its own nav treatment).

## Changes

All in [app/components/MobileNavMenu.js](app/components/MobileNavMenu.js) plus one prop thread in [app/components/Nav.js](app/components/Nav.js):

1. **Thread store data** — `Nav` already receives `stores` (server-fetched via `getAllStores()`, already passed to `DesktopNav`). Pass the same prop to `<MobileNavMenu stores={stores} />` (Nav.js:105). Filter to `s.active` (match stores/page.js:22) — confirm whether `getAllStores` already filters; desktop nav usage shows the shape `{ storeName, domain, displayName, location }`.

2. **RootView: STORES becomes a view switch** — replace the `<Link href="/stores">` (MobileNavMenu.js:137-143) with a `<button onClick={onOpenStores}>` styled identically to the SHOP button above it (same classes, same `›` chevron).

3. **New `StoresView`** — clone the `SubcategoryView` pattern (MobileNavMenu.js:221-252):
   - Header: `‹ BACK` (→ root) / centered `{t("nav.stores").toUpperCase()}` / `✕` close — same classes as ShopView header.
   - Body: `flex-1 px-8 pt-10 pb-8 flex flex-col gap-6 overflow-y-auto`; one `<Link>` per store, `font-mono text-[10px] tracking-[0.32em] uppercase text-zinc-50`, text = `store.displayName` uppercased, `href={buildFreshFeedUrl({ store: store.domain })}` (fresh URL is correct for nav-menu links per CLAUDE.md), `onClick={onClose}`.
   - Keep store order as delivered by `getAllStores()` (same order desktop uses).

4. **View state** — extend the `view` union: `'root' | 'shop' | 'stores' | {type:'subcategory',…}`; wire `onOpenStores={() => setView("stores")}` and render `StoresView` when `view === "stores"`.

No i18n additions needed — `nav.stores` and `nav.back` keys already exist.

## Out of scope

- `/stores` page redesign (desktop keeps it; can revisit later).
- Piece counts / map — explicitly excluded by user.

## Verification

1. `npm run dev` (or Claude preview), mobile viewport (e.g. 390px).
2. Open hamburger menu → tap STORES → subview slides in with store list, header shows ‹ BACK / STORES / ✕.
3. Tap a store → menu closes, feed loads filtered to that store (`/feed?store=<domain>`); confirm products shown belong to it.
4. BACK returns to root; ✕ closes; reopening menu resets to root (existing `setView("root")` on close).
5. Toggle language to FR → STORES header label uses the FR string.
6. Desktop unaffected: `/stores` still reachable and unchanged; desktop nav store filtering still works.
