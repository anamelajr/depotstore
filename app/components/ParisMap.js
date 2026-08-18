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

  // Leaflet + its CSS + the CartoDB tiles are a large below-the-fold payload
  // that used to load on every homepage hydration, competing with the
  // above-the-fold work for bandwidth on a map most visitors never scroll to.
  // Gate the dynamic import on a one-shot IntersectionObserver with a generous
  // 400px margin, so the map is still ready by the time it's actually on
  // screen. mapInstanceRef stays the init guard (StrictMode double-effect,
  // remounts); the observer only decides *when*.
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

    function loadMap() {
      import("leaflet").then((L) => {
        import("leaflet/dist/leaflet.css");

        const map = L.map(mapRef.current, {
          center: [48.857, 2.347],
          zoom: 13,
          zoomControl: false,
          scrollWheelZoom: false,
          attributionControl: false,
        });

        L.tileLayer(
          "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
          {
            attribution: "© CartoDB",
          }
        ).addTo(map);

        mapStores.forEach((store) => {
          const circle = L.circleMarker([store.lat, store.lng], {
            radius: 6,
            fillColor: "#0a0a0a",
            color: "#0a0a0a",
            weight: 1,
            opacity: 0.9,
            fillOpacity: 0.9,
          }).addTo(map);

          circle.bindTooltip(
            `<div style="font-family:var(--font-general-sans),sans-serif;font-size:11px;line-height:1.6;background:#ffffff;color:#3f3f46;border:1px solid #d4d4d8;padding:8px 12px;border-radius:0;">
              <strong style="font-size:12px;">${store.name}</strong><br/>
              ${store.location}
            </div>`,
            {
              permanent: false,
              direction: "top",
              opacity: 1,
              className: "depot-tooltip",
            }
          );
        });

        // Custom zoom control
        const ZoomControl = L.Control.extend({
          onAdd: function () {
            const container = L.DomUtil.create("div");
            container.style.cssText = "display:flex;flex-direction:column;gap:1px;";

            const btnStyle = `
        width:32px;height:32px;background:#ffffff;color:#71717a;
        border:1px solid #d4d4d8;display:flex;align-items:center;
        justify-content:center;cursor:pointer;font-family:var(--font-general-sans),sans-serif;
        font-size:16px;line-height:1;transition:color 0.2s,border-color 0.2s;
      `;

            const zoomIn = L.DomUtil.create("button", "", container);
            zoomIn.innerHTML = "+";
            zoomIn.style.cssText = btnStyle;
            zoomIn.onmouseover = () => {
              zoomIn.style.color = "#0a0a0a";
              zoomIn.style.borderColor = "#71717a";
            };
            zoomIn.onmouseout = () => {
              zoomIn.style.color = "#71717a";
              zoomIn.style.borderColor = "#d4d4d8";
            };
            L.DomEvent.on(zoomIn, "click", (e) => {
              L.DomEvent.stopPropagation(e);
              map.zoomIn();
            });

            const zoomOut = L.DomUtil.create("button", "", container);
            zoomOut.innerHTML = "−";
            zoomOut.style.cssText = btnStyle;
            zoomOut.onmouseover = () => {
              zoomOut.style.color = "#0a0a0a";
              zoomOut.style.borderColor = "#71717a";
            };
            zoomOut.onmouseout = () => {
              zoomOut.style.color = "#71717a";
              zoomOut.style.borderColor = "#d4d4d8";
            };
            L.DomEvent.on(zoomOut, "click", (e) => {
              L.DomEvent.stopPropagation(e);
              map.zoomOut();
            });

            return container;
          },
        });

        new ZoomControl({ position: "bottomright" }).addTo(map);

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

  // isolation traps Leaflet's internal z-indexes (panes 200–700, control
  // corners 1000) in their own stacking context — without it they paint over
  // the mobile nav (sticky z-50) while the map scrolls beneath it.
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

