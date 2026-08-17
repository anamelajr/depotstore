"use client";

import { useEffect, useRef, useState } from "react";
import { shopifyImageUrl } from "../lib/shopifyImage.js";

// Mobile swipe gallery. Desktop uses DesktopProductGallery — this component
// only ever renders inside the page's `lg:hidden` wrapper.
export default function ProductGallery({ images, alt }) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const scrollRef = useRef(null);
  const slideRefs = useRef([]);
  const containerWidthRef = useRef(0);
  const rafRef = useRef(0);

  // Reset scroll on mount — Next.js navigation from scrolled feed pages
  // sometimes lands mid-page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const hasImages = images && images.length > 0;
  const count = hasImages ? images.length : 0;
  const multiple = count > 1;

  // Clamp selectedIndex if image list shrinks.
  useEffect(() => {
    if (selectedIndex > count - 1) {
      setSelectedIndex(Math.max(0, count - 1));
    }
  }, [count, selectedIndex]);

  // Track slide width via ResizeObserver.
  useEffect(() => {
    if (!multiple) return;
    const el = scrollRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      containerWidthRef.current = el.clientWidth;
    });
    ro.observe(el);
    containerWidthRef.current = el.clientWidth;
    return () => ro.disconnect();
  }, [multiple]);

  // Scroll-position → selectedIndex (primary writer).
  useEffect(() => {
    if (!multiple) return;
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const w = containerWidthRef.current || el.clientWidth || 1;
        const idx = Math.round(el.scrollLeft / w);
        const clamped = Math.max(0, Math.min(count - 1, idx));
        setSelectedIndex((prev) => (prev === clamped ? prev : clamped));
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [multiple, count]);

  // IntersectionObserver as secondary corrector during transient layouts.
  useEffect(() => {
    if (!multiple) return;
    const root = scrollRef.current;
    if (!root) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const i = Number(entry.target.dataset.index);
            if (!Number.isNaN(i)) {
              setSelectedIndex((prev) => (prev === i ? prev : i));
            }
          }
        }
      },
      { root, threshold: [0.6] },
    );

    slideRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [multiple, count]);

  // Restore scroll position on resize / orientationchange.
  useEffect(() => {
    if (!multiple) return;
    const el = scrollRef.current;
    if (!el) return;

    const realign = () => {
      const w = el.clientWidth;
      containerWidthRef.current = w;
      el.scrollLeft = selectedIndex * w;
    };

    window.addEventListener("resize", realign);
    window.addEventListener("orientationchange", realign);
    return () => {
      window.removeEventListener("resize", realign);
      window.removeEventListener("orientationchange", realign);
    };
  }, [multiple, selectedIndex]);

  if (!hasImages) {
    return (
      <div className="aspect-[3/4] w-full bg-zinc-100 flex items-center justify-center text-zinc-400 text-sm">
        No image
      </div>
    );
  }

  const goToIndex = (i) => {
    const el = scrollRef.current;
    if (el) {
      const w = containerWidthRef.current || el.clientWidth || 0;
      el.scrollTo({ left: i * w, behavior: "smooth" });
    } else {
      setSelectedIndex(i);
    }
  };

  return (
    <div className="relative lg:hidden">
      <div
        ref={scrollRef}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {images.map((src, i) => (
          <div
            key={i}
            ref={(el) => {
              slideRefs.current[i] = el;
            }}
            data-index={i}
            className="relative flex-none w-full aspect-[3/4] snap-start snap-always"
          >
            {/* Slide 1: bare `src` at width=1600, NO srcSet — identical to
                DesktopProductGallery's first image and to the document
                preload, so every viewport resolves to exactly ONE first-image
                fetch. (Slightly over-fetched on small phones; that is the
                accepted price of guaranteed dedup across the two galleries,
                both of which ship in the same HTML.)
                Slides 2+ are lazy and responsive. Because this whole gallery
                sits in a `lg:hidden` container, its lazy slides never
                intersect on desktop — which is what stops desktop from
                downloading the mobile set on top of its own. */}
            <img
              src={shopifyImageUrl(src, i === 0 ? 1600 : 1400)}
              srcSet={
                i === 0
                  ? undefined
                  : [800, 1200, 1400]
                      .map((w) => `${shopifyImageUrl(src, w)} ${w}w`)
                      .join(", ")
              }
              sizes={i === 0 ? undefined : "100vw"}
              alt={i === 0 ? alt : ""}
              loading={i === 0 ? "eager" : "lazy"}
              fetchPriority={i === 0 ? "high" : undefined}
              decoding="async"
              className="h-full w-full object-cover"
            />
          </div>
        ))}
      </div>

      {multiple && (
        <>
          {/* Prev arrow */}
          <button
            type="button"
            onClick={() => goToIndex(Math.max(0, selectedIndex - 1))}
            aria-label="Previous image"
            className="absolute left-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center text-zinc-900"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M12.5 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Next arrow */}
          <button
            type="button"
            onClick={() => goToIndex(Math.min(count - 1, selectedIndex + 1))}
            aria-label="Next image"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center text-zinc-900"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M7.5 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Indicators — overlaid on bottom edge */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, i) => {
              const isActive = i === selectedIndex;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => goToIndex(i)}
                  aria-label={`Go to image ${i + 1}`}
                  aria-current={isActive ? "true" : undefined}
                  className="p-1 -m-1"
                >
                  <span
                    className={`block h-1 w-1 transition-colors ${
                      isActive ? "bg-zinc-900" : "bg-zinc-400"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
