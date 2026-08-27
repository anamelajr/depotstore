// Single source of truth for the Paris map's camera and basemap style.
//
// Three consumers must agree on these exactly or the static snapshot stops
// lining up with the live map:
//   - ParisMap.js          (the live MapLibre map)
//   - MapSnapshot.js       (the pre-rendered basemap + its projected dots)
//   - scripts/generate-map-snapshot.mjs (the offline renderer)
// Changing MAP_CENTER, MAP_ZOOM or MAP_STYLE_URL means regenerating
// public/paris-map-snapshot.webp — see the script's header.

export const MAP_CENTER = [2.347, 48.857];
export const MAP_ZOOM = 12;
export const MAP_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export const SNAPSHOT_SRC = "/paris-map-snapshot.webp";
// Rendered far wider than any container so `object-fit: cover` only ever
// crops the sides — one asset serves every viewport width.
export const SNAPSHOT_WIDTH = 1600;
export const SNAPSHOT_HEIGHT = 480;

// The container's fixed height, shared by the live map, the snapshot layer and
// the Suspense placeholder so streaming never shifts layout.
export const MAP_HEIGHT_PX = 480;

// MapLibre renders 512px tiles, so the Web Mercator world at zoom z is
// 512 * 2^z pixels square.
const TILE_SIZE = 512;

function mercatorX(lng) {
  return (lng + 180) / 360;
}

function mercatorY(lat) {
  // Clamped to the Mercator limit: tan() diverges at the poles.
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat));
  const rad = (clamped * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

/**
 * Pixel offset of a lng/lat from the map's center, at MAP_ZOOM.
 *
 * Deliberately center-relative: the returned values are constants, so the
 * snapshot's dots can be placed with `calc(50% + dx)` and stay aligned through
 * any resize or orientation change with zero JS — the same recentering the
 * live map does internally, and the same anchor `object-fit: cover;
 * object-position: center` gives the snapshot image.
 */
export function lngLatToCenterOffsetPx(
  lng,
  lat,
  center = MAP_CENTER,
  zoom = MAP_ZOOM,
) {
  const worldSize = TILE_SIZE * Math.pow(2, zoom);
  return {
    dx: (mercatorX(lng) - mercatorX(center[0])) * worldSize,
    dy: (mercatorY(lat) - mercatorY(center[1])) * worldSize,
  };
}
