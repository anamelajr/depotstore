import { describe, it, expect } from "vitest";
import { appendDedupedProducts, nextServerOffset } from "../feed-utils.js";

const p = (handle, storeDomain = "a.myshopify.com") => ({ handle, storeDomain });

describe("appendDedupedProducts", () => {
  it("appends a fully fresh page unchanged", () => {
    const prev = [p("one"), p("two")];
    expect(appendDedupedProducts(prev, [p("three")])).toEqual([p("one"), p("two"), p("three")]);
  });

  it("drops rows whose handle|storeDomain is already in the grid", () => {
    const prev = [p("one"), p("two")];
    expect(appendDedupedProducts(prev, [p("two"), p("three")])).toEqual([
      p("one"), p("two"), p("three"),
    ]);
  });

  it("keeps the same handle from a different store", () => {
    const prev = [p("one", "a.myshopify.com")];
    const rows = [p("one", "b.myshopify.com")];
    expect(appendDedupedProducts(prev, rows)).toHaveLength(2);
  });

  it("appends nothing when the whole page is duplicates", () => {
    const prev = [p("one"), p("two")];
    expect(appendDedupedProducts(prev, [p("one"), p("two")])).toEqual(prev);
  });
});

describe("nextServerOffset", () => {
  it("advances by the raw page length even when rows were deduped away", () => {
    const prev = [p("one"), p("two")];
    const rows = [p("two"), p("three")]; // one duplicate
    const merged = appendDedupedProducts(prev, rows);
    expect(merged).toHaveLength(3);          // rendered length diverges…
    expect(nextServerOffset(2, rows)).toBe(4); // …the server offset does not
  });

  it("still advances on an all-duplicate page so Load More can't stall", () => {
    const rows = [p("one"), p("two")];
    expect(appendDedupedProducts([p("one"), p("two")], rows)).toHaveLength(2);
    expect(nextServerOffset(2, rows)).toBe(4);
  });

  it("does not advance on an empty page", () => {
    expect(nextServerOffset(30, [])).toBe(30);
    expect(nextServerOffset(30, undefined)).toBe(30);
  });
});
