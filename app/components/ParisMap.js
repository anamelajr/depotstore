"use client";

import { useEffect, useRef, useState } from "react";
import MapSnapshot, { MAP_BOX_STYLE } from "./MapSnapshot";
import { MAP_CENTER, MAP_STYLE_URL, MAP_ZOOM } from "../lib/mapView.js";

// Bounded readiness fallback. If CARTO is blocked or partially unavailable,
// "load" may never fire — and a transparent, interactive map layer sitting
// over the snapshot would swallow taps forever. After this long without
// "load" we tear the map down and leave the snapshot showing, the same
// graceful degradation as the no-WebGL catch at construction.
const READY_TIMEOUT_MS = 12000;
// Safari has no requestIdleCallback; warm the chunk on a timer instead.
const IDLE_WARMUP_FALLBACK_MS = 2500;

// One memoized promise for the library and its stylesheet, shared by the idle
// warmup and the observer-triggered construction — whichever fires first wins
// the race and the other awaits the same work. The CSS is inside the
// Promise.all deliberately: it used to be fire-and-forget, which let the
// canvas paint unstyled for a frame.
let maplibrePromise = null;
function loadMapLibre() {
  if (!maplibrePromise) {
    maplibrePromise = Promise.all([
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl.css"),
    ]).then(([mod]) => mod.default ?? mod);
  }
  return maplibrePromise;
}

