// Three-layer size parser for Shopify product data.
//
// Layer 1 (parseSizeFromOptions):
//   Look up the product option whose name matches Size / Taille / Pointure /
//   Talla (case-insensitive, trimmed). Return that option's value across all
//   variants, filtering out "Default Title" and empties.
//
// Layer 2 (parseSizeFromBody):
//   Two sub-patterns in priority order:
//   2a. Labeled: `Size:` / `SIZE :` / `Taille` / `Pointure` followed by a
//       value. Stops at next labeled field, comma, period, paren, or HTML
//       tag. Rejects negative phrases ("no size tag", "on request", etc).
//   2b. Unlabeled triplet/duo: `38 FR / M / 42 IT`, `S / 40 IT`. Requires
//       at least two size atoms (numeric+unit OR letter size) separated by
//       `/` or `·`. Pure letter-only standalone tokens don't match.
//
// parseSizes (orchestrator):
//   L1 → L2a → L2b. First non-null wins.
//
// Layer 3 (ONE SIZE fallback for Bags & Accessories) is applied by the
// PDP renderer (`resolveProductDetail`), NOT here — it's a presentation
// rule, not a parser rule, and depends on the row's category column.

// ---------- helpers ----------

function stripHtml(html) {
  if (typeof html !== "string") return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\xa0/g, " ");
}

const SIZE_OPTION_NAME = /^\s*(size|taille|pointure|talla)\s*$/i;

// ---------- Layer 1 ----------

export function parseSizeFromOptions(product) {
  const options = Array.isArray(product?.options) ? product.options : [];
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (options.length === 0 || variants.length === 0) return null;

  const idx = options.findIndex((o) => SIZE_OPTION_NAME.test(o?.name ?? ""));
  if (idx === -1) return null;

  // First-seen dedup: a 2-option Shopify product (e.g. Color × Size) lists
  // every size once per color variant, so naive collection yields
  // ["S","S","M","M"]. Set preserves insertion order in JS, so this also
  // preserves the seller's listing order (typically ascending size).
  //
  // Per-variant in-stock filtering is intentionally NOT applied here.
  // The listing endpoint exposes `variant.available`, but the current
  // (pre-redesign) PDP shows every variant label regardless of stock, so
  // adding a stock filter now would be a scope expansion, not a fix —
  // and a sold-out-only product would render with no SIZE block, which
  // is worse than showing the size and letting the storefront link
  // surface the out-of-stock state. Phase 2 candidate.
  const key = `option${idx + 1}`;
  const seen = new Set();
  for (const v of variants) {
    const val = typeof v?.[key] === "string" ? v[key].trim() : "";
    if (!val || val.toLowerCase() === "default title") continue;
    seen.add(val);
  }
  return seen.size > 0 ? [...seen] : null;
}

// ---------- Layer 2 ----------

// Match `size` / `taille` / `pointure` followed by either:
//   (a) ":" then any value (colon signals a value follows — permissive)
//   (b) whitespace then a size-shape first token (digit, S/M/L family,
//       OS, ONE SIZE, FITS, TBD) then more chars
// Rejects retail headings like "Size and fit:", "Size & Fit:",
// "Size guide", "Size range:" — they have neither a colon directly
// after the label nor a size-shape next token. (Codex round-2 finding.)
//
// Decimal handling: `.` is permitted inside the capture so that half-
// sizes like "Pointure: 40.5" or "Size: 38.5 IT" survive — common in
// shoe sizing. The terminator `\.(?!\d)` ensures a period that ENDS
// a sentence (period + space or end-of-string) still stops the capture,
// while a period between digits is treated as part of the value.
//
// Capture groups: (1) colon path, (2) no-colon path. parseSizeFromBody
// picks whichever matched.
const LABEL_RE = new RegExp(
  String.raw`\b(?:size|taille|pointure)` +
    String.raw`(?:` +
    String.raw`\s*:\s*([^<\n(]{1,80}?)` +
    String.raw`|` +
    String.raw`\s+((?:\d|XX?S\b|XX?L\b|XL\b|XS\b|[SML]\b|OS\b|ONE\s+SIZE\b|FITS?\b|TBD\b)[^<\n(]{0,79}?)` +
    String.raw`)` +
    String.raw`(?=\s+(?:[A-Z][a-zA-Z]+|[A-Z]+)\s*:|\.(?!\d)|[<\n(]|$)`,
  "i",
);

