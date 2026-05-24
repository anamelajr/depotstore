import { describe, it, expect } from "vitest";
import { decideBranchAction } from "../../app/lib/publishOrchestrator.js";

const NOW = new Date("2026-05-21T16:32:00Z");
const NEW_BRANCH = "content/edit-20260521-1632";
const OPEN_PR = { number: 46, url: "https://github.com/anamelajr/depotstore/pull/46" };
const MERGED_PR = { number: 40, url: "https://github.com/anamelajr/depotstore/pull/40" };

describe("decideBranchAction", () => {
  it("refuses on-main when newSession=false", () => {
    const r = decideBranchAction({ currentBranch: "main", defaultBranch: "main", newSession: false, openPr: null, mergedPr: null, now: NOW });
    expect(r.action).toBe("refuse");
    expect(r.code).toBe("on-main");
  });

  it("creates fresh branch when on main with newSession=true", () => {
    const r = decideBranchAction({ currentBranch: "main", defaultBranch: "main", newSession: true, openPr: null, mergedPr: null, now: NOW });
    expect(r.action).toBe("create-and-switch");
    expect(r.newBranchName).toBe(NEW_BRANCH);
  });

  it("uses current branch when content/edit-* has open PR and newSession=false", () => {
    const r = decideBranchAction({ currentBranch: "content/edit-20260501-0900", defaultBranch: "main", newSession: false, openPr: OPEN_PR, mergedPr: null, now: NOW });
    expect(r.action).toBe("use-current");
  });

  it("refuses merged-pr when content/edit-* PR is merged and newSession=false", () => {
    const r = decideBranchAction({ currentBranch: "content/edit-20260501-0900", defaultBranch: "main", newSession: false, openPr: null, mergedPr: MERGED_PR, now: NOW });
    expect(r.action).toBe("refuse");
    expect(r.code).toBe("merged-pr");
    expect(r.mergedPrUrl).toBe(MERGED_PR.url);
  });

  it("uses current branch when content/edit-* has no open/merged PR (first commit, newSession=false)", () => {
    const r = decideBranchAction({ currentBranch: "content/edit-20260501-0900", defaultBranch: "main", newSession: false, openPr: null, mergedPr: null, now: NOW });
    expect(r.action).toBe("use-current");
  });

  it("creates fresh branch when content/edit-* with newSession=true", () => {
    const r = decideBranchAction({ currentBranch: "content/edit-20260501-0900", defaultBranch: "main", newSession: true, openPr: OPEN_PR, mergedPr: null, now: NOW });
    expect(r.action).toBe("create-and-switch");
    expect(r.newBranchName).toBe(NEW_BRANCH);
  });

  it("refuses non-editing-branch for unexpected branches", () => {
    const r = decideBranchAction({ currentBranch: "feat/some-feature", defaultBranch: "main", newSession: false, openPr: null, mergedPr: null, now: NOW });
    expect(r.action).toBe("refuse");
    expect(r.code).toBe("non-editing-branch");
  });
});
