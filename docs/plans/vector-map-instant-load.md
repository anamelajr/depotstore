# Instant, smooth Paris map load (vector map performance)

## Context

The raster→vector migration (PR #129) replaced Leaflet with MapLibre GL + CARTO Positron vector style in `app/components/ParisMap.js`. It looks great once loaded, but on phone/laptop the section shows a blank grey/white box for ~1s before the map pops in — everything (maplibre chunk, WebGL init, style.json, fonts, sprites, tiles, each on cold connections) is serialized behind a 400px-rootMargin IntersectionObserver, with no preconnect, no prefetch, and no graceful reveal. This ruins the luxury feel.

**Decision (user-approved, Option C):** do both — (A) make the real map genuinely faster, and (B) show a pre-rendered static snapshot of the exact map view instantly, with live HTML store dots on top, cross-fading to the interactive map when it's ready. Dots are NOT baked into the image (they'd go stale with the store list); the snapshot freezes only the basemap.

## Current-state facts (from exploration)

- `app/components/ParisMap.js` (305 lines): `"use client"`, dynamic `import("maplibre-gl")` at line ~56 inside `loadMap()`, CSS import fire-and-forget at line ~60 (NOT awaited before `new Map()` at ~70), one-shot IntersectionObserver `rootMargin: "400px"` (~42–52), hardcoded keyless style `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json`, `transformRequest` appends `?key=` to `*.basemaps.cartocdn.com` when `NEXT_PUBLIC_CARTO_BASEMAPS_KEY` set. Center `[2.347, 48.857]`, zoom 12, container `height: 480px; background: #f4f4f5; isolation: isolate`. Markers/popups built synchronously after construction (~133–226). No `map.on("load")` handler, no fade-in.
- Usage: `app/page.js:3` static import; `AcrossParis` server component renders `<ParisMap stores={stores} />` inside `<Suspense fallback={<MapPlaceholder />}>` (placeholder covers only the streaming gap, not the MapLibre gap).
- `app/layout.js:58` preconnects only to `cdn.shopify.com`. No preconnect for `basemaps.cartocdn.com` / `tiles.basemaps.cartocdn.com` / `fonts.cartocdn.com`.
- `maplibre-gl@^5.9.0`, `next@16.2.0`, react 19.
- Font rule (CLAUDE.md): DOM injected outside React (popup card, zoom control) must reference the next/font CSS variable directly — the same applies to any new non-React DOM.

## Plan

### Part A — make the real map faster

1. **Preconnect to CARTO hosts** — in `app/page.js` (or the `AcrossParis` section) via `react-dom`'s `preconnect()`, matching the existing `cdn.shopify.com` pattern in `app/layout.js:58`: `https://basemaps.cartocdn.com`, `https://tiles.basemaps.cartocdn.com`, `https://fonts.cartocdn.com`. Verify the actual tile/glyph hosts by inspecting the live style.json's `sources`/`glyphs`/`sprite` URLs during implementation and preconnect to exactly those origins.
2. **Warm the maplibre chunk early** — in ParisMap's mount effect, kick off `import("maplibre-gl")` (and the CSS import) immediately on mount (module registry caches it); keep the IntersectionObserver solely to gate *map construction* (WebGL + tile fetches). Net effect: by the time the user scrolls near the map, the JS is already parsed.
3. **Await the CSS import** before `new maplibregl.Map()` — `await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")])` so the canvas never paints unstyled.
4. **Graceful reveal** — wrap the map div; start it at `opacity: 0` and transition to 1 (~400–600ms ease) on the map `"load"` event (fires when style + initial tiles are ready). This is the cross-fade over the snapshot.

### Part B — static snapshot + live dots

5. **Snapshot generation script** — `scripts/generate-map-snapshot.mjs` (dev-only, run manually): uses Playwright headless (`npx playwright` — add as devDependency if not present; check first) to load a minimal local HTML page that constructs the same MapLibre map (same style URL, center `[2.347, 48.857]`, zoom 12, no markers/controls, `preserveDrawingBuffer: true`), waits for `map.on("idle")`, screenshots the canvas at **1600×480 @2x** (3200×960), and writes optimized WebP to `public/paris-map-snapshot.webp` (target ≲150KB; also a 1x fallback if size warrants). Wide render + CSS centering means one asset serves all viewport widths. Document in the script header: re-run only if the basemap style or camera changes.
6. **Snapshot layer in ParisMap** — inside the existing 480px container, an absolutely-positioned `next/image` (or plain `<img>` with explicit dimensions, `priority`-loaded once near viewport) showing the snapshot: `position: absolute; inset: 0; object-fit: cover; object-position: center` — because the live map and the snapshot share the same center anchored at container center, cover-centering keeps them pixel-aligned at any width. The map canvas sits above it, fading in per step 4; after the fade completes, the img can be removed or left (it's occluded — leave it, simplest).
7. **Live static dots** — a small pure function `lngLatToContainerPx(lng, lat, center, zoom, width, height)` implementing Web Mercator: pixel offset from container center = `(mercX(lng) − mercX(centerLng)) · 512 · 2^zoom` (and same for y with the latitude mercator). Render one absolutely-positioned 12px dot per store (same styling as the live markers, built in React this time) over the snapshot. They are **visual only** (no popups) and fade out as the live map fades in, replaced by the real MapLibre markers. Recompute on container resize is unnecessary — dots position relative to center, so compute from `offsetWidth/Height` once at render via a ref/layout effect (the map section isn't resized interactively; a simple resize listener is optional-skip, YAGNI).
8. **Zoom constant shared** — extract center/zoom into module-level constants used by both the live map and the projection math so they can't drift.

### Files touched

- `app/components/ParisMap.js` — steps 2, 3, 4, 6, 7, 8 (main work)
- `app/page.js` — step 1 (preconnects near the map section)
- `scripts/generate-map-snapshot.mjs` — new, step 5
- `public/paris-map-snapshot.webp` — new generated asset
- `package.json` — Playwright devDependency only if not already available

### Explicitly out of scope

- No change to popup/pin behavior, zoom control, attribution, or the interleaved data path.
- No pre-load interactivity on the static dots (popups arrive with the live map).
- No CDN/static-map API dependency (snapshot is a checked-in asset; the live map remains the only runtime CARTO consumer).

## Verification

1. `npm run dev` from the worktree (per memory: worktree needs `.env.local` + `npm ci`; keep the preview pane visible or the IntersectionObserver never fires).
2. Open the homepage in the Browser pane; throttle via DevTools-equivalent isn't available, so verify sequencing instead: on load, `read_network_requests` should show the maplibre chunk + CARTO preconnects starting at page load, not at scroll.
3. Scroll to the map: the snapshot + dots must appear instantly (screenshot proof), then the live map cross-fades in with no pop, dots swap seamlessly (positions must match within ~1px — compare screenshots of snapshot-dots vs live markers).
4. `resize_window` mobile preset: snapshot stays centered/aligned; dots still coincide with live markers.
5. Regenerate snapshot via the script; confirm byte size ≲150KB and visual identity with the live map.
6. Check console for errors; confirm keyless path still works (unset `NEXT_PUBLIC_CARTO_BASEMAPS_KEY` behavior unchanged).
7. Branch + PR per workflow; no push to main.
