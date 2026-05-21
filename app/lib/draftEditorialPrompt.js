// Shared drafting prompt + OpenAI call. Used by both
// scripts/draftEditorial.mjs (CLI) and app/api/admin/draft/route.js.
import { promises as fs } from "node:fs";

export const VALID_LAYOUTS = [
  "image-right",
  "image-left",
  "image-below",
  "image-pair-top",
];

const MAX_SOURCE_CHARS = 6000;
const FETCH_TIMEOUT_MS = 15000;

// Treat any non-HTTP value as either a filesystem path (CLI only) or
// pasted text. The API route MUST NOT pass allowFiles: true — request-
// controlled paths would let a hostile local process exfiltrate .env.local
// via the OpenAI prompt.
export async function loadSource(value, { allowFiles = false } = {}) {
  if (/^https?:\/\//i.test(value)) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(value, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        },
        signal: controller.signal,
      });
      if (!res.ok) return { value, error: `HTTP ${res.status}`, text: null };
      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { value, error: null, text: text.slice(0, MAX_SOURCE_CHARS) };
    } catch (err) {
      return { value, error: err.message || String(err), text: null };
    } finally {
      clearTimeout(t);
    }
  }

  if (!allowFiles) {
    // The API route reaches here. Treat the value as inline text rather
    // than a filesystem path. The label is shown to the model as the
    // source identifier ("pasted-1", "pasted-2", …) since there's no URL.
    return {
      value: "pasted",
      error: null,
      text: String(value).slice(0, MAX_SOURCE_CHARS),
    };
  }

  // CLI only: load from disk.
  try {
    const text = await fs.readFile(value, "utf8");
    return { value, error: null, text: text.slice(0, MAX_SOURCE_CHARS) };
  } catch (err) {
    return { value, error: err.message || String(err), text: null };
  }
}

export async function loadAll(values, { allowFiles = false } = {}) {
  const results = [];
  for (const v of values) {
    const r = await loadSource(v, { allowFiles });
    if (r.error) {
      console.warn(`[draftEditorial] skipping ${v}: ${r.error}`);
    } else {
      results.push(r);
    }
  }
  return results;
}

export function buildPrompt({
  title,
  brand,
  layout,
  sources,
  styles,
  notes,
  structurePlan = "",
}) {
  const research = sources
    .map(
      (s, i) =>
        `<research source="${s.value}" index="${i + 1}">\n${s.text}\n</research>`
    )
    .join("\n\n");
  const style = styles
    .map(
      (s, i) =>
        `<style-reference source="${s.value}" index="${i + 1}">\n${s.text}\n</style-reference>`
    )
    .join("\n\n");
  const noteBlock = notes.length
    ? notes.map((n, i) => `<note index="${i + 1}">${n}</note>`).join("\n")
    : "";

  const structureSection = structurePlan
    ? `\n\nSTRUCTURE (you must produce exactly this block sequence):\n${structurePlan}\n\nEvery text block must end on a complete sentence AND a complete idea — no clauses that depend on the next block, because there may be an image break before the next text block.\n`
    : "";

  return `You are drafting an editorial profile for Dépôt, a curated Paris archive-fashion platform. Dépôt's voice is short, opinionated, image-led, confident — closer to a fashion zine than to SEO copy.

Write a profile of ${title}${brand && brand !== title ? ` (brand: ${brand})` : ""}. The hero layout will be "${layout}".

Output STRICT JSON only — no prose before or after, no markdown fences. The JSON object must match this shape exactly:

{
  "hero": {
    "eyebrow": "Editorial",
    "title": "<short, can match input>",
    "subtitle": "<one or two short lines, can use \\n for a line break>",
    "byline": "By DÉPÔT",
    "imageAlt": ["<short alt for hero image>"]
  },
  "blocks": [
    { "type": "text", "width": "narrow", "dropcap": true, "body": "<3-6 sentences, opens the piece>" },
    { "type": "section-heading", "text": "<3-5 word eyebrow>" },
    { "type": "text", "width": "narrow", "body": "<2-4 sentences>" },
    { "type": "image", "src": "", "width": "full-bleed", "alt": "<describe what should go here>" },
    { "type": "pullquote", "text": "<a short, opinionated quote>", "attribution": "<who said it, year if known, or 'Attributed'>" },
    { "type": "text", "width": "narrow", "body": "<2-4 sentences>" }
  ]
}

Rules:
- Text blocks: 2-6 sentences each. No filler. Strong, declarative voice. No "this designer", "this brand" — name them.
- Section-headings: 3-5 words, like a magazine eyebrow ("Architecture as attitude", "The Antwerp instinct").
- Pull quote: short (one or two sentences). If you don't have a real attributed quote from the research, you may write one in the designer's voice but set attribution to "Attributed".
- Image blocks: leave "src" empty (the author drops images in later). Use "alt" to describe what photo should fit there.
- Vary block order — don't always go text/image/text/image. Two text blocks in a row are fine. Two images in a row become a pair (use "image-pair" with two images).
- Treat <research> tags as factual sources to draw from. Treat <style-reference> tags as voice/tone you should echo. Treat <note> tags as personal direction from the editor that you must honor.
- Total blocks: between 8 and 14.${structureSection}

${research || "(no research provided)"}

${style || "(no style references provided)"}

${noteBlock || "(no personal notes provided)"}`;
}

export async function callOpenAI(prompt, { apiKey = process.env.OPENAI_API_KEY } = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5.5",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");
  return content;
}

export function extractJson(content) {
  const cleaned = content
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
  return JSON.parse(cleaned);
}
