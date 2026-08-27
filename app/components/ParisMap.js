"use client";

import { useEffect, useRef } from "react";

export default function ParisMap({ stores = [] }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);

  const mapStores = stores
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({
      name: s.storeName,
      location: s.location || "",
      lat: s.lat,
      lng: s.lng,
    }));

  // MapLibre + its CSS + the OpenFreeMap vector tiles are a large
  // below-the-fold payload that used to load on every homepage hydration,
  // competing with the above-the-fold work for bandwidth on a map most
  // visitors never scroll to. Gate the dynamic import on a one-shot
  // IntersectionObserver with a generous 400px margin, so the map is still
  // ready by the time it's actually on screen. mapInstanceRef stays the init
  // guard (StrictMode double-effect, remounts); the observer only decides
  // *when*.
  useEffect(() => {
    if (mapInstanceRef.current) return;
    const el = mapRef.current;
    if (!el) return;

    let observer = null;
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

    // Positron restyled into the site's editorial palette: every label,
    // boundary and icon layer dropped, fills flattened onto the #f4f4f5
    // ground, streets as white threads, the Seine one shade darker. The
    // transform keys off layer *type* plus id substrings so minor upstream
    // id churn degrades to "slightly off shade", never to a broken style.
    function toDepotStyle(style) {
      const WATER = "#d6d6da";
      const GROUND = "#f4f4f5";
      const GREEN = "#ededee";
      const ROAD = "#ffffff";
      const RAIL = "#e8e8ea";
      style.layers = style.layers
        .filter((l) => l.type !== "symbol")
        .filter((l) => !/boundary|admin/.test(l.id))
        .map((l) => {
          const layer = { ...l, paint: { ...(l.paint || {}) } };
          const isWater = /water|river|ocean/.test(l.id);
          if (l.type === "background") {
            layer.paint["background-color"] = GROUND;
          } else if (l.type === "fill") {
            layer.paint["fill-color"] = isWater
              ? WATER
              : /green|park|wood|grass|cemetery|landcover/.test(l.id)
                ? GREEN
                : GROUND;
            delete layer.paint["fill-outline-color"];
          } else if (l.type === "line") {
            layer.paint["line-color"] = isWater
              ? WATER
              : /rail|transit/.test(l.id)
                ? RAIL
                : ROAD;
          }
          return layer;
        });
      return style;
    }

    function loadMap() {
      Promise.all([
        import("maplibre-gl"),
        fetch("https://tiles.openfreemap.org/styles/positron").then((r) => {
          if (!r.ok) throw new Error(`style fetch ${r.status}`);
          return r.json();
        }),
      ]).then(([mod, styleJson]) => {
        import("maplibre-gl/dist/maplibre-gl.css");
        const maplibregl = mod.default ?? mod;

        // MapLibre zoom levels run one lower than Leaflet's for the same
        // extent (512px vs 256px tiles): zoom 12 here ≈ the old Leaflet 13.
        const map = new maplibregl.Map({
          container: mapRef.current,
          style: toDepotStyle(styleJson),
          center: [2.347, 48.857],
          zoom: 12,
          attributionControl: false,
        });
        map.scrollZoom.disable();

        // OSM data is ODbL — attribution must stay discoverable. Collapsed
        // to the bare ⓘ toggle; credits show only on demand.
        const attribution = new maplibregl.AttributionControl({
          compact: true,
        });
        map.addControl(attribution, "bottom-left");
        // The control re-expands itself when style data arrives, so collapse
        // once loading settles rather than synchronously here.
        map.once("idle", () => {
          attribution._container.classList.remove("maplibregl-compact-show");
          attribution._container.removeAttribute("open");
        });

        // The lone label the restyle keeps: "Paris", pinned as a DOM marker
        // at the city-center anchor Positron used, so it needs no glyph
        // layers and always renders in the site's own type.
        const parisLabel = document.createElement("div");
        parisLabel.textContent = "Paris";
        parisLabel.style.cssText =
          "font-family:var(--font-general-sans),sans-serif;font-size:17px;font-weight:600;color:#0a0a0a;letter-spacing:0.02em;pointer-events:none;user-select:none;";
        new maplibregl.Marker({ element: parisLabel })
          .setLngLat([2.3522, 48.8566])
          .addTo(map);

        mapStores.forEach((store) => {
          const dot = document.createElement("div");
          dot.style.cssText =
            "width:12px;height:12px;border-radius:50%;background:#0a0a0a;border:1px solid #0a0a0a;opacity:0.9;cursor:pointer;";

          const popup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 12,
            anchor: "bottom",
            className: "depot-tooltip",
          }).setHTML(
            `<div style="font-family:var(--font-general-sans),sans-serif;font-size:11px;line-height:1.6;background:#ffffff;color:#3f3f46;border:1px solid #d4d4d8;padding:8px 12px;border-radius:0;">
              <strong style="font-size:12px;">${store.name}</strong><br/>
              ${store.location}
            </div>`
          );

          const marker = new maplibregl.Marker({ element: dot })
            .setLngLat([store.lng, store.lat])
            .addTo(map);

          dot.addEventListener("mouseenter", () => {
            popup.setLngLat(marker.getLngLat()).addTo(map);
          });
          dot.addEventListener("mouseleave", () => {
            popup.remove();
          });
        });

        // Custom zoom control
        const buildZoomControl = () => {
          const container = document.createElement("div");
          // The maplibregl-ctrl class is what restores pointer-events inside
          // the control corner (the corner itself is pointer-events:none).
          container.className = "maplibregl-ctrl";
          container.style.cssText = "display:flex;flex-direction:column;gap:1px;";

          const btnStyle = `
        width:32px;height:32px;background:#ffffff;color:#71717a;
        border:1px solid #d4d4d8;display:flex;align-items:center;
        justify-content:center;cursor:pointer;font-family:var(--font-general-sans),sans-serif;
        font-size:16px;line-height:1;transition:color 0.2s,border-color 0.2s;
      `;

          const makeButton = (label, onClick) => {
            const btn = document.createElement("button");
            btn.innerHTML = label;
            btn.style.cssText = btnStyle;
            btn.onmouseover = () => {
              btn.style.color = "#0a0a0a";
              btn.style.borderColor = "#71717a";
            };
            btn.onmouseout = () => {
              btn.style.color = "#71717a";
              btn.style.borderColor = "#d4d4d8";
            };
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              onClick();
            });
            container.appendChild(btn);
            return btn;
          };

          makeButton("+", () => map.zoomIn());
          makeButton("−", () => map.zoomOut());

          return {
            onAdd: () => container,
            onRemove: () => container.remove(),
          };
        };

        map.addControl(buildZoomControl(), "bottom-right");

        mapInstanceRef.current = map;
      });
    }

    return () => {
      if (observer) observer.disconnect();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // isolation traps MapLibre's internal z-indexes (markers, popups, control
  // corners) in their own stacking context — without it they paint over the
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
