import { describe, it, expect } from "vitest";
import {
  buildArchiveFilterGroups,
  filterProductsByCategories,
  sortArchiveProducts,
} from "../archiveProductFilters.js";

// Minimal product shape — only the fields the helpers read. `handle` doubles
// as the assertion handle throughout.
function p(handle, fields = {}) {
  return {
    handle,
    storeDomain: "lesarchives.fr",
    price: "€400.00",
    category: null,
    subcategory: null,
    syncedAt: "2026-08-11T10:00:00Z",
    ...fields,
  };
}

const PRODUCTS = [
  p("jacket", { category: "Jackets & Coats", subcategory: "jackets" }),
  p("coat", { category: "Jackets & Coats", subcategory: "coats" }),
  p("boots", { category: "Footwear" }),
  p("tee-untagged", { category: "Tops" }), // parent present, no leaf
  p("unenriched"), // category NULL
];

const handles = (list) => list.map((x) => x.handle).sort();

describe("buildArchiveFilterGroups", () => {
  it("excludes categories with no products in the set", () => {
    const groups = buildArchiveFilterGroups(PRODUCTS, "en");
    const values = groups.map((g) => g.value);
    expect(values).toContain("jackets_coats");
    expect(values).toContain("footwear");
    expect(values).not.toContain("bottoms");
    expect(values).not.toContain("bags_accessories");
  });

  it("keeps the canonical taxonomy order", () => {
    expect(buildArchiveFilterGroups(PRODUCTS, "en").map((g) => g.value)).toEqual([
      "tops",
      "jackets_coats",
      "footwear",
    ]);
  });

  it("gives a parent with present leaves an 'All' child first, then only present leaves", () => {
    const jackets = buildArchiveFilterGroups(PRODUCTS, "en").find(
      (g) => g.value === "jackets_coats",
    );
    expect(jackets.children.map((c) => c.value)).toEqual([
      "jackets_coats",
      "jackets",
      "coats",
    ]);
    expect(jackets.children[0].label).toBe("All Jackets & Coats");
  });

  it("drops leaves that no product carries", () => {
    const oneLeaf = buildArchiveFilterGroups(
      [p("jacket", { category: "Jackets & Coats", subcategory: "jackets" })],
      "en",
    ).find((g) => g.value === "jackets_coats");
    expect(oneLeaf.children.map((c) => c.value)).toEqual(["jackets_coats", "jackets"]);
  });

  it("renders a parent present only via NULL-subcategory rows as a leaf row", () => {
    const tops = buildArchiveFilterGroups(PRODUCTS, "en").find((g) => g.value === "tops");
    expect(tops.children).toBeNull();
  });

  it("renders French labels when the language is threaded through", () => {
    const groups = buildArchiveFilterGroups(PRODUCTS, "fr");
    const jackets = groups.find((g) => g.value === "jackets_coats");
    expect(jackets.label).toBe("Vestes & Manteaux");
    expect(jackets.children.map((c) => c.label)).toEqual([
      "Tout afficher",
      "Vestes",
      "Manteaux",
    ]);
    expect(groups.find((g) => g.value === "footwear").label).toBe("Chaussures");
  });

  it("returns [] for an empty set", () => {
    expect(buildArchiveFilterGroups([], "en")).toEqual([]);
  });
});

describe("filterProductsByCategories", () => {
  it("returns everything when nothing is selected", () => {
    expect(filterProductsByCategories(PRODUCTS, [])).toHaveLength(PRODUCTS.length);
  });

  it("matches a parent slug on category alone", () => {
    expect(handles(filterProductsByCategories(PRODUCTS, ["jackets_coats"]))).toEqual([
      "coat",
      "jacket",
    ]);
  });

  it("matches a leaf slug on category AND subcategory", () => {
    expect(handles(filterProductsByCategories(PRODUCTS, ["coats"]))).toEqual(["coat"]);
  });

  it("ORs a parent and a leaf from different trees instead of intersecting them", () => {
    expect(handles(filterProductsByCategories(PRODUCTS, ["footwear", "jackets"]))).toEqual([
      "boots",
      "jacket",
    ]);
  });

  it("excludes rows with a NULL category under any selection", () => {
    for (const slugs of [["tops"], ["jackets_coats"], ["footwear", "coats"]]) {
      expect(handles(filterProductsByCategories(PRODUCTS, slugs))).not.toContain("unenriched");
    }
  });

  it("returns nothing for a category present in the taxonomy but not the set", () => {
    expect(filterProductsByCategories(PRODUCTS, ["bottoms"])).toEqual([]);
  });
});

describe("sortArchiveProducts", () => {
  const dated = [
    p("mid", { syncedAt: "2026-08-11T10:00:00Z", price: "€200.00" }),
    p("new", { syncedAt: "2026-08-11T12:00:00Z", price: "€100.00" }),
    p("old", { syncedAt: "2026-08-11T08:00:00Z", price: "€300.00" }),
    p("nodate", { syncedAt: null, price: "€50.00" }),
  ];

  it("does not mutate its input", () => {
    const input = [...dated];
    sortArchiveProducts(input, "oldest");
    expect(input.map((x) => x.handle)).toEqual(dated.map((x) => x.handle));
  });

  it("sorts newest-first for 'latest' and 'interleaved' alike", () => {
    const latest = sortArchiveProducts(dated, "latest").map((x) => x.handle);
    expect(latest).toEqual(["new", "mid", "old", "nodate"]);
    expect(sortArchiveProducts(dated, "interleaved").map((x) => x.handle)).toEqual(latest);
  });

  it("sorts oldest-first for 'oldest'", () => {
    expect(sortArchiveProducts(dated, "oldest").map((x) => x.handle)).toEqual([
      "old",
      "mid",
      "new",
      "nodate",
    ]);
  });

  it("keeps a null syncedAt last in BOTH directions", () => {
    expect(sortArchiveProducts(dated, "latest").at(-1).handle).toBe("nodate");
    expect(sortArchiveProducts(dated, "oldest").at(-1).handle).toBe("nodate");
  });

  it("sorts price numerically, not lexicographically", () => {
    const prices = [
      p("nine", { price: "€9.00" }),
      p("ninety", { price: "€90.00" }),
      p("hundred", { price: "€100.00" }),
    ];
    expect(sortArchiveProducts(prices, "price_asc").map((x) => x.handle)).toEqual([
      "nine",
      "ninety",
      "hundred",
    ]);
    expect(sortArchiveProducts(prices, "price_desc").map((x) => x.handle)).toEqual([
      "hundred",
      "ninety",
      "nine",
    ]);
  });

  it("keeps null and unparseable prices last in BOTH directions", () => {
    const messy = [
      p("null-price", { price: null }),
      p("garbage", { price: "Sold out" }),
      p("cheap", { price: "€10.00" }),
      p("dear", { price: "€900.00" }),
    ];
    for (const sort of ["price_asc", "price_desc"]) {
      const ranked = sortArchiveProducts(messy, sort).map((x) => x.handle);
      expect(ranked.slice(0, 2)).not.toContain("null-price");
      expect(ranked.slice(0, 2)).not.toContain("garbage");
    }
  });

  it("breaks equal keys deterministically", () => {
    const tied = [
      p("b", { price: "€100.00", storeDomain: "z.fr" }),
      p("a", { price: "€100.00", storeDomain: "a.fr" }),
    ];
    const once = sortArchiveProducts(tied, "price_asc").map((x) => x.handle);
    const twice = sortArchiveProducts([...tied].reverse(), "price_asc").map((x) => x.handle);
    expect(once).toEqual(twice);
  });
});
