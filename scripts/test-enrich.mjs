// Smoke test for /api/enrich. Hits a preview or prod URL, polls until drained.
// Usage: node scripts/test-enrich.mjs https://depot-preview-xxx.vercel.app
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env.local") });

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("Usage: node scripts/test-enrich.mjs <base-url>");
  process.exit(1);
}

const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error("CRON_SECRET missing from .env.local");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function nullCount() {
  const { count } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true })
    .eq("available", true)
    .lt("enrich_attempts", 3)
    .or("brand.is.null,title.is.null,category.is.null");
  return count ?? 0;
}

const before = await nullCount();
console.log(`Pre-run null-editorial rows: ${before}`);

const t0 = Date.now();
const res = await fetch(`${baseUrl}/api/enrich`, {
  method: "POST",
  headers: { Authorization: `Bearer ${CRON_SECRET}` },
});
const body = await res.json();
console.log(`/api/enrich responded in ${Date.now() - t0}ms:`, body);

if (!body.chained) {
  const after = await nullCount();
  console.log(`Post-run null-editorial rows: ${after}`);
  console.log(`Drained: ${before - after}`);
  process.exit(0);
}

// Chain in flight — poll every 30s for up to 25 min.
console.log("Chain triggered. Polling...");
for (let i = 0; i < 50; i++) {
  await new Promise((r) => setTimeout(r, 30_000));
  const remaining = await nullCount();
  console.log(`[poll ${i + 1}] remaining: ${remaining}`);
  if (remaining === 0) {
    console.log(`Drained completely in ${Math.round((Date.now() - t0) / 1000)}s.`);
    process.exit(0);
  }
}
console.log("Timed out polling. Investigate Vercel logs.");
process.exit(2);
