import { promises as fs } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { assertDev } from "../_gate.js";

export async function POST(request) {
  const gate = assertDev();
  if (gate) return gate;

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.picks)) {
    return NextResponse.json({ error: "expected { picks: [] }" }, { status: 400 });
  }
  if (body.picks.length > 8) {
    return NextResponse.json({ error: "max 8 picks" }, { status: 400 });
  }
  const normalized = [];
  for (const p of body.picks) {
    if (!p || typeof p.storeDomain !== "string" || typeof p.handle !== "string") {
      return NextResponse.json(
        { error: "each pick must be { storeDomain: string, handle: string }" },
        { status: 400 }
      );
    }
    normalized.push({ storeDomain: p.storeDomain, handle: p.handle });
  }

  const file = join(process.cwd(), "content", "homepage-edit.json");
  const tmpFile = `${file}.tmp.${process.pid}.${Date.now()}`;

  const json = JSON.stringify(normalized, null, 2) + "\n";
  try {
    await fs.writeFile(tmpFile, json, "utf8");
    await fs.rename(tmpFile, file);
  } catch (err) {
    await fs.unlink(tmpFile).catch(() => {});
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: normalized.length });
}
