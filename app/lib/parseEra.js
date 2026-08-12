// Deterministic era extraction — the queryable half of `era_year`.
//
// ~2/3 of the catalog carries a season signal, but only as free text inside
// `title` / `name` ("FW03 Velour Jacket"). This module turns that text into one
// INT so archive membership can be a `gte`/`lte` predicate instead of a
// substring hunt. No model call, no judgment: `era_year` is derived data,
// recomputable from scratch at any time, which is why every writer overwrites
// it plainly rather than COALESCE-protecting it like the editorial fields.
//
// Season grammar is NOT re-implemented here. Each input runs through
// normalizeSeasonCodes (app/lib/seasonCodes.js) first, so every spelling the
// catalog uses — "Spring 2001", "F/W 2004", "Ss04" — collapses onto the house
// form before matching, and the two modules can never disagree about what a
// season token is.

import { normalizeSeasonCodes } from "./seasonCodes.js";

// Shape 1 — house season code. The trailing \b is load-bearing: it declines
// "SS19999" (a malformed token the normalizer also refuses to repair) rather
// than reading "19" out of it and inventing a season. A split year takes its
// opening year by definition, so the second group is matched only to be
// consumed — never read.
const SEASON_CODE = /\b(?:FW|SS|AW)(\d{2})(?:\/\d{2})?\b/gi;

// Shape 2 — standalone 4-digit year. \b alone excludes "1990s": "0" and "s"
// are both word characters, so there is no boundary between them and the
// decade marker falls through to shape 3.
const FULL_YEAR = /\b(?:19|20)\d{2}\b/g;

// Shape 3 — decade marker, normalized to lowercase "s" by pass D of
// normalizeSeasonCodes. Yields the decade's opening year ("2000s" → 2000).
const DECADE = /\b((?:19|20)\d0)s\b/gi;

// Catalog bounds. Nothing later than 2029 can exist in archive fashion stock,
// and pre-1960 is effectively absent — so a 2-digit year of 30 or more is a
// 19xx, and anything landing outside the window is discarded rather than
// stored as a plausible-looking wrong number.
const MIN_YEAR = 1960;
const MAX_YEAR = 2029;
const PIVOT = 30;

const inRange = (y) => Number.isInteger(y) && y >= MIN_YEAR && y <= MAX_YEAR;

function expandShortYear(yy) {
  return yy >= PIVOT ? 1900 + yy : 2000 + yy;
}

// First in-range value of `shape` in `text`, or null. Out-of-range matches are
// skipped rather than aborting the scan, so one junk token can't mask a good
// one later in the same string.
function firstMatch(text, shape, toYear) {
  shape.lastIndex = 0;
  let m;
  while ((m = shape.exec(text)) !== null) {
    const year = toYear(m);
    if (inRange(year)) return year;
  }
  return null;
}

function parseOne(text) {
  if (typeof text !== "string" || text === "") return null;
  const normalized = normalizeSeasonCodes(text);

  return (
    firstMatch(normalized, SEASON_CODE, (m) => expandShortYear(Number(m[1]))) ??
    firstMatch(normalized, FULL_YEAR, (m) => Number(m[0])) ??
    firstMatch(normalized, DECADE, (m) => Number(m[1]))
  );
}

/**
 * Opening year of the era a product belongs to, or null when nothing
 * deterministic can be read off it. Pure; never throws on any input.
 *
 * `title` is the enriched, canonical string and is scanned in full first;
 * `name` (the raw Shopify listing) is consulted only when the title yields
 * nothing — a name-derived value must never displace a title-derived one.
 */
export function parseEraYear(title, name) {
  return parseOne(title) ?? parseOne(name);
}
