import { describe, it, expect } from "vitest";
import { assignCategory } from "../stores.js";

// Helper: classification only consults title/name/description/etc. on the
// product object. We pass just title; the broad-rule passes will pick it up.
const classify = (title) => assignCategory({ title });

describe("assignCategory — Tops leaves", () => {
  const cases = [
    ["T-Shirt",                        "Tops", "tees"],
    ["Tee",                            "Tops", "tees"],
    ["Tee Shirt",                      "Tops", "tees"],
    ["Knit Tee",                       "Tops", "tees"],
    ["Knit Polo Sweater",              "Tops", "hoodies_sweaters"],
    ["Crewneck Sweatshirt",            "Tops", "hoodies_sweaters"],
    ["Sweater Vest",                   "Tops", "hoodies_sweaters"],
    ["Cardigan",                       "Tops", "hoodies_sweaters"],
    ["Cashmere Shirt",                 "Tops", "shirts_blouses"],
    ["Polo Shirt",                     "Tops", "shirts_blouses"],
    ["Knit Polo",                      "Tops", "shirts_blouses"],
    ["Button-Up Shirt",                "Tops", "shirts_blouses"],
    ["Blouse",                         "Tops", "shirts_blouses"],
    ["Tank Top",                       "Tops", "shirts_blouses"],
    ["Knit Turtleneck",                "Tops", "knitwear"],
    ["Turtleneck",                     "Tops", "knitwear"],
    ["Knit",                           "Tops", "knitwear"],
    ["Knitwear",                       "Tops", "knitwear"],
    ["Top",                            "Tops", null],
    ["Bow Tie Top",                    "Tops", null],
    ["Bow Tie Shirt",                  "Tops", "shirts_blouses"],
    ["Tie Dye Shirt",                  "Tops", "shirts_blouses"],
    ["Comme des Garçons Special Piece", null, null],
  ];
  it.each(cases)("%s → %s / %s", (title, category, subcategory) => {
    const result = classify(title);
    expect(result).toEqual({ category, subcategory });
  });
});

describe("assignCategory — Jackets & Coats leaves", () => {
  const cases = [
    ["Denim Jacket",       "Jackets & Coats", "jackets"],
    ["Bomber",             "Jackets & Coats", "jackets"],
    ["Bomber Coat",        "Jackets & Coats", "jackets"],
    ["Shearling Jacket",   "Jackets & Coats", "jackets"],
    ["Puffer Jacket",      "Jackets & Coats", "jackets"],
    ["Blazer",             "Jackets & Coats", "jackets"],
    ["Anorak",             "Jackets & Coats", "jackets"],
    ["Windbreaker",        "Jackets & Coats", "jackets"],
    ["Bolero",             "Jackets & Coats", "jackets"],
    ["Denim Coat",         "Jackets & Coats", "coats"],
    ["Trench",             "Jackets & Coats", "coats"],
    ["Trench Coat",        "Jackets & Coats", "coats"],
    ["Trench Jacket",      "Jackets & Coats", "coats"],
    ["Parka",              "Jackets & Coats", "coats"],
    ["Peacoat",            "Jackets & Coats", "coats"],
    ["Overcoat",           "Jackets & Coats", "coats"],
    ["Puffer Coat",        "Jackets & Coats", "coats"],
    ["Shearling Coat",     "Jackets & Coats", "coats"],
    ["Puffer",                  "Jackets & Coats", null],
    ["Shearling",               "Jackets & Coats", null],
    ["Cape",                    "Jackets & Coats", null],
    ["Caban",                   "Jackets & Coats", null],
    ["Belt Leather Jacket",     "Jackets & Coats", "jackets"],
    ["Tweed Jacket With Belt",  "Jackets & Coats", "jackets"],
  ];
  it.each(cases)("%s → %s / %s", (title, category, subcategory) => {
    const result = classify(title);
    expect(result).toEqual({ category, subcategory });
  });
});

describe("assignCategory — Bags & Accessories leaves", () => {
  const cases = [
    ["Tote Bag",     "Bags & Accessories", "bags"],
    ["Belt Bag",     "Bags & Accessories", "bags"],
    ["Crossbody",    "Bags & Accessories", "bags"],
    ["Clutch",       "Bags & Accessories", "bags"],
    ["Backpack",     "Bags & Accessories", "bags"],
    ["Card Holder",  "Bags & Accessories", "bags"],
    ["Wallet",       "Bags & Accessories", "bags"],
    ["Belt",         "Bags & Accessories", "accessories"],
    ["Silk Scarf",   "Bags & Accessories", "accessories"],
    ["Sunglasses",   "Bags & Accessories", "accessories"],
    ["Beanie",       "Bags & Accessories", "accessories"],
    ["Tie",          "Bags & Accessories", "accessories"],
    ["Necktie",      "Bags & Accessories", "accessories"],
    ["Bracelet",     "Bags & Accessories", "accessories"],
    ["Watch",        "Bags & Accessories", "accessories"],
    ["Bow Tie",      "Bags & Accessories", "accessories"],
    ["Silk Bow Tie", "Bags & Accessories", "accessories"],
    ["Tie Dye Bag",  "Bags & Accessories", "bags"],
  ];
  it.each(cases)("%s → %s / %s", (title, category, subcategory) => {
    const result = classify(title);
    expect(result).toEqual({ category, subcategory });
  });
});

describe("assignCategory — flat buckets (subcategory must be null)", () => {
  const cases = [
    ["Denim Jeans",     "Bottoms",          null],
    ["Cargo Pants",     "Bottoms",          null],
    ["Sneakers",        "Footwear",         null],
    ["Boots",           "Footwear",         null],
    ["Maxi Dress",      "Dresses & Skirts", null],
    ["Skirt",           "Dresses & Skirts", null],
    ["Wool Set",        "Sets",             null],
    ["Tracksuit",       "Sets",             null],
    ["Belt Dress",      "Dresses & Skirts", null],
    ["Belt Skirt",      "Dresses & Skirts", null],
    ["Pants With Belt", "Bottoms",          null],
  ];
  it.each(cases)("%s → %s / %s", (title, category, subcategory) => {
    const result = classify(title);
    expect(result).toEqual({ category, subcategory });
  });
});

describe("assignCategory — uncategorisable rows", () => {
  it("returns { category: null, subcategory: null } when nothing matches", () => {
    expect(classify("Comme des Garçons Special Piece")).toEqual({
      category: null,
      subcategory: null,
    });
  });
});
