import { describe, it, expect } from "vitest";
import { fetchArchiveProducts } from "../fetchArchiveProducts.js";

// Minimal in-memory PostgREST stub. It evaluates the filters the module builds
// — eq / gte / lte / is / in / or — against a row table, so these tests pin
// actual membership semantics rather than the shape of the call chain.
function parseValue(raw) {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/""/g, '"');
  }
  return raw;
}

function clauseMatches(row, clause) {
  const [col, op, ...rest] = clause.split(".");
  const raw = rest.join(".");
  const value = parseValue(raw);
  const cell = row[col];
  if (op === "is") return value === "null" ? cell == null : cell === value;
  if (op === "neq") return cell !== value;
  if (op === "ilike") {
    const body = value.replace(/^%|%$/g, "").toLowerCase();
    return typeof cell === "string" && cell.toLowerCase().includes(body);
  }
  throw new Error(`stub: unsupported op ${op}`);
}

function makeBuilder(rows, error) {
  const ops = [];
  const builder = {
    select: () => builder,
    eq: (col, value) => (ops.push((r) => r[col] === value), builder),
    gte: (col, value) => (ops.push((r) => r[col] != null && r[col] >= value), builder),
    lte: (col, value) => (ops.push((r) => r[col] != null && r[col] <= value), builder),
    is: (col, value) => (ops.push((r) => (value === null ? r[col] == null : r[col] === value)), builder),
    in: (col, values) => (ops.push((r) => values.includes(r[col])), builder),
    or: (expr) => {
      const clauses = expr.split(",");
      ops.push((r) => clauses.some((c) => clauseMatches(r, c)));
      return builder;
    },
    then: (resolve) =>
      resolve(
        error
          ? { data: null, error }
          : { data: rows.filter((r) => ops.every((op) => op(r))), error: null },
      ),
  };
  return builder;
}

function makeClient(rows, { error = null } = {}) {
  return { from: () => makeBuilder(rows, error) };
}

const base = {
  available: true,
  hidden: false,
  price: "€400.00",
  store_name: "Les Archives Paris",
  store_domain: "lesarchives.fr",
  image_url: "/a.jpg",
  product_url: "https://x/y",
  synced_at: "2026-08-11T10:00:00Z",
  description: "",
  title: null,
};

const ROWS = [
  { ...base, handle: "sl-teddy", brand: "SAINT LAURENT", name: "AW14 Teddy Jacket", era_year: 2014 },
  {
    ...base,
    handle: "sl10h",
    brand: "SAINT LAURENT",
    name: "SL10H Sneakers by Hedi Slimane",
    era_year: null,
    synced_at: "2026-08-11T09:00:00Z",
  },
  {
    ...base,
    handle: "sl-2018",
    brand: "SAINT LAURENT",
    name: "Wool Coat",
    description: "From the collection succeeding Hedi Slimane.",
    era_year: 2018,
  },
  { ...base, handle: "dior-galliano", brand: "DIOR", name: "FW04 Saddle Skirt", era_year: 2004 },
  {
    ...base,
    handle: "dior-homme",
    brand: "DIOR",
    name: "Dior Homme FW05 Wool Blazer",
    era_year: 2005,
    synced_at: "2026-08-11T11:00:00Z",
  },
  { ...base, handle: "hidden-sl", brand: "SAINT LAURENT", name: "AW13 Boots", era_year: 2013, hidden: true },
  { ...base, handle: "sold-sl", brand: "SAINT LAURENT", name: "AW13 Belt", era_year: 2013, available: false },
];

const archive = {
  rules: [
    { brand: "DIOR", eraStart: 2000, eraEnd: 2007, attribution: ["homme", "hedi", "slimane"] },
    { brand: "SAINT LAURENT", eraStart: 2012, eraEnd: 2016 },
    { brand: "SAINT LAURENT", eraYearNull: true, attribution: ["hedi", "slimane"] },
  ],
  include: [],
  exclude: [],
};

