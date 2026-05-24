export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { assertDev } from "../_gate.js";
import { decideBranchAction } from "../../../lib/publishOrchestrator.js";
import {
  isGitRepo,
  isGhAuthed,
  getCurrentBranch,
  getDefaultBranch,
  listDirtyAllowlisted,
  branchOpenPr,
  branchMergedPr,
  runGit,
  runGh,
  getVercelInspectorUrl,
} from "../../../lib/publishGit.js";

const ALLOWLIST_PREFIXES = ["content/", "public/editorial/"];

function generateCommitMessage(dirtyPaths, label) {
  const parts = [];
  const slugsSeen = new Set();

  for (const p of dirtyPaths) {
    if (p === "content/editorial/index.js") {
      parts.push("+ registry");
    } else if (p === "content/homepage-edit.json") {
      parts.push("Today's Edit");
    } else if (p.startsWith("content/editorial/") && p.endsWith(".js")) {
      const slug = p.slice("content/editorial/".length, -3);
      parts.push(`edit ${slug}`);
    } else if (p.startsWith("public/editorial/")) {
      const slug = p.split("/")[2];
      if (slug && !slugsSeen.has(slug)) {
        slugsSeen.add(slug);
        parts.push(`+ images`);
      }
    }
  }

  if (parts.length === 0 && label) {
    parts.push(`edit ${label}`);
  }

  const body = parts.join(", ");
  const full = `content: ${body}`;
  return full.length > 70 ? full.slice(0, 67) + "…" : full;
}

