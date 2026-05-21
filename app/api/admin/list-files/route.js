import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { NextResponse } from "next/server";
import { assertDev } from "../_gate.js";

export async function GET(request) {
  const gate = assertDev();
  if (gate) return gate;

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }

  // Resolve and confirm we're still inside public/editorial/ — defense
  // against `..` traversal even though the regex prevents it.
  const root = resolve(process.cwd(), "public", "editorial");
  const dir = resolve(root, slug);
  if (!dir.startsWith(root + "/") && dir !== root) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }

  try {
    const entries = await fs.readdir(dir);
    const files = entries
      .filter((name) => !name.startsWith("."))
      .filter((name) => /\.(webp|jpg|jpeg|png|avif)$/i.test(name))
      .sort();
    return NextResponse.json({ files });
  } catch (err) {
    if (err.code === "ENOENT") return NextResponse.json({ files: [] });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
