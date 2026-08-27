"use client";

import { useEffect, useRef } from "react";

export default function ParisMap({ stores = [] }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);

  const mapStores = stores
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => ({
      name: s.storeName,
      location: s.location || "",
      lat: s.lat,
      lng: s.lng,
    }));

  // MapLibre + its CSS + the CARTO vector tiles are a large below-the-fold
  // payload that used to load on every homepage hydration, competing with the
  // above-the-fold work for bandwidth on a map most visitors never scroll to.
  // Gate the dynamic import on a one-shot IntersectionObserver with a generous
  // 400px margin, so the map is still ready by the time it's actually on
  // screen. mapInstanceRef stays the init guard (StrictMode double-effect,
  // remounts); the observer only decides *when*. `cancelled` covers the window
  // the ref can't: the import is async, so a cleanup that runs mid-import must
  // stop the init that resolves after it.
  useEffect(() => {
    if (mapInstanceRef.current) return;
    const el = mapRef.current;
    if (!el) return;

    let observer = null;
    let cancelled = false;
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

    function loadMap() {
      import("maplibre-gl")
        .then((mod) => {
          if (cancelled || mapInstanceRef.current || !mapRef.current) return;
          const maplibregl = mod.default ?? mod;
          import("maplibre-gl/dist/maplibre-gl.css");

          // CARTO's Positron GL style is served keyless; the free-tier key
          // (5M tiles/month) is attached per-request below because the style
          // pulls tiles/sprites/glyphs from separate hosts. Keyless still
          // renders — degradation is graceful, never a broken map.
          const cartoKey = process.env.NEXT_PUBLIC_CARTO_BASEMAPS_KEY;

          let map;
          try {
            map = new maplibregl.Map({
              container: mapRef.current,
              style:
                "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
              center: [2.347, 48.857],
              zoom: 12,
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
            // Leave the container's #f4f4f5 ground showing.
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
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      if (observer) observer.disconnect();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // isolation traps MapLibre's internal z-indexes (canvas, marker and control
  // layers) in their own stacking context — without it they paint over the
  // mobile nav (sticky z-50) while the map scrolls beneath it.
  return (
    <div
      ref={mapRef}
      style={{
        height: "480px",
        width: "100%",
        background: "#f4f4f5",
        isolation: "isolate",
      }}
    />
  );
}
