"use client";

import { useEffect, useRef } from "react";

export default function ParisMap({ products = [] }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);

  const STORES = [
    {
      name: "Dolce Vita Hub",
      location: "11th arr.",
      lat: 48.8574,
      lng: 2.3756,
    },
    {
      name: "L'OBSCUR",
      location: "Le Marais",
      lat: 48.8621,
      lng: 2.3543,
    },
    {
      name: "Nuovo Paris",
      location: "Le Marais",
      lat: 48.8609,
      lng: 2.3601,
    },
    {
      name: "at dawn paris",
      location: "Le Marais",
      lat: 48.8626,
      lng: 2.3574,
    },
    {
      name: "Numero 13 Vintage",
      location: "Le Marais",
      lat: 48.8601,
      lng: 2.3589,
    },
    {
      name: "Les Archives Paris",
      location: "Saint-Germain",
      lat: 48.8502,
      lng: 2.3278,
    },
  ];

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

      STORES.forEach((store) => {
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
          `<div style="font-family:monospace;font-size:11px;line-height:1.6;background:#0a0a0a;color:#e4e4e7;border:1px solid #3f3f46;padding:8px 12px;border-radius:0;">
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

