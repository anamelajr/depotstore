// Pure evaluation logic for /api/health/formatting, split out so every rule is
// unit-testable without Supabase. Read-only by construction: nothing here
// writes, requeues, or mutates a row — the editorial write-once invariant in
// CLAUDE.md stays untouched.
//
// Input: visible product rows (the caller applies withVisibility, which also
// drops the '€0.00' rental pieces) selecting
// `id, store_domain, brand, title, category, enrich_attempts`.
//
// Every rule composes an existing helper wherever one exists — the point is a
// validator that tracks the write path, not a second source of truth that
// drifts from it.

import {
  canonicalBrand,
  normalizeBrand,
  titleLeaksAllowedBrandStrict,
} from "./brand.js";
import { normalizeSeasonCodes, manualReviewFlags } from "./seasonCodes.js";
import { SUB_LINE_PREFIXES } from "./handleFallback.js";
import { MAX_ENRICH_ATTEMPTS } from "./enrichLimits.js";

// Editorial fields enrichment is responsible for filling. A NULL here is either
// "still queued" or "gave up", never "fine".
export const EDITORIAL_FIELDS = ["brand", "title", "category"];

const missingEditorialFields = (row) =>
  EDITORIAL_FIELDS.filter(
    (f) => row?.[f] === null || row?.[f] === undefined || row?.[f] === ""
  );

// Per-key display cap. `count` stays the true total; `truncated` says the list
// was cut. The fingerprint is computed BEFORE this cap applies (see
// evaluateFormattingHealth) — hashing the capped list would make a change among
// items past the cap invisible.
export const DISPLAY_CAP = 50;

// The review tier gets a larger cap. It exists to be eyeballed, it can never
// mail, and it currently runs 109 items against 8,012 rows — truncating that to
// 50 would hide half the list including id 14953917, the very row the check was
// designed to catch. Ordering is by id, so a small cap hides an arbitrary half.
export const REVIEW_DISPLAY_CAP = 200;

// Review tier: a capitalised title token seen under at most this many distinct
// brands is treated as a possible proper noun (an off-allowlist brand leak)
// rather than a garment/material/colour word. Garment words ("Leather",
// "Boots", "Zip-up") appear under hundreds of brands; "Calvin"/"Klein" appear
// under one or two.
//
// Deliberately review-tier, never a violation, and it never enters the
// fingerprint — the rule is empirical, so it must not be able to send mail.
export const REVIEW_BRAND_DISTINCT_THRESHOLD = 2;

// Tokens too short to carry signal.
const REVIEW_MIN_TOKEN_LENGTH = 4;

// Two extra conditions, both measured against production (8,012 live rows)
// rather than guessed:
//
//   rarity alone                     1,528 flags — unusable
//   + consecutive rare pair            216
//   + pair must OPEN the title         109
//
// Both tightenings are principled, not just quieter. A one-word rare token is
// indistinguishable from a distinctive garment word ("Tabi", "Mitten",
// "Purse") by this method; a brand name is almost always two or more proper
// nouns in a row. And a leaked brand sits at the FRONT — vendors prepend it —
// which is where "Calvin Klein 205w39nyc …" (id 14953917) sits. At 109 of
// 8,012 the list is genuinely eyeballable, and its content is the right class:
// Luna Rossa, Linea Rossa, Eastpak, Basquiat, Marilyn Monroe.
const REVIEW_LEADING_TOKENS = 2;

// Season code / decade / bare year that legitimately opens a house-form title.
// Skipped before the leading-token test so "SS15 Trail Blazers …" is judged on
// "Trail Blazers", not on the season code.
const LEADING_SEASON = /^(?:(?:FW|SS|AW)\d{2,4}(?:\/\d{2,4})?|(?:19|20)\d0s|\d{4})\s+/i;

