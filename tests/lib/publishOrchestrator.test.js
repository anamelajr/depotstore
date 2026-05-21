import { describe, it, expect } from "vitest";
import {
  decideBranchAction,
  buildBranchName,
  isEditingBranch,
} from "../../app/lib/publishOrchestrator.js";

const NOW = new Date("2026-05-21T16:32:00Z");
const EXPECTED_BRANCH = "content/edit-20260521-1632";

describe("buildBranchName", () => {
  it("formats yyyymmdd-hhmm in UTC", () => {
    expect(buildBranchName(NOW)).toBe(EXPECTED_BRANCH);
  });

  it("pads month/day/hour/minute", () => {
    expect(buildBranchName(new Date("2026-01-02T03:04:00Z"))).toBe(
      "content/edit-20260102-0304"
    );
  });
});

describe("isEditingBranch", () => {
  it("matches content/edit-* branches", () => {
    expect(isEditingBranch("content/edit-20260521-1632")).toBe(true);
    expect(isEditingBranch("content/edit-anything")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isEditingBranch("main")).toBe(false);
    expect(isEditingBranch("feat/x")).toBe(false);
    expect(isEditingBranch("content/other")).toBe(false);
    expect(isEditingBranch("")).toBe(false);
    expect(isEditingBranch(null)).toBe(false);
  });
});

describe("decideBranchAction", () => {
  it("refuses on main without newSession", () => {
    const out = decideBranchAction({
      currentBranch: "main",
      defaultBranch: "main",
      newSession: false,
      openPr: null,
      mergedPr: null,
      now: NOW,
    });
    expect(out.action).toBe("refuse");
    expect(out.code).toBe("on-main");
    expect(out.suggestion).toBe("newSession");
  });

  it("creates a dated branch off main when newSession is true", () => {
    const out = decideBranchAction({
      currentBranch: "main",
      defaultBranch: "main",
      newSession: true,
      openPr: null,
      mergedPr: null,
      now: NOW,
    });
    expect(out.action).toBe("create-and-switch");
    expect(out.newBranchName).toBe(EXPECTED_BRANCH);
  });

  it("reuses current editing branch when it has an open PR", () => {
    const out = decideBranchAction({
      currentBranch: "content/edit-20260520-1000",
      defaultBranch: "main",
      newSession: false,
      openPr: { url: "https://github.com/x/y/pull/1", number: 1 },
      mergedPr: null,
      now: NOW,
    });
    expect(out.action).toBe("use-current");
    expect(out.branch).toBe("content/edit-20260520-1000");
  });

  it("refuses when current editing branch has a merged PR", () => {
    const out = decideBranchAction({
      currentBranch: "content/edit-20260520-1000",
      defaultBranch: "main",
      newSession: false,
      openPr: null,
      mergedPr: { url: "https://github.com/x/y/pull/2", number: 2 },
      now: NOW,
    });
    expect(out.action).toBe("refuse");
    expect(out.code).toBe("merged-pr");
    expect(out.suggestion).toBe("newSession");
    expect(out.mergedPrUrl).toBe("https://github.com/x/y/pull/2");
  });

  it("uses current editing branch with no PR yet (first commit before PR create)", () => {
    const out = decideBranchAction({
      currentBranch: "content/edit-20260521-0900",
      defaultBranch: "main",
      newSession: false,
      openPr: null,
      mergedPr: null,
      now: NOW,
    });
    expect(out.action).toBe("use-current");
    expect(out.branch).toBe("content/edit-20260521-0900");
  });

  it("creates a fresh dated branch when newSession is true on an editing branch", () => {
    const out = decideBranchAction({
      currentBranch: "content/edit-20260520-1000",
      defaultBranch: "main",
      newSession: true,
      openPr: { url: "https://github.com/x/y/pull/1", number: 1 },
      mergedPr: null,
      now: NOW,
    });
    expect(out.action).toBe("create-and-switch");
    expect(out.newBranchName).toBe(EXPECTED_BRANCH);
  });

  it("refuses on unrecognised non-editing branches", () => {
    const out = decideBranchAction({
      currentBranch: "feat/something",
      defaultBranch: "main",
      newSession: false,
      openPr: null,
      mergedPr: null,
      now: NOW,
    });
    expect(out.action).toBe("refuse");
    expect(out.code).toBe("non-editing-branch");
  });

  it("refuses non-editing branches even with newSession=true (user must switch manually)", () => {
    const out = decideBranchAction({
      currentBranch: "feat/something",
      defaultBranch: "main",
      newSession: true,
      openPr: null,
      mergedPr: null,
      now: NOW,
    });
    expect(out.action).toBe("refuse");
    expect(out.code).toBe("non-editing-branch");
  });
});
