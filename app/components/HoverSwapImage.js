"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHoverCapable } from "../lib/useHoverCapable.js";
import { shopifyImageUrl, shopifySrcSet } from "../lib/shopifyImage.js";
import { schedulePrefetch } from "../lib/idleImagePrefetch.js";

// Single home for the hover-swap behavior so it works identically under all
// four cards regardless of their server/client status. The three Server
// Component cards render this child instead of calling the hook directly.
//
// width defaults to 800: crisp at the ~400px card these surfaces render on a
// 2× retina display, while letting Shopify's CDN serve a right-sized image
// instead of the multi-MB master.
//
// sizes is opt-in: callers whose cards render larger than that (e.g. the
// near-full-width feed grid) pass it to get a srcSet of wider derivatives so
// retina displays don't upscale the 800px default. Omitted, behavior is
// byte-identical to a plain width=800 request. The candidate list runs down to
// 400w because a 2-col mobile card at 50vw / 2× DPR wants ~400px — it used to
// start at 800w, forcing phones to download twice the pixels they can show.

// Shared predicate for "this is a canonical Shopify CDN URL we can append a
// resize width to". Type-tolerant like shopifyImageUrl: callers hand us
// whatever the row carried, so a bare .startsWith would throw on non-strings.
function isShopifyCdnUrl(url) {
  return typeof url === "string" && url.startsWith("https://cdn.shopify.com/");
}

// The ladder lives in shopifyImage.js and is shared with the PDP hero (see
// pdpSlide1SrcSet). That identity is load-bearing, not cosmetic: a feed card
// and the product page it links to only share a cached download when their
// candidate lists match rung-for-rung, so this must never fork back into a
// local array.
const srcSetFor = shopifySrcSet;

