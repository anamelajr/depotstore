#!/usr/bin/env node
// scripts/prewarm.js
// Pre-populates Upstash Redis with cleaned titles and editorial descriptions for all products.
// Usage: node scripts/prewarm.js

const fs = require("fs");
const path = require("path");

// Load .env.local before anything else
(function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  let content;
  try {
    content = fs.readFileSync(envPath, "utf8");
  } catch (e) {
    console.error("Could not read .env.local:", e.message);
    process.exit(1);
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
})();

const { Redis } = require("@upstash/redis");

const CACHE_VERSION = "v7";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const STORES = [
  { domain: "lobscur.com", storeName: "L'OBSCUR" },
  { domain: "dolcevitahub.com", storeName: "Dolce Vita Hub" },
  { domain: "seyswardrobe.fr", storeName: "Seys Wardrobe" },
  { domain: "numero13vintage.com", storeName: "Numero 13 Vintage" },
  { domain: "lesarchivesparis.com", storeName: "Les Archives Paris" },
  { domain: "atdawnparis.com", storeName: "at dawn paris" },
  { domain: "nuovo-paris.com", storeName: "Nuovo Paris" },
  { domain: "yourgarmentz.com", storeName: "yourgarmentz" },
  { domain: "www.dotcomme.net", storeName: "dot COMME" },
  { domain: "escoparis.com", storeName: "ESCO" },
  { domain: "graindesell.shop", storeName: "Grain de sell" },
];

function toAbsoluteUrl(inputUrl, domain) {
  if (typeof inputUrl !== "string" || inputUrl.length === 0) return null;
  try {
    if (/^https?:\/\//i.test(inputUrl)) return inputUrl;
    if (inputUrl.startsWith("/")) return `https://${domain}${inputUrl}`;
    return `https://${domain}/${inputUrl}`;
  } catch {
    return null;
  }
}

function normalizeProduct(product, store) {
  const name = typeof product?.title === "string" ? product.title : null;
  if (!name) return null;

  const productType =
    typeof product?.product_type === "string" ? product.product_type : "";
  const vendor = typeof product?.vendor === "string" ? product.vendor : null;
  const handle = typeof product?.handle === "string" ? product.handle : null;

  const tags = Array.isArray(product?.tags)
    ? product.tags.filter((t) => typeof t === "string")
    : typeof product?.tags === "string"
    ? product.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const images = Array.isArray(product?.images)
    ? product.images.map((img) => img?.src).filter(Boolean)
    : [];

  const rawDescription =
    typeof product?.body_html === "string"
      ? product.body_html
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      : null;

  const variants = Array.isArray(product?.variants) ? product.variants : [];
  let minPrice = null;
  for (const variant of variants) {
    const n = Number.parseFloat(String(variant?.price ?? ""));
    if (!Number.isFinite(n)) continue;
    minPrice = minPrice === null ? n : Math.min(minPrice, n);
  }
  const price = minPrice === null ? null : `€${minPrice.toFixed(2)}`;

  const productUrl =
    toAbsoluteUrl(product?.url, store.domain) ??
    (handle ? `https://${store.domain}/products/${handle}` : null);

  return {
    name,
    price,
    images,
    storeName: store.storeName,
    storeDomain: store.domain,
    productUrl,
    available: variants.some((v) => v?.available === true),
    productType,
    tags,
    vendor,
    handle,
    rawDescription,
    createdAt: product?.created_at ?? null,
  };
}

async function fetchStoreProducts(store) {
  const url =
    store.domain === "www.dotcomme.net"
      ? "https://www.dotcomme.net/collections/paris/products.json?limit=250"
      : `https://${store.domain}/products.json?limit=250`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const products = Array.isArray(data?.products) ? data.products : [];
  return products.map((p) => normalizeProduct(p, store)).filter(Boolean);
}

async function callClaude(content, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 120)}`);
  }
  const data = await res.json();
  return data?.content?.[0]?.text?.trim() ?? null;
}

async function prewarmProduct(product) {
  const rawTitle = product.name;
  const titleKey = `title:${CACHE_VERSION}:${rawTitle}`;
  const descKey = `desc:${CACHE_VERSION}:${rawTitle}`;

  const cachedTitle = await redis.get(titleKey);
  if (cachedTitle !== null) {
    return { skipped: true };
  }

  const vendor = product.vendor ?? null;
  const tags = Array.isArray(product.tags) ? product.tags.join(", ") : "";
  const description = product.rawDescription ?? "";

  const titleResult = await callClaude(
    `You are extracting and formatting vintage fashion product data for an editorial platform.

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
    60
  );

  const descResult = await callClaude(
    `You are writing editorial product descriptions for Dépôt, a curated Paris archive fashion platform.

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
Store: ${product.storeName ?? "unknown"}
Price: ${product.price ?? "unknown"}
Tags: ${tags || "none"}
Description from store: ${description ? description.slice(0, 500) : "none"}`,
    150
  );

  if (titleResult) await redis.set(titleKey, titleResult);
  if (descResult) await redis.set(descKey, descResult);

  return { skipped: false };
}

async function runWithConcurrency(concurrency, tasks) {
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      await tasks[i]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker)
  );
}

async function main() {
  console.log("Prewarming Redis cache...\n");
  const startTime = Date.now();
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const store of STORES) {
    process.stdout.write(`Fetching ${store.storeName}... `);
    let products;
    try {
      products = await fetchStoreProducts(store);
    } catch (e) {
      console.error(`FAILED (${e.message})`);
      continue;
    }
    console.log(`${products.length} products`);

    let storeProcessed = 0;
    let storeSkipped = 0;
    let storeFailed = 0;

    const tasks = products.map((product) => async () => {
      try {
        const { skipped } = await prewarmProduct(product);
        if (skipped) {
          storeSkipped++;
        } else {
          storeProcessed++;
          process.stdout.write(".");
        }
      } catch (e) {
        storeFailed++;
        console.error(`\n  [error] "${product.name}": ${e.message}`);
      }
    });

    await runWithConcurrency(20, tasks);

    if (storeProcessed > 0) process.stdout.write("\n");
    console.log(
      `  ${store.storeName}: ${storeProcessed} processed, ${storeSkipped} skipped${storeFailed ? `, ${storeFailed} failed` : ""}`
    );

    totalProcessed += storeProcessed;
    totalSkipped += storeSkipped;
    totalFailed += storeFailed;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n--- Summary ---");
  console.log(`Total processed : ${totalProcessed}`);
  console.log(`Total skipped   : ${totalSkipped}`);
  console.log(`Total failed    : ${totalFailed}`);
  console.log(`Time taken      : ${elapsed}s`);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
