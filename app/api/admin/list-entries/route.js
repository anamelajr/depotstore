import { promises as fs } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { assertDev } from "../_gate.js";

export async function GET() {
  const gate = assertDev();
  if (gate) return gate;

  const dir = join(process.cwd(), "content", "editorial");
  const files = await fs.readdir(dir);

  const entries = [];
  for (const file of files) {
    if (!file.endsWith(".js") || file === "index.js") continue;
    const slug = file.replace(/\.js$/, "");
    try {
      // Cache-bust so we always get the latest file content during dev.
      const mod = await import(join(dir, file) + `?t=${Date.now()}`);
      const entry = mod.default;
      entries.push({
        slug,
        title: entry?.hero?.title ?? slug,
        publishedAt: entry?.publishedAt ?? "",
        brandFilter: entry?.brandFilter ?? "",
      });
    } catch (err) {
      entries.push({ slug, title: slug, error: err.message });
    }
  }

  entries.sort((a, b) =>
    (b.publishedAt || "").localeCompare(a.publishedAt || "")
  );
  return NextResponse.json({ entries });
}
