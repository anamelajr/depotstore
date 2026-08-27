# Migrate homepage Paris map from Leaflet raster to MapLibre GL vector (CARTO)

## Context

The homepage "Across Paris" map currently renders CARTO raster tiles (light_all PNGs)
through Leaflet. CARTO (our basemap provider) supports vector basemaps, which give
razor-sharp rendering at every zoom and DPR, smooth continuous zoom, no tile seams
(the mobile blend-mode bug class disappears by construction), and future client-side
styling control. The user has approved migrating to vector with **visual parity first**
— CARTO's **Positron GL style** (the vector twin of light_all); custom Dépôt basemap
styling is an explicit follow-up, not part of this change.

On the "watermark": the "API KEY REQUIRED" stamp only appears when
`NEXT_PUBLIC_CARTO_BASEMAPS_KEY` is unset — with the key set it is already gone. The
"© OpenStreetMap © CARTO" credit line is contractually/legally required (CARTO free
tier + OSM license) and **must stay visible**; it remains whisper-styled bottom-left.

## Scope

One component + one CSS block + package swap + doc touch-ups:

- `app/components/ParisMap.js` — the whole map lives here
- `app/globals.css` — lines 26–64 (leaflet tooltip reset, tile blend workaround, attribution restyle)
- `package.json` — swap `leaflet` → `maplibre-gl`
- `CLAUDE.md` — two stale lines after the change
- `app/page.js` — verify-only (MapPlaceholder must keep matching the map container)

No tests reference the map; no webpack/next.config changes needed (Next 16.2.0).

## Design decisions

