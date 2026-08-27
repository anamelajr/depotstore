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
   and give per-marker `mouseenter`/`mouseleave` for the hover card. The raw-HTML card
   ports unchanged into `maplibregl.Popup({closeButton:false, closeOnClick:false,
   anchor:"bottom", offset:10, className:"depot-tooltip"})`, shown on enter / removed
   on leave. (Repo rule: raw-HTML must use `var(--font-general-sans)` directly, never
   Tailwind classes — unchanged.)
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
4. **Key handling.** Style URL
   `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json` +
   `(cartoKey ? \`?key=${cartoKey}\` : "")`. Keyless still renders (graceful
   degradation contract preserved — never a broken map).
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
2. **`app/components/ParisMap.js`** — keep everything outside `loadMap()` untouched:
   `"use client"`, the `mapStores` lat/lng null-filter (fallback stores without
   coords must silently drop), the one-shot IntersectionObserver (400px rootMargin),
   the `mapInstanceRef` StrictMode guard, the cleanup (`map.remove()` is the same API
   in MapLibre), and the container div (`height:480px; width:100%;
   background:#f4f4f5; isolation:isolate` — keep isolation, still guards the sticky
   mobile nav z-50). Rewrite `loadMap()`:
   - `import("maplibre-gl").then((mod) => { const maplibregl = mod.default ?? mod;
     import("maplibre-gl/dist/maplibre-gl.css"); … })`
   - **[lng, lat] order** — the #1 porting hazard: center becomes `[2.347, 48.857]`,
     markers/popups use `setLngLat([store.lng, store.lat])`.
   - Zoom 13 should frame the same (Positron GL is a 512px-tile style so zoom scales
     match Leaflet); spot-check the framing.
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
  sticky nav paints over the map while scrolling; no hairline seams.
- Console clean; network shows `style.json` + vector tiles (with `?key` when set);
  no CLS at the placeholder→map swap.

## Out of scope (follow-ups)

- Custom Dépôt styling of the basemap (colors/label typeface) — user chose
  visual-parity first.
- Removing the OSM/CARTO attribution — not possible under license/free-tier terms.