// priority is tri-state: false | "eager" | "high".
//   false   — lazy, normal fetch priority (every below-the-fold card).
//   "eager" — opts out of lazy loading only; the fetch still queues normally.
//   "high"  — eager + fetchPriority=high, reserved for the plausible LCP
//             candidates. Marking many images high dilutes the real LCP's
//             bandwidth share: equal-priority derivatives race each other and
//             the one that becomes LCP finishes later.
export default function HoverSwapImage({ imageUrl, imageUrl2, alt, width = 800, sizes, priority = false }) {
  const hoverCapable = useHoverCapable();
  // The hover image used to mount at hydration on every desktop card — ~30
  // extra CDN requests per feed page for an image most visitors never see.
  // It now waits for a real pointerenter (see the effect below). Its BYTES are
  // warmed earlier though: once the card's own primary image has finished and
  // the card is in the viewport, an idle-time off-DOM prefetch
  // (idleImagePrefetch.js) fetches the exact URL the hover <img> will request,
  // so the pointerenter mount hits the HTTP cache. Lifecycle: primary loads →
  // primaryDone → in viewport → idle prefetch → pointerenter mounts →
  // crossfade.
  const [primed, setPrimed] = useState(false);
  // Priority images start visible: their whole point is that the SSR HTML
  // paints them, so the LCP must not wait on hydration to clear opacity-0.
  const [loaded, setLoaded] = useState(Boolean(priority));
  const [loaded2, setLoaded2] = useState(false);
  // "The primary image actually finished" — deliberately NOT `loaded`, which
  // starts true for priority cards (see above) so the hover-image prefetch
  // would queue inside the LCP window for the very cards that carry the LCP.
  const [primaryDone, setPrimaryDone] = useState(false);
  const hoverTargetRef = useRef(null);

  // hoverCapable gate is the PRIMARY desktop-only mechanism: mobile/touch
  // never mounts the second <img>, so it never fetches image_url_2.
  const showSecond = hoverCapable && primed && imageUrl2 && imageUrl2 !== imageUrl;
  const srcSet = sizes ? srcSetFor(imageUrl) : undefined;
  const srcSet2 = sizes ? srcSetFor(imageUrl2) : undefined;

  // Listen on the aspect wrapper (the primary img's parent), not the img:
  // the SOLD overlay and the link layer sit above the image and would
  // otherwise swallow the event. Captured through the ref callback below so
  // callers keep the same API — no wrapper ref to thread through.
  useEffect(() => {
    const el = hoverTargetRef.current;
    if (!el) return;
    const onEnter = () => setPrimed(true);
    el.addEventListener("pointerenter", onEnter, { once: true });
    return () => el.removeEventListener("pointerenter", onEnter);
  }, []);

  const primaryRef = useCallback((el) => {
    if (!el) return;
    hoverTargetRef.current = el.parentElement;
    // Images already in the HTTP cache decode before React attaches onLoad,
    // so the event never fires and the fade would be stuck at opacity-0.
    if (el.complete && el.naturalWidth > 0) {
      setLoaded(true);
      setPrimaryDone(true);
    }
  }, []);

  // ── Idle prefetch of the hover image ──
  // The hover <img> still mounts on pointerenter (below); this only warms the
  // HTTP cache ahead of it, so that mount becomes a cache-hit decode instead
  // of a cold CDN round-trip the user is already waiting on.
  //
  // Schedule on intersect, cancel on un-intersect — the scheduler's job map
  // makes that race-free with no local bookkeeping: cancel only dequeues a
  // still-queued job (bounding fast-fling waste on restored 600-card grids)
  // and is a no-op once running; re-entry after a cancel reschedules because
  // cancel cleared the key; re-entry after completion is a no-op via the done
  // state, including across remounts (scroll restore).
  useEffect(() => {
    if (!hoverCapable || !primaryDone || primed) return;
    if (!imageUrl2 || imageUrl2 === imageUrl) return;
    // The aspect wrapper, not the img: it still has layout under a
    // `content-visibility: auto` ancestor.
    const el = hoverTargetRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    let cancel = null;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          cancel = schedulePrefetch({
            src: shopifyImageUrl(imageUrl2, width),
            srcSet: srcSet2,
            sizes: srcSet2 ? sizes : undefined,
          });
        } else if (cancel) {
          cancel();
          cancel = null;
        }
      }
    });
    observer.observe(el);
    return () => {
      if (cancel) cancel();
      observer.disconnect();
    };
  }, [hoverCapable, primaryDone, primed, imageUrl2, imageUrl, width, srcSet2, sizes]);

  const hoverRef = useCallback((el) => {
    if (el && el.complete && el.naturalWidth > 0) setLoaded2(true);
  }, []);

  return (
    <>
      {/* Blur-up placeholder, ~1KB. Deliberately an <img> and not a CSS
          background: backgrounds aren't lazy-loaded, so a restored 600-card
          grid would fetch every one of them. As a lazy img it rides the same
          viewport machinery as the photo it stands in for.

          Priority cards get NO placeholder — six extra requests inside the
          LCP-critical window (any of which could miss Shopify's derivative
          cache) is a worse trade than a beat of grey, and those images start
          at opacity-100 anyway. Non-Shopify hosts get none either, so the
          caller's own bg-zinc-100 shows through exactly as it does today. */}
      {!priority && isShopifyCdnUrl(imageUrl) ? (
        <img
          src={shopifyImageUrl(imageUrl, 20)}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          // scale-110 pushes the blur's transparent halo past the edges; the
          // wrapper's overflow-hidden clips it back.
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-md"
        />
      ) : null}
      <img
        ref={primaryRef}
        src={shopifyImageUrl(imageUrl, width)}
        srcSet={srcSet}
        sizes={srcSet ? sizes : undefined}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority === "high" ? "high" : undefined}
        decoding="async"
        // onError also clears the gate: a dead URL degrades to today's
        // broken-image-over-grey rather than freezing on the blur.
        onLoad={() => { setLoaded(true); setPrimaryDone(true); }}
        onError={() => { setLoaded(true); setPrimaryDone(true); }}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ease-out ${loaded ? "opacity-100" : "opacity-0"}`}
      />
      {showSecond ? (
        <img
          ref={hoverRef}
          src={shopifyImageUrl(imageUrl2, width)}
          srcSet={srcSet2}
          sizes={srcSet2 ? sizes : undefined}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          onLoad={() => setLoaded2(true)}
          // onError hides a stale/404 image 2 outright so image 1 (the base
          // layer underneath) shows through unchanged on hover. DOM-node hide
          // is fine: the node is recreated on each remount.
          onError={(e) => { e.currentTarget.style.display = "none"; }}
          // CSS variant is the secondary/visual gate for the crossfade. It's
          // withheld until the image has actually decoded: because the node
          // now mounts on the pointerenter that also triggers :hover, an
          // ungated variant would snap a half-painted image in on first hover.
          className={`absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-[350ms] ease-out${loaded2 ? " [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100" : ""}`}
        />
      ) : null}
    </>
  );
}
