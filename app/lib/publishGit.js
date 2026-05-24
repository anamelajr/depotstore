import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(_execFile);

const ALLOWLIST_PREFIXES = ["content/", "public/editorial/"];

function runGit(args, opts = {}) {
  return execFile("git", args, { cwd: process.cwd(), ...opts });
}

function runGh(args, opts = {}) {
  return execFile("gh", args, { cwd: process.cwd(), ...opts });
}

async function isGitRepo() {
  try {
    await runGit(["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

async function isGhAuthed() {
  try {
    await runGh(["auth", "status"]);
    return true;
  } catch {
    return false;
  }
}

async function getCurrentBranch() {
  const { stdout } = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  return stdout.trim();
}

async function getDefaultBranch() {
  try {
    const { stdout } = await runGh(["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
    return stdout.trim() || "main";
  } catch {
    return "main";
  }
}

async function getRepoNameWithOwner() {
  const { stdout } = await runGh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  return stdout.trim();
}

async function listDirtyAllowlisted() {
  const { stdout } = await runGit(["status", "--porcelain=v1"]);
  const paths = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    // Format: "XY path" or "XY old -> new" (renames)
    const raw = line.slice(3);
    const path = raw.includes(" -> ") ? raw.split(" -> ")[1] : raw;
    const trimmed = path.trim();
    if (ALLOWLIST_PREFIXES.some((p) => trimmed.startsWith(p))) {
      paths.push(trimmed);
    }
  }
  return paths;
}

async function branchOpenPr(branchName) {
  try {
    const { stdout } = await runGh(["pr", "list", "--head", branchName, "--state", "open", "--json", "number,url"]);
    const list = JSON.parse(stdout.trim() || "[]");
    return list[0] ?? null;
  } catch {
    return null;
  }
}

async function branchMergedPr(branchName) {
  try {
    const { stdout } = await runGh(["pr", "list", "--head", branchName, "--state", "merged", "--json", "number,url"]);
    const list = JSON.parse(stdout.trim() || "[]");
    return list[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract the first https://*.vercel.app preview URL from Vercel bot PR comments.
 * @param {string} commentsJson - raw JSON string from gh api .../issues/.../comments
 * @returns {string | null}
 */
function parseVercelPreviewFromComments(commentsJson) {
  let comments;
  try {
    comments = JSON.parse(commentsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(comments)) return null;

  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    const login = comment?.user?.login ?? "";
    if (login !== "vercel[bot]") continue;
    const body = comment?.body ?? "";
    const match = body.match(/https:\/\/[\w-]+\.vercel\.app/);
    if (match) return match[0];
  }
  return null;
}

async function getVercelInspectorUrl(prNumber) {
  try {
    const { stdout } = await runGh(
      ["pr", "view", String(prNumber), "--json", "statusCheckRollup"],
      { timeout: 3000 }
    );
    const data = JSON.parse(stdout.trim() || "{}");
    const checks = data?.statusCheckRollup ?? [];
    const vercelCheck = checks.find(
      (c) => c?.targetUrl && c.targetUrl.includes("vercel.com") && c?.context?.includes("Vercel")
    );
    return vercelCheck?.targetUrl ?? null;
  } catch {
    return null;
  }
}

export {
  runGit,
  runGh,
  isGitRepo,
  isGhAuthed,
  getCurrentBranch,
  getDefaultBranch,
  getRepoNameWithOwner,
  listDirtyAllowlisted,
  branchOpenPr,
  branchMergedPr,
  parseVercelPreviewFromComments,
  getVercelInspectorUrl,
};
