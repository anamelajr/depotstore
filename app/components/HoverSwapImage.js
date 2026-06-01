"use client";
import { useHoverCapable } from "../lib/useHoverCapable.js";
import { shopifyImageUrl } from "../lib/shopifyImage.js";

// Single home for the hover-swap behavior so it works identically under all
// four cards regardless of their server/client status. The three Server
// Component cards render this child instead of calling the hook directly.
//
// width defaults to 800: crisp at the ~400px card these surfaces render on a
// 2× retina display, while letting Shopify's CDN serve a right-sized image
// instead of the multi-MB master.
export default function HoverSwapImage({ imageUrl, imageUrl2, alt, width = 800 }) {
  const hoverCapable = useHoverCapable();
  // hoverCapable gate is the PRIMARY desktop-only mechanism: mobile/touch
  // never mounts the second <img>, so it never fetches image_url_2.
  const showSecond = hoverCapable && imageUrl2 && imageUrl2 !== imageUrl;
  return (
    <>
      <img
        src={shopifyImageUrl(imageUrl, width)}
        alt={alt}
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
      />
      {showSecond ? (
        <img
          src={shopifyImageUrl(imageUrl2, width)}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          // onError hides a stale/404 image 2 outright so image 1 (the base
          // layer underneath) shows through unchanged on hover. DOM-node hide
          // is fine: the node is recreated on each remount.
          onError={(e) => { e.currentTarget.style.display = "none"; }}
          // CSS variant is the secondary/visual gate for the crossfade and
          // covers the brief post-hydration window before useEffect runs.
          className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-[350ms] ease-out [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100"
        />
      ) : null}
    </>
  );
}
