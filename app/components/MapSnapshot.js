import {
  MAP_HEIGHT_PX,
  SNAPSHOT_HEIGHT,
  SNAPSHOT_SRC,
  SNAPSHOT_WIDTH,
  lngLatToCenterOffsetPx,
} from "../lib/mapView.js";

// The pre-rendered basemap that stands in for the live map until MapLibre is
// ready. Deliberately a plain, hook-free component so it can render inside the
// server-rendered Suspense fallback in app/page.js as well as inside ParisMap:
// the section's store fetch races a 4s timeout, and this image must not wait
// behind it.
//
// The image is a CARTO/OSM basemap render. Primary license compliance is the
// credit baked INTO the image by scripts/generate-map-snapshot.mjs (CARTO's
// static-image clause requires it legible in the image itself); the linked
// overlay below adds the clickable credit in the live map's own position and
// styling, and is occluded by the live map's AttributionControl on reveal — so
// the credit is never duplicated and never missing, including on the failure
// path where the snapshot stays as the final experience.
export default function MapSnapshot({ stores = [], occluded = false }) {
  return (
    <div
      // Once the live map has faded in this whole layer is painted over;
      // hiding it from a11y stops the duplicate attribution links.
      aria-hidden={occluded ? "true" : undefined}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element --
          deliberately NOT next/image: the asset is a hand-optimized static
          WebP, and routing it through /_next/image adds a server round-trip
          to the one request that exists to be instant. */}
      <img
        src={SNAPSHOT_SRC}
        alt=""
        width={SNAPSHOT_WIDTH}
        height={SNAPSHOT_HEIGHT}
        // NOT lazy: ParisMap (and its IntersectionObserver) can stream in up
        // to 4s late, and lazy heuristics are non-deterministic — a fast
        // scroll would reach the section before the image and reintroduce the
        // blank box. NOT priority/preloaded either: `eager` + low fetch
        // priority starts the request deterministically with the document
        // while still yielding bandwidth to the hero/LCP resources.
        loading="eager"
        fetchPriority="low"
        decoding="async"
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          // The live map centers its camera in the container; cover-centering
          // the wide render anchors the snapshot on the same point, so the two
          // stay pixel-aligned at any width.
          objectPosition: "center",
        }}
      />

      {stores.map((store) => {
        const { dx, dy } = lngLatToCenterOffsetPx(store.lng, store.lat);
        return (
          <div
            key={`${store.name}-${store.lat}-${store.lng}`}
            aria-hidden="true"
            style={{
              position: "absolute",
              left: `calc(50% + ${dx.toFixed(2)}px)`,
              top: `calc(50% + ${dy.toFixed(2)}px)`,
              transform: "translate(-50%, -50%)",
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: "#0a0a0a",
              border: "1px solid #0a0a0a",
              opacity: 0.9,
            }}
          />
        );
      })}

      {/* Same dev-only carve-out as the live map's AttributionControl: hidden
          while iterating locally, always present in any production build. */}
      {process.env.NODE_ENV === "production" ? (
        <div className="depot-map-attrib">
          {"© "}
          <a
            href="https://carto.com/about-carto/"
            target="_blank"
            rel="noopener noreferrer"
          >
            CARTO
          </a>
          {", © "}
          <a
            href="http://www.openstreetmap.org/about/"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenStreetMap
          </a>
          {" contributors"}
        </div>
      ) : null}
    </div>
  );
}

// Exported so ParisMap and the Suspense placeholder can't drift on the box.
export const MAP_BOX_STYLE = {
  position: "relative",
  height: `${MAP_HEIGHT_PX}px`,
  width: "100%",
  background: "#f4f4f5",
  // isolation traps MapLibre's internal z-indexes (canvas, marker and control
  // layers) in their own stacking context — without it they paint over the
  // mobile nav (sticky z-50) while the map scrolls beneath it.
  isolation: "isolate",
};
