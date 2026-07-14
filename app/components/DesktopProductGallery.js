"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BackToFeedLink from "./BackToFeedLink";
import { shopifyImageUrl } from "../lib/shopifyImage.js";

// Saint Laurent-style stacked desktop gallery: one full-height section per
// image, native scroll, sticky vertical counter, click-to-zoom overlay with a
// left thumbnail rail. Desktop-only — the page renders it inside a
// `hidden lg:grid` wrapper; mobile keeps ProductGallery untouched.

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function sectionHeight() {
  // --nav-height is 56px (coupled to the desktop nav bar).
  return window.innerHeight - 56;
}

/* ---------- Counter (odometer digit) ---------- */

function OdometerDigit({ value }) {
  const [display, setDisplay] = useState({ current: value, leaving: null });

  // Adjust state during render (React-sanctioned pattern) — the old digit
  // becomes `leaving` and fades up out while the new one fades up in.
  if (display.current !== value) {
    setDisplay({
      current: value,
      leaving: prefersReducedMotion() ? null : display.current,
    });
  }
  const { current, leaving } = display;

  useEffect(() => {
    if (leaving === null) return;
    const t = setTimeout(
      () => setDisplay((d) => (d.leaving === null ? d : { ...d, leaving: null })),
      220,
    );
    return () => clearTimeout(t);
  }, [leaving, current]);

  return (
    <span className="relative block h-[14px] overflow-visible">
      {leaving !== null && (
        <span
          aria-hidden="true"
          className="absolute inset-0 block"
          style={{ animation: "pdpOdometerOut 220ms cubic-bezier(0.22,1,0.36,1) forwards" }}
        >
          {leaving}
        </span>
      )}
      <span
        key={current}
        className="block"
        style={
          leaving !== null
            ? { animation: "pdpOdometerIn 220ms cubic-bezier(0.22,1,0.36,1) both" }
            : undefined
        }
      >
        {current}
      </span>
    </span>
  );
}

/* ---------- Reveal-on-first-intersection section ---------- */

