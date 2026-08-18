import Image from "next/image";
import Link from "next/link";
import T from "../T";
import { HERO_GROUND, UTILITY_CAPS } from "./tokens";

// Landing hero: copy left, one static full-bleed image right. No caption, no
// rotation, no dots (user-confirmed). The image is a placeholder — swapping
// public/home/hero.jpg changes nothing about the layout.
export default function Hero() {
  // bg literals mirror GROUND / HERO_GROUND in tokens.js — a dynamic
  // bg-[${GROUND}] never reaches Tailwind's JIT scanner. Mobile sits on the
  // page ground so the masked photo dissolves into one continuous cream.
  return (
    <section className="relative w-full overflow-x-clip bg-[#faf9f7] md:bg-[#eceae4]">
      <div className="grid grid-cols-1 md:min-h-[600px] md:grid-cols-[46fr_54fr]">
        {/* Copy */}
        <div className="flex flex-col justify-center px-6 py-12 md:py-24 md:pl-[8.2vw] md:pr-14">
          <h1
            className="text-[clamp(40px,4.4vw,64px)] font-normal leading-[1.05] tracking-[-0.02em] text-zinc-950"
            style={{ fontFamily: "var(--font-satoshi), sans-serif" }}
          >
            <T k="home.heroLine1" />
            <br />
            <T k="home.heroLine2" />
            <br />
            <T k="home.heroLine3" />
          </h1>

          <p className="mt-6 max-w-[320px] text-[14px] leading-[1.6] text-zinc-600 md:max-w-[260px]">
            <T k="home.heroDescription" />
          </p>

          {/* Retargeted to /archives when the real archives phase lands. */}
          <Link
            href="/feed"
            // See app/page.js — full prefetch, deduped with the other /feed links.
            prefetch={true}
            className={`${UTILITY_CAPS} mt-8 flex w-fit items-center gap-4 transition-opacity hover:opacity-60`}
          >
            <T k="home.exploreArchives" />
            <span aria-hidden="true" className="text-[15px] leading-none">
              →
            </span>
          </Link>
        </div>

        {/* Image — full-bleed to the top, right and bottom of the section. */}
        {/* Mobile: vertical mask fades the photo into the section ground at top
            and bottom, so there is no seam against the copy block above or the
            search row below. Reset at md: — any prefixed twin added here must
            ship its own md: reset in the same edit, or the fade leaks onto
            desktop Safari. */}
        <div className="relative min-h-[320px] [mask-image:linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.16)_6%,rgba(0,0,0,0.5)_12%,rgba(0,0,0,0.84)_18%,black_24%,black_76%,rgba(0,0,0,0.84)_82%,rgba(0,0,0,0.5)_88%,rgba(0,0,0,0.16)_94%,transparent_100%)] md:min-h-full md:[mask-image:none]">
          <Image
            src="/home/hero.jpg"
            alt=""
            fill
            priority
            sizes="(max-width: 768px) 100vw, 54vw"
            className="object-cover"
          />
          {/* Softens the seam so copy ground and photo meet with no divider. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 hidden w-48 md:block"
            style={{
              background: `linear-gradient(to right, ${HERO_GROUND}, rgba(236,234,228,0))`,
            }}
          />
        </div>
      </div>
    </section>
  );
}
