import { describe, it, expect } from "vitest";
import {
  patchEditorialIndex,
  unpatchEditorialIndex,
} from "../patchEditorialIndex.js";

function makeIndex(imports, entries) {
  const importLines = imports.map((i) => i).join("\n");
  return `${importLines}\n\nconst ENTRIES = [${entries.join(", ")}];\n`;
}

describe("unpatchEditorialIndex", () => {
  it("single entry -> empty array, import removed", () => {
    const src = makeIndex(['import rickOwens from "./rick-owens.js";'], [
      "rickOwens",
    ]);
    const out = unpatchEditorialIndex(src, "rick-owens");
    expect(out).not.toContain('import rickOwens from "./rick-owens.js";');
    expect(out).toContain("const ENTRIES = [];");
  });

  it("middle removal keeps siblings with correct commas", () => {
    const src = makeIndex(
      [
        'import a from "./a.js";',
        'import b from "./b.js";',
        'import c from "./c.js";',
      ],
      ["a", "b", "c"]
    );
    const out = unpatchEditorialIndex(src, "b");
    expect(out).not.toContain('import b from "./b.js";');
    expect(out).toContain("const ENTRIES = [a, c];");
    expect(out).toContain('import a from "./a.js";');
    expect(out).toContain('import c from "./c.js";');
  });

  it("first removal", () => {
    const src = makeIndex(
      ['import a from "./a.js";', 'import b from "./b.js";'],
      ["a", "b"]
    );
    const out = unpatchEditorialIndex(src, "a");
    expect(out).toContain("const ENTRIES = [b];");
    expect(out).not.toContain('import a from "./a.js";');
  });

  it("last removal", () => {
    const src = makeIndex(
      ['import a from "./a.js";', 'import b from "./b.js";'],
      ["a", "b"]
    );
    const out = unpatchEditorialIndex(src, "b");
    expect(out).toContain("const ENTRIES = [a];");
    expect(out).not.toContain('import b from "./b.js";');
  });

  it("idempotent when both absent -> returns source unchanged", () => {
    const src = makeIndex(['import a from "./a.js";'], ["a"]);
    const out = unpatchEditorialIndex(src, "nonexistent");
    expect(out).toBe(src);
  });

  it("substring safety: deleting `rick` does not clobber `rickOwens`", () => {
    const src = makeIndex(
      ['import rick from "./rick.js";', 'import rickOwens from "./rick-owens.js";'],
      ["rick", "rickOwens"]
    );
    const out = unpatchEditorialIndex(src, "rick");
    expect(out).toContain("const ENTRIES = [rickOwens];");
    expect(out).toContain('import rickOwens from "./rick-owens.js";');
    expect(out).not.toContain('import rick from "./rick.js";');
  });

  it("repairs one-sided corruption: import gone but ENTRIES still references identifier", () => {
    // Manually-corrupted state: no import line, but ENTRIES still lists `b`.
    const src = makeIndex(['import a from "./a.js";'], ["a", "b"]);
    const out = unpatchEditorialIndex(src, "b");
    expect(out).toContain("const ENTRIES = [a];");
  });

  it("throws when ENTRIES anchor is missing", () => {
    expect(() => unpatchEditorialIndex('import a from "./a.js";\n', "a")).toThrow(
      /ENTRIES/
    );
  });

  it("round-trips with patchEditorialIndex", () => {
    const base = makeIndex(['import a from "./a.js";'], ["a"]);
    const added = patchEditorialIndex(base, "new-entry");
    expect(added).toContain("const ENTRIES = [a, newEntry];");
    const removed = unpatchEditorialIndex(added, "new-entry");
    expect(removed).toContain("const ENTRIES = [a];");
    expect(removed).not.toContain('import newEntry from "./new-entry.js";');
  });
});
