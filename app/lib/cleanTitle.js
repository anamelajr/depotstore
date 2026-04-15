export async function cleanTitle(product) {
  const rawTitle = product?.name;
  if (!rawTitle) return null;

  const vendor = product?.vendor ?? null;
  const tags = Array.isArray(product?.tags) ? product.tags.join(", ") : "";
  const description = product?.rawDescription ?? "";

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 60,
        messages: [
          {
            role: "user",
            content: `You are a vintage archive fashion expert extracting product data for Dépôt, a curated Paris editorial platform.

Return ONLY a JSON object: {"brand": "BRAND NAME", "title": "Clean Title"}

BRAND rules:
- Always ALL CAPS. E.g. "RICK OWENS", "ANN DEMEULEMEESTER", "YOHJI YAMAMOTO POUR HOMME"
- Extract from the title first — almost always at the start before a dash or separator
- Common formats: "BRAND - description", "(New Arrival) BRAND - description"
- Also check the store description field — brand is sometimes mentioned there
- If truly unidentifiable, return {"brand": "", "title": ""}
- Never invent or guess

TITLE rules:
- Format: [Season+Year if present] [Garment type] [ONE detail max]
- Season ALWAYS comes first: "SS16 Wool Coat", "FW99 Wide Trousers"
- If no season: "Wool Coat", "Leather Belt", "Wide Trousers"
- Maximum 5 words, Title Case only
- Remove: brand name, "(New Arrival)", "(runway)", "(on hold)", collection names in quotes, parentheticals
- If you cannot produce a clean 2-5 word title, return {"brand": "", "title": ""}

QUALITY GATE — return {"brand": "", "title": ""} if:
- Brand not confidently identifiable
- Title would exceed 5 words
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
    const cleaned = data?.content?.[0]?.text?.trim();

    if (cleaned) {
      try {
        const parsed = JSON.parse(cleaned);
        const titleWords = parsed.title ? parsed.title.trim().split(/\s+/).length : 0;
        const brandValid = parsed.brand && parsed.brand.trim().length > 0;
        const titleValid = parsed.title && titleWords >= 2 && titleWords <= 5;

        if (brandValid && titleValid) {
          return cleaned;
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