const REJECT_RE =
  /\b(no size tag|missing size tag|no tag|on request|n\/a|n a|unknown|not specified|unspecified|tba)\b/i;

const FITS_PREFIX_RE = /^\s*(?:fits?|aprox\.?|approx\.?)\s+/i;
const TRAILING_NOISE_RE = /\s+(?:women(?:'s)?|men(?:'s)?|unisex|kids?)\s*$/i;
const FROM_TO_RE = /\bfrom\s+(\S+?)\s+to\s+(\S+?)\b/i;
const NUMERIC_UNIT_RE = /(\d)(IT|EU|US|UK|FR)\b/gi;
const TRAILING_PUNCT_RE = /[\s:\-.,;]+$/;

const SIZE_ATOM = "(?:\\d{1,3}\\s*(?:FR|IT|EU|US|UK)|XX?S|XX?L|[SML])";
const TRIPLET_RE = new RegExp(
  `\\b(${SIZE_ATOM}(?:\\s*[/·]\\s*${SIZE_ATOM}){1,3})\\b`,
  "i",
);

function canonicalizeLabeled(raw) {
  if (!raw) return null;
  let p = raw.trim();
  if (REJECT_RE.test(p)) return null;
  p = p.replace(FITS_PREFIX_RE, "");
  p = p.replace(TRAILING_NOISE_RE, "");
  // Cut at " fit " — body shape note, not size data.
  p = p.split(/\bfit\b/i)[0];
  // "from X to Y" -> "X-Y"
  const ft = FROM_TO_RE.exec(p);
  if (ft) p = `${ft[1].toUpperCase()}-${ft[2].toUpperCase()}`;
  // "44IT" -> "44 IT"
  p = p.replace(NUMERIC_UNIT_RE, (_, d, u) => `${d} ${u.toUpperCase()}`);
  // Cut at first comma (often introduces a clarifier).
  p = p.split(",")[0];
  p = p.replace(TRAILING_PUNCT_RE, "").trim();
  return p || null;
}

function canonicalizeTriplet(raw) {
  let p = raw.trim();
  p = p.replace(/\s*\/\s*/g, " / ");
  p = p.replace(/\s*·\s*/g, " · ");
  p = p.replace(NUMERIC_UNIT_RE, (_, d, u) => `${d} ${u.toUpperCase()}`);
  p = p.replace(/\b(xx?s|xx?l|[sml])\b/gi, (m) => m.toUpperCase());
  return p.replace(TRAILING_PUNCT_RE, "").trim() || null;
}

export function parseSizeFromBody(bodyHtml) {
  const text = stripHtml(bodyHtml);
  if (!text) return null;

  const labeled = LABEL_RE.exec(text);
  if (labeled) {
    // LABEL_RE has two capture groups: colon path (1) and no-colon path
    // (2). Exactly one matches per execution; the other is undefined.
    const cleaned = canonicalizeLabeled(labeled[1] ?? labeled[2]);
    if (cleaned) return [cleaned];
  }

  const triplet = TRIPLET_RE.exec(text);
  if (triplet) {
    const cleaned = canonicalizeTriplet(triplet[1]);
    if (cleaned) return [cleaned];
  }

  return null;
}

// ---------- Orchestrator ----------

export function parseSizes(product) {
  if (!product || typeof product !== "object") return null;
  const fromOpts = parseSizeFromOptions(product);
  if (fromOpts) return fromOpts;
  return parseSizeFromBody(product.body_html);
}