function GallerySection({ src, alt, index, onZoom, registerRef, eager }) {
  const ref = useRef(null);
  const [revealed, setRevealed] = useState(false);

  // Reduced motion is handled by the `.pdp-motion` CSS override (forces
  // opacity 1 / no transform), so the observer can run unconditionally.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section
      ref={(el) => {
        ref.current = el;
        registerRef(index, el);
      }}
      className="flex items-center justify-center"
      style={{ height: "calc(100vh - var(--nav-height))" }}
    >
      <button
        type="button"
        onClick={() => onZoom(index)}
        aria-label={`Zoom image ${index + 1}`}
        className="pdp-motion flex h-full w-full items-center justify-center cursor-zoom-in focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-zinc-400"
        style={{
          opacity: revealed ? 1 : 0,
          transform: revealed ? "translateY(0)" : "translateY(12px)",
          transition:
            "opacity 500ms cubic-bezier(0.22,1,0.36,1), transform 500ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <img
          src={shopifyImageUrl(src, 1600)}
          alt={index === 0 ? alt : ""}
          loading={eager ? "eager" : "lazy"}
          className="max-h-[86%] max-w-[72%] object-contain"
        />
      </button>
    </section>
  );
}

/* ---------- Zoom overlay ---------- */

function ZoomOverlay({ images, alt, initialIndex, closing, onRequestClose, onClosed }) {
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const containerRef = useRef(null);
  const closeRef = useRef(null);
  const overlayRef = useRef(null);
  const railRefs = useRef([]);
  const rafRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeRef = useRef(initialIndex);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    activeRef.current = activeIndex;
  }, [activeIndex]);

  const scrollToIndex = useCallback((i, behavior = "smooth") => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({
      top: i * el.clientHeight,
      behavior: prefersReducedMotion() ? "auto" : behavior,
    });
  }, []);

  // Open at clicked index (before paint, no smooth scroll). Re-assert on the
  // next frame — right after page load the first layout pass can land at 0.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = initialIndex * el.clientHeight;
    const raf = requestAnimationFrame(() => {
      const target = initialIndex * el.clientHeight;
      if (Math.abs(el.scrollTop - target) > 2) el.scrollTop = target;
    });
    return () => cancelAnimationFrame(raf);
  }, [initialIndex]);

  // Single effect owning focus trap, keys, body lock and inert — keyed on
  // mount so rapid open/close can't leave stale handlers or a stuck inert.
  useEffect(() => {
    const overlay = overlayRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Make everything behind the overlay inert (overlay is portaled to body).
    const inerted = [];
    for (const child of document.body.children) {
      if (child !== overlay && !child.hasAttribute("inert")) {
        child.setAttribute("inert", "");
        inerted.push(child);
      }
    }

    closeRef.current?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onRequestClose(activeRef.current);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const next = Math.max(0, Math.min(images.length - 1, activeRef.current + dir));
        scrollToIndex(next);
        return;
      }
      if (e.key === "Tab") {
        const focusables = overlay.querySelectorAll("button:not([disabled])");
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (!overlay.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      inerted.forEach((el) => el.removeAttribute("inert"));
      // After inert removal — the page can receive focus again.
      onClosedRef.current(activeRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync active index from scroll position; keep active thumb in view.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const h = el.clientHeight || 1;
        const idx = Math.max(0, Math.min(images.length - 1, Math.round(el.scrollTop / h)));
        setActiveIndex((prev) => {
          if (prev !== idx) {
            railRefs.current[idx]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
          return idx;
        });
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [images.length]);

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image zoom"
      className="pdp-motion fixed inset-0 z-[9999] bg-white"
      style={{
        animation: reduced
          ? "none"
          : closing
            ? "pdpZoomExit 200ms ease-out both"
            : "pdpZoomEnter 300ms ease-out both",
      }}
    >
      {/* Thin black cross — 44px hit target, 1px strokes */}
      <button
        ref={closeRef}
        type="button"
        onClick={() => onRequestClose(activeRef.current)}
        aria-label="Close zoom"
        className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center text-zinc-900 hover:opacity-60 transition-opacity focus-visible:outline-1 focus-visible:outline-zinc-400"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
          <path d="M4 4l16 16M20 4L4 20" />
        </svg>
      </button>

      {/* Left thumbnail rail */}
      <div className="absolute left-0 top-0 z-10 flex h-full w-[104px] flex-col items-center justify-center">
        <div
          className="flex max-h-full flex-col gap-[10px] overflow-y-auto py-6 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {images.map((src, i) => (
            <button
              key={i}
              ref={(el) => {
                railRefs.current[i] = el;
              }}
              type="button"
              onClick={() => scrollToIndex(i)}
              aria-label={`Go to image ${i + 1}`}
              aria-current={i === activeIndex ? "true" : undefined}
              className="pdp-motion relative block w-16 flex-none focus-visible:outline-1 focus-visible:outline-zinc-400"
              style={
                reduced
                  ? undefined
                  : { animation: `pdpThumbEnter 300ms ease-out both ${80 + i * 40}ms` }
              }
            >
              <span
                aria-hidden="true"
                className={`absolute -left-[7px] top-0 h-full w-[1.5px] bg-black transition-opacity duration-200 ${
                  i === activeIndex ? "opacity-100" : "opacity-0"
                }`}
              />
              <img
                src={shopifyImageUrl(src, 128)}
                alt=""
                className={`block w-16 object-contain transition-opacity duration-200 ${
                  i === activeIndex ? "opacity-100" : "opacity-60 hover:opacity-100"
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Main zoom scroller */}
      <div
        ref={containerRef}
        className="h-full overflow-y-auto [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        <div
          className="pdp-motion"
          style={reduced ? undefined : { animation: "pdpZoomImageEnter 300ms ease-out both" }}
        >
          {images.map((src, i) => (
            <div key={i} className="flex h-screen items-center justify-center">
              <img
                src={shopifyImageUrl(src, 2048)}
                alt={i === activeIndex ? alt : ""}
                loading={Math.abs(i - initialIndex) <= 1 ? "eager" : "lazy"}
                className="max-h-[88vh] max-w-[86%] object-contain"
              />
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Gallery ---------- */

export default function DesktopProductGallery({ images, alt }) {
  const hasImages = images && images.length > 0;
  const count = hasImages ? images.length : 0;
  const multiple = count > 1;

  const sectionRefs = useRef([]);
  const rafRef = useRef(0);
  const closeTimerRef = useRef(0);
  const [currentIndex, setCurrentIndex] = useState(1);
  const [scrolled, setScrolled] = useState(false);
  const [zoom, setZoom] = useState(null); // { index, closing }

  const registerRef = useCallback((i, el) => {
    sectionRefs.current[i] = el;
  }, []);

  // Next.js navigation from scrolled feed pages sometimes lands mid-page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Counter index + back-link fade from window scroll, rAF-throttled.
  useEffect(() => {
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const y = window.scrollY;
        setScrolled(y > 40);
        if (multiple) {
          const idx = Math.round(y / sectionHeight()) + 1;
          setCurrentIndex(Math.max(1, Math.min(count, idx)));
        }
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [multiple, count]);

  useEffect(() => () => clearTimeout(closeTimerRef.current), []);

  const openZoom = useCallback((index) => {
    clearTimeout(closeTimerRef.current);
    setZoom({ index, closing: false });
  }, []);

  const closeZoom = useCallback(() => {
    setZoom((prev) => {
      if (!prev || prev.closing) return prev;
      if (prefersReducedMotion()) return null;
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => setZoom(null), 200);
      return { ...prev, closing: true };
    });
  }, []);

  // Runs at overlay unmount, after inert is removed: re-sync the page to the
  // last-viewed image and hand focus back to its section button.
  const handleZoomClosed = useCallback((lastIndex) => {
    window.scrollTo({ top: lastIndex * sectionHeight(), behavior: "auto" });
    sectionRefs.current[lastIndex]
      ?.querySelector("button")
      ?.focus({ preventScroll: true });
  }, []);

  if (!hasImages) {
    return (
      <div
        className="flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400"
        style={{ height: "calc(100vh - var(--nav-height))" }}
      >
        No image
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Floating back link — fades out after the first scroll */}
      <div
        className={`absolute left-10 top-7 z-10 transition-opacity duration-300 ${
          scrolled ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <BackToFeedLink className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-900 transition-colors" />
      </div>

      {/* Vertical counter — sticky zero-height wrapper, digits at viewport center */}
      {multiple && (
        <div className="sticky top-[var(--nav-height)] z-10 h-0" aria-hidden="true">
          <div
            className="absolute left-10 flex flex-col items-center gap-[7px] font-mono text-[11px] leading-none tabular-nums"
            style={{
              top: "calc((100vh - var(--nav-height)) / 2)",
              transform: "translateY(-50%)",
            }}
          >
            <span className="text-zinc-900">
              <OdometerDigit value={currentIndex} />
            </span>
            <span className="block h-[14px] w-px bg-zinc-300" />
            <span className="text-zinc-400">{count}</span>
          </div>
        </div>
      )}

      {images.map((src, i) => (
        <GallerySection
          key={i}
          src={src}
          alt={alt}
          index={i}
          eager={i === 0}
          onZoom={openZoom}
          registerRef={registerRef}
        />
      ))}

      {zoom && (
        <ZoomOverlay
          images={images}
          alt={alt}
          initialIndex={zoom.index}
          closing={zoom.closing}
          onRequestClose={closeZoom}
          onClosed={handleZoomClosed}
        />
      )}
    </div>
  );
}
