import { describe, it, expect } from "vitest";
import { resolveCategoryFilter } from "../categories.js";

describe("resolveCategoryFilter", () => {
  it("returns empty arrays for null / undefined / non-array input", () => {
    expect(resolveCategoryFilter(null)).toEqual({ parentCategories: [], leafFilters: [] });
    expect(resolveCategoryFilter(undefined)).toEqual({ parentCategories: [], leafFilters: [] });
    expect(resolveCategoryFilter("tops")).toEqual({ parentCategories: [], leafFilters: [] });
  });

  it("returns empty arrays for an empty slug list", () => {
    expect(resolveCategoryFilter([])).toEqual({ parentCategories: [], leafFilters: [] });
  });

  it("resolves a single parent slug to a broad category, no leaf", () => {
    expect(resolveCategoryFilter(["tops"])).toEqual({
      parentCategories: ["Tops"],
      leafFilters: [],
    });
  });

  it("resolves a single flat-bucket slug as a broad category", () => {
    expect(resolveCategoryFilter(["bottoms"])).toEqual({
      parentCategories: ["Bottoms"],
      leafFilters: [],
    });
  });

  it("resolves a single leaf slug to a (category, subcategory) pair", () => {
    expect(resolveCategoryFilter(["tops_tees"])).toEqual({
      parentCategories: [],
      leafFilters: [{ category: "Tops", subcategory: "tees" }],
    });
  });

  it("resolves multiple parent slugs into one deduplicated category list", () => {
    expect(resolveCategoryFilter(["tops", "bottoms"])).toEqual({
      parentCategories: ["Tops", "Bottoms"],
      leafFilters: [],
    });
  });

  it("resolves multiple leaf slugs into multiple pairs", () => {
    expect(resolveCategoryFilter(["tops_tees", "jackets"])).toEqual({
      parentCategories: [],
      leafFilters: [
        { category: "Tops", subcategory: "tees" },
        { category: "Jackets & Coats", subcategory: "jackets" },
      ],
    });
  });

  it("keeps parent and same-group leaf separate (the SQL OR handles the union)", () => {
    // ?category=tops,tops_tees — user clicked "All Tops" AND "Tees".
    // Result: parent filter covers all of Tops; the leaf pair is redundant
    // but harmless in the OR clause downstream.
    expect(resolveCategoryFilter(["tops", "tops_tees"])).toEqual({
      parentCategories: ["Tops"],
      leafFilters: [{ category: "Tops", subcategory: "tees" }],
    });
  });

  it("keeps parent and cross-group leaf separate so neither is dropped", () => {
    // The regression Codex flagged: ?category=tops,jackets
    // Old shape collapsed to category IN ('Tops','Jackets & Coats')
    //   AND subcategory='jackets' — dropping all Tops rows.
    // New shape preserves the union: parent filter for Tops, leaf pair
    // for Jackets & Coats / jackets.
    expect(resolveCategoryFilter(["tops", "jackets"])).toEqual({
      parentCategories: ["Tops"],
      leafFilters: [{ category: "Jackets & Coats", subcategory: "jackets" }],
    });
  });

  it("deduplicates repeated parent slugs", () => {
    expect(resolveCategoryFilter(["tops", "tops", "bottoms"])).toEqual({
      parentCategories: ["Tops", "Bottoms"],
      leafFilters: [],
    });
  });

  it("falls back unknown slugs into parentCategories so legacy behavior holds", () => {
    expect(resolveCategoryFilter(["not-a-real-slug"])).toEqual({
      parentCategories: ["not-a-real-slug"],
      leafFilters: [],
    });
  });

  it("handles a mixed flat-bucket + leaf-from-different-group selection", () => {
    // ?category=bottoms,tops_tees — flat-bucket + a leaf in another group.
    expect(resolveCategoryFilter(["bottoms", "tops_tees"])).toEqual({
      parentCategories: ["Bottoms"],
      leafFilters: [{ category: "Tops", subcategory: "tees" }],
    });
  });
});
