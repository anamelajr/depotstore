import { describe, it, expect } from "vitest";
import {
  parseVercelPreviewFromComments,
  isAllowlisted,
} from "../../app/lib/publishGit.js";

describe("isAllowlisted", () => {
  it("accepts content/ paths", () => {
    expect(isAllowlisted("content/editorial/rick-owens.js")).toBe(true);
    expect(isAllowlisted("content/homepage-edit.json")).toBe(true);
  });

  it("accepts public/editorial/ paths", () => {
    expect(isAllowlisted("public/editorial/rick-owens/hero.webp")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isAllowlisted("app/page.js")).toBe(false);
    expect(isAllowlisted(".env")).toBe(false);
    expect(isAllowlisted("package.json")).toBe(false);
    expect(isAllowlisted("public/favicon.ico")).toBe(false);
  });
});

describe("parseVercelPreviewFromComments", () => {
  it("extracts the *.vercel.app URL from a Vercel-bot comment", () => {
    const comments = [
      {
        author: { login: "vercel[bot]" },
        body:
          "The latest updates on your projects.\n\n" +
          "| Name | Status | Preview |\n" +
          "| depotstore | ✅ Ready | " +
          "https://depotstore-git-content-edit-20260521-1632-anamelajr.vercel.app |\n",
      },
    ];
    expect(parseVercelPreviewFromComments(comments)).toBe(
      "https://depotstore-git-content-edit-20260521-1632-anamelajr.vercel.app"
    );
  });

  it("returns null for empty comments", () => {
    expect(parseVercelPreviewFromComments([])).toBeNull();
  });

  it("returns null when the only comment is from a non-Vercel author", () => {
    const comments = [
      {
        author: { login: "someone-else" },
        body: "check https://depotstore-test.vercel.app for me",
      },
    ];
    expect(parseVercelPreviewFromComments(comments)).toBeNull();
  });

  it("returns null when the Vercel comment has no *.vercel.app URL", () => {
    const comments = [
      {
        author: { login: "vercel[bot]" },
        body: "Deployment is building. Check the inspector for progress.",
      },
    ];
    expect(parseVercelPreviewFromComments(comments)).toBeNull();
  });

  it("ignores https://vercel.com inspector links and finds the *.vercel.app URL", () => {
    const comments = [
      {
        author: { login: "vercel[bot]" },
        body:
          "[Inspect](https://vercel.com/anamelajr/depotstore/abcdef)\n" +
          "https://depotstore-git-feature-x.vercel.app",
      },
    ];
    expect(parseVercelPreviewFromComments(comments)).toBe(
      "https://depotstore-git-feature-x.vercel.app"
    );
  });

  it("returns null on non-array input", () => {
    expect(parseVercelPreviewFromComments(null)).toBeNull();
    expect(parseVercelPreviewFromComments(undefined)).toBeNull();
    expect(parseVercelPreviewFromComments({})).toBeNull();
  });

  it("falls back to user.login when author is absent (REST API shape)", () => {
    const comments = [
      {
        user: { login: "vercel[bot]" },
        body: "https://depotstore-git-x.vercel.app",
      },
    ];
    expect(parseVercelPreviewFromComments(comments)).toBe(
      "https://depotstore-git-x.vercel.app"
    );
  });
});
