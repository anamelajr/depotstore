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
      <div
        className={`${CONTAINER} flex flex-col gap-6 py-8 md:h-[90px] md:flex-row md:items-center md:gap-0 md:py-0`}
      >
        <span className={`${BAND_LABEL} shrink-0 md:w-[17%]`}>
          <T k="home.featured" />
        </span>

        <div className="grid grid-cols-2 gap-y-5 sm:grid-cols-3 md:flex md:flex-1 md:gap-y-0">
          {ENTRIES.map((entry, i) => (
            <div
              key={entry.name}
              className={`flex cursor-default flex-col items-center justify-center gap-1.5 px-2 text-center md:flex-1 ${
                i === 0 ? "" : "md:border-l"
              }`}
              style={i === 0 ? undefined : { borderColor: HAIRLINE }}
            >
              <span className="whitespace-nowrap text-[10px] uppercase leading-none tracking-[0.1em] text-zinc-950">
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
          className={`${UTILITY_CAPS} shrink-0 cursor-default md:ml-7 md:border-l md:pl-7`}
          style={{ borderColor: HAIRLINE }}
        >
          <T k="home.viewAll" />
        </span>
      </div>
    </section>
  );
}
