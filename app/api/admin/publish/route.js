import { NextResponse } from "next/server";
import { assertDev } from "../_gate.js";
import {
  decideBranchAction,
  isEditingBranch,
} from "../../../lib/publishOrchestrator.js";
import {
  isGitRepo,
  getCurrentBranch,
  listDirtyAllowlisted,
  branchOpenPr,
  branchMergedPr,
  runGit,
  runGh,
  isAllowlisted,
} from "../../../lib/publishGit.js";

const DEFAULT_BRANCH = "main";
const INSPECTOR_TIMEOUT_MS = 3000;

function refuse(status, error, extra = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

function firstStderrLine(err) {
  const raw = err?.stderr || err?.stdout || err?.message || String(err);
  return String(raw).split("\n")[0].trim();
}

function summariseDirty(paths, labelHint) {
  // edit <slug> per editorial entry, + registry for index.js,
  // Today's Edit for homepage json, + images per slug for new files
  // under public/editorial/<slug>/. Joined with ", ", prefixed
  // "content:", truncated to 70 chars with ellipsis.
  const parts = [];
  const editorialSlugs = new Set();
  const imageSlugs = new Set();
  let touchedRegistry = false;
  let touchedHomepage = false;

  for (const p of paths) {
    if (p === "content/editorial/index.js") {
      touchedRegistry = true;
      continue;
    }
    if (p === "content/homepage-edit.json") {
      touchedHomepage = true;
      continue;
    }
    const editorialMatch = p.match(/^content\/editorial\/([^/]+)\.js$/);
    if (editorialMatch) {
      editorialSlugs.add(editorialMatch[1]);
      continue;
    }
    const imgMatch = p.match(/^public\/editorial\/([^/]+)\//);
    if (imgMatch) {
      imageSlugs.add(imgMatch[1]);
      continue;
    }
  }

  if (editorialSlugs.size > 0) {
    parts.push(`edit ${[...editorialSlugs].join(", ")}`);
  }
  if (touchedRegistry) parts.push("+ registry");
  if (touchedHomepage) parts.push("Today's Edit");
  for (const slug of imageSlugs) {
    parts.push(`+ images (${slug})`);
  }

  let summary = parts.join(", ");
  if (!summary) {
    summary = labelHint || paths.join(", ");
  }
  const prefix = "content: ";
  const max = 70;
  const full = prefix + summary;
  if (full.length <= max) return full;
  return full.slice(0, max - 1) + "…";
}

async function tryInspectorUrl(prNumber) {
  try {
    const { stdout } = await runGh(
      ["pr", "view", String(prNumber), "--json", "statusCheckRollup"],
      { timeout: INSPECTOR_TIMEOUT_MS }
    );
    const data = JSON.parse(stdout || "{}");
    const checks = Array.isArray(data.statusCheckRollup)
      ? data.statusCheckRollup
      : [];
    const vercelCheck = checks.find(
      (c) =>
        typeof c?.context === "string" &&
        c.context.toLowerCase().includes("vercel") &&
        c.targetUrl
    ) ||
      checks.find(
        (c) =>
          typeof c?.name === "string" &&
          c.name.toLowerCase().includes("vercel") &&
          c.targetUrl
      );
    return vercelCheck?.targetUrl || null;
  } catch {
    return null;
  }
}

export async function POST(request) {
  const gate = assertDev();
  if (gate) return gate;

  const body = await request.json().catch(() => ({}));
  const requestedFiles = Array.isArray(body?.files) ? body.files : [];
  const newSession = body?.newSession === true;
  const labelHint = typeof body?.label === "string" ? body.label : "";

  for (const f of requestedFiles) {
    if (typeof f !== "string" || !isAllowlisted(f)) {
      return refuse(400, `file outside allowlist: ${f}`);
    }
  }

  if (!(await isGitRepo())) {
    return refuse(500, "not a git repository");
  }

  try {
    await runGh(["--version"]);
  } catch {
    return refuse(500, "gh CLI not found");
  }

  const currentBranch = await getCurrentBranch();

  let dirty;
  try {
    dirty = await listDirtyAllowlisted();
  } catch (err) {
    return refuse(500, `git status failed: ${firstStderrLine(err)}`);
  }
  if (dirty.length === 0) {
    return refuse(400, "no editable changes detected");
  }

  // Resolve open/merged PR state only if the branch could plausibly be
  // an editing branch — saves an extra gh call on main and feat/* branches.
  let openPr = null;
  let mergedPr = null;
  if (isEditingBranch(currentBranch)) {
    openPr = await branchOpenPr(currentBranch);
    mergedPr = openPr ? null : await branchMergedPr(currentBranch);
  }

  const decision = decideBranchAction({
    currentBranch,
    defaultBranch: DEFAULT_BRANCH,
    newSession,
    openPr,
    mergedPr,
    now: new Date(),
  });

  if (decision.action === "refuse") {
    const status = decision.code === "non-editing-branch" ? 409 : 409;
    return refuse(status, decision.message, {
      code: decision.code,
      suggestion: decision.suggestion,
      mergedPrUrl: decision.mergedPrUrl,
    });
  }

  let branchName;
  let stashed = false;

  if (decision.action === "create-and-switch") {
    branchName = decision.newBranchName;
    try {
      // Stash only the allowlisted dirty paths so `git checkout main` /
      // `git pull --ff-only` don't fail when origin/main has touched the
      // same files. We restore the stash after creating the new branch.
      await runGit(["stash", "push", "--include-untracked", "-m", "publish-orchestrator", "--", ...dirty]);
      stashed = true;
      await runGit(["fetch", "origin", DEFAULT_BRANCH]);
      await runGit(["checkout", DEFAULT_BRANCH]);
      try {
        await runGit(["pull", "--ff-only", "origin", DEFAULT_BRANCH]);
      } catch (err) {
        // Don't paper over a dirty/diverged local main; bail out
        // restoring the user's working tree.
        await runGit(["checkout", currentBranch]).catch(() => {});
        if (stashed) {
          await runGit(["stash", "pop"]).catch(() => {});
        }
        return refuse(
          500,
          `local ${DEFAULT_BRANCH} cannot fast-forward: ${firstStderrLine(err)}`
        );
      }
      await runGit(["checkout", "-b", branchName]);
      await runGit(["stash", "pop"]);
      stashed = false;
    } catch (err) {
      if (stashed) {
        await runGit(["stash", "pop"]).catch(() => {});
      }
      return refuse(500, `branch setup failed: ${firstStderrLine(err)}`);
    }
  } else {
    // use-current
    branchName = decision.branch;
  }

  // Stage and commit.
  try {
    await runGit(["add", "--", ...dirty]);
  } catch (err) {
    return refuse(500, `git add failed: ${firstStderrLine(err)}`);
  }

  const commitMessage = summariseDirty(dirty, labelHint);
  try {
    await runGit(["commit", "-m", commitMessage]);
  } catch (err) {
    return refuse(500, `git commit failed: ${firstStderrLine(err)}`);
  }

  let commitSha = "";
  try {
    const { stdout } = await runGit(["rev-parse", "--short", "HEAD"]);
    commitSha = stdout.trim();
  } catch {
    // non-fatal — leave empty
  }

  // Push. Try --set-upstream first; if it fails because upstream is set,
  // retry with plain push.
  try {
    await runGit(["push", "--set-upstream", "origin", branchName]);
  } catch (err) {
    try {
      await runGit(["push", "origin", branchName]);
    } catch (err2) {
      return refuse(
        500,
        `git push failed: ${firstStderrLine(err2) || firstStderrLine(err)}`
      );
    }
  }

  // Resolve PR — reuse existing open PR if we're on the same branch, else create.
  let prUrl;
  let prNumber;
  let prAction;

  if (openPr) {
    prUrl = openPr.url;
    prNumber = openPr.number;
    prAction = "updated";
  } else {
    const prTitle = `Content: ${labelHint || branchName.replace(/^content\/edit-/, "")}`;
    const prBody =
      "Local admin edit. Verify on the Vercel preview, then merge.";
    try {
      const { stdout } = await runGh([
        "pr",
        "create",
        "--base",
        DEFAULT_BRANCH,
        "--head",
        branchName,
        "--title",
        prTitle,
        "--body",
        prBody,
      ]);
      prUrl = stdout.trim().split("\n").pop();
      const numMatch = prUrl.match(/\/pull\/(\d+)/);
      prNumber = numMatch ? Number(numMatch[1]) : null;
      prAction = "created";
    } catch (err) {
      return refuse(500, `gh pr create failed: ${firstStderrLine(err)}`);
    }
  }

  const vercelInspectorUrl = prNumber ? await tryInspectorUrl(prNumber) : null;

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
