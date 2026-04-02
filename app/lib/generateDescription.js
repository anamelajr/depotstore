import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export async function generateDescription(product) {
  const rawTitle = product?.name;
  if (!rawTitle) return null;

  const CACHE_VERSION = "v7";
const cacheKey = `desc:${CACHE_VERSION}:${rawTitle}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) return cached;
  } catch {
    // Redis unavailable, continue without cache
  }

  const vendor = product?.vendor ?? null;
  const tags = Array.isArray(product?.tags) ? product.tags.join(", ") : "";
  const description = product?.rawDescription ?? "";
  const price = product?.price ?? null;
  const storeName = product?.storeName ?? null;

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
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: `You are writing editorial product descriptions for Dépôt, a curated Paris archive fashion platform.

Write a short, clean, editorial description of 2-4 sentences. 

Rules:
- Only use information from the data provided below — never invent details
- Include brand, item type, key details (color, material, construction) if available
- Include season/collection if present in the data
- Include size and condition if available
- If there is interesting provenance or context in the description (like "worn by Lenny Kravitz"), include it
- Tone: confident, minimal, editorial — like a luxury archive catalogue
- Never use marketing language or superlatives
- Never fabricate historical claims or collection context not in the source data
- Return only the description, nothing else

Product data:
Title: ${rawTitle}
Vendor: ${vendor ?? "unknown"}
Store: ${storeName ?? "unknown"}
Price: ${price ?? "unknown"}
Tags: ${tags || "none"}
Description from store: ${description ? description.slice(0, 500) : "none"}`,
          },
        ],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const generated = data?.content?.[0]?.text?.trim() ?? null;

    try {
      if (generated) await redis.set(cacheKey, generated);
    } catch {
      // ignore cache write failure
    }

    return generated;
  } catch {
    return null;
  }
}