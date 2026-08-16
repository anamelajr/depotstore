// Response validation + issue rendering for the formatting-audit workflow.
//
// Lives here, in JS, rather than in the workflow's shell: this code decides
// whether you are told, which makes it the most consequential logic in the
// design. A jq/sha256sum pipeline would be neither unit-testable nor
// reviewable.

// Human labels for the violation keys classifyRow emits. A key with no entry
// falls back to itself — an unmapped key must still be rendered, never dropped.
const KEY_LABELS = {
  enrichment_failed: "Enrichment gave up (editorial field still NULL past the retry cap)",
  non_canonical_brand: "Brand label is not the canonical spelling",
  split_brand_family: "Brand family split across spellings (filters as separate brands)",
  uncompacted_season_code: "Season code not in house form",
  season_not_first: "Season code is not the first token",
  sub_line_prefix: "Sub-line name leaked ahead of the season code",
  overlong_year: "Malformed season year",
  bare_letter_year: "Bare letter + 4-digit year",
  decade_with_season_prefix: "Decade marker wearing a season prefix",
  trailing_by: "Title ends in a dangling “By”",
  over_7_words: "Title is longer than 7 words",
  brand_in_title: "Allowlisted brand name leaked into the title",
  parenthetical: "Parenthetical in the title",
  dash_in_title: "Sub-line dash (“ - ”) in the title",
  possible_off_allowlist_brand: "Possible off-allowlist brand name in the title",
};

/**
 * Throw unless `payload` is a complete formatting-health response.
 *
 * Fail closed. A 200 returning `{}` is valid JSON with no violations, which
 * would read as all-clear and overwrite the living report with a false clean
 * status — so shape, not just parseability, is the gate. Violations themselves
 * are NOT a failure: the issue is the alert, and a red workflow must keep
 * meaning "the check itself is broken".
 */
export function validateReport(payload) {
  const bad = (msg) => {
    throw new Error(`invalid formatting-health response: ${msg}`);
  };
  const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

  if (!isPlainObject(payload)) bad("body is not an object");
  if (typeof payload.status !== "string" || payload.status === "") bad("missing status");
  if (!isPlainObject(payload.violations)) bad("missing violations object");
  if (!isPlainObject(payload.review)) bad("missing review object");
  if (!Number.isInteger(payload.scanned)) bad("missing or non-integer scanned");
  if (typeof payload.fingerprint !== "string" || payload.fingerprint === "") {
    bad("missing fingerprint");
  }
  if (typeof payload.checked_at !== "string" || payload.checked_at === "") {
    bad("missing checked_at");
  }
  return payload;
}

const FINGERPRINT_MARKER = "formatting-audit-fingerprint";

/** Fingerprint carried in a rendered body, or null. */
export function extractFingerprint(body) {
  const m = /<!-- formatting-audit-fingerprint: ([^\s>]+) -->/.exec(body ?? "");
  return m ? m[1] : null;
}

function renderItem(item) {
  const where = item.store_domain ? `[${item.store_domain}] ` : "";
  const value = [item.brand, item.title].filter(Boolean).join(" | ") || "—";
  const detail = item.tokens?.length
    ? ` — tokens: ${item.tokens.join(", ")}`
    : item.missing?.length
      ? ` — NULL: ${item.missing.join(", ")}`
      : "";
  return `- \`${item.id}\` ${where}${value}${detail}`;
}

function renderSection(groups) {
  const keys = Object.keys(groups).sort();
  if (keys.length === 0) return "_Nothing._\n";
  return keys
    .map((key) => {
      const { count, items, truncated } = groups[key];
      const head = `### ${KEY_LABELS[key] ?? key} — ${count} (\`${key}\`)`;
      const list = items.map(renderItem).join("\n");
      const tail = truncated ? `\n\n_Showing ${items.length} of ${count}._` : "";
      return `${head}\n\n${list}${tail}`;
    })
    .join("\n\n");
}

function totalCount(groups) {
  return Object.values(groups).reduce((n, g) => n + g.count, 0);
}

/**
 * Render the living report body.
 *
 * The issue is never closed, so "issue open" no longer signals "something is
 * wrong" — the first line carries the current status instead.
 */
export function renderIssueBody(payload) {
  const violations = totalCount(payload.violations);
  const review = totalCount(payload.review);
  const headline =
    violations === 0
      ? "✅ **No formatting violations.**"
      : `⚠️ **${violations} formatting violation${violations === 1 ? "" : "s"}.**`;

  return [
    headline,
    "",
    `Scanned ${payload.scanned} live items at ${payload.checked_at}. ` +
      `${payload.silent?.queued_null ?? 0} row(s) still queued for enrichment ` +
      `(silent by design). ${review} item(s) worth a glance.`,
    "",
    "## Violations",
    "",
    renderSection(payload.violations),
    "",
    "## Worth a glance",
    "",
    "_Review tier — deliberately fuzzy, excluded from the change fingerprint, " +
      "never mails on its own._",
    "",
    renderSection(payload.review),
    "",
    `<!-- ${FINGERPRINT_MARKER}: ${payload.fingerprint} -->`,
    "",
  ].join("\n");
}
