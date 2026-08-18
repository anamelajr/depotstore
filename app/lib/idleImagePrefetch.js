"use client";

// Shared idle-time prefetcher for hover (second) images.
//
// The hover <img> mounts only on the first real pointerenter, so its CDN fetch
// starts with zero lead time — the user is already hovering when the request
// begins, and a cold Shopify derivative visibly lags. This warms the HTTP cache
// for cards that are actually on screen, during idle time, so the mount becomes
// a cache hit.
//
// It is deliberately much cheaper than priming every card at mount (the design
// rejected in docs/plans/feed-image-loading-perf.md): viewport-visible only,
// after the card's primary image finished, after window `load`, behind an idle
// callback, capped at MAX_IN_FLIGHT, skipped entirely on save-data/2g and on
// touch devices (the caller's hoverCapable gate).

const MAX_IN_FLIGHT = 3;
const IDLE_TIMEOUT_MS = 1500;
const IDLE_FALLBACK_MS = 300;

// key → "queued" | "running" | "done". Dedupe applies from the moment of
// SCHEDULING, not completion, so two same-key cards can't double-queue.
const jobs = new Map();
// Parallel map of key → job payload for everything still queued.
const queue = new Map();

let inFlight = 0;
let drainScheduled = false;
let pageLoaded = false;
let loadListenerAttached = false;

// Key on `src` AND `sizes`: with a srcSet the fetched candidate is selected
// from viewport/DPR/`sizes`, so the same image on a surface with different
// `sizes` (feed 33vw vs MoreFromStore 25vw) is a different byte request and
// needs its own prefetch. Keying on bare `src` would suppress it and leave
// that surface's first hover cold. DPR/resize drift between prefetch and hover
// remains an accepted miss — it just falls back to today's behavior.
function keyFor(src, sizes) {
  return `${src}|${sizes ?? ""}`;
}

function saveDataDisabled() {
  if (typeof navigator === "undefined") return false;
  const c = navigator.connection;
  if (!c) return false;
  return Boolean(c.saveData) || /2g/.test(c.effectiveType || "");
}

// The drain must not start before window `load`. Per-card "primary finished"
// only proves ONE primary finished — a small card can complete while the real
// LCP image is still transferring — and requestIdleCallback measures CPU
// idleness, not network idleness. LCP is only measured on hard loads, where
// this gate holds the whole drain out of the LCP window; soft navs are already
// post-load and pay nothing.
// The drain must not start before window `load`. Per-card "primary finished"
// only proves ONE primary finished — a small card can complete while the real
// LCP image is still transferring — and requestIdleCallback measures CPU
// idleness, not network idleness. LCP is only measured on hard loads, where
// this gate holds the whole drain out of the LCP window; soft navs are already
// post-load and pay nothing.
function armLoadGate() {
  if (typeof document === "undefined") return;
  if (document.readyState === "complete") {
    pageLoaded = true;
    return;
  }
  if (loadListenerAttached) return;
  loadListenerAttached = true;
  window.addEventListener(
    "load",
    () => {
      pageLoaded = true;
      scheduleDrain();
    },
    { once: true },
  );
}

// Resolved per call, not at module load: Safari has no requestIdleCallback.
function requestIdle(cb) {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(cb, { timeout: IDLE_TIMEOUT_MS });
    return;
  }
  setTimeout(cb, IDLE_FALLBACK_MS); // Safari
}

function scheduleDrain() {
  if (queue.size === 0 || inFlight >= MAX_IN_FLIGHT) return;
  if (!pageLoaded) {
    // The listener re-enters scheduleDrain once `load` fires.
    armLoadGate();
    if (!pageLoaded) return;
  }
  if (drainScheduled) return;
  drainScheduled = true;
  requestIdle(() => {
    drainScheduled = false;
    drain();
  });
}

function drain() {
  for (const [key, job] of queue) {
    if (inFlight >= MAX_IN_FLIGHT) break;
    queue.delete(key);
    start(key, job);
  }
  if (queue.size > 0) scheduleDrain();
}

function start(key, { src, srcSet, sizes }) {
  jobs.set(key, "running");
  inFlight += 1;

  const finish = () => {
    // load AND error both mark done: never retry a dead URL. The mounted img's
    // own onError display-none path already handles the visual side.
    jobs.set(key, "done");
    inFlight -= 1;
    scheduleDrain();
  };

  const img = new Image();
  img.decoding = "async";
  img.fetchPriority = "low";
  img.onload = finish;
  img.onerror = finish;
  // Order matters for the cache-hit guarantee: `sizes` before `srcset` before
  // `src`, with byte-identical strings to what the mounted hover <img> will
  // carry, so the browser's candidate selection warms exactly the URL the real
  // element will request.
  if (sizes) img.sizes = sizes;
  if (srcSet) img.srcset = srcSet;
  img.src = src;
}

const NOOP = () => {};

// Returns an idempotent cancel. Cancel only removes a still-QUEUED job (and
// clears its key so a later re-entry can reschedule); a running fetch is never
// aborted — it finishes and marks done.
export function schedulePrefetch({ src, srcSet, sizes } = {}) {
  if (typeof window === "undefined" || !src) return NOOP;
  if (saveDataDisabled()) return NOOP;

  const key = keyFor(src, sizes);
  if (jobs.has(key)) return NOOP; // queued, running, or done — all no-ops

  jobs.set(key, "queued");
  queue.set(key, { src, srcSet, sizes });
  scheduleDrain();

  let cancelled = false;
  return () => {
    if (cancelled) return;
    cancelled = true;
    if (jobs.get(key) !== "queued") return;
    jobs.delete(key);
    queue.delete(key);
  };
}

// Test-only: reset module state between cases.
export function __resetIdleImagePrefetch() {
  jobs.clear();
  queue.clear();
  inFlight = 0;
  drainScheduled = false;
  pageLoaded = false;
  loadListenerAttached = false;
}
