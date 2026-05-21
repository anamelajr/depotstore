import { NextResponse } from "next/server";
import { assertDev } from "../../_gate.js";
import {
  runGh,
  parseVercelPreviewFromComments,
} from "../../../../lib/publishGit.js";

export async function GET(request) {
  const gate = assertDev();
  if (gate) return gate;

  const { searchParams } = new URL(request.url);
  const pr = searchParams.get("pr");
  if (!pr || !/^\d+$/.test(pr)) {
    return NextResponse.json(
      { error: "missing or invalid ?pr=<number>" },
      { status: 400 }
    );
  }

  let comments;
  try {
    const { stdout } = await runGh([
      "pr",
      "view",
      pr,
      "--json",
      "comments",
    ]);
    const data = JSON.parse(stdout || "{}");
    comments = Array.isArray(data.comments) ? data.comments : [];
  } catch (err) {
    const stderr = String(err?.stderr || err?.message || err).split("\n")[0];
    return NextResponse.json(
      { error: `gh pr view failed: ${stderr}` },
      { status: 500 }
    );
  }

  const url = parseVercelPreviewFromComments(comments);
  if (url) {
    return NextResponse.json({ url });
  }
  return NextResponse.json({ status: "pending" }, { status: 202 });
}
