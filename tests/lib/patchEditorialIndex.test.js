import { describe, it, expect } from "vitest";
import {
  patchEditorialIndex,
  slugToIdentifier,
  isValidIdentifier,
} from "../../app/lib/patchEditorialIndex.js";

const SAMPLE = `import rickOwens from "./rick-owens.js";

const ENTRIES = [rickOwens];

const BY_SLUG = new Map(ENTRIES.map((e) => [e.slug, e]));

export function getAllEntries() {
  return [...ENTRIES].sort(
    (a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || "")
  );
}

export function getEntryBySlug(slug) {
  return BY_SLUG.get(slug) ?? null;
}

export function getAllSlugs() {
  return ENTRIES.map((e) => e.slug);
}
`;

describe("slugToIdentifier", () => {
  it("kebab → camelCase", () => {
    expect(slugToIdentifier("rick-owens")).toBe("rickOwens");
    expect(slugToIdentifier("yohji-yamamoto")).toBe("yohjiYamamoto");
    expect(slugToIdentifier("comme")).toBe("comme");
    expect(slugToIdentifier("a-b-c-d")).toBe("aBCD");
  });
});

describe("patchEditorialIndex", () => {
  it("inserts a new import and pushes into ENTRIES", () => {
    const out = patchEditorialIndex(SAMPLE, "yohji-yamamoto");
    expect(out).toContain('import yohjiYamamoto from "./yohji-yamamoto.js";');
    expect(out).toMatch(/const ENTRIES = \[rickOwens, yohjiYamamoto\];/);
  });

  it("is idempotent if the slug is already registered", () => {
    const once = patchEditorialIndex(SAMPLE, "yohji-yamamoto");
    const twice = patchEditorialIndex(once, "yohji-yamamoto");
    expect(twice).toBe(once);
  });

  it("inserts after the last import line", () => {
    const out = patchEditorialIndex(SAMPLE, "comme-des-garcons");
    const importLines = out.split("\n").filter((l) => l.startsWith("import "));
    expect(importLines.length).toBe(2);
    expect(importLines[1]).toBe(
      'import commeDesGarcons from "./comme-des-garcons.js";'
    );
  });

  it("throws if ENTRIES anchor is missing", () => {
    expect(() => patchEditorialIndex("// no entries here", "x")).toThrow(
      /ENTRIES/
    );
  });

  it("rejects slugs that produce digit-prefixed identifiers", () => {
    expect(() => patchEditorialIndex(SAMPLE, "2026-archive")).toThrow(
      /invalid JS identifier/
    );
  });

  it("rejects slugs that produce reserved-word identifiers", () => {
    expect(() => patchEditorialIndex(SAMPLE, "new")).toThrow(
      /invalid JS identifier/
    );
    expect(() => patchEditorialIndex(SAMPLE, "class")).toThrow(
      /invalid JS identifier/
    );
  });

  it("accepts slugs whose first segment merely contains a reserved word", () => {
    const out = patchEditorialIndex(SAMPLE, "new-collection");
    expect(out).toContain('import newCollection from "./new-collection.js";');
  });
});

describe("isValidIdentifier", () => {
  it("accepts plain camelCase identifiers", () => {
    expect(isValidIdentifier("rickOwens")).toBe(true);
    expect(isValidIdentifier("comme")).toBe(true);
    expect(isValidIdentifier("newCollection")).toBe(true);
  });

  it("rejects digit-prefixed identifiers", () => {
    expect(isValidIdentifier("2026Archive")).toBe(false);
    expect(isValidIdentifier("9to5")).toBe(false);
  });

  it("rejects reserved words", () => {
    expect(isValidIdentifier("new")).toBe(false);
    expect(isValidIdentifier("class")).toBe(false);
    expect(isValidIdentifier("function")).toBe(false);
    expect(isValidIdentifier("default")).toBe(false);
    expect(isValidIdentifier("let")).toBe(false);
    expect(isValidIdentifier("await")).toBe(false);
  });

  it("rejects empty or non-string input", () => {
    expect(isValidIdentifier("")).toBe(false);
    expect(isValidIdentifier(null)).toBe(false);
    expect(isValidIdentifier(undefined)).toBe(false);
  });
});
