import { describe, it, expect } from "vitest";
import { serializeEditorialModule } from "../../app/lib/serializeEditorialModule.js";

describe("serializeEditorialModule", () => {
  it("produces a parseable JS module ending in export default entry", () => {
    const out = serializeEditorialModule({
      slug: "test-designer",
      publishedAt: "2026-05-21",
      hero: {
        layout: "image-right",
        eyebrow: "Editorial",
        title: "Test",
        subtitle: "Line one\nLine two",
        byline: "By DÉPÔT",
        images: ["hero.webp"],
        imageAlt: ["alt"],
      },
      brandFilter: "Test",
      curatedProducts: [
        { storeDomain: "esco.example", handle: "h1" },
      ],
      blocks: [
        { type: "text", width: "narrow", dropcap: true, body: "Hello." },
      ],
    });
    expect(out).toContain("const entry = {");
    expect(out).toMatch(/export default entry;\s*$/);
    expect(out).toContain('slug: "test-designer"');
    expect(out).toContain('storeDomain: "esco.example"');
    expect(out).toContain('"Line one\\nLine two"');
  });

  it("emits empty arrays as []", () => {
    const out = serializeEditorialModule({
      slug: "x",
      publishedAt: "2026-01-01",
      hero: {
        layout: "image-right",
        eyebrow: "",
        title: "X",
        subtitle: "",
        byline: "",
        images: ["hero.jpg"],
        imageAlt: [""],
      },
      brandFilter: "X",
      curatedProducts: [],
      blocks: [],
    });
    expect(out).toContain("curatedProducts: []");
    expect(out).toContain("blocks: []");
  });
});
