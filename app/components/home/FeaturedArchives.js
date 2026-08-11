import T from "../T";
import { BAND_LABEL, CONTAINER, GROUND, HAIRLINE, UTILITY_CAPS } from "./tokens";

// Visual placeholders only. The real archives system (era parsing, DB columns,
// /archives routes) is a later phase — until it exists these entries are inert:
// no href, no hover state, cursor: default. The set lives here on purpose;
// app/lib/archives.js arrives with that phase, not this one.
// Designer names and year ranges are literal strings — never translated.
const ENTRIES = [
  { name: "MARTIN MARGIELA", years: "1999–2008" },
  { name: "HEDI SLIMANE", years: "2000–07 · 2012–16" },
  { name: "RICK OWENS", years: "2011–2015" },
  { name: "COMME DES GARÇONS", years: "1999–2005" },
  { name: "HELMUT LANG", years: "1996–2005" },
];

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
            {ENTRIES.map((entry, i) => (
              <div
                key={entry.name}
                className={`flex shrink-0 cursor-default flex-col items-center justify-center gap-1.5 px-5 py-4 text-center ${
                  i === 0 ? "" : "border-l"
                }`}
                style={i === 0 ? undefined : { borderColor: HAIRLINE }}
              >
                <span className="whitespace-nowrap font-mono text-[10px] font-medium uppercase leading-none tracking-[0.15em] text-zinc-950">
                  {entry.name}
                </span>
                <span className="whitespace-nowrap text-[9px] leading-none tracking-[0.06em] text-zinc-500">
                  {entry.years}
                </span>
              </div>
            ))}
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
          {ENTRIES.map((entry, i) => (
            <div
              key={entry.name}
              className={`flex cursor-default flex-col items-center justify-center gap-1.5 px-2 text-center lg:flex-1 ${
                i === 0 ? "" : "lg:border-l"
              }`}
              style={i === 0 ? undefined : { borderColor: HAIRLINE }}
            >
              {/* Same face as ProductCard's brand line, at this band's 10px size. */}
              <span className="whitespace-nowrap font-mono text-[10px] font-medium uppercase leading-none tracking-[0.15em] text-zinc-950">
                {entry.name}
              </span>
              <span className="whitespace-nowrap text-[9px] leading-none tracking-[0.06em] text-zinc-500">
                {entry.years}
              </span>
            </div>
          ))}
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