// Ported from scripts/auditTitles.py:classify — the two classes with no
// existing helper in app/lib.
const PARENTHETICAL = /\((?!runway)/i;
const SUB_LINE_DASH = /\s-\s/;
const TRAILING_BY = /\s+by\s*$/i;
const MAX_TITLE_WORDS = 7; // mirrors validateCleanTitleResult (cleanTitle.js)

// Capitalised word tokens, digits excluded so season codes ("SS87") and style
// numbers ("205w39nyc") never enter the genericness corpus.
const CAPITALISED_TOKEN = /\b[A-Z][A-Za-z'’-]*\b/g;

// Case/diacritic/punctuation fold used for the split-family check. This is the
// same two-pass fold isAllowedBrand trusts (normalizeBrand, then
// whitespace-strip), so "J.W. ANDERSON"/"JW ANDERSON" and "Y-PROJECT"/
// "Y/PROJECT" land on one key.
function brandFoldKey(brand) {
  const normalized = normalizeBrand(brand);
  return normalized ? normalized.replace(/\s+/g, "") : null;
}

// Does `title` open with a known sub-line marker for `brand`? The four
// season-ordering hits in production are really sub-line leaks ("Tao FW07 …"),
// and the fix for those is a strip, not a reorder — so they get their own key.
function leadingSubLinePrefix(title, brand) {
  const key = normalizeBrand(canonicalBrand(brand));
  const prefixes = key ? SUB_LINE_PREFIXES[key] : null;
  if (!prefixes || !title) return null;
  for (const prefix of [...prefixes].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`^\\s*${prefix.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(title)) return prefix;
  }
  return null;
}

/**
 * Row-local violation keys for one product row.
 *
 * Returns `{ violations: string[], queuedNull: boolean }`. `queuedNull` is the
 * silent state — a NULL editorial field still under the attempt cap — and is
 * deliberately NOT a violation key, so a caller cannot accidentally report it.
 *
 * Cross-row rules (split brand families, corpus genericness) are not here:
 * they cannot be decided from a single row. They live in
 * evaluateFormattingHealth.
 */
export function classifyRow(row) {
  const violations = [];
  const title = typeof row?.title === "string" ? row.title.trim() : null;
  const brand = typeof row?.brand === "string" ? row.brand.trim() : null;

  const missing = missingEditorialFields(row).length > 0;
  const attempts = row?.enrich_attempts ?? 0;
  const queuedNull = missing && attempts < MAX_ENRICH_ATTEMPTS;
  if (missing && !queuedNull) violations.push("enrichment_failed");

  if (brand && canonicalBrand(brand) !== brand) {
    violations.push("non_canonical_brand");
  }

  if (title) {
    // Inequality IS the violation: normalizeSeasonCodes is idempotent and
    // position-preserving, so a title already in house form is a fixed point.
    if (normalizeSeasonCodes(title) !== title) {
      violations.push("uncompacted_season_code");
    }
    for (const flag of manualReviewFlags(title)) {
      if (flag === "season_not_first") {
        violations.push(
          leadingSubLinePrefix(title, brand) ? "sub_line_prefix" : "season_not_first"
        );
      } else {
        violations.push(flag);
      }
    }
    if (TRAILING_BY.test(title)) violations.push("trailing_by");
    if (title.split(/\s+/).length > MAX_TITLE_WORDS) violations.push("over_7_words");
    if (titleLeaksAllowedBrandStrict(title)) violations.push("brand_in_title");
    if (PARENTHETICAL.test(title)) violations.push("parenthetical");
    if (SUB_LINE_DASH.test(title)) violations.push("dash_in_title");
  }

  return { violations: [...new Set(violations)], queuedNull };
}

// FNV-1a over two 32-bit lanes → 16 hex chars. Hand-rolled rather than
// node:crypto so this module stays a pure, runtime-agnostic import (it is
// evaluated in the Next route and in vitest alike) with no async surface.
function hashTuples(tuples) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const joined = [...tuples].sort().join("\n");
  for (let i = 0; i < joined.length; i++) {
    const c = joined.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Stable hash of `(violation_key, id)` tuples.
 *
 * Tuples, not bare ids: an item that swaps one violation class for another,
 * gains a second, or has one of two fixed keeps the same id set — an id-only
 * hash would call those states identical and silently swallow them.
 *
 * The item's current FIELD VALUE is deliberately excluded, so a
 * bad-title→different-bad-title edit does not send mail. The whole design rests
 * on silence being trustworthy; that means changes of state notify, and churn
 * within a state does not.
 */
export function fingerprintViolations(tuples) {
  return hashTuples(tuples.map(([key, id]) => `${key} ${id}`));
}

// Distinct normalized brands each capitalised title token appears under,
// computed from the same rows being scanned — no new hand-maintained wordlist,
// and therefore no new source of truth to drift.
function buildTokenBrandIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    if (typeof row?.title !== "string") continue;
    const brandKey = brandFoldKey(row.brand) ?? " null";
    for (const token of row.title.match(CAPITALISED_TOKEN) ?? []) {
      const key = token.toLowerCase();
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(brandKey);
    }
  }
  return index;
}

function pack(items, cap) {
  return {
    count: items.length,
    items: items.slice(0, cap),
    truncated: items.length > cap,
  };
}

function groupByKey(entries, cap = DISPLAY_CAP) {
  const grouped = {};
  for (const { key, item } of entries) {
    (grouped[key] ??= []).push(item);
  }
  const out = {};
  for (const key of Object.keys(grouped).sort()) out[key] = pack(grouped[key], cap);
  return out;
}

/**
 * Evaluate a whole visible row set.
 *
 * `status` is "ok" only when there are zero VIOLATIONS — the review tier never
 * changes it, and never enters the fingerprint, so it cannot send mail.
 */
export function evaluateFormattingHealth(rows) {
  const all = rows ?? [];
  const violationEntries = [];
  let queuedNull = 0;

  for (const row of all) {
    const { violations, queuedNull: silent } = classifyRow(row);
    if (silent) queuedNull += 1;
    for (const key of violations) {
      violationEntries.push({
        key,
        item: {
          id: row.id,
          store_domain: row.store_domain ?? null,
          brand: row.brand ?? null,
          title: row.title ?? null,
          category: row.category ?? null,
          // Which editorial field is actually NULL. Without it an
          // enrichment_failed line renders a perfectly good brand and title
          // and reads as a false alarm.
          missing: missingEditorialFields(row),
        },
      });
    }
  }

  // Cross-row rule 1 — split brand families. Reported per FAMILY, not per row:
  // the fix is one alias, and 52 identical rows would drown the report. The
  // synthetic id is the fold key, which keeps the (key, id) fingerprint stable
  // while a family's row count churns.
  const byFold = new Map();
  for (const row of all) {
    const fold = brandFoldKey(row?.brand);
    if (!fold) continue;
    if (!byFold.has(fold)) byFold.set(fold, new Map());
    const labels = byFold.get(fold);
    const label = row.brand.trim();
    labels.set(label, (labels.get(label) ?? 0) + 1);
  }
  for (const [fold, labels] of [...byFold.entries()].sort()) {
    if (labels.size < 2) continue;
    violationEntries.push({
      key: "split_brand_family",
      item: {
        id: `brand:${fold}`,
        store_domain: null,
        brand: [...labels.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([label, n]) => `${label} (${n})`)
          .join(" | "),
        title: null,
        category: null,
      },
    });
  }

  // Fingerprint the FULL tuple set, before any display cap is applied. Order is
  // load-bearing: enrichment_failed alone carries 76 items today, so hashing the
  // capped structure would make a fix or a new breakage among items 51–76
  // invisible. `count` is displayed but not hashed, so it cannot compensate.
  const fingerprint = fingerprintViolations(
    violationEntries.map(({ key, item }) => [key, item.id])
  );

  // Cross-row rule 2 — review tier. Excluded from `status` and from the
  // fingerprint by construction: it is assembled after the hash above.
  const tokenIndex = buildTokenBrandIndex(all);
  const flaggedRows = new Set(
    violationEntries.filter((e) => e.key === "brand_in_title").map((e) => e.item.id)
  );
  const reviewEntries = [];
  for (const row of all) {
    if (typeof row?.title !== "string" || flaggedRows.has(row.id)) continue;
    const tokens =
      row.title.replace(LEADING_SEASON, "").match(CAPITALISED_TOKEN) ?? [];
    const leading = tokens.slice(0, REVIEW_LEADING_TOKENS);
    const isRare = (token) => {
      if (token.length < REVIEW_MIN_TOKEN_LENGTH) return false;
      const brands = tokenIndex.get(token.toLowerCase());
      return Boolean(brands) && brands.size <= REVIEW_BRAND_DISTINCT_THRESHOLD;
    };
    if (leading.length < REVIEW_LEADING_TOKENS || !leading.every(isRare)) continue;
    const suspicious = leading;
    reviewEntries.push({
      key: "possible_off_allowlist_brand",
      item: {
        id: row.id,
        store_domain: row.store_domain ?? null,
        brand: row.brand ?? null,
        title: row.title,
        category: row.category ?? null,
        tokens: [...new Set(suspicious)],
      },
    });
  }

  const violations = groupByKey(violationEntries);
  return {
    status: violationEntries.length === 0 ? "ok" : "violations",
    violations,
    review: groupByKey(reviewEntries, REVIEW_DISPLAY_CAP),
    silent: { queued_null: queuedNull },
    scanned: all.length,
    fingerprint,
  };
}