export async function POST(request) {
  const gate = assertDev();
  if (gate) return gate;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { files, newSession = false, label } = body;

  // Confirm git repo
  if (!(await isGitRepo())) {
    return NextResponse.json({ error: "not a git repository" }, { status: 500 });
  }

  // Confirm gh CLI is available and authenticated
  if (!(await isGhAuthed())) {
    return NextResponse.json({ error: "gh CLI not found or not authenticated — run: gh auth login" }, { status: 500 });
  }

  // Scan dirty files under allowlist
  const allDirtyPaths = await listDirtyAllowlisted();
  if (allDirtyPaths.length === 0) {
    return NextResponse.json({ error: "no editable changes detected — save your changes first" }, { status: 400 });
  }

  // Validate any explicitly-passed file paths are within allowlist
  if (Array.isArray(files)) {
    for (const f of files) {
      if (!ALLOWLIST_PREFIXES.some((p) => String(f).startsWith(p))) {
        return NextResponse.json({ error: `file outside allowlist: ${f}` }, { status: 400 });
      }
    }
  }

  // Restrict staged paths to the requested files/prefixes when provided
  const dirtyPaths = Array.isArray(files) && files.length > 0
    ? allDirtyPaths.filter((p) => files.some((f) => p === f || p.startsWith(f)))
    : allDirtyPaths;
  if (dirtyPaths.length === 0) {
    return NextResponse.json({ error: "no editable changes in the specified files — save first" }, { status: 400 });
  }

  const currentBranch = await getCurrentBranch();
  const defaultBranch = await getDefaultBranch();

  // Only check for open/merged PR if we're on a content/edit-* branch
  let openPr = null;
  let mergedPr = null;
  if (currentBranch.startsWith("content/edit-")) {
    [openPr, mergedPr] = await Promise.all([
      branchOpenPr(currentBranch),
      branchMergedPr(currentBranch),
    ]);
  }

  const decision = decideBranchAction({ currentBranch, defaultBranch, newSession, openPr, mergedPr });

  if (decision.action === "refuse") {
    if (decision.code === "on-main") {
      return NextResponse.json(
        { error: `on main; pass { newSession: true } to start an editing branch`, suggestion: "newSession" },
        { status: 409 }
      );
    }
    if (decision.code === "merged-pr") {
      return NextResponse.json(
        { error: "branch has merged PR; start a new session", suggestion: "newSession", mergedPrUrl: decision.mergedPrUrl },
        { status: 409 }
      );
    }
    if (decision.code === "non-editing-branch") {
      return NextResponse.json(
        { error: `on non-editing branch '${currentBranch}' — switch to main or a content/edit-* branch first` },
        { status: 409 }
      );
    }
  }

  let branchName = currentBranch;

  // Create and switch to a new branch if needed
  if (decision.action === "create-and-switch") {
    branchName = decision.newBranchName;
    try {
      await runGit(["fetch", "origin", defaultBranch]);
      await runGit(["checkout", defaultBranch]);
      await runGit(["pull", "--ff-only", "origin", defaultBranch]);
      await runGit(["checkout", "-b", branchName]);
    } catch (err) {
      const msg = err?.stderr?.split("\n")[0] || err?.message || "unknown git error";
      return NextResponse.json({ error: `git branch setup failed: ${msg}` }, { status: 500 });
    }
  }

  // Stage dirty allowlisted files
  try {
    for (const p of dirtyPaths) {
      await runGit(["add", "--", p]);
    }
  } catch (err) {
    const msg = err?.stderr?.split("\n")[0] || err?.message || "git add failed";
    return NextResponse.json({ error: `git add failed: ${msg}` }, { status: 500 });
  }

  // Commit
  const commitMessage = generateCommitMessage(dirtyPaths, label);
  let commitSha;
  try {
    await runGit(["commit", "-m", commitMessage, "--", ...dirtyPaths]);
    const { stdout } = await runGit(["rev-parse", "--short", "HEAD"]);
    commitSha = stdout.trim();
  } catch (err) {
    const msg = err?.stderr?.split("\n")[0] || err?.message || "git commit failed";
    return NextResponse.json({ error: `git commit failed: ${msg}` }, { status: 500 });
  }

  // Push
  try {
    await runGit(["push", "--set-upstream", "origin", branchName]);
  } catch {
    try {
      await runGit(["push", "origin", branchName]);
    } catch (err) {
      const msg = err?.stderr?.split("\n")[0] || err?.message || "push failed";
      return NextResponse.json({ error: `git push failed: ${msg}` }, { status: 500 });
    }
  }

  // PR: reuse existing open PR or create new one
  const existingPr = decision.action === "use-current" ? openPr : null;
  let prUrl, prNumber, prAction;

  if (existingPr) {
    prUrl = existingPr.url;
    prNumber = existingPr.number;
    prAction = "updated";
  } else {
    try {
      const prTitle = label ? `Content: ${label}` : `Content: ${dirtyPaths[0]}`;
      const { stdout } = await runGh([
        "pr", "create",
        "--base", defaultBranch,
        "--head", branchName,
        "--title", prTitle,
        "--body", "Local admin edit. Verify on the Vercel preview, then merge.",
      ]);
      const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
      prUrl = urlMatch ? urlMatch[0] : stdout.trim();
      const numMatch = prUrl.match(/\/pull\/(\d+)$/);
      prNumber = numMatch ? parseInt(numMatch[1], 10) : null;
      prAction = "created";
    } catch (err) {
      // May already have an open PR if push triggered creation race — try to find it
      const existing = await branchOpenPr(branchName);
      if (existing) {
        prUrl = existing.url;
        prNumber = existing.number;
        prAction = "found";
      } else {
        const msg = err?.stderr?.split("\n")[0] || err?.message || "gh pr create failed";
        return NextResponse.json({ error: `PR creation failed: ${msg}` }, { status: 500 });
      }
    }
  }

  // Best-effort inspector URL (3s timeout)
  const vercelInspectorUrl = prNumber ? await getVercelInspectorUrl(prNumber) : null;

  return NextResponse.json({
    ok: true,
    branch: branchName,
    commitSha,
    prUrl,
    prNumber,
    prAction,
    vercelInspectorUrl,
  });
}
