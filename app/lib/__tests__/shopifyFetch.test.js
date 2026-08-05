import { describe, it, expect } from "vitest";
import { dedupeByHandle, passesBrandFilter } from "../shopifyFetch.js";

// Regression suite for the sync-time curation gate. The 2026-07-26 incident:
// a non-allowlisted vendor ("CHEZ SNOW BUNNY" on all 4,795 rows — Shopify
// pre-fills vendor with the shop's own name) short-circuited brand
// resolution before the title check ran, so the store synced 0 products.
// The vendor path must only win when the vendor IS an allowlisted brand.

const product = (vendor, name) => ({ vendor, name });

describe("passesBrandFilter", () => {
  it("accepts an allowlisted vendor regardless of title", () => {
    expect(passesBrandFilter(product("Prada", "Silk Slip Dress"), null)).toBe(true);
  });

  it("falls through to the title when the vendor is the shop's own name", () => {
    expect(
      passesBrandFilter(
        product("CHEZ SNOW BUNNY", "Christian Dior Pink Monogramme White Flower Top"),
        null
      )
    ).toBe(true);
  });

  it("falls through to the title when the vendor is a non-allowlisted brand", () => {
    expect(
      passesBrandFilter(product("Ralph Lauren", "Jean Paul Gaultier Mesh Top"), null)
    ).toBe(true);
  });

  it("drops a non-allowlisted vendor whose title names no allowlisted brand", () => {
    expect(
      passesBrandFilter(product("CHEZ SNOW BUNNY", "Vintage Black Leather Trench"), null)
    ).toBe(false);
    expect(passesBrandFilter(product("Levi's", "Blue Denim 501"), null)).toBe(false);
  });

  it("drops an empty vendor with no title match", () => {
    expect(passesBrandFilter(product(null, "Cropped Wool Cardigan"), null)).toBe(false);
  });

  it("accepts on title alone when vendor is empty", () => {
    expect(passesBrandFilter(product(null, "Yohji Yamamoto Wool Coat"), null)).toBe(true);
  });

  it("preserves existing curated rows even when vendor and title match nothing", () => {
    expect(
      passesBrandFilter(product("CHEZ SNOW BUNNY", "Renamed Editorial Piece"), {
        brand: "PRADA",
      })
    ).toBe(true);
  });

  it("still applies the allowlist to an existing row's brand (shipped behavior)", () => {
    expect(
      passesBrandFilter(product("Prada", "Prada Nylon Bag"), { brand: "Totally Fake Brand" })
    ).toBe(false);
  });
});

// Regression suite for the 2026-08-05 incident: Shopify offset pagination
// returned the same handle on two pages, the duplicate landed inside one
// 500-row upsert batch, and Postgres rejected it ("ON CONFLICT DO UPDATE
// command cannot affect row a second time") — skipping the whole store's sync.
describe("dedupeByHandle", () => {
  const row = (handle, price) => ({ handle, price });

  it("collapses duplicate handles, last occurrence wins", () => {
    const out = dedupeByHandle([row("a", "€10"), row("b", "€20"), row("a", "€30")]);
    expect(out).toEqual([row("a", "€30"), row("b", "€20")]);
  });

  it("passes distinct handles through unchanged, order preserved", () => {
    const input = [row("a", "€1"), row("b", "€2"), row("c", "€3")];
    expect(dedupeByHandle(input)).toEqual(input);
  });

  it("preserves every null-handle row", () => {
    const out = dedupeByHandle([row(null, "€1"), row("a", "€2"), row(null, "€3")]);
    expect(out).toEqual([row("a", "€2"), row(null, "€1"), row(null, "€3")]);
  });

  it("returns an empty array for empty input", () => {
    expect(dedupeByHandle([])).toEqual([]);
  });
});
