# Fix homepage Paris map: CARTO watermark + mobile tile seams

## Context

Two production bugs on the homepage map, both rooted in the tile layer of
[app/components/ParisMap.js](app/components/ParisMap.js):

1. **"API KEY REQUIRED" text on the map.** The map loads free anonymous raster
   tiles from `basemaps.cartocdn.com/light_all`. CARTO changed policy and now
   bakes an "API KEY REQUIRED — carto.com/basemaps/apikey" watermark directly
   into tile PNGs served without an API key (verified by fetching a raw Paris
   tile — the text is in the image). No code regression; the supplier changed.

2. **White "cake slice" lines on mobile.** Leaflet composes the map from 256px
   raster tiles positioned via GPU transforms; on phones with fractional
   effective scaling (e.g. DPR 2.625) per-tile rounding leaves ~1px gaps at
   tile boundaries, showing the white page background through the seams
   (canonical Leaflet issue #3575). No site CSS is involved.

**Decision (user-approved):** replace Leaflet + CARTO with **MapLibre GL +
OpenFreeMap's free `positron` vector style** — no API key or account ever,
near-identical light-grey look, and vector rendering draws one continuous
surface so the mobile seam bug disappears inherently. One change fixes both.

## Changes

### 1. Rewrite `app/components/ParisMap.js` on MapLibre GL

Keep the component's contract and structure identical; swap only the map
engine inside `loadMap()`:

- `npm i maplibre-gl`; `npm rm leaflet`.
- Keep the one-shot IntersectionObserver lazy-load (400px rootMargin) and the
  `mapInstanceRef` init guard exactly as-is — only the dynamic imports change:
  `import("maplibre-gl")` + `import("maplibre-gl/dist/maplibre-gl.css")`.
- Map init:
  ```js
  new maplibregl.Map({
    container: mapRef.current,
    style: "https://tiles.openfreemap.org/styles/positron",
    center: [2.347, 48.857],   // NOTE: [lng, lat] — reversed vs Leaflet
    zoom: 12,                  // MapLibre uses 512px tiles: Leaflet z13 ≈ MapLibre z12
    attributionControl: false,
  });
  map.scrollZoom.disable();
  ```
- Add a compact attribution control (`maplibregl.AttributionControl` with
  `compact: true`, custom "© OpenFreeMap © OpenStreetMap") — OSM data legally
  requires attribution; the current code hid "© CartoDB", don't carry that over.
- Markers: for each store, a `maplibregl.Marker` with a custom `element` — a
  12px black (#0a0a0a) circle div replicating the current `circleMarker`
  (opacity 0.9). Hover tooltip via a `maplibregl.Popup` (`closeButton: false`,
  `closeOnClick: false`, offset above) opened/closed on the element's
  `mouseenter`/`mouseleave`, reusing the existing inline-styled HTML block
  (keep `font-family: var(--font-general-sans), sans-serif` — the two-layer
  font-variable sharp edge in CLAUDE.md applies to raw-HTML injection here).
- Custom zoom control: port the existing `ZoomControl` DOM verbatim as a
  MapLibre `IControl` (`{ onAdd(map){...return container}, onRemove(){} }`)
  added at `"bottom-right"`; buttons call `map.zoomIn()` / `map.zoomOut()`
  (same API names). Use `e.stopPropagation()` instead of `L.DomEvent`.
- Cleanup path unchanged: `map.remove()` in the effect teardown.
- Keep the wrapper div exactly as-is (480px, `#f4f4f5` ground, and the
  `isolation: isolate` stacking-context trap — MapLibre controls also use
  z-indexes that must not paint over the sticky mobile nav).

### 2. CSS

In [app/globals.css](app/globals.css): replace the now-dead
`.depot-tooltip .leaflet-tooltip` block with the equivalent for the MapLibre
popup (strip default chrome: `.depot-tooltip .maplibregl-popup-content
{ background: transparent; border: none; box-shadow: none; padding: 0; }`,
and hide/neutralize the popup tip arrow to match the current look).

## Verification

Worktree has no `.env.local` (known: "supabaseUrl is required" = missing env,
not a regression) — copy it from the main checkout before running the dev
server. Read-path UI only; do not touch `/api/cron` or `/api/enrich`.

1. `preview_start` the dev server, scroll to the map on the homepage.
2. Confirm: light-grey Positron map of Paris, **no "API KEY REQUIRED"
   anywhere** (screenshot), store dots render at the same spots, hover shows
   the styled tooltip, custom +/− buttons zoom, scroll-wheel does not zoom.
3. `resize_window` mobile preset, reload: **no white seam lines** while
   panning/zooming; map scrolls beneath the sticky mobile nav (isolation
   check).
4. Framing sanity: zoom 12 shows roughly the same Paris extent the Leaflet
   z13 view did; adjust ±0.5 if visibly off.
5. `npm run build` passes; `grep -r leaflet app package.json` returns nothing.
