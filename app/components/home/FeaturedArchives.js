import Link from "next/link";
import T from "../T";
import { ARCHIVES } from "../../lib/archives";
import { BAND_LABEL, CONTAINER, GROUND, HAIRLINE, UTILITY_CAPS } from "./tokens";

// The set now lives in app/lib/archives.js — the phase this component's
// placeholder comment reserved has arrived. Entries with `live: true` have a
// real /archives/<slug> page and link to it; the rest stay inert (no href, no
// hover state, cursor: default) until their membership rules are written.
// VIEW ALL stays inert: there is no index page yet.
// Designer names and year ranges are literal strings — never translated.

export default function FeaturedArchives() {
  return (
    <section
      className="w-full border-b"
      style={{ backgroundColor: GROUND, borderColor: HAIRLINE }}
    >
      {/* Mobile/tablet: label + VIEW ALL on one header row, entries in a
          horizontal swipe row that peeks at the screen edge. Dual blocks follow
          ProductCard's convention — the two DOMs diverge structurally. */}
      <div className={`${CONTAINER} py-7 lg:hidden`}>
        <div className="flex items-baseline justify-between gap-x-6">
          <span className={BAND_LABEL}>
            <T k="home.featured" />
          </span>
          {/* Inert for now — becomes a link with the real archives phase. */}
          <span className={`${UTILITY_CAPS} shrink-0 cursor-default`}>
            <T k="home.viewAll" />
          </span>
        </div>

        <div className="-mx-6 mt-5 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max">
            {ARCHIVES.map((entry, i) => {
              const Cell = entry.live ? Link : "div";
              return (
                <Cell
                  key={entry.name}
                  {...(entry.live ? { href: `/archives/${entry.slug}` } : {})}
                  className={`flex shrink-0 flex-col items-center justify-center gap-1.5 px-5 py-4 text-center ${
                    entry.live ? "transition-opacity hover:opacity-60" : "cursor-default"
                  } ${i === 0 ? "" : "border-l"}`}
                  style={i === 0 ? undefined : { borderColor: HAIRLINE }}
                >
                  <span className="whitespace-nowrap font-mono text-[10px] font-medium uppercase leading-none tracking-[0.15em] text-zinc-950">
                    {entry.name}
                  </span>
                  <span className="whitespace-nowrap text-[9px] leading-none tracking-[0.06em] text-zinc-500">
                    {entry.years}
                  </span>
                </Cell>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className={`${CONTAINER} hidden flex-col gap-6 py-8 lg:flex lg:h-[90px] lg:flex-row lg:items-center lg:gap-0 lg:py-0`}
      >
        <span className={`${BAND_LABEL} shrink-0 lg:w-[17%]`}>
          <T k="home.featured" />
        </span>

        <div className="flex flex-1">
          {ARCHIVES.map((entry, i) => {
            const Cell = entry.live ? Link : "div";
            return (
              <Cell
                key={entry.name}
                {...(entry.live ? { href: `/archives/${entry.slug}` } : {})}
                className={`flex flex-col items-center justify-center gap-1.5 px-2 text-center lg:flex-1 ${
                  entry.live ? "transition-opacity hover:opacity-60" : "cursor-default"
                } ${i === 0 ? "" : "lg:border-l"}`}
                style={i === 0 ? undefined : { borderColor: HAIRLINE }}
              >
                {/* Same face as ProductCard's brand line, at this band's 10px size. */}
                <span className="whitespace-nowrap font-mono text-[10px] font-medium uppercase leading-none tracking-[0.15em] text-zinc-950">
                  {entry.name}
                </span>
                <span className="whitespace-nowrap text-[9px] leading-none tracking-[0.06em] text-zinc-500">
                  {entry.years}
                </span>
              </Cell>
            );
          })}
        </div>

        {/* Inert for now — becomes a link with the real archives phase. */}
        <span
          className={`${UTILITY_CAPS} shrink-0 cursor-default lg:ml-7 lg:border-l lg:pl-7`}
          style={{ borderColor: HAIRLINE }}
        >
          <T k="home.viewAll" />
        </span>
      </div>
    </section>
  );
}
