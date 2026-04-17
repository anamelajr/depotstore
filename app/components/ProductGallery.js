"use client";

import { useEffect, useRef, useState } from "react";

const WHEEL_COOLDOWN_MS = 750;

function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export default function ProductGallery({ images, alt }) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const heroRef = useRef(null);
  const scrollRef = useRef(null);
  const thumbRefs = useRef([]);
  const slideRefs = useRef([]);
  const cooldownRef = useRef(0);
  const indexRef = useRef(0);
  const containerWidthRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    indexRef.current = selectedIndex;
  }, [selectedIndex]);

  const hasImages = images && images.length > 0;
  const count = hasImages ? images.length : 0;
  const multiple = count > 1;

  // Clamp selectedIndex if image list shrinks.
  useEffect(() => {
    if (selectedIndex > count - 1) {
      setSelectedIndex(Math.max(0, count - 1));
    }
  }, [count, selectedIndex]);

  // Desktop: wheel-to-navigate on hero.
  useEffect(() => {
    if (!multiple) return;
    const el = heroRef.current;
    if (!el) return;

    const onWheel = (e) => {
      e.preventDefault();
      if (Math.abs(e.deltaY) < 2) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

      const now = performance.now();
      if (now - cooldownRef.current < WHEEL_COOLDOWN_MS) return;

      const dir = e.deltaY > 0 ? 1 : -1;
      const next = indexRef.current + dir;
      if (next < 0 || next >= count) return;

      cooldownRef.current = now;
      indexRef.current = next;
      setSelectedIndex(next);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [multiple, count]);

  // Desktop: arrow-key navigation.
  useEffect(() => {
    if (!multiple) return;

    const onKey = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (isEditableTarget(document.activeElement)) return;

      const next = indexRef.current + (e.key === "ArrowRight" ? 1 : -1);
      if (next < 0 || next >= count) return;
      indexRef.current = next;
      setSelectedIndex(next);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [multiple, count]);

  // Desktop: scroll active thumbnail into view.
  useEffect(() => {
    thumbRefs.current[selectedIndex]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [selectedIndex]);

  // Mobile: track slide width via ResizeObserver.
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

  // Mobile: scroll-position → selectedIndex (primary writer).
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

  // Mobile: IntersectionObserver as secondary corrector during transient layouts.
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

  // Mobile: restore scroll position on resize / orientationchange.
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
      <>
        <div className="hidden lg:block" />
        <div className="order-1 lg:order-none">
          <div className="aspect-[3/4] w-full bg-zinc-100 flex items-center justify-center text-zinc-400 text-sm lg:h-[calc(100vh-var(--nav-height)-4rem)] lg:aspect-auto">
            No image
          </div>
        </div>
      </>
    );
  }

  const activeSrc = images[selectedIndex] ?? images[0];

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
    <>
      {/* Desktop thumbnail column */}
      <div
        className="hidden lg:flex lg:flex-col lg:gap-2 lg:sticky lg:top-[calc(var(--nav-height)+2rem)] lg:self-start lg:h-[calc(100vh-var(--nav-height)-4rem)] lg:overflow-y-auto [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {images.map((src, i) => {
          const isActive = i === selectedIndex;
          return (
            <button
              key={i}
              ref={(el) => {
                thumbRefs.current[i] = el;
              }}
              type="button"
              onClick={() => setSelectedIndex(i)}
              aria-label={`View image ${i + 1}`}
              aria-current={isActive ? "true" : undefined}
              className={`relative block aspect-[3/4] w-full flex-none overflow-hidden bg-zinc-100 ${
                isActive
                  ? "ring-1 ring-zinc-900"
                  : ""
              }`}
            >
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          );
        })}
      </div>

      {/* Hero (desktop) + swipe gallery (mobile) */}
      <div className="order-1 lg:order-none">
        {/* Desktop hero */}
        <div
          ref={heroRef}
          className="relative hidden lg:block w-full lg:h-[calc(100vh-var(--nav-height)-4rem)]"
        >
          <img
            src={activeSrc}
            alt={alt}
            className="h-full w-full object-contain"
          />
        </div>

        {/* Mobile swipe gallery */}
        <div className="lg:hidden">
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
                <img
                  src={src}
                  alt={i === 0 ? alt : ""}
                  className="h-full w-full object-contain"
                />
              </div>
            ))}
          </div>

          {/* Dot indicator */}
          {multiple && (
            <div className="mt-3 flex justify-center gap-2">
              {images.map((_, i) => {
                const isActive = i === selectedIndex;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => goToIndex(i)}
                    aria-label={`Go to image ${i + 1}`}
                    aria-current={isActive ? "true" : undefined}
                    className="p-2 -m-2"
                  >
                    <span
                      className={`block h-1.5 w-1.5 rounded-full transition-colors ${
                        isActive ? "bg-zinc-900" : "bg-zinc-300"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
