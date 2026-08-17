import { describe, it, expect, vi } from "vitest";

// supabase.js calls createClient() at import time and throws without env vars.
vi.mock("../../../../lib/supabase.js", () => ({ supabaseAdmin: {} }));

import { scanVisibleRows } from "../route.js";

const PAGE_SIZE = 1000;

// Fake PostgREST builder recording the keyset cursor each page asks for.
// withVisibility runs for real, so .eq/.or must chain like the real client.
function fakeClient(pages, cursors) {
  let call = 0;
  const builder = {
    select: () => builder,
    eq: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    gt: (_col, value) => {
      cursors.push(value);
      return builder;
    },
    then: (resolve) => Promise.resolve(pages[call++]).then(resolve),
  };
  return { from: () => builder };
}

const page = (n, startId) =>
  Array.from({ length: n }, (_, i) => ({
    id: startId + i,
    store_domain: "example.com",
    brand: "PRADA",
    title: "FW04 Wool Coat",
    category: "Jackets & Coats",
    enrich_attempts: 0,
  }));

describe("scanVisibleRows — keyset paging", () => {
  it("carries the last id forward and terminates on a short page", async () => {
    const cursors = [];
    const pages = [
      { data: page(PAGE_SIZE, 1), error: null },
      { data: page(PAGE_SIZE, 1001), error: null },
      { data: page(7, 2001), error: null },
    ];
    const rows = await scanVisibleRows(fakeClient(pages, cursors));

    expect(rows).toHaveLength(2 * PAGE_SIZE + 7);
    // gt("id", lastId) — a row value, not an offset. An offset would silently
    // drop a row whenever /api/enrich flips `hidden` mid-scan.
    expect(cursors).toEqual([0, 1000, 2000]);
  });

  it("terminates on an empty page even at an exact page boundary", async () => {
    const cursors = [];
    const pages = [
      { data: page(PAGE_SIZE, 1), error: null },
      { data: [], error: null },
    ];
    expect(await scanVisibleRows(fakeClient(pages, cursors))).toHaveLength(PAGE_SIZE);
  });

  it("throws on a page error instead of returning a truncated set", async () => {
    // Fail closed: a short scan under-reports, and the workflow would read that
    // as items having been fixed.
    const pages = [
      { data: page(PAGE_SIZE, 1), error: null },
      { data: page(PAGE_SIZE, 1001), error: null },
      { data: page(PAGE_SIZE, 2001), error: null },
      { data: null, error: { message: "statement timeout" } },
    ];
    await expect(scanVisibleRows(fakeClient(pages, []))).rejects.toThrow(
      /product scan failed after id 3000: statement timeout/
    );
  });

  it("throws on a duplicate id rather than double-counting", async () => {
    const pages = [
      { data: page(PAGE_SIZE, 1), error: null },
      { data: page(3, 1000), error: null },
    ];
    await expect(scanVisibleRows(fakeClient(pages, []))).rejects.toThrow(
      /duplicate row id 1000/
    );
  });
});
