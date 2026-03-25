import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export async function cleanTitle(product) {
  const rawTitle = product?.name;
  if (!rawTitle) return rawTitle;

  const CACHE_VERSION = "v2";
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
            content: `You are formatting vintage fashion product titles for an editorial platform called Dépôt.

Format: BRAND — Item description in sentence case, Season code if available

Rules:
- Brand name in ALL CAPS
- Description in sentence case (not title case)
- Keep season codes if present (FW21, SS03, AW99 etc) at the end after a comma
- Remove parenthetical tags like (new arrival) (runway) (sale)
- Remove "by [designer name]" credits
- Remove redundant brand mentions in the description if already in the BRAND position
- If no brand is identifiable from title, vendor, tags or description, just write the description in sentence case with no dash
- Use vendor field or description to identify the brand if not in the title
- Return only the formatted title, nothing else, no explanation
- If the title is very short or vague (like "Top", "Dress", "Jacket"), just return it in sentence case with no brand prefix
- Always return a formatted title, never ask questions or request clarification

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