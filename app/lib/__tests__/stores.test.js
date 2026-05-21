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
    ["Puffer",             "Jackets & Coats", null],
    ["Shearling",          "Jackets & Coats", null],
    ["Cape",               "Jackets & Coats", null],
    ["Caban",              "Jackets & Coats", null],
  ];
  it.each(cases)("%s → %s / %s", (title, category, subcategory) => {
    const result = classify(title);
    expect(result).toEqual({ category, subcategory });
  });
});
