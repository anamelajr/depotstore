import { NextResponse } from "next/server";
import { assertDev } from "../_gate.js";
import {
  loadAll,
  buildPrompt,
  callOpenAI,
  extractJson,
  VALID_LAYOUTS,
} from "../../../lib/draftEditorialPrompt.js";
import { buildStructurePlan } from "../../../lib/structurePlan.js";

export const maxDuration = 60;

export async function POST(request) {
  const gate = assertDev();
  if (gate) return gate;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const {
    title,
    brand,
    layout = "image-right",
    sourceValues = [],
    styleValues = [],
    notes = [],
    length = "medium",
    currentBlocks = [],
  } = body;

  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  if (!VALID_LAYOUTS.includes(layout)) {
    return NextResponse.json({ error: "invalid layout" }, { status: 400 });
  }

  // SECURITY: do NOT pass allowFiles: true here. The shared loadSource
  // helper defaults to "treat non-HTTP values as inline text" precisely
  // so request-controlled values can't escape into fs.readFile and
  // exfiltrate .env.local through the OpenAI prompt. See invariant #9.
  const sources = await loadAll(sourceValues);
  const styles = await loadAll(styleValues);
  const { plan, textBlockCount } = buildStructurePlan({ currentBlocks, length });

  const prompt = buildPrompt({
    title,
    brand: brand || title,
    layout,
    sources,
    styles,
    notes,
    structurePlan: plan,
  });

  let raw;
  try {
    raw = await callOpenAI(prompt);
  } catch (err) {
    return NextResponse.json({ error: `OpenAI: ${err.message}` }, { status: 502 });
  }

  let parsed;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    return NextResponse.json(
      { error: `JSON parse failed: ${err.message}`, raw },
      { status: 502 }
    );
  }

  return NextResponse.json({
    hero: parsed.hero ?? null,
    generatedBlocks: parsed.blocks ?? [],
    expectedTextCount: textBlockCount,
  });
}
