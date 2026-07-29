// Canonical season-code form for product titles.
//
// The catalog carries the same season a dozen ways — "SS2004", "S/S 2004",
// "Spring/Summer 2004", "Ss04". The house form is UPPERCASE PREFIX + 2-DIGIT
// YEAR ("SS04", "FW99"), split years joined with a slash ("FW02/03"), and
// decade markers lowercase ("2000s"). Both AW and FW are kept — they are
// distinct archive conventions, not a spelling drift.
//
// Applied at the single enrich choke point (app/api/enrich/route.js) so both
// title producers — cleanTitle's model output and the handle fallback — write
// the same shape, and reused by scripts/backfillSeasonCodes.mjs so existing
// rows converge on it too.

// Two-digit tail of a year token: "2004" → "04", "99" → "99".
const shortYear = (y) => y.slice(-2);

// Pass A1 — compound spelled-out seasons ("Fall/Winter", "Autumn Winter").
// Year-gated: a bare "Fall Winter Coat" must not collapse to a yearless "FW".
const COMPOUND_FW = /\b(?:Fall|Autumn)[\s/-]+Winter(?=\s*'?\d{2,4}\b)/gi;
const COMPOUND_SS = /\bSpring[\s/-]+Summer(?=\s*'?\d{2,4}\b)/gi;

// Pass A2 — standalone spelled-out seasons, also year-gated. The lookbehind
// spares "Pre-Fall", which is a distinct season in its own right (as are
// Resort and Cruise, which have no rule here and so pass through untouched).
const STANDALONE_FW = /(?<!Pre[-\s])\b(?:Fall|Autumn)(?=\s+(?:19|20)?\d{2}\b)/gi;
const STANDALONE_SS = /(?<!Pre[-\s])\bSpring(?=\s+(?:19|20)?\d{2}\b)/gi;

// Pass B — letter-slash prefixes ("S/S 2004", "F/w 1997"). Must be followed by
// a digit run so a non-season "A/W" can never be rewritten. Pair validity is
// checked in the replacer: F/W, S/S and A/W only.
const LETTER_SLASH = /\b([FSA])\s*\/\s*([WS])(?=\s*\d)/gi;
const VALID_PAIRS = new Set(["FW", "SS", "AW"]);

// Pass C — the core rule. Uppercases the prefix, shortens each year to two
// digits, and normalizes a split year onto a slash ("FW10-11" → "FW10/11").
// The optional apostrophe after the prefix pairs with the compound-season
// lookaheads above, which accept "'03" — without it, "Fall/Winter '03" would
// strand as the half-normalized "FW '03".
//
// Guards, each load-bearing:
//   \b + mandatory digits — "Sswing"/"Awning" carry no digit run, so they
//     never match; the boundary also blocks mid-word hits.
//   (?!\d)  — leaves the "SS19999" typo alone rather than half-fixing it to
//     "SS19" and silently inventing a season.
//   (?!s\b) — same for "FW90s", which is a decade marker wearing a season
//     prefix, not a season code.
// Both land in the backfill's manual-review report instead.
const SEASON_YEAR =
  /\b(FW|SS|AW)\s?'?((?:19|20)\d{2}|\d{2})(?:\s?[/-]\s?((?:19|20)\d{2}|\d{2}))?(?!\d)(?!s\b)/gi;

// Pass D — decade markers keep a lowercase "s" ("2000S" → "2000s"). Anchored
// on a true decade (\d0) so a style code like "2003S" is left alone.
const DECADE_UPPER_S = /\b((?:19|20)\d0)S\b/g;

/**
 * Rewrite every season code and decade marker in `title` to the house form.
 *
 * Pure, idempotent, and position-preserving: only matched substrings are
 * replaced, so word order, spacing and every other character survive
 * untouched. Non-string input is returned as-is.
 */
export function normalizeSeasonCodes(title) {
  if (typeof title !== "string" || title === "") return title;

  return (
    title
      // Compound forms run before standalone ones, otherwise "Fall/Winter
      // 2003" would be caught by the standalone Fall rule and leave a
      // stranded "Winter".
      .replace(COMPOUND_FW, "FW")
      .replace(COMPOUND_SS, "SS")
      .replace(STANDALONE_FW, "FW")
      .replace(STANDALONE_SS, "SS")
      .replace(LETTER_SLASH, (match, a, b) => {
        const pair = (a + b).toUpperCase();
        return VALID_PAIRS.has(pair) ? pair : match;
      })
      // Passes A and B emit a prefix still separated from its year ("FW 2003");
      // SEASON_YEAR's optional \s? closes that gap in the same sweep.
      .replace(SEASON_YEAR, (_match, prefix, year1, year2) => {
        const head = prefix.toUpperCase() + shortYear(year1);
        return year2 ? `${head}/${shortYear(year2)}` : head;
      })
      .replace(DECADE_UPPER_S, "$1s")
  );
}

// Titles the normalizer deliberately declines to fully repair — malformed
// season tokens whose correct value cannot be derived without a human looking
// at the garment, plus titles whose season code sits somewhere other than the
// front. Reported by the backfill for manual follow-up.
//
// The first three classes are no-ops under normalizeSeasonCodes (the regex
// guards above see to that), so flagging them never suppresses a write that
// would otherwise happen. `seasonNotFirst` is different: those rows DO get the
// in-place format fix ("Top - FW2010" → "Top - FW10"), which is deterministic
// and leaves word order untouched; the flag is about the position, which
// automation intentionally does not decide.
export const MANUAL_REVIEW_PATTERNS = [
  { key: "overlong_year", re: /\b(?:FW|SS|AW)\d{5,}/i },
  { key: "bare_letter_year", re: /\b[A-Z]\d{4}\b/ },
  { key: "decade_with_season_prefix", re: /\b(?:FW|SS|AW)\d{2}s\b/i },
  // Year length is deliberately loose (\d{2,4}): the flag is computed against
  // the ORIGINAL title, which may still carry a 4-digit year the normalizer is
  // about to shorten.
  { key: "season_not_first", re: /^(?!\s*(?:FW|SS|AW)\d).*\b(?:FW|SS|AW)\d{2,4}(?:\/\d{2,4})?\b/i },
];

/** Manual-review class keys matching `title`, or [] when it looks clean. */
export function manualReviewFlags(title) {
  if (typeof title !== "string" || title === "") return [];
  return MANUAL_REVIEW_PATTERNS.filter(({ re }) => re.test(title)).map((p) => p.key);
}
