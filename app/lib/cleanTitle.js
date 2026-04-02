import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export async function cleanTitle(product) {
  const rawTitle = product?.name;
  if (!rawTitle) return rawTitle;

  const CACHE_VERSION = "v7";
const cacheKey = `title:${CACHE_VERSION}:${rawTitle}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) return cached;
  } catch {
    // Redis unavailable, continue without cache
  }

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
            content: `You are extracting and formatting vintage fashion product data for an editorial platform.

Return ONLY a JSON object in this exact format, nothing else:
{"brand": "BRAND NAME IN ALL CAPS", "title": "Title Case Description"}

Rules for brand:
- Extract the brand from the title itself first — it is almost always at the start
- Brand must be in ALL CAPS (e.g. "RICK OWENS", "COMME DES GARÇONS", "JUNYA WATANABE")
- The vendor field sometimes contains the real brand name — use it if the title has no clear brand signal
- Only ignore the vendor field if it exactly matches one of these store names: "L'Obscur", "Dolce Vita Hub", "yourgarmentz", "Numero 13 Vintage", "Les Archives Paris", "at dawn paris", "Nuovo Paris", "dot COMME", "ESCO", "Grain de Sell", "Seys Wardrobe", "VINTAGE"
- Never hallucinate a brand — if truly no brand identifiable from title or vendor, return empty string ""

Rules for title:
- Title case — first letter of every word capitalised (e.g. "Long Parka FW11", "Wool Tartan Scarf 2000s")
- Remove the brand name from the title entirely
- Keep item type and ONE key detail maximum (colour, fabric, or silhouette)
- Season/era codes always at the end (e.g. FW11, SS03, 2000s)
- Remove parenthetical tags like (New Arrival) (Runway) (Sale)
- Keep it short — maximum 6 words

Title: ${rawTitle}
Vendor: ${vendor ?? "unknown"}
Tags: ${tags || "none"}
Description: ${description ? description.slice(0, 300) : "none"}`,
          },
        ],
      }),
    });

    if (!res.ok) return rawTitle;
    const data = await res.json();
    const cleaned = data?.content?.[0]?.text?.trim() ?? rawTitle;

    try {
      await redis.set(cacheKey, cleaned);
    } catch {
      // ignore cache write failure
    }

    return cleaned;
  } catch {
    return rawTitle;
  }
}