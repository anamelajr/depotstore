import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// Allowlisted prefixes for files the publish flow is willing to commit.
// Anything outside these prefixes is rejected up front to keep the route
// from accidentally committing source code, .env, lockfiles, etc.
const ALLOWLIST_PREFIXES = ["content/", "public/editorial/"];

function isAllowlisted(relPath) {
  return ALLOWLIST_PREFIXES.some((p) => relPath.startsWith(p));
}

export { isAllowlisted, ALLOWLIST_PREFIXES };

function run(cmd, args, opts = {}) {
  return execFileP(cmd, args, {
    cwd: opts.cwd ?? process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
    timeout: opts.timeout,
    env: process.env,
  });
}

export async function runGit(args, opts = {}) {
  return run("git", args, opts);
}

export async function runGh(args, opts = {}) {
  return run("gh", args, opts);
}

export async function isGitRepo(opts = {}) {
  try {
    await runGit(["rev-parse", "--git-dir"], opts);
    return true;
  } catch {
    return false;
  }
}

export async function getCurrentBranch(opts = {}) {
  const { stdout } = await runGit(
    ["rev-parse", "--abbrev-ref", "HEAD"],
    opts
  );
  return stdout.trim();
}

/**
 * Returns the list of relative paths that are dirty (modified, added, or
 * untracked) and fall under the publish allowlist. Uses --porcelain=v1 -z
 * so paths with whitespace round-trip safely.
 */
export async function listDirtyAllowlisted(opts = {}) {
  const { stdout } = await runGit(
    ["status", "--porcelain=v1", "-z"],
    opts
  );
  if (!stdout) return [];

  // -z output: each entry is `XY <path>\0` (renames carry the new name).
  // Status codes XY are exactly two chars followed by a space; paths run
  // until the next NUL.
  const entries = stdout.split("\0").filter(Boolean);
  const paths = [];
  for (const entry of entries) {
    // entry format: "XY path"
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    // For renames (`R `) the format is `R  new -> old` but with -z the
    // rename source comes as a separate NUL-terminated entry. The visible
    // path here is the new path.
    if (code.startsWith("R")) {
      // Skip the next entry — that's the rename source.
      // Iteration variable doesn't help us peek; rename of editorial
      // content is unsupported by the admin tool today, so simply ignore.
      continue;
    }
    paths.push(path);
  }
  return paths.filter(isAllowlisted);
}

/**
 * Returns the open PR for a branch (head=<branch>) as { url, number },
 * or null if none.
 */
export async function branchOpenPr(branch, opts = {}) {
  try {
    const { stdout } = await runGh(
      [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "open",
        "--json",
        "url,number",
        "--limit",
        "1",
      ],
      opts
    );
    const list = JSON.parse(stdout || "[]");
    return list[0] || null;
  } catch {
    return null;
  }
}

/**
 * Returns the most-recently-merged PR for a branch, or null if none.
 */
export async function branchMergedPr(branch, opts = {}) {
  try {
    const { stdout } = await runGh(
      [
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "merged",
        "--json",
        "url,number,mergedAt",
        "--limit",
        "1",
      ],
      opts
    );
    const list = JSON.parse(stdout || "[]");
    return list[0] || null;
  } catch {
    return null;
  }
}

const VERCEL_AUTHOR_RE = /^vercel(\[bot\])?$/i;
const VERCEL_URL_RE = /https?:\/\/[a-z0-9-]+(?:[a-z0-9-]+\.)*vercel\.app(?:\/[\w\-./?=&%#]*)?/i;

/**
 * Given a parsed JSON array of GitHub issue comments (the shape returned
 * by `gh pr view <num> --json comments`), return the first deployed
 * *.vercel.app URL that appears in a comment authored by the Vercel bot.
 * Returns null if none found.
 */
export function parseVercelPreviewFromComments(comments) {
  if (!Array.isArray(comments)) return null;
  for (const c of comments) {
    if (!c || typeof c !== "object") continue;
    const author = c.author?.login || c.user?.login || "";
    if (!VERCEL_AUTHOR_RE.test(author)) continue;
    const body = typeof c.body === "string" ? c.body : "";
    const match = body.match(VERCEL_URL_RE);
    if (match) return match[0];
  }
  return null;
}
