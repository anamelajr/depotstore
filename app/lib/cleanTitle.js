export async function cleanTitle(product) {
  const rawTitle = product?.name;
  if (!rawTitle) return null;

  const vendor = product?.vendor ?? null;
  const tags = Array.isArray(product?.tags) ? product.tags.join(", ") : "";
  const description = product?.rawDescription ?? "";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        max_completion_tokens: 60,
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
- Format: [Season+Year if present] [Garment type] [ONE detail max]
- Season ALWAYS comes first: "SS16 Wool Coat", "FW99 Wide Trousers"
- Decade markers (e.g. "2000s", "1990s") are treated the same as season codes — they come first in the title and are preserved: "2000s Crossbody Bag", "1990s Leather Jacket"
- If no season: "Wool Coat", "Leather Belt", "Wide Trousers"
- Maximum 7 words, Title Case only
- Remove: brand name, "(New Arrival)", "(runway)", "(on hold)", collection names in quotes, parentheticals
- If you cannot produce a clean 2-7 word title, return {"brand": "", "title": ""}

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

    if (!res.ok) return null;
    const data = await res.json();
    const cleaned = data?.choices?.[0]?.message?.content?.trim();

    if (cleaned) {
      try {
        const jsonText = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
        const parsed = JSON.parse(jsonText);
        const titleWords = parsed.title ? parsed.title.trim().split(/\s+/).length : 0;
        const brandValid = parsed.brand && parsed.brand.trim().length > 0;
        const titleValid = parsed.title && titleWords >= 2 && titleWords <= 7;

        // Accent-safe normalizer — matches normalizeBrand() style in stores.js
        const normalize = (s) =>
          s
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();

        // Guard 1: reject if Haiku echoed the raw name back unchanged.
        const echoedInput =
          titleValid && normalize(parsed.title) === normalize(rawTitle);

        // Guard 2: reject if a distinctive (≥4 char) brand token appears in
        // the title — catches leaks like brand "DIOR HOMME" with title
        // "Dior Wool Coat". Short tokens are skipped because they collide
        // with common words ("des"/"van" in multi-word brands, or "a"/"p"/"c"
        // from A.P.C.).
        const titleTokens = titleValid
          ? new Set(normalize(parsed.title).split(" ").filter(Boolean))
          : new Set();
        const brandTokens = brandValid
          ? normalize(parsed.brand).split(" ").filter((t) => t.length >= 4)
          : [];
        const brandInTitle = brandTokens.some((t) => titleTokens.has(t));

        if (brandValid && titleValid && !echoedInput && !brandInTitle) {
          return { brand: parsed.brand.trim(), title: parsed.title.trim() };
        }
      } catch {
        // JSON parse failed
      }
    }

    return null;
  } catch {
    return null;
  }
}