1. **Markers: DOM `maplibregl.Marker` with a custom element.** A 12px div
   (`border-radius:50%`, background #0a0a0a, 1px border, opacity 0.9) reproduces the
   current `L.circleMarker` radius-6 dot. Handful of stores → DOM markers are simplest
   and give per-marker events for the hover card:
   `maplibregl.Popup({closeButton:false, closeOnClick:true, anchor:"bottom",
   offset:10, className:"depot-tooltip"})`. **One coherent interaction contract**
   (hover-open + click-toggle + closeOnClick:false is self-contradictory — a click
   after mouseenter would instantly close the card, and map-click dismissal only
   works when `closeOnClick` is true):
   - `mouseenter` opens the popup; `mouseleave` closes it **only if it was opened
     by hover** (a one-boolean distinction: hover-opened vs click-pinned).
   - `click`/tap on the marker opens and pins it (with `stopPropagation` so the
     map-click handler doesn't immediately dismiss); tapping the map elsewhere
     dismisses via `closeOnClick:true`. Touch devices get access this way —
     Leaflet tooltips open on tap today, and mouse-only events would silently
     drop the mobile store card.
   - Marker element gets button semantics (`role="button"`, `tabindex="0"`,
     `aria-label` = store name) **plus a `keydown` handler: Enter/Space pins the
     popup, Escape closes it** — role/tabindex alone don't make it operable. **Build the card with DOM nodes + `textContent` and pass it via
   `popup.setDOMContent()`, not an interpolated HTML string** — `storeName`/`location`
   come from Supabase rows and `setHTML` doesn't sanitize; textContent closes the
   injection sink for free while we're rewriting anyway. Inline styles on those
   nodes keep the repo rule: fonts via `var(--font-general-sans)` directly, never
   Tailwind classes.
2. **Interaction parity.** Constructor `scrollZoom:false` (page scroll wins),
   drag pan default-on, flat north-up look: `dragRotate:false, pitchWithRotate:false,
   touchPitch:false`, plus `map.touchZoomRotate.disableRotation()` after init.
3. **Attribution.** `attributionControl:false` in the constructor, then
   `map.addControl(new maplibregl.AttributionControl({compact:false,
   customAttribution:'© <a …>OpenStreetMap</a> © <a …>CARTO</a>'}), "bottom-left")`.
   CSS restyle keyed on `div.maplibregl-map .maplibregl-ctrl-attrib` — same
   specificity tie-break trick the current `div.leaflet-container` rules use, since
   maplibre-gl.css is also dynamically imported after globals.css. Same whisper
   styling: transparent bg, 9px General Sans, #a1a1aa, hover #71717a.
4. **Key handling + failure degradation.** Style URL
   `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json` (served keyless).
   **Appending `?key=` to the style URL does NOT reach tile requests** — the style
   references a separate TileJSON (`tiles.basemaps.cartocdn.com/vector/carto.streets/
   v1/tiles.json`), which in turn lists the MVT tile URLs, plus independent sprite
   and glyph hosts (verified against the live style.json). So when
   `NEXT_PUBLIC_CARTO_BASEMAPS_KEY` is set, pass a `transformRequest` in the Map
   constructor that appends `?key=` (or `&key=`) to any request whose host ends in
   `basemaps.cartocdn.com`; when unset, omit it entirely. Keyless still renders
   (graceful degradation contract preserved — never a broken map).
   Failure handling: MapLibre **throws at construction when WebGL is unavailable**
   — wrap `new maplibregl.Map(...)` in try/catch and put `.catch(() => {})` on the
   dynamic import; on those failures, bail out and leave the container's `#f4f4f5`
   background showing. Later async failures (style/TileJSON/tile/glyph fetches) are
   NOT catchable there — they surface as MapLibre `error` events and leave a
   transparent canvas over the same `#f4f4f5` background with controls showing,
   which matches the raster map's degraded tiles-failed look; that is the accepted
   behavior. No readiness state machine, telemetry, or raster fallback — this is a
   decorative below-fold section.
5. **Cleanup.** Remove `leaflet ^1.9.4`; add `maplibre-gl` (^5). Delete obsolete
   leaflet CSS (tooltip reset, `mix-blend-mode` tile-seam workaround — no `<img>`
   tiles exist under WebGL, attribution block). New rules:
   `.depot-tooltip .maplibregl-popup-content { background:transparent; border:none;
   box-shadow:none; padding:0; border-radius:0; }` and
   `.depot-tooltip .maplibregl-popup-tip { display:none; }` (the injected card
   carries its own border, as today).

## Steps

1. **`package.json`** — remove `leaflet`, add `maplibre-gl`; `npm install` to refresh
   the lockfile. (Worktree note: run `npm ci`/`npm install` here first — worktrees
   start without `node_modules`, and `.env.local` must be copied in.)
2. **`app/components/ParisMap.js`** — keep outside `loadMap()`: `"use client"`, the
   `mapStores` coordinate filter — tightened from `!= null` to
   `Number.isFinite(s.lat) && Number.isFinite(s.lng)` (fallback stores without
   coords must still silently drop) — the one-shot IntersectionObserver (400px
   rootMargin), and the container
   div (`height:480px; width:100%; background:#f4f4f5; isolation:isolate` — keep
   isolation, still guards the sticky mobile nav z-50). **Fix the async-init race
   while porting** (it exists today): `mapInstanceRef` is only set after the dynamic
   import resolves, so a StrictMode cleanup/re-effect mid-import can start a second
   init (two maps, first leaked) and an unmount mid-import initializes against a
   detached node. Fix: an **effect-scoped `cancelled` flag** (local variable set in
   the cleanup), checked after the `.then` resolves and before construction; if a
   map finishes constructing after cancellation, `map.remove()` it immediately.
   **No shared "loading" lock** — the observer is one-shot per effect and each
   effect's cleanup disconnects its own observer, so per-effect `cancelled` plus
   the existing `mapInstanceRef.current` check covers every race without a claim
   that could be stranded held (a shared claim cleared only on failure can
   permanently suppress init after a StrictMode cancel). **Assign
   `mapInstanceRef.current` immediately after `new maplibregl.Map(...)` returns**
   (before markers/controls) so cleanup can always reach the map if a later init
   step throws. Cleanup keeps `map.remove()` (same API in MapLibre). Rewrite
   `loadMap()`:
   - `import("maplibre-gl").then((mod) => { const maplibregl = mod.default ?? mod;
     import("maplibre-gl/dist/maplibre-gl.css"); … })`
   - **[lng, lat] order** — the #1 porting hazard: center becomes `[2.347, 48.857]`,
     markers/popups use `setLngLat([store.lng, store.lat])`.
   - **Zoom is NOT 1:1**: Leaflet's scale is 256px-tile based, MapLibre's camera is
     512px-based, so the same number renders ~one level closer in MapLibre. Start
     at **zoom 12** (≈ Leaflet 13) and lock the framing with a side-by-side check
     against the current map — all store pins previously in view must stay in view
     on desktop and mobile widths.
   - Custom zoom control ports as a plain IControl class
     (`onAdd(map){…return container}`, `onRemove(){this._container.remove()}`) added
     at `"bottom-right"` — same two 32px buttons, inline styles, hover handlers;
     `L.DomUtil`/`L.DomEvent` → `document.createElement`/`addEventListener` with
     `e.stopPropagation()`, calling `map.zoomIn()/zoomOut()`.
   - Update the Leaflet-specific comments (lazy-load rationale stays; isolation
     comment now references MapLibre control z-indexes; keyless-degradation comment
     reworded for the vector style URL).
3. **`app/globals.css`** — deletions/additions per decisions 3 and 5. While
   implementing, check maplibre-gl.css's actual `.maplibregl-ctrl-attrib` /
   popup selectors to confirm the specificity margin holds.
4. **`CLAUDE.md`** — sharp-edge line naming "Leaflet in ParisMap.js" → MapLibre popup
   HTML (font-variable rule unchanged); `NEXT_PUBLIC_CARTO_BASEMAPS_KEY` entry
   reworded from raster "tiles stamped API KEY REQUIRED" to key-appended vector style
   URL, unset still degrades gracefully.
5. **`app/page.js`** — no change; confirm `MapPlaceholder` (480px, #f4f4f5) still
   mirrors the container exactly (CLS guard).

## Verification

- `npm install` in the worktree; `grep -ri leaflet app/ package.json` → empty;
  `npm run lint` and `npm run test` (regression only — no map tests exist).
- Ensure `.env.local` exists in the worktree; test **both with and without**
  `NEXT_PUBLIC_CARTO_BASEMAPS_KEY` — keyless must still render a map.
- Dev server via the preview pane. **The IntersectionObserver won't fire while the
  preview pane is hidden** — keep the pane visible and scroll the homepage down to
  the map section before concluding anything is broken.
- Visual checks: crisp vector labels (the payoff); framing matches old center/zoom;
  store pins render; hover card in General Sans above the pin with no default white
  bubble/arrow; +/− buttons bottom-right with hover states; quiet attribution
  bottom-left; wheel scrolls the page, drag pans, no rotation.
- Mobile viewport (`resize_window` mobile preset): pinch zooms without rotating;
  **tapping a pin opens the store card, tapping again (or elsewhere) dismisses it**;
  sticky nav paints over the map while scrolling; no hairline seams.
- Console clean; network shows `style.json`, TileJSON, and MVT tiles — **with the
  key set, confirm `?key=` appears on the actual tile requests** (transformRequest
  working), and with it unset, confirm requests are clean and the map still renders;
  no CLS at the placeholder→map swap.

## Out of scope (follow-ups)

- Custom Dépôt styling of the basemap (colors/label typeface) — user chose
  visual-parity first.
- Removing the OSM/CARTO attribution — not possible under license/free-tier terms.
