"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { saveDataDisabled } from "../lib/idleImagePrefetch.js";

// One shared owner for every link that points at a product page.
//
// Hovering a card warms BOTH halves of the click: the route's RSC payload
// (router.prefetch with kind "full" — the real render, not just the loading
// skeleton a default prefetch warms) and the hero image the PDP will request.
// Without this a click waits on store-gate -> (Shopify fetch || Supabase row)
// with nothing in flight.
//
// HoverSwapImage's own pointer handlers are deliberately left alone: that
// component swaps the card's second photo, a different concern that happens to
// fire on the same event.

// ── THE TUNABLE DIAL ──
// Cursor must rest this long before we spend anything. Raise toward 250-300ms
// if Vercel invocations or OpenAI spend look high; lower toward 150ms for
// snappier prefetch. A full prefetch runs the real page render, so an
// undescribed product generates its description here — see the plan's
// trade-off note. This is the throttle for that.
export const HOVER_PREFETCH_REST_MS = 200;

// Segment-cache entries for dynamic routes live at least 30s (the server's
// stale-time header is clamped to a 30s minimum). Re-prefetching a shade
// earlier keeps a lingering cursor warm without re-firing every hover.
const REPREFETCH_AFTER_MS = 25_000;

// Module-scope, not component state: cards unmount and remount constantly
// (scroll restore, filter changes) and per-instance state would re-fire a
// prefetch the browser already paid for.
const prefetchedAt = new Map();
const warmedImages = new Set();

function shouldPrefetchRoute(href) {
  const last = prefetchedAt.get(href);
  return last === undefined || Date.now() - last >= REPREFETCH_AFTER_MS;
}

// Off-DOM warm of the exact candidate the PDP hero will select. Assignment
// order matters: `sizes` before `srcset` before `src`, so the selection
// algorithm runs once with the full contract rather than firing a bare-src
// fetch first.
function warmHeroImage(heroImage) {
  if (!heroImage?.src) return;
  const key = `${heroImage.src}|${heroImage.sizes ?? ""}`;
  if (warmedImages.has(key)) return;
  warmedImages.add(key);
  const img = new Image();
  if (heroImage.sizes) img.sizes = heroImage.sizes;
  if (heroImage.srcSet) img.srcset = heroImage.srcSet;
  img.src = heroImage.src;
}

export default function PrefetchLink({ href, heroImage, children, ...rest }) {
  const router = useRouter();
  const timerRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // A card can unmount mid-rest (filter change, scroll restore) — without this
  // the timer still fires and spends on a page the user can no longer click.
  useEffect(() => clear, [clear]);

  const onPointerEnter = useCallback(
    (e) => {
      // Touch has no hover: a tap fires pointerenter immediately before the
      // click, so prefetching there is pure duplicate work on the connection
      // least able to afford it.
      if (e.pointerType === "touch") return;
      if (saveDataDisabled()) return;
      clear();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (shouldPrefetchRoute(href)) {
          prefetchedAt.set(href, Date.now());
          // "full" fetches the real dynamic render. The default kind warms
          // only the static shell — i.e. the loading skeleton — which is
          // exactly the part that was never slow.
          router.prefetch(href, { kind: "full" });
        }
        // No idle queue for the image: unlike the viewport prefetch in
        // idleImagePrefetch, a rested cursor is strong intent and the fetch
        // is racing a click that may be milliseconds away.
        warmHeroImage(heroImage);
      }, HOVER_PREFETCH_REST_MS);
    },
    [clear, href, heroImage, router],
  );

  return (
    <Link href={href} onPointerEnter={onPointerEnter} onPointerLeave={clear} {...rest}>
      {children}
    </Link>
  );
}
