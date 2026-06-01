import { describe, it, expect } from "vitest";
import { shopifyImageUrl } from "../shopifyImage.js";

// A canonical production URL: cdn.shopify.com host, single `?v=` querystring.
const BASE = "https://cdn.shopify.com/s/files/1/0001/0002/files/jacket.webp?v=1700000000";

describe("shopifyImageUrl — appends a CDN resize width", () => {
  it("appends &width to a real ?v= URL", () => {
    expect(shopifyImageUrl(BASE, 800)).toBe(`${BASE}&width=800`);
  });

  it("uses ? when the URL has no existing querystring", () => {
    const noQuery = "https://cdn.shopify.com/s/files/1/0001/files/coat.jpg";
    expect(shopifyImageUrl(noQuery, 256)).toBe(`${noQuery}?width=256`);
  });

  it("rounds a fractional width", () => {
    expect(shopifyImageUrl(BASE, 399.6)).toBe(`${BASE}&width=400`);
  });

  it("is extension-agnostic (heic/jpg/webp/png)", () => {
    for (const ext of ["heic", "jpg", "webp", "png"]) {
      const url = `https://cdn.shopify.com/s/files/1/0/files/x.${ext}?v=9`;
      expect(shopifyImageUrl(url, 1400)).toBe(`${url}&width=1400`);
    }
  });
});

describe("shopifyImageUrl — passthrough (worst case = today's behavior)", () => {
  it("leaves a non-Shopify URL untouched", () => {
    const other = "https://example.com/img/jacket.jpg?v=1";
    expect(shopifyImageUrl(other, 800)).toBe(other);
  });

  it("leaves an empty string untouched", () => {
    expect(shopifyImageUrl("", 800)).toBe("");
  });

  it("leaves null/undefined untouched", () => {
    expect(shopifyImageUrl(null, 800)).toBe(null);
    expect(shopifyImageUrl(undefined, 800)).toBe(undefined);
  });

  it("is idempotent — never doubles an existing width param", () => {
    const already = `${BASE}&width=800`;
    expect(shopifyImageUrl(already, 1400)).toBe(already);
  });

  it("leaves the URL untouched for non-positive or non-finite widths", () => {
    expect(shopifyImageUrl(BASE, 0)).toBe(BASE);
    expect(shopifyImageUrl(BASE, -100)).toBe(BASE);
    expect(shopifyImageUrl(BASE, NaN)).toBe(BASE);
    expect(shopifyImageUrl(BASE, Infinity)).toBe(BASE);
  });
});
