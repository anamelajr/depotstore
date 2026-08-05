import { titleLeaksAllowedBrandStrict } from "./brand.js";

// Brand tokens shorter than the generic 4-char floor that must still block a
// write. Guard 2 skips short tokens because they collide with common words
// ("des"/"van" in multi-word brands, "a"/"p"/"c" from A.P.C.) — but that floor
// is exactly how "YSL" walked into 100+ titles under a SAINT LAURENT chip.
// Explicit membership, not a length tweak, so the collision class stays closed.
const SHORT_BRAND_TOKENS = new Set(["ysl", "mm6", "cdg"]);

// Accent-safe normalizer — matches normalizeBrand() style in stores.js
const normalize = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Post-parse validation for the model's {brand, title} object.
 *
 * Returns the trimmed, repaired pair, or null to reject. Null is RETRYABLE by
 * contract (CLAUDE.md): the caller cannot distinguish a reject here from a
 * transient OpenAI failure, and must not try to. The optional telemetry param
 * on cleanTitle() records WHICH null site fired for counters only — no caller
 * behavior may branch on it.
 *
 * Exported so the guards can be unit-tested without an HTTP round trip.
 */
export function validateCleanTitleResult(parsed, rawTitle) {
  if (!parsed || typeof parsed !== "object") return null;

  const brandValid =
    typeof parsed.brand === "string" && parsed.brand.trim().length > 0;
  // Repair, don't reject: the model occasionally emits a dangling attribution
  // ("… Leather Pants By") after dropping the era-designer that followed it.
  const title =
    typeof parsed.title === "string"
      ? parsed.title.trim().replace(/\s+by$/i, "").trim()
      : "";
  const titleWords = title ? title.split(/\s+/).length : 0;
  const titleValid = title.length > 0 && titleWords <= 7;
  if (!brandValid || !titleValid) return null;

  // Guard 1: reject if the model echoed the raw name back unchanged.
  if (normalize(title) === normalize(rawTitle ?? "")) return null;

  // Guard 2: reject if a distinctive brand token appears in the title —
  // catches leaks like brand "DIOR HOMME" with title "Dior Wool Coat".
  const titleTokens = new Set(normalize(title).split(" ").filter(Boolean));
  const brandTokens = normalize(parsed.brand)
    .split(" ")
    .filter((t) => t.length >= 4 || SHORT_BRAND_TOKENS.has(t));
  if (brandTokens.some((t) => titleTokens.has(t))) return null;

  // Guard 3: reject a leak of ANY allowlisted brand, not just the extracted
  // one — the era-designer / collaborator class ("Gucci By FW96 …" stored
  // under TOM FORD) that guard 2 structurally cannot see. Word-bounded so
  // "Silk Camisole" isn't refused for containing "ami".
  if (titleLeaksAllowedBrandStrict(title)) return null;

  return { brand: parsed.brand.trim(), title };
}

