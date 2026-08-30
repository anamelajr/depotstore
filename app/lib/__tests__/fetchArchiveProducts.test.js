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
  // `not` is a prefix operator in PostgREST (name.not.ilike.%x%). Mirroring
  // Postgres, NOT ILIKE against a NULL cell is NULL — i.e. NOT a match — which
  // is exactly the trap the paired `col.is.null` clause exists to cover.
  if (op === "not") return !clauseMatches(row, [col, ...rest].join("."));
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

// PostgREST returns ONLY the selected columns; anything the select omits
// arrives `undefined` at the mapper. Simulating that projection is what makes
// a too-narrow ROW_SELECT (or a field dropped in the final map) visible to the
// suite instead of silently emptying every category filter in production.
// Projection happens on the way out only — filters still evaluate against the
// full row, exactly like a server-side WHERE.
function project(row, cols) {
  if (!cols) return row;
  return Object.fromEntries(cols.map((c) => [c, row[c]]));
}

function makeBuilder(rows, error) {
  const ops = [];
  let cols = null;
  const builder = {
    select: (spec) => {
      cols = String(spec)
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      return builder;
    },
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
          : {
              data: rows
                .filter((r) => ops.every((op) => op(r)))
                .map((r) => project(r, cols)),
              error: null,
            },
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
  category: "Jackets & Coats",
  subcategory: "jackets",
};

const ROWS = [
  { ...base, handle: "sl-teddy", brand: "SAINT LAURENT", name: "AW14 Teddy Jacket", era_year: 2014 },
  {
    ...base,
    handle: "sl10h",
    brand: "SAINT LAURENT",
    name: "SL10H Sneakers by Hedi Slimane",
    era_year: null,
    category: "Footwear",
    subcategory: null,
    // No synced_at at all — pins the `?? null` normalization for a column
    // present in the select but NULL in the row.
    synced_at: undefined,
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
    subcategory: "coats",
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

// The archive page's client-side filter/sort reads category, subcategory and
// syncedAt off these products. The select is the only thing standing between
// those fields and `undefined`, and an undefined category empties every
// category filter without erroring anywhere — hence a behavioural test of the
// mapped output rather than an assertion on the select string.
describe("fetchArchiveProducts — filter/sort field contract", () => {
  const byHandle = async () => {
    const products = await fetchArchiveProducts(archive, { client: makeClient(ROWS) });
    return Object.fromEntries(products.map((p) => [p.handle, p]));
  };

  it("carries category, subcategory and syncedAt through to the mapped product", async () => {
    const p = (await byHandle())["sl-teddy"];
    expect(p.category).toBe("Jackets & Coats");
    expect(p.subcategory).toBe("jackets");
    expect(p.syncedAt).toBe("2026-08-11T10:00:00Z");
  });

  it("normalizes a NULL subcategory to null rather than undefined", async () => {
    const p = (await byHandle())["sl10h"];
    expect(p.category).toBe("Footwear");
    expect(p.subcategory).toBeNull();
  });

  it("normalizes a missing synced_at to null", async () => {
    expect((await byHandle())["sl10h"].syncedAt).toBeNull();
  });

  it("carries the fields through the include path too", async () => {
    const products = await fetchArchiveProducts(
      { ...archive, include: [{ storeDomain: "lesarchives.fr", handle: "dior-galliano" }] },
      { client: makeClient(ROWS) },
    );
    const included = products.find((p) => p.handle === "dior-galliano");
    expect(included.category).toBe("Jackets & Coats");
    expect(included.subcategory).toBe("jackets");
    expect(included.syncedAt).toBe("2026-08-11T10:00:00Z");
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

// excludeAttribution — the negative of `attribution`, used by the Margiela
// archive to keep re-editions and another house's tenure out of the era window
// durably (a handle-pinned exclude wouldn't survive a relisting).
describe("fetchArchiveProducts — excludeAttribution", () => {
  const mmBase = {
    ...base,
    brand: "MAISON MARGIELA",
    era_year: 2005,
    name: null,
    description: null,
  };
  const mmArchive = {
    rules: [
      {
        brand: "MAISON MARGIELA",
        eraStart: 1988,
        eraEnd: 2009,
        excludeAttribution: ["h&m", "hermes"],
      },
    ],
    include: [],
    exclude: [],
  };

  const run = (rows, over = {}) =>
    fetchArchiveProducts({ ...mmArchive, ...over }, { client: makeClient(rows) });

  it("drops a row whose name carries a token", async () => {
    const rows = [
      { ...mmBase, handle: "keep", name: "SS05 Deconstructed Blazer" },
      { ...mmBase, handle: "hm", name: "SS2005 Margiela x H&M Denim Jacket" },
    ];
    expect(handles(await run(rows))).toEqual(["keep"]);
  });

  it("drops a row whose description carries a token", async () => {
    const rows = [
      { ...mmBase, handle: "keep", description: "Artisanal line, Paris." },
      {
        ...mmBase,
        handle: "hermes",
        description: "Hermes by Martin Margiela silk cardigan.",
      },
    ];
    expect(handles(await run(rows))).toEqual(["keep"]);
  });

  it("keeps rows with a NULL name, NULL description, or both", async () => {
    const rows = [
      { ...mmBase, handle: "null-name", name: null, description: "Wool coat." },
      { ...mmBase, handle: "null-desc", name: "AW98 Coat", description: null },
      { ...mmBase, handle: "null-both", name: null, description: null },
    ];
    expect(handles(await run(rows))).toEqual(["null-both", "null-desc", "null-name"]);
  });

  it("matches tokens case-insensitively across every token in the list", async () => {
    const rows = [
      { ...mmBase, handle: "keep", name: "SS05 Blazer" },
      { ...mmBase, handle: "a", name: "RE-EDITION h&m TEE" },
      { ...mmBase, handle: "b", description: "HERMES tenure piece" },
    ];
    expect(handles(await run(rows))).toEqual(["keep"]);
  });

  it("lets a manual include bypass excludeAttribution — includes are fetched by handle, not through the rule, and are the curator's explicit override", async () => {
    const rows = [
      { ...mmBase, handle: "hm", name: "Margiela x H&M Denim Jacket" },
    ];
    const products = await run(rows, {
      include: [{ storeDomain: mmBase.store_domain, handle: "hm" }],
    });
    expect(handles(products)).toEqual(["hm"]);
  });
});
