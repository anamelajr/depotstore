export async function generateDescription(product) {
  const rawTitle = product?.name;
  if (!rawTitle) return null;

  const vendor = product?.vendor ?? null;
  const tags = Array.isArray(product?.tags) ? product.tags.join(", ") : "";
  const description = product?.rawDescription ?? "";
  const price = product?.price ?? null;
  const storeName = product?.storeName ?? null;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5.6-sol",
        // GPT-5.6 spends reasoning tokens out of max_completion_tokens
        // before writing any output; too small a cap yields empty content.
        reasoning_effort: "low",
        max_completion_tokens: 500,
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
    return data?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}