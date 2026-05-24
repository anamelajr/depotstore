function formatTs(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${y}${m}${d}-${hh}${mm}`;
}

/**
 * @param {{ currentBranch: string, defaultBranch: string, newSession: boolean,
 *           openPr: { number: number, url: string } | null,
 *           mergedPr: { number: number, url: string } | null,
 *           now?: Date }} opts
 * @returns {{ action: "create-and-switch" | "use-current" | "refuse",
 *             newBranchName?: string, code?: string, mergedPrUrl?: string }}
 */
export function decideBranchAction({ currentBranch, defaultBranch, newSession, openPr, mergedPr, now }) {
  const newBranchName = `content/edit-${formatTs(now ?? new Date())}`;

  if (currentBranch === defaultBranch) {
    if (newSession) return { action: "create-and-switch", newBranchName };
    return { action: "refuse", code: "on-main" };
  }

  if (currentBranch.startsWith("content/edit-")) {
    if (newSession) return { action: "create-and-switch", newBranchName };
    if (mergedPr) return { action: "refuse", code: "merged-pr", mergedPrUrl: mergedPr.url };
    return { action: "use-current" };
  }

  return { action: "refuse", code: "non-editing-branch" };
}
