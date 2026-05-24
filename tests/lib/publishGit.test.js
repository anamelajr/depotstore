import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseVercelPreviewFromComments } from "../../app/lib/publishGit.js";

const FIXTURE_PATH = join(import.meta.dirname, "../fixtures/vercel-comments-pr57.json");
const fixtureJson = readFileSync(FIXTURE_PATH, "utf8");

describe("parseVercelPreviewFromComments", () => {
  it("extracts the deployed preview URL from a real Vercel bot comment", () => {
    const url = parseVercelPreviewFromComments(fixtureJson);
    expect(url).toMatch(/^https:\/\/[\w-]+\.vercel\.app$/);
    // Confirm the specific URL shape from PR #57
    expect(url).toContain("depotstore-git-");
  });

  it("returns null for empty comments array", () => {
    expect(parseVercelPreviewFromComments("[]")).toBeNull();
  });

  it("returns null when Vercel comment has no *.vercel.app URL in body", () => {
    const comments = JSON.stringify([
      { user: { login: "vercel[bot]" }, body: "Deployment failed. No preview available." },
    ]);
    expect(parseVercelPreviewFromComments(comments)).toBeNull();
  });

  it("returns null when a non-Vercel author mentions a *.vercel.app URL", () => {
    const comments = JSON.stringify([
      { user: { login: "someuser" }, body: "Check https://myapp-abc.vercel.app for the preview!" },
    ]);
    expect(parseVercelPreviewFromComments(comments)).toBeNull();
  });
});
