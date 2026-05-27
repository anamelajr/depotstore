import { describe, it, expect } from "vitest";
import { expandSearchAliases } from "../searchAliases.js";

describe("expandSearchAliases", () => {
  it("returns null unchanged", () => {
    expect(expandSearchAliases(null)).toBeNull();
  });

  it("returns empty string unchanged", () => {
    expect(expandSearchAliases("")).toBe("");
  });

  it("expands CDG (uppercase) to comme", () => {
    expect(expandSearchAliases("CDG")).toBe("comme");
  });

  it("expands cdg (lowercase) to comme", () => {
    expect(expandSearchAliases("cdg")).toBe("comme");
  });

  it("expands CdG (mixed case) to comme", () => {
    expect(expandSearchAliases("CdG")).toBe("comme");
  });

  it("expands cdg in a compound query, preserving other tokens", () => {
    expect(expandSearchAliases("cdg dress")).toBe("comme dress");
  });

  it("trims leading/trailing whitespace and collapses inner whitespace", () => {
    expect(expandSearchAliases("  cdg   shirt  ")).toBe("comme shirt");
  });

  it("leaves an unaliased term unchanged", () => {
    expect(expandSearchAliases("dress")).toBe("dress");
  });

  it("does not double-expand — comme stays comme", () => {
    expect(expandSearchAliases("comme")).toBe("comme");
  });

  it("cdg + comme expands cdg and leaves comme, producing comme comme", () => {
    expect(expandSearchAliases("cdg comme")).toBe("comme comme");
  });
});
