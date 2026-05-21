#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import {
  VALID_LAYOUTS,
  loadAll,
  buildPrompt,
  callOpenAI,
  extractJson,
} from "../app/lib/draftEditorialPrompt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
dotenv.config({ path: join(repoRoot, ".env.local") });

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
  const sources = await loadAll(args.sources, { allowFiles: true });
  const styles = await loadAll(args.styles, { allowFiles: true });
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
