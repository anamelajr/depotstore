import { describe, it, expect } from "vitest";
import { MESSAGES } from "../messages";

describe("translation key parity", () => {
  it("FR has exactly the same keys as EN (no missing or extra)", () => {
    const enKeys = new Set(Object.keys(MESSAGES.en));
    const frKeys = new Set(Object.keys(MESSAGES.fr));

    const missingInFr = [...enKeys].filter((k) => !frKeys.has(k));
    const extraInFr = [...frKeys].filter((k) => !enKeys.has(k));

    expect(missingInFr).toEqual([]);
    expect(extraInFr).toEqual([]);
  });
});
