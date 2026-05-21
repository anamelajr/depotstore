// Pure branch-decision state machine for the admin publish flow.
//
// Given the current git state (branch name, open/merged PR for that branch),
// decide whether to (a) create a fresh dated branch off main, (b) reuse the
// current editing branch, or (c) refuse with a documented code.
//
// Kept side-effect-free so the decision table can be exercised exhaustively
// in unit tests without touching git or gh.

const EDITING_BRANCH_PREFIX = "content/edit-";
const EDITING_BRANCH_RE = /^content\/edit-/;

function formatTimestamp(date) {
  // yyyymmdd-hhmm in UTC for stable branch names regardless of admin
  // operator timezone.
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  return `${yyyy}${mm}${dd}-${hh}${mi}`;
}

export function buildBranchName(now) {
  return `${EDITING_BRANCH_PREFIX}${formatTimestamp(now)}`;
}

export function isEditingBranch(branchName) {
  return typeof branchName === "string" && EDITING_BRANCH_RE.test(branchName);
}

/**
 * @param {object} params
 * @param {string} params.currentBranch
 * @param {string} params.defaultBranch  e.g. "main"
 * @param {boolean} params.newSession    user clicked "start new editing session"
 * @param {{ url:string, number:number } | null} params.openPr
 * @param {{ url:string, number:number } | null} params.mergedPr
 * @param {Date}   params.now
 * @returns {object} { action, newBranchName?, code?, suggestion?, mergedPrUrl? }
 */
export function decideBranchAction({
  currentBranch,
  defaultBranch,
  newSession,
  openPr,
  mergedPr,
  now,
}) {
  if (currentBranch === defaultBranch) {
    if (!newSession) {
      return {
        action: "refuse",
        code: "on-main",
        suggestion: "newSession",
        message: `on ${defaultBranch}; pass { newSession: true } to start an editing branch`,
      };
    }
    return {
      action: "create-and-switch",
      newBranchName: buildBranchName(now),
    };
  }

  if (isEditingBranch(currentBranch)) {
    if (newSession) {
      // `openPr` is for the branch we're about to leave — never reuse it.
      return {
        action: "create-and-switch",
        newBranchName: buildBranchName(now),
      };
    }
    if (openPr) {
      return {
        action: "use-current",
        branch: currentBranch,
        reusePr: openPr,
      };
    }
    if (mergedPr) {
      return {
        action: "refuse",
        code: "merged-pr",
        suggestion: "newSession",
        mergedPrUrl: mergedPr.url,
        message: "branch has merged PR; start a new session",
      };
    }
    return { action: "use-current", branch: currentBranch };
  }

  return {
    action: "refuse",
    code: "non-editing-branch",
    message: `on non-editing branch '${currentBranch}'`,
  };
}
