// Shared visual language for the landing page, transcribed from
// docs/superpowers/specs/assets/2026-08-11-landing-redesign/reference-landing.png.
// Kept in one module so the hairline colour, page ground and the tracked-out
// small-caps label treatment stay identical across every section.

/** Warm off-white page ground. */
export const GROUND = "#faf9f7";
/** Warm greige the hero copy column sits on — meets the photo with no divider. */
export const HERO_GROUND = "#eceae4";
/** 1px section hairline. */
export const HAIRLINE = "#e5e2dc";

/** Inline band label: FEATURED ARCHIVES. */
export const BAND_LABEL =
  "text-[12px] font-medium uppercase tracking-[0.15em] text-zinc-950";

/** Section heading: CURATED SELECTION / ACROSS PARIS. */
export const SECTION_LABEL =
  "text-[18px] font-medium uppercase tracking-[0.15em] text-zinc-950";

/** Small tracked-out utility caps: browse-by items, VIEW ALL, the hero CTA. */
export const UTILITY_CAPS =
  "text-[11px] uppercase tracking-[0.14em] text-zinc-950";

/** Muted variant of the above (BROWSE BY, archive year ranges). */
export const UTILITY_CAPS_MUTED =
  "text-[10px] uppercase tracking-[0.14em] text-zinc-500";

/**
 * The one shared content container. 1210px cap gives ~119px side margins at the
 * reference's 1449px frame (~8.2%), matching its global content margin.
 */
export const CONTAINER = "mx-auto w-full max-w-[1210px] px-6";
