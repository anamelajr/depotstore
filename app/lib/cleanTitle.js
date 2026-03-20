import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export async function cleanTitle(rawTitle) {
  if (!rawTitle) return rawTitle;

  const cacheKey = `title:${rawTitle}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) return cached;
  } catch {
    // Redis unavailable, continue without cache
  }

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
- If no brand is identifiable, just write the description in sentence case with no dash
- Return only the formatted title, nothing else, no explanation
- If the title is very short or vague (like "Top", "Dress", "Jacket"), just return it in sentence case with no brand prefix — never ask for more information
- Always return a formatted title, never ask questions or request clarification

Title: ${rawTitle}`,
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