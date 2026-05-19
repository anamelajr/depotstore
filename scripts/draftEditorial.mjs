#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
dotenv.config({ path: join(repoRoot, ".env.local") });

const VALID_LAYOUTS = ["image-right", "image-left", "image-below", "image-pair-top"];

function parseArgs(argv) {
  const args = {
    slug: null,
    title: null,
    brand: null,
    layout: "image-right",
    sources: [],
    styles: [],
    notes: [],
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--slug":    args.slug = next(); break;
      case "--title":   args.title = next(); break;
      case "--brand":   args.brand = next(); break;
      case "--layout":  args.layout = next(); break;
      case "--source":  args.sources.push(next()); break;
      case "--style":   args.styles.push(next()); break;
      case "--note":    args.notes.push(next()); break;
      case "--force":   args.force = true; break;
      case "--help":
      case "-h":        printHelp(); process.exit(0);
      default:
        if (a.startsWith("--")) {
          console.error(`Unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/draftEditorial.mjs --slug <slug> [options]

Options:
  --slug <slug>       Required. Output: content/editorial/<slug>.js
  --title <title>     Display title (e.g. "Rick Owens")
  --brand <brand>     Brand filter for "More from" (defaults to --title)
  --layout <name>     One of: ${VALID_LAYOUTS.join(", ")} (default: image-right)
  --source <path|url> Research material; repeatable
  --style  <path|url> Voice/tone reference; repeatable
  --note   <text>     Personal direction for the model; repeatable
  --force             Overwrite existing content/editorial/<slug>.js
  -h, --help          This help
`);
}

function validateArgs(args) {
  if (!args.slug) {
    console.error("Error: --slug is required.");
    process.exit(2);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(args.slug)) {
    console.error(`Error: --slug must be kebab-case (got "${args.slug}").`);
    process.exit(2);
  }
  if (!VALID_LAYOUTS.includes(args.layout)) {
    console.error(`Error: --layout must be one of: ${VALID_LAYOUTS.join(", ")}.`);
    process.exit(2);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY is not set (check .env.local).");
    process.exit(2);
  }
}

const MAX_SOURCE_CHARS = 6000;
const FETCH_TIMEOUT_MS = 15000;

async function loadSource(value) {
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

  try {
    const text = await fs.readFile(value, "utf8");
    return { value, error: null, text: text.slice(0, MAX_SOURCE_CHARS) };
  } catch (err) {
    return { value, error: err.message || String(err), text: null };
  }
}

async function loadAll(values) {
  const results = [];
  for (const v of values) {
    const r = await loadSource(v);
    if (r.error) {
      console.warn(`[draftEditorial] skipping ${v}: ${r.error}`);
    } else {
      results.push(r);
    }
  }
  return results;
}

function buildPrompt({ title, brand, layout, sources, styles, notes }) {
  const research = sources
    .map((s, i) => `<research source="${s.value}" index="${i + 1}">\n${s.text}\n</research>`)
    .join("\n\n");
  const style = styles
    .map((s, i) => `<style-reference source="${s.value}" index="${i + 1}">\n${s.text}\n</style-reference>`)
    .join("\n\n");
  const noteBlock = notes.length
    ? notes.map((n, i) => `<note index="${i + 1}">${n}</note>`).join("\n")
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
- Total blocks: between 8 and 14.

${research || "(no research provided)"}

${style || "(no style references provided)"}

${noteBlock || "(no personal notes provided)"}`;
}

async function callOpenAI(prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
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

function extractJson(content) {
  const cleaned = content
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

function serialize(value, indent = 0) {
  const pad = "  ".repeat(indent);
  const pad2 = "  ".repeat(indent + 1);
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") {
    return JSON.stringify(value).replace(/\\\\n/g, "\\n");
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => `${pad2}${serialize(v, indent + 1)}`);
    return `[\n${items.join(",\n")},\n${pad}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    const lines = keys.map((k) => `${pad2}${k}: ${serialize(value[k], indent + 1)}`);
    return `{\n${lines.join(",\n")},\n${pad}}`;
  }
  return JSON.stringify(value);
}

function buildModule({ slug, publishedAt, hero, brandFilter, blocks }) {
  const entry = {
    slug,
    publishedAt,
    hero,
    brandFilter,
    curatedProducts: [],
    blocks,
  };
  return `const entry = ${serialize(entry, 0)};\n\nexport default entry;\n`;
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);

  const outFile = join(repoRoot, "content", "editorial", `${args.slug}.js`);
  const imgDir = join(repoRoot, "public", "editorial", args.slug);
  const draftsDir = join(repoRoot, "drafts");

  if (existsSync(outFile) && !args.force) {
    console.error(`Error: ${outFile} already exists. Pass --force to overwrite.`);
    process.exit(1);
  }

  console.log("[draftEditorial] loading sources…");
  const sources = await loadAll(args.sources);
  const styles = await loadAll(args.styles);
  console.log(`[draftEditorial] sources=${sources.length} styles=${styles.length} notes=${args.notes.length}`);

  console.log("[draftEditorial] calling model (this may take 10-30s)…");
  const prompt = buildPrompt({
    title: args.title || args.slug,
    brand: args.brand || args.title || args.slug,
    layout: args.layout,
    sources,
    styles,
    notes: args.notes,
  });

  let raw;
  try {
    raw = await callOpenAI(prompt);
  } catch (err) {
    console.error(`[draftEditorial] OpenAI failed: ${err.message}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    await fs.mkdir(draftsDir, { recursive: true });
    const dump = join(draftsDir, `${args.slug}.raw.txt`);
    await fs.writeFile(dump, raw, "utf8");
    console.error(`[draftEditorial] JSON parse failed: ${err.message}`);
    console.error(`[draftEditorial] raw response saved to ${dump}`);
    process.exit(1);
  }

  const hero = {
    layout: args.layout,
    eyebrow: parsed.hero?.eyebrow || "Editorial",
    title: parsed.hero?.title || args.title || args.slug,
    subtitle: parsed.hero?.subtitle || "",
    byline: parsed.hero?.byline || "By DÉPÔT",
    images: args.layout === "image-pair-top" ? ["hero-1.jpg", "hero-2.jpg"] : ["hero.jpg"],
    imageAlt: parsed.hero?.imageAlt || [""],
  };

  const moduleSource = buildModule({
    slug: args.slug,
    publishedAt: todayIso(),
    hero,
    brandFilter: args.brand || args.title || args.slug,
    blocks: parsed.blocks || [],
  });

  await fs.mkdir(dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, moduleSource, "utf8");
  await fs.mkdir(imgDir, { recursive: true });
  await fs.writeFile(join(imgDir, ".gitkeep"), "", "utf8");

  console.log(`[draftEditorial] wrote ${outFile}`);
  console.log(`[draftEditorial] image dir ready: ${imgDir}`);
  console.log("[draftEditorial] next steps:");
  console.log(`  1. Open ${outFile}, review and edit the text.`);
  console.log(`  2. Drop hero + inline images into ${imgDir}.`);
  console.log(`  3. Add the entry to content/editorial/index.js (import + ENTRIES array).`);
  console.log(`  4. npm run dev — preview at /editorial/${args.slug}`);
}

main().catch((err) => {
  console.error("[draftEditorial] fatal:", err);
  process.exit(1);
});
