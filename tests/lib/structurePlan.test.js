import { describe, it, expect } from "vitest";
import { buildStructurePlan } from "../../app/lib/structurePlan.js";

describe("buildStructurePlan", () => {
  it("counts text-shaped blocks the model should produce", () => {
    const { textBlockCount } = buildStructurePlan({
      currentBlocks: [
        { type: "image", src: "01.webp" },
        { type: "image-pair", images: [{ src: "a" }, { src: "b" }] },
      ],
      length: "medium",
    });
    // medium → 6 text-shaped blocks total
    expect(textBlockCount).toBe(6);
  });

  it("describes image breaks at their positions in the plan", () => {
    const { plan } = buildStructurePlan({
      currentBlocks: [
        { type: "image", src: "01.webp", width: "full-bleed" },
      ],
      length: "short",
    });
    expect(plan).toMatch(/IMAGE BREAK/);
    expect(plan).toMatch(/full-bleed/);
  });

  it("instructs blocks to end on complete thoughts", () => {
    const { plan } = buildStructurePlan({ currentBlocks: [], length: "short" });
    expect(plan).toMatch(/complete (sentence|thought)/i);
  });

  it("varies block count by length", () => {
    const short = buildStructurePlan({ currentBlocks: [], length: "short" }).textBlockCount;
    const long = buildStructurePlan({ currentBlocks: [], length: "long" }).textBlockCount;
    expect(long).toBeGreaterThan(short);
  });
});