export default function ParisMap({ stores = [] }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  const mapStores = stores
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => ({
      name: s.storeName,
      location: s.location || "",
      lat: s.lat,
      lng: s.lng,
    }));

  // Warm the maplibre chunk during idle time, separately from construction.
  // Not synchronous on mount: an unconditional mount-time import competes with
  // hero images and hydration on constrained phones — the very devices this
  // targets. The module registry caches it, so an earlier intersection simply
  // wins the race and the observer keeps gating only the expensive part
  // (WebGL context + tile fetches).
  useEffect(() => {
    let handle = null;
    let timer = null;
    if (typeof requestIdleCallback === "function") {
      handle = requestIdleCallback(() => loadMapLibre().catch(() => {}), {
        timeout: IDLE_WARMUP_FALLBACK_MS,
      });
    } else {
      timer = setTimeout(
        () => loadMapLibre().catch(() => {}),
        IDLE_WARMUP_FALLBACK_MS,
      );
    }
    return () => {
      if (handle !== null && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(handle);
      }
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  // MapLibre's WebGL context and the CARTO vector tiles are a large
  // below-the-fold cost, so map *construction* stays gated on a one-shot
  // IntersectionObserver with a generous 400px margin. mapInstanceRef stays
  // the init guard (StrictMode double-effect, remounts); the observer only
  // decides *when*. `cancelled` covers the window the ref can't: the import is
  // async, so a cleanup that runs mid-import must stop the init that resolves
  // after it.
  useEffect(() => {
    if (mapInstanceRef.current) return;
    const el = mapRef.current;
    if (!el) return;

    let observer = null;
    let cancelled = false;
    let readyTimer = null;
    const init = () => {
      if (mapInstanceRef.current) return;
      loadMap();
    };

    if (typeof IntersectionObserver === "undefined") {
      init();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            observer.disconnect();
            observer = null;
            init();
          }
        },
        { rootMargin: "400px" },
      );
      observer.observe(el);
    }

    async function loadMap() {
      let maplibregl;
      try {
        maplibregl = await loadMapLibre();
      } catch {
        // Chunk or stylesheet unreachable — the snapshot stays.
        return;
      }
      if (cancelled || mapInstanceRef.current || !mapRef.current) return;

      // CARTO's Positron GL style is served keyless; the free-tier key
      // (5M tiles/month) is attached per-request below because the style
      // pulls tiles/sprites/glyphs from separate hosts. Keyless still
      // renders — degradation is graceful, never a broken map.
      const cartoKey = process.env.NEXT_PUBLIC_CARTO_BASEMAPS_KEY;

      let map;
      try {
        map = new maplibregl.Map({
          container: mapRef.current,
          style: MAP_STYLE_URL,
          center: MAP_CENTER,
          zoom: MAP_ZOOM,
          scrollZoom: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          attributionControl: false,
          ...(cartoKey
            ? {
                transformRequest: (url) => {
                  try {
                    const u = new URL(url);
                    if (u.hostname.endsWith("basemaps.cartocdn.com")) {
                      u.searchParams.set("key", cartoKey);
                      return { url: u.toString() };
                    }
                  } catch {
                    // Non-absolute URL (bundled asset) — leave untouched.
                  }
                  return { url };
                },
              }
            : {}),
        });
      } catch {
        // MapLibre throws at construction when WebGL is unavailable.
        // Leave the snapshot showing.
        return;
      }

      // Assign before anything else can throw, so cleanup can always
      // reach the map.
      mapInstanceRef.current = map;
      if (cancelled) {
        map.remove();
        mapInstanceRef.current = null;
        return;
      }

      // The cross-fade. Until "load" fires (style + first tiles ready) the
      // map layer is transparent AND pointer-events:none, so the snapshot
      // underneath stays both visible and interactive-looking. `settled`
      // makes reveal and teardown mutually exclusive — whichever happens
      // first wins, and the loser is a no-op.
      let settled = false;
      const clearReadyTimer = () => {
        if (readyTimer !== null) {
          clearTimeout(readyTimer);
          readyTimer = null;
        }
      };
      const reveal = () => {
        if (settled || cancelled) return;
        settled = true;
        clearReadyTimer();
        setMapReady(true);
      };
      const abandon = () => {
        if (settled || cancelled) return;
        settled = true;
        clearReadyTimer();
        if (mapInstanceRef.current) {
          mapInstanceRef.current.remove();
          mapInstanceRef.current = null;
        }
      };

      map.on("load", reveal);
      // Only a failure of the *style document itself* is fatal — a single
      // missing glyph or tile 404 must not tear down an otherwise fine map,
      // so this matches on the style URL rather than on any error.
      map.on("error", (e) => {
        const url = e?.error?.url;
        if (typeof url === "string" && url.split("?")[0] === MAP_STYLE_URL) {
          abandon();
        }
      });
      readyTimer = setTimeout(abandon, READY_TIMEOUT_MS);

      map.touchZoomRotate.disableRotation();

      // CARTO's free basemap tier requires visible CARTO + OSM
      // attribution; kept clear of the custom zoom control's corner. No
      // customAttribution — the Positron style's own sources already carry
      // the linked OSM + CARTO credit, and adding ours prints it twice.
      // Dev-only carve-out: hidden while iterating locally so the design
      // can be judged clean; any production build always shows it — the
      // credit is a license requirement, not a style choice.
      if (process.env.NODE_ENV === "production") {
        map.addControl(
          new maplibregl.AttributionControl({ compact: false }),
          "bottom-left",
        );
      }

      // Only one popup pinned at a time: marker clicks stopPropagation,
      // so the map's closeOnClick can't dismiss a previous pin — do it
      // here when pinning the next one.
      let activePinned = null;
      mapStores.forEach((store) => {
        const dot = document.createElement("div");
        dot.style.cssText =
          "width:12px;height:12px;border-radius:50%;background:#0a0a0a;" +
          "border:1px solid #0a0a0a;opacity:0.9;cursor:pointer;";
        dot.setAttribute("role", "button");
        dot.setAttribute("tabindex", "0");
        dot.setAttribute("aria-label", store.name);

        // Built from DOM nodes + textContent: store name/location come
        // from Supabase rows, and setHTML does not sanitize.
        const card = document.createElement("div");
        card.style.cssText =
          "font-family:var(--font-general-sans),sans-serif;font-size:11px;" +
          "line-height:1.6;background:#ffffff;color:#3f3f46;" +
          "border:1px solid #d4d4d8;padding:8px 12px;border-radius:0;";
        const nameEl = document.createElement("strong");
        nameEl.style.fontSize = "12px";
        nameEl.textContent = store.name;
        card.appendChild(nameEl);
        card.appendChild(document.createElement("br"));
        card.appendChild(document.createTextNode(store.location));

        const popup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: true,
          anchor: "bottom",
          offset: 10,
          className: "depot-tooltip",
        })
          .setDOMContent(card)
          .setLngLat([store.lng, store.lat]);

        // Deliberately NOT bound via marker.setPopup(): that installs
        // MapLibre's own click-to-toggle on the element, which would
        // close a hover-opened card on the click meant to pin it.
        new maplibregl.Marker({ element: dot })
          .setLngLat([store.lng, store.lat])
          .addTo(map);

        // One interaction contract: hover opens transiently, click/tap
        // pins. mouseleave only closes what hover opened.
        let pinned = false;
        // Any close path (closeOnClick, Escape, our own remove) lands
        // here — without the reset, a stale pinned=true stops later
        // hover-opened cards from closing on mouseleave.
        popup.on("close", () => {
          pinned = false;
          if (activePinned === popup) activePinned = null;
        });
        const open = () => {
          if (!popup.isOpen()) popup.addTo(map);
        };
        const pin = () => {
          if (activePinned && activePinned !== popup) activePinned.remove();
          pinned = true;
          activePinned = popup;
          open();
        };
        const close = () => {
          pinned = false;
          popup.remove();
        };
        dot.addEventListener("mouseenter", open);
        dot.addEventListener("mouseleave", () => {
          if (!pinned) popup.remove();
        });
        dot.addEventListener("click", (e) => {
          // Without this the map's own click handler dismisses the popup
          // (closeOnClick) in the same gesture that opened it.
          e.stopPropagation();
          if (pinned && popup.isOpen()) {
            close();
          } else {
            pin();
          }
        });
        dot.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (pinned && popup.isOpen()) {
              close();
            } else {
              pin();
            }
          } else if (e.key === "Escape") {
            close();
          }
        });

        dot.addEventListener("blur", () => {
          if (!pinned) popup.remove();
        });
      });

      // Custom zoom control — a plain IControl object (onAdd/onRemove).
      const zoomControl = {
        onAdd() {
          const container = document.createElement("div");
          // The corner wrappers ship pointer-events:none; only the
          // .maplibregl-ctrl class restores interactivity.
          container.className = "maplibregl-ctrl";
          container.style.cssText =
            "display:flex;flex-direction:column;gap:1px;";

          const btnStyle = `
    width:32px;height:32px;background:#ffffff;color:#71717a;
    border:1px solid #d4d4d8;display:flex;align-items:center;
    justify-content:center;cursor:pointer;font-family:var(--font-general-sans),sans-serif;
    font-size:16px;line-height:1;transition:color 0.2s,border-color 0.2s;
  `;

          const makeBtn = (label, onClick) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = label;
            btn.style.cssText = btnStyle;
            btn.addEventListener("mouseover", () => {
              btn.style.color = "#0a0a0a";
              btn.style.borderColor = "#71717a";
            });
            btn.addEventListener("mouseout", () => {
              btn.style.color = "#71717a";
              btn.style.borderColor = "#d4d4d8";
            });
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              onClick();
            });
            container.appendChild(btn);
          };

          makeBtn("+", () => map.zoomIn());
          makeBtn("\u2212", () => map.zoomOut());

          this._container = container;
          return container;
        },
        onRemove() {
          this._container.remove();
        },
      };

      map.addControl(zoomControl, "bottom-right");
    }

    return () => {
      cancelled = true;
      if (observer) observer.disconnect();
      if (readyTimer !== null) clearTimeout(readyTimer);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div style={MAP_BOX_STYLE}>
      {/* Instant basemap + live dots, visible from first paint. Left mounted
          after the fade: it is fully occluded by the opaque map, and removing
          it would buy nothing. */}
      <MapSnapshot stores={mapStores} occluded={mapReady} />
      <div
        ref={mapRef}
        style={{
          position: "absolute",
          inset: 0,
          opacity: mapReady ? 1 : 0,
          // Invariant: the transparent map layer must never sit
          // interactive-but-dead over the snapshot.
          pointerEvents: mapReady ? "auto" : "none",
          transition: "opacity 500ms ease-out",
        }}
      />
    </div>
  );
}
