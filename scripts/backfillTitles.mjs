import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env.local") });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BATCH_SIZE = 25;
const DELAY_MS = 1500; // stay well under Tier 1 rate limits

// ── Deterministic cleanup ─────────────────────────────────────────────────────

const STORE_NAMES = new Set([
  "l'obscur", "dolce vita hub", "yourgarmentz", "numero 13 vintage",
  "les archives paris", "at dawn paris", "nuovo paris", "dot comme",
  "esco", "grain de sell", "seys wardrobe", "vintage",
]);

const JUNK_PREFIXES = [
  /^\(new arrival\)\s*/i,
  /^\(on hold\)\s*/i,
  /^\(sale\)\s*/i,
  /^\(runway\)\s*/i,
  /^\(reserved\)\s*/i,
  /^\(sold\)\s*/i,
];

function deterministicClean(row) {
  let raw = row.name ?? "";

  // Strip junk prefixes
  for (const pattern of JUNK_PREFIXES) {
    raw = raw.replace(pattern, "");
  }
  raw = raw.trim();

  // Try splitting on " - " — common format: "BRAND - item description"
  const dashParts = raw.split(/\s+[-–]\s+/);
  if (dashParts.length >= 2) {
    const possibleBrand = dashParts[0].trim();
    const possibleTitle = dashParts.slice(1).join(" - ").trim();
    // Only accept if brand part looks like a brand (not too long, no lowercase)
    if (possibleBrand.length < 40 && possibleBrand === possibleBrand.toUpperCase()) {
      return {
        brand: possibleBrand,
        title: toTitleCase(possibleTitle),
        resolved: true,
      };
    }
  }

  // Try vendor field as brand if it's not a store name
  if (false) { // vendor column not in Supabase schema
    const vendorUpper = row.vendor.toUpperCase();
    // Remove vendor from start of title if present
    const titleWithoutVendor = raw
      .replace(new RegExp(`^${escapeRegex(row.vendor)}\\s*[-–]?\\s*`, "i"), "")
      .trim();
    if (titleWithoutVendor && titleWithoutVendor !== raw) {
      return {
        brand: vendorUpper,
        title: toTitleCase(titleWithoutVendor),
        resolved: true,
      };
    }
    // Vendor exists but wasn't in the title — still use it as brand signal
    return {
      brand: vendorUpper,
      title: toTitleCase(raw),
      resolved: true,
    };
  }

  return { brand: null, title: null, resolved: false };
}

function toTitleCase(str) {
  return str
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Haiku batch cleaning ──────────────────────────────────────────────────────

async function cleanBatch(rows) {
  const titlesPayload = rows.map((r, i) => ({
    index: i,
    title: r.name ?? "",
    vendor: "unknown",
  }));

  const prompt = `You are cleaning vintage fashion product titles for an editorial platform.

For each product below, return a JSON array where each element has:
- "index": the same index number provided
- "brand": brand name in ALL CAPS (e.g. "RICK OWENS", "COMME DES GARÇONS"). Empty string "" if truly unidentifiable.
- "title": clean Title Case description, max 6 words, no brand name, no junk like (New Arrival)

Return ONLY the JSON array, no other text.

Products:
${JSON.stringify(titlesPayload, null, 2)}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error(`Haiku error: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text?.trim() ?? "";
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error("Batch parse error:", err.message);
    return null;
  }
}

// ── Dirty row detection ───────────────────────────────────────────────────────

function isDirty(row) {
  // Title identical to raw name — never cleaned
  if (!row.title || row.title === row.name) return true;
  // Still contains junk prefixes
  if (/^\(new arrival\)|^\(on hold\)|^\(sale\)|^\(runway\)/i.test(row.title)) return true;
  // Title contains " - " suggesting unsplit brand
  if (row.title.includes(" - ")) return true;
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching dirty products from Supabase...");

  // Paginate through all products to find dirty ones
  const PAGE = 1000;
  let from = 0;
  const dirty = [];

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("id, name, title, brand, store_domain")
      .range(from, from + PAGE - 1);

    if (error) { console.error("Fetch error:", error.message); break; }
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (isDirty(row)) dirty.push(row);
    }

    console.log(`Scanned ${from + data.length} rows, ${dirty.length} dirty so far...`);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`\nFound ${dirty.length} dirty products. Starting cleanup...\n`);

  let fixed = 0;
  let skipped = 0;

  for (let i = 0; i < dirty.length; i += BATCH_SIZE) {
    const batch = dirty.slice(i, i + BATCH_SIZE);
    const updates = [];

    // First pass — deterministic
    const needsHaiku = [];
    for (const row of batch) {
      const result = deterministicClean(row);
      if (result.resolved) {
        updates.push({ id: row.id, brand: result.brand, title: result.title });
      } else {
        needsHaiku.push(row);
      }
    }

    // Second pass — Haiku for ambiguous ones
    if (needsHaiku.length > 0) {
      const haikuResults = await cleanBatch(needsHaiku);
      if (haikuResults) {
        for (const result of haikuResults) {
          const row = needsHaiku[result.index];
          if (row && (result.brand || result.title)) {
            updates.push({
              id: row.id,
              brand: result.brand || null,
              title: result.title || row.title,
            });
          }
        }
      }
    }

    // Write updates to Supabase
    for (const update of updates) {
      const { error } = await supabaseAdmin
        .from("products")
        .update({ brand: update.brand, title: update.title })
        .eq("id", update.id);

      if (error) {
        console.error(`Failed updating id ${update.id}:`, error.message);
        skipped++;
      } else {
        fixed++;
      }
    }

    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(dirty.length / BATCH_SIZE)} — fixed: ${fixed}, skipped: ${skipped}`);

    // Delay between batches to respect rate limits
    if (i + BATCH_SIZE < dirty.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\nDone. Fixed: ${fixed}, Skipped: ${skipped}`);
}

main().catch(console.error);