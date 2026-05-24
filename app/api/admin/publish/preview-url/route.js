export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { assertDev } from "../../_gate.js";
import { runGh, getRepoNameWithOwner, parseVercelPreviewFromComments } from "../../../../lib/publishGit.js";

export async function GET(request) {
  const gate = assertDev();
  if (gate) return gate;

  const { searchParams } = new URL(request.url);
  const prStr = searchParams.get("pr");
  const prNumber = parseInt(prStr, 10);
  if (!prStr || isNaN(prNumber) || prNumber < 1) {
    return NextResponse.json({ error: "missing or invalid pr param" }, { status: 400 });
  }

  let nameWithOwner;
  try {
    nameWithOwner = await getRepoNameWithOwner();
  } catch (err) {
    const msg = err?.stderr?.split("\n")[0] || err?.message || "gh error";
    return NextResponse.json({ error: `could not resolve repo: ${msg}` }, { status: 500 });
  }

  let commentsJson;
  try {
    const { stdout } = await runGh(["api", `repos/${nameWithOwner}/issues/${prNumber}/comments`]);
    commentsJson = stdout;
  } catch (err) {
    const msg = err?.stderr?.split("\n")[0] || err?.message || "gh api error";
    return NextResponse.json({ error: `gh api error: ${msg}` }, { status: 500 });
  }

  const url = parseVercelPreviewFromComments(commentsJson);
  if (url) {
    return NextResponse.json({ url });
  }
  return NextResponse.json({ status: "pending" }, { status: 202 });
}
