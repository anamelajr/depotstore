"use client";

import { useState } from "react";

export default function ProductGallery({ images, alt }) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!images || images.length === 0) {
    return (
      <>
        {/* Desktop: empty left thumbnail column placeholder */}
        <div className="hidden lg:block" />
        {/* Hero placeholder */}
        <div className="order-1 lg:order-none">
          <div className="aspect-[3/4] w-full bg-zinc-100 flex items-center justify-center text-zinc-400 text-sm lg:h-[calc(100vh-var(--nav-height)-4rem)] lg:aspect-auto">
            No image
          </div>
        </div>
      </>
    );
  }

  const activeSrc = images[selectedIndex] ?? images[0];

  return (
    <>
      {/* Desktop thumbnail column (hidden on mobile) */}
      <div className="hidden lg:block lg:sticky lg:top-[calc(var(--nav-height)+2rem)] lg:self-start">
        <div className="flex flex-col gap-3">
          {images.map((src, i) => {
            const isActive = i === selectedIndex;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setSelectedIndex(i)}
                aria-label={`View image ${i + 1}`}
                className={`block aspect-[3/4] w-full overflow-hidden bg-zinc-100 transition-opacity ${
                  isActive
                    ? "ring-1 ring-zinc-900 opacity-100"
                    : "opacity-60 hover:opacity-100"
                }`}
              >
                <img
                  src={src}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Hero image */}
      <div className="order-1 lg:order-none">
        <div className="w-full bg-zinc-50 lg:h-[calc(100vh-var(--nav-height)-4rem)]">
          <img
            src={activeSrc}
            alt={alt}
            className="h-full w-full object-contain aspect-[3/4] lg:aspect-auto"
          />
        </div>

        {/* Mobile horizontal thumbnail strip (hidden on desktop) */}
        {images.length > 1 && (
          <div
            className="mt-3 flex gap-2 overflow-x-auto snap-x px-5 lg:hidden [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: "none" }}
          >
            {images.map((src, i) => {
              const isActive = i === selectedIndex;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedIndex(i)}
                  aria-label={`View image ${i + 1}`}
                  className={`flex-none w-16 aspect-[3/4] snap-start overflow-hidden bg-zinc-100 transition-opacity ${
                    isActive
                      ? "ring-1 ring-zinc-900 opacity-100"
                      : "opacity-60"
                  }`}
                >
                  <img
                    src={src}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
