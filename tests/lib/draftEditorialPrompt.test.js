import { describe, it, expect } from "vitest";
import { buildPrompt } from "../../app/lib/draftEditorialPrompt.js";

describe("buildPrompt", () => {
  it("includes the title and layout", () => {
    const out = buildPrompt({
      title: "Rick Owens",
      brand: "Rick Owens",
      layout: "image-right",
      sources: [],
      styles: [],
      notes: [],
    });
    expect(out).toContain("Rick Owens");
    expect(out).toContain('"image-right"');
  });

  it("appends a structure plan when provided", () => {
    const out = buildPrompt({
      title: "X",
      brand: "X",
      layout: "image-right",
      sources: [],
      styles: [],
      notes: [],
      structurePlan: "STRUCTURE: 5 text blocks, image break after block 2.",
    });
    expect(out).toContain("STRUCTURE: 5 text blocks, image break after block 2.");
  });

  it("renders research and note tags from input arrays", () => {
    const out = buildPrompt({
      title: "X",
      brand: "X",
      layout: "image-right",
      sources: [{ value: "https://x.com/a", text: "hello world" }],
      styles: [],
      notes: ["keep it short"],
    });
    expect(out).toMatch(/<research source="https:\/\/x\.com\/a"/);
    expect(out).toContain("hello world");
    expect(out).toMatch(/<note index="1">keep it short<\/note>/);
  });
});

describe("loadSource", () => {
  it("treats non-HTTP values as pasted text by default (allowFiles: false)", async () => {
    const { loadSource } = await import("../../app/lib/draftEditorialPrompt.js");
    const r = await loadSource("/etc/hosts");
    // Must NOT read the file. The value is treated as inline text.
    expect(r.error).toBe(null);
    expect(r.text).toBe("/etc/hosts");
    expect(r.value).toBe("pasted");
  });

  it("reads files when allowFiles: true (CLI use)", async () => {
    const { loadSource } = await import("../../app/lib/draftEditorialPrompt.js");
    // package.json definitely exists at repo root; use it as a harmless probe.
    const r = await loadSource("package.json", { allowFiles: true });
    expect(r.error).toBe(null);
    expect(r.text).toMatch(/"name":\s*"archiveapp"/);
  });
});
