import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export async function cleanTitle(product) {
  const rawTitle = product?.name;
  if (!rawTitle) return rawTitle;

  const CACHE_VERSION = "v4";
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
            content: `You are formatting vintage fashion product titles for an editorial platform.

OUTPUT FORMAT: BRAND — Description in sentence case
Example input: "Comme des Garçons HOMME 2000s Wool Tartan Scarf"
Example output: COMME DES GARÇONS HOMME — Wool tartan scarf 2000s
Bad example (too long): ALEXANDER McQUEEN — Sheer midi dress with hand embroidered beading and floral lace
Good example: ALEXANDER McQUEEN — Embroidered midi dress

Rules:
- Identify the brand from: the title itself, vendor field, tags, or description
- Brand goes first in ALL CAPS, then em dash, then description in sentence case
- Keep titles short — brand, item type, and ONE key detail maximum (e.g. color, fabric, or silhouette)
- Season/era codes always go at the end with a space, no comma (e.g. FW21, SS03, 2000s, 1990s)
- Never describe construction details, embellishments, or multiple features — that belongs in the description
- Remove parenthetical tags like (new arrival) (runway) (sale)
- Remove "by [designer name]" suffix credits
- Do not repeat the brand name in the description
- If truly no brand identifiable from any source, return description in sentence case only
- Return ONLY the formatted title, nothing else

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