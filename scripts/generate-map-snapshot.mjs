#!/usr/bin/env node
/**
 * Generates public/paris-map-snapshot.webp — the static basemap shown instantly
 * under the Paris map while MapLibre boots, and left as the final experience
 * when the live map can't load.
 *
 * Dev-only, run by hand:
 *
 *   NEXT_PUBLIC_CARTO_BASEMAPS_KEY=… node scripts/generate-map-snapshot.mjs
 *
 * RE-RUN IT WHEN:
 *   - MAP_CENTER / MAP_ZOOM change in app/lib/mapView.js
 *   - MAP_STYLE_URL changes
 *   - the cross-fade develops a visible jump
 *
 * That last case is the one to watch: CARTO can update the Positron style and
 * its tiles remotely with no code change here, so the checked-in snapshot can
 * drift out of sync on its own. That's an accepted risk handled by manual
 * regeneration — the divergence is cosmetic and masked by the cross-fade, so
 * pinning or self-hosting the style is not worth it.
 *
 * LICENSE (CARTO Basemap Terms):
 *   - The key is REQUIRED here and the script refuses to run without it. CARTO
 *     may watermark tiles served to keyless requests, and a watermarked asset
 *     must never be checked in. (The LIVE map's keyless path is unaffected:
 *     runtime keyless rendering is permitted, merely watermarkable.)
 *   - A legible "© CARTO © OpenStreetMap contributors" credit is baked INTO
 *     the image, inside the central safe zone so no `object-fit: cover` crop
 *     at any viewport width can remove it. CARTO's terms permit static images
 *     only when attribution is legible in the image itself.
 */

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { chromium } from "playwright";

import {
  MAP_CENTER,
  MAP_STYLE_URL,
  MAP_ZOOM,
  SNAPSHOT_HEIGHT,
  SNAPSHOT_WIDTH,
} from "../app/lib/mapView.js";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "paris-map-snapshot.webp");

// @2x so the asset stays crisp on the retina phones this targets.
const DEVICE_SCALE = 2;
// Keeps the credit inside the narrowest plausible cover-crop of a 1600px-wide
// render, so it survives at every viewport width.
const SAFE_ZONE_PX = 350;
const TARGET_BYTES = 150 * 1024;

const cartoKey = process.env.NEXT_PUBLIC_CARTO_BASEMAPS_KEY;
if (!cartoKey) {
  console.error(
    "[map-snapshot] NEXT_PUBLIC_CARTO_BASEMAPS_KEY is unset.\n" +
      "Refusing to render: CARTO may watermark keyless tiles, and a\n" +
      "watermarked snapshot must never be checked in.",
  );
  process.exit(1);
}

const page = (maplibreJs, maplibreCss) => `<!doctype html>
<meta charset="utf-8">
<style>
  ${maplibreCss}
  html, body { margin: 0; padding: 0; background: #f4f4f5; }
  #map { width: ${SNAPSHOT_WIDTH}px; height: ${SNAPSHOT_HEIGHT}px; position: relative; }
  /* Baked-in credit — matches the live map's whisper styling, but kept a
     touch more legible because the terms require it readable in the image. */
  #credit {
    position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%);
    max-width: ${SAFE_ZONE_PX}px; text-align: center; z-index: 5;
    font: 8px/1 -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: #a1a1aa; white-space: nowrap;
  }
</style>
<div id="map"><div id="credit">© CARTO © OpenStreetMap contributors</div></div>
<script>${maplibreJs}</script>
<script>
  const key = ${JSON.stringify(cartoKey)};
  const map = new maplibregl.Map({
    container: "map",
    style: ${JSON.stringify(MAP_STYLE_URL)},
    center: ${JSON.stringify(MAP_CENTER)},
    zoom: ${JSON.stringify(MAP_ZOOM)},
    interactive: false,
    attributionControl: false,
    preserveDrawingBuffer: true,
    fadeDuration: 0,
    transformRequest: (url) => {
      try {
        const u = new URL(url);
        if (u.hostname.endsWith("basemaps.cartocdn.com")) {
          u.searchParams.set("key", key);
          return { url: u.toString() };
        }
      } catch {}
      return { url };
    },
  });
  map.on("idle", () => { window.__mapIdle_done = true; });
  map.on("error", (e) => { window.__mapError = String(e && e.error && e.error.message || e); });
</script>`;

async function main() {
  const [maplibreJs, maplibreCss] = await Promise.all([
    readFile(require.resolve("maplibre-gl/dist/maplibre-gl.js"), "utf8"),
    readFile(require.resolve("maplibre-gl/dist/maplibre-gl.css"), "utf8"),
  ]);

  // Served over http rather than page.setContent: an about:blank origin makes
  // the cross-origin CARTO fetches behave differently from the real site.
  const html = page(maplibreJs, maplibreCss);
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--enable-unsafe-swiftshader"],
  });
  try {
    const ctx = await browser.newContext({
      viewport: { width: SNAPSHOT_WIDTH, height: SNAPSHOT_HEIGHT },
      deviceScaleFactor: DEVICE_SCALE,
    });
    const tab = await ctx.newPage();
    await tab.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    // Race idle against any recorded MapLibre error and a hard deadline —
    // awaiting __mapIdle alone would hang forever on a bad key or network
    // outage, and this script's contract is to fail loudly.
    const outcome = await tab.waitForFunction(
      "window.__mapError ? 'error' : window.__mapIdle_done ? 'idle' : false",
      { timeout: 120000 },
    );
    if ((await outcome.jsonValue()) === "error") {
      const err = await tab.evaluate("window.__mapError");
      throw new Error(`MapLibre reported an error: ${err}`);
    }
    // A beat past "idle" so the last symbol/label raster settles.
    await tab.waitForTimeout(750);

    const png = await tab.locator("#map").screenshot({ type: "png" });

    const webp = await sharp(png).webp({ quality: 82, effort: 6 }).toBuffer();
    await writeFile(OUT, webp);

    const meta = await sharp(webp).metadata();
    const kb = (webp.length / 1024).toFixed(1);
    console.log(
      `[map-snapshot] wrote ${path.relative(ROOT, OUT)} — ` +
        `${meta.width}×${meta.height}, ${kb}KB`,
    );
    if (webp.length > TARGET_BYTES) {
      console.warn(
        `[map-snapshot] over the ~${TARGET_BYTES / 1024}KB target — ` +
          "consider lowering quality or dropping to 1x.",
      );
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error("[map-snapshot]", err);
  process.exit(1);
});
