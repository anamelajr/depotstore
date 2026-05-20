"use client";

import { useEffect, useRef } from "react";

export default function ParisMap({ products = [], stores = [] }) {
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

  useEffect(() => {
    if (mapInstanceRef.current) return;

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
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          attribution: "© CartoDB",
        }
      ).addTo(map);

      // Compute piece counts from products prop
      const counts = {};
      for (const p of products) {
        if (p?.storeName) counts[p.storeName] = (counts[p.storeName] ?? 0) + 1;
      }

      mapStores.forEach((store) => {
        const count = counts[store.name] ?? 0;
        const circle = L.circleMarker([store.lat, store.lng], {
          radius: 6,
          fillColor: "#ffffff",
          color: "#ffffff",
          weight: 1,
          opacity: 0.9,
          fillOpacity: 0.9,
        }).addTo(map);

        circle.bindTooltip(
          `<div style="font-family:var(--font-serif),sans-serif;font-size:11px;line-height:1.6;background:#0a0a0a;color:#e4e4e7;border:1px solid #3f3f46;padding:8px 12px;border-radius:0;">
            <strong style="font-size:12px;">${store.name}</strong><br/>
            ${store.location}<br/>
            <span style="color:#71717a">${count} pcs</span>
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
      width:32px;height:32px;background:#0a0a0a;color:#a1a1aa;
      border:1px solid #3f3f46;display:flex;align-items:center;
      justify-content:center;cursor:pointer;font-family:var(--font-serif),sans-serif;
      font-size:16px;line-height:1;transition:color 0.2s,border-color 0.2s;
    `;

          const zoomIn = L.DomUtil.create("button", "", container);
          zoomIn.innerHTML = "+";
          zoomIn.style.cssText = btnStyle;
          zoomIn.onmouseover = () => {
            zoomIn.style.color = "#fff";
            zoomIn.style.borderColor = "#71717a";
          };
          zoomIn.onmouseout = () => {
            zoomIn.style.color = "#a1a1aa";
            zoomIn.style.borderColor = "#3f3f46";
          };
          L.DomEvent.on(zoomIn, "click", (e) => {
            L.DomEvent.stopPropagation(e);
            map.zoomIn();
          });

          const zoomOut = L.DomUtil.create("button", "", container);
          zoomOut.innerHTML = "−";
          zoomOut.style.cssText = btnStyle;
          zoomOut.onmouseover = () => {
            zoomOut.style.color = "#fff";
            zoomOut.style.borderColor = "#71717a";
          };
          zoomOut.onmouseout = () => {
            zoomOut.style.color = "#a1a1aa";
            zoomOut.style.borderColor = "#3f3f46";
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

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={mapRef}
      style={{ height: "480px", width: "100%", background: "#0a0a0a" }}
    />
  );
}

