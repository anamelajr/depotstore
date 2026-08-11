import Link from "next/link";
import T from "../T";
import HeroSearchInput from "../HeroSearchInput";
import { CONTAINER, GROUND, HAIRLINE, UTILITY_CAPS_MUTED } from "./tokens";

function Chevron() {
  return (
    <svg width="7" height="10" viewBox="0 0 7 10" fill="none" aria-hidden="true">
      <path d="M1.5 1L5.5 5L1.5 9" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

// One notch below UTILITY_CAPS — sized like the muted variant but ink-dark.
const ITEM =
  "flex items-center gap-2 whitespace-nowrap text-[10px] uppercase tracking-[0.14em] text-zinc-950";

export default function SearchBrowseRow() {
  return (
    <section
      className="w-full border-t"
      style={{ backgroundColor: GROUND, borderColor: HAIRLINE }}
    >
      <div
        className={`${CONTAINER} flex flex-col gap-6 py-8 md:h-[90px] md:flex-row md:items-center md:gap-10 md:py-0`}
      >
        {/* Underline-only field; GET submit lands on /feed?search=… */}
        <form action="/feed" method="GET" className="relative w-full md:w-[52%]">
          <HeroSearchInput
            placeholderKey="home.archiveSearchPlaceholder"
            className="w-full rounded-none border-b bg-transparent pb-2 pr-8 text-[18px] text-zinc-950 placeholder:text-zinc-400 outline-none focus:border-zinc-800"
          />
          <button
            type="submit"
            aria-label="Search"
            className="absolute bottom-2 right-0 text-zinc-950 transition-opacity hover:opacity-60"
          >
            <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
              <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M11.6 11.6L16 16" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-x-7 gap-y-3 md:ml-auto md:flex-nowrap">
          <span className={`${UTILITY_CAPS_MUTED} whitespace-nowrap`}>
            <T k="home.browseBy" />
          </span>
          <span
            aria-hidden="true"
            className="hidden h-3.5 w-px md:block"
            style={{ backgroundColor: HAIRLINE }}
          />
          <Link href="/designers" className={`${ITEM} transition-opacity hover:opacity-60`}>
            <T k="home.browseDesigner" />
            <Chevron />
          </Link>
          <span
            aria-hidden="true"
            className="hidden h-3.5 w-px md:block"
            style={{ backgroundColor: HAIRLINE }}
          />
          {/* Inert: no era browsing exists yet (deferred archives phase). */}
          <span className={`${ITEM} cursor-default`}>
            <T k="home.browseYear" />
            <Chevron />
          </span>
          <span
            aria-hidden="true"
            className="hidden h-3.5 w-px md:block"
            style={{ backgroundColor: HAIRLINE }}
          />
          <Link href="/feed" className={`${ITEM} transition-opacity hover:opacity-60`}>
            <T k="home.browseCategory" />
            <Chevron />
          </Link>
        </div>
      </div>
    </section>
  );
}