const handles = (products) => products.map((p) => p.handle).sort();

describe("fetchArchiveProducts — membership", () => {
  it("unions the rules and excludes everything they don't name", async () => {
    const products = await fetchArchiveProducts(archive, {
      client: makeClient(ROWS),
    });
    expect(handles(products)).toEqual(["dior-homme", "sl-teddy", "sl10h"]);
  });

  it("includes an attribution-only match with a NULL era_year", async () => {
    const products = await fetchArchiveProducts(archive, { client: makeClient(ROWS) });
    expect(products.some((p) => p.handle === "sl10h")).toBe(true);
  });

  it("excludes an attributed row whose era_year falls outside the tenure", async () => {
    const products = await fetchArchiveProducts(archive, { client: makeClient(ROWS) });
    expect(products.some((p) => p.handle === "sl-2018")).toBe(false);
  });

  it("excludes in-era stock by another designer when attribution is required", async () => {
    const products = await fetchArchiveProducts(archive, { client: makeClient(ROWS) });
    expect(products.some((p) => p.handle === "dior-galliano")).toBe(false);
  });

  it("never returns hidden or sold pieces", async () => {
    const products = await fetchArchiveProducts(archive, { client: makeClient(ROWS) });
    expect(products.some((p) => p.handle === "hidden-sl")).toBe(false);
    expect(products.some((p) => p.handle === "sold-sl")).toBe(false);
  });

  it("sorts newest-synced first and dedupes rows matched by two rules", async () => {
    const products = await fetchArchiveProducts(archive, { client: makeClient(ROWS) });
    expect(products.map((p) => p.handle)).toEqual(["dior-homme", "sl-teddy", "sl10h"]);
  });

  it("returns [] for an archive with no rules", async () => {
    expect(await fetchArchiveProducts({ rules: [] }, { client: makeClient(ROWS) })).toEqual([]);
  });
});

describe("fetchArchiveProducts — curation overrides", () => {
  it("drops an excluded pair", async () => {
    const products = await fetchArchiveProducts(
      { ...archive, exclude: [{ storeDomain: "lesarchives.fr", handle: "sl-teddy" }] },
      { client: makeClient(ROWS) },
    );
    expect(handles(products)).toEqual(["dior-homme", "sl10h"]);
  });

  it("adds an included pair the rules miss", async () => {
    const products = await fetchArchiveProducts(
      { ...archive, include: [{ storeDomain: "lesarchives.fr", handle: "dior-galliano" }] },
      { client: makeClient(ROWS) },
    );
    expect(handles(products)).toContain("dior-galliano");
  });

  it("still refuses a hidden piece pulled in by hand", async () => {
    const products = await fetchArchiveProducts(
      { ...archive, include: [{ storeDomain: "lesarchives.fr", handle: "hidden-sl" }] },
      { client: makeClient(ROWS) },
    );
    expect(handles(products)).not.toContain("hidden-sl");
  });
});

describe("fetchArchiveProducts — fail closed", () => {
  it("throws when a rule query errors instead of returning partial membership", async () => {
    const client = makeClient(ROWS, { error: { message: "statement timeout" } });
    await expect(fetchArchiveProducts(archive, { client })).rejects.toThrow(
      /Archive rule query failed: statement timeout/,
    );
  });

  it("throws when an include-chunk query errors", async () => {
    // Rules resolve normally; only the include chunk fails.
    let calls = 0;
    const client = {
      from: () => {
        calls += 1;
        return calls <= archive.rules.length
          ? makeBuilder(ROWS, null)
          : makeBuilder(ROWS, { message: "connection reset" });
      },
    };
    await expect(
      fetchArchiveProducts(
        { ...archive, include: [{ storeDomain: "lesarchives.fr", handle: "dior-galliano" }] },
        { client },
      ),
    ).rejects.toThrow(/Archive include query failed: connection reset/);
  });
});