// telemetry (optional): caller-owned mutable object; each null site below
// increments one counter on it. Pure measurement — the return value stays
// object|null and no behavior may branch on which counter fired (CLAUDE.md
// pins null as uniformly retryable).
export async function cleanTitle(product, telemetry) {
  const bump = (key) => {
    if (telemetry) telemetry[key] = (telemetry[key] ?? 0) + 1;
  };
  const rawTitle = product?.name;
  if (!rawTitle) {
    bump("noName");
    return null;
  }

  const vendor = product?.vendor ?? null;
  const tags = Array.isArray(product?.tags) ? product.tags.join(", ") : "";
  const description = product?.rawDescription ?? "";

  // Per-call AbortController. Without this, a single hung OpenAI request
  // can run for the full Vercel maxDuration (300 s), eating the entire
  // batch budget and breaking the enrich chain by killing the function
  // before it can dispatch the next hop. 8 s is generous vs typical
  // gpt-5.6-terra latency at reasoning_effort "low" (~2 s) and short
  // enough that pathological calls don't dominate batch wall time.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-5.6-terra",
        // GPT-5.6 spends reasoning tokens out of max_completion_tokens
        // before writing any output; a cap of 60 returns finish_reason
        // "length" with EMPTY content on every call. Keep the cap well
        // above the ~40 reasoning tokens "low" effort uses.
        reasoning_effort: "low",
        max_completion_tokens: 200,
        messages: [
          {
            role: "user",
            content: `You are a vintage archive fashion expert extracting product data for Dépôt, a curated Paris editorial platform.

Return ONLY a JSON object: {"brand": "BRAND NAME", "title": "Clean Title"}

BRAND rules:
- Always ALL CAPS. E.g. "RICK OWENS", "ANN DEMEULEMEESTER", "YOHJI YAMAMOTO POUR HOMME"
- Extract from the title first
- Common formats:
    "BRAND - description"
    "(New Arrival) BRAND - description"
    "2000s BRAND description" (decade prefix — brand follows the decade)
    "FW2017 BRAND description" (season-year prefix — brand follows the season code)
    "SS1999 BRAND description" (season-year prefix — brand follows the season code)
- Era/season tokens at the start (e.g. "2000s", "1990s", "FW2017", "SS1999", "AW1999") are NOT the brand — skip past them to find the brand
- Numbers, decades, and season codes are never a brand
- The brand may be one or multiple words (e.g. "Prada", "Saint Laurent", "Dolce & Gabbana")
  It appears immediately after any era/season prefix and before the garment description
  Do NOT include garment or material descriptors (e.g. "Nylon", "Leather", "Wool", "Shirt", "Jacket") as part of the brand
- Also check the store description field — brand is sometimes mentioned there
- If truly unidentifiable, return {"brand": "", "title": ""}
- Never invent or guess

TITLE rules:
- Format: [Season+Year if present] [most distinctive detail] [Garment type]
- Season ALWAYS comes first: "SS16 Wool Coat", "FW99 Wide Trousers"
- Season codes are ALWAYS uppercase, compact, and use a 2-digit year: "SS04" (never "SS2004", "S/S 2004", "Ss04", "Spring/Summer 2004"). Split years keep both halves: "FW02/03" (never "Fw02/03" or "FW2002/2003")
- Convert spelled-out seasons to a code: "Fall/Winter 2003" → "FW03", "Autumn Winter 1997" → "FW97", "Spring 2000" → "SS00". "Pre-Fall", "Resort" and "Cruise" are distinct seasons — leave those spelled out
- Decade markers (e.g. "2000s", "1990s") are treated the same as season codes — they come first in the title and are preserved: "2000s Crossbody Bag", "1990s Leather Jacket"
- Include the single most distinctive detail the source name carries — material, silhouette, colour, or season — when one is present. NEVER reduce to a bare garment noun ("Dress", "Jacket", "Bag") if the source name has a usable descriptor. E.g. "Roberto Cavalli shearling hand painted jacket" → "Shearling Jacket" (not "Jacket"); "Dior fall 2003 velour dress" → "FW03 Velour Dress" (not "Dress")
- The detail MUST already appear in the source name (or description). NEVER invent a colour, material, silhouette, or season that is not in the source. If the source is genuinely sparse, e.g. "ACNE STUDIOS - Sweater", the correct title is just "Sweater" — do not fabricate a descriptor
- If no season or detail: a plain "Wool Coat", "Leather Belt", "Wide Trousers" is fine
- Maximum 7 words, Title Case only (season codes and decade markers keep their canonical casing — never title-case "FW02/03" into "Fw02/03")
- Remove ALL brand / designer / label names — the item's own brand AND any collaborator or era-designer, even when different from the brand you extracted — plus "(New Arrival)", "(runway)", "(on hold)", collection names in quotes, and other parentheticals
- E.g. "Gucci by Tom Ford shearling jacket" → "Shearling Jacket" (drop the era-designer "Tom Ford", keep the "Shearling" detail — never bare "Jacket"); "Chrome Hearts × Comme des Garçons tee" → "Tee" (drop the collaborator; when only the garment type remains, a single noun is the correct title)
- A clean 2-7 word title is ideal, but a single descriptive garment noun is also valid when the source is genuinely sparse after removing brand/designer names (e.g. "ACNE STUDIOS - Sweater" → "Sweater"; "Chrome Hearts × Comme des Garçons tee" → "Tee"). Only return {"brand": "", "title": ""} when there is no usable garment signal at all — never merely because a single word remains

QUALITY GATE — return {"brand": "", "title": ""} if:
- Brand not confidently identifiable
- Title would exceed 7 words
- Raw title is a placeholder with no fashion signal

Title: ${rawTitle}
Vendor: ${vendor ?? "unknown"}
Tags: ${tags || "none"}
Description from store: ${description ? description.slice(0, 400) : "none"}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      bump("httpError");
      if (telemetry) telemetry.lastHttpStatus = res.status;
      return null;
    }
    const data = await res.json();
    const cleaned = data?.choices?.[0]?.message?.content?.trim();

    if (cleaned) {
      try {
        const jsonText = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
        const parsed = JSON.parse(jsonText);
        const validated = validateCleanTitleResult(parsed, rawTitle);
        if (validated === null) bump("validationReject");
        return validated;
      } catch {
        bump("parseError");
      }
    } else {
      // 200 with empty content — the reasoning-token-starvation signature
      // (see max_completion_tokens comment above).
      bump("emptyContent");
    }

    return null;
  } catch {
    // AbortError from the timeout lands here too, returning null so
    // the row counts as a normal failure and increments enrich_attempts.
    // res.json() throwing on a malformed body also lands here, not in
    // parseError.
    bump("timeoutOrNetwork");
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}