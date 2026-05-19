import test from "node:test";
import assert from "node:assert/strict";
import { fetchEditorialProducts } from "./fetchEditorialProducts.js";

function makeFakeClient(rowsByCall) {
  const calls = [];
  return {
    calls,
    from(table) {
      const state = { kind: "query", table, filters: [], order: [], limit: null };
      const builder = {
        select(cols) { state.cols = cols; return builder; },
        eq(col, val) { state.filters.push(["eq", col, val]); return builder; },
        ilike(col, val) { state.filters.push(["ilike", col, val]); return builder; },
        in(col, val) { state.filters.push(["in", col, val]); return builder; },
        order(col, opts) { state.order.push([col, opts]); return builder; },
        limit(n) { state.limit = n; return builder; },
        then(resolve) {
          const result = rowsByCall(state, calls.length);
          calls.push(state);
          return Promise.resolve(result).then(resolve);
        },
      };
      return builder;
    },
    async rpc(name, params) {
      const state = { kind: "rpc", name, params };
      const result = rowsByCall(state, calls.length);
      calls.push(state);
      return result;
    },
  };
}

function row(handle, domain, brand = "Rick Owens", extras = {}) {
  return {
    id: `${domain}-${handle}`,
    name: handle,
    title: null,
    brand,
    price: "€100",
    image_url: null,
    store_name: domain,
    store_domain: domain,
    product_url: null,
    available: true,
    handle,
    ...extras,
  };
}

test("curated query is split per store_domain and filters available + hidden", async () => {
  const client = makeFakeClient((state, i) => {
    if (i === 0) {
      const got = Object.fromEntries(
        state.filters.map(([op, col, val]) => [`${op}:${col}`, val])
      );
      assert.equal(got["eq:store_domain"], "esco.test");
      assert.equal(got["eq:available"], true);
      assert.equal(got["eq:hidden"], false);
      assert.deepEqual(got["in:handle"], ["a", "b"]);
      return { data: [row("a", "esco.test"), row("b", "esco.test")] };
    }
    return { data: [] };
  });

  const { curated } = await fetchEditorialProducts({
    curatedProducts: [
      { storeDomain: "esco.test", handle: "a" },
      { storeDomain: "esco.test", handle: "b" },
    ],
    brandFilter: null,
    moreFromLimit: 0,
    client,
  });
  assert.equal(curated.length, 2);
  assert.equal(curated[0].handle, "a");
  assert.equal(curated[1].handle, "b");
});

test("more-from calls get_interleaved_products RPC + excludes curated handles", async () => {
  const client = makeFakeClient((state, i) => {
    if (i === 0) return { data: [row("a", "esco.test")] };
    assert.equal(state.kind, "rpc");
    assert.equal(state.name, "get_interleaved_products");
    assert.equal(state.params.p_brand, "Rick Owens");
    assert.equal(state.params.p_store, null);
    assert.equal(state.params.p_category, null);
    assert.equal(state.params.p_search, null);
    assert.equal(state.params.p_offset, 0);
    return { data: [row("a", "esco.test"), row("x", "esco.test"), row("y", "esco.test")] };
  });

  const { moreFrom } = await fetchEditorialProducts({
    curatedProducts: [{ storeDomain: "esco.test", handle: "a" }],
    brandFilter: "Rick Owens",
    moreFromLimit: 2,
    client,
  });
  const handles = moreFrom.map((p) => p.handle);
  assert.deepEqual(handles, ["x", "y"]);
});

test("backfills curated from brand pool when below minCurated and excludes moreFrom handles", async () => {
  let call = 0;
  const client = makeFakeClient(() => {
    call++;
    if (call === 1) return { data: [row("a", "esco.test")] };
    if (call === 2) return {
      data: [row("x", "esco.test"), row("y", "esco.test"), row("z", "esco.test")],
    };
    if (call === 3) return { data: [row("p", "esco.test"), row("q", "esco.test"), row("r", "esco.test"), row("s", "esco.test")] };
    return { data: [] };
  });

  const { curated, moreFrom } = await fetchEditorialProducts({
    curatedProducts: [{ storeDomain: "esco.test", handle: "a" }],
    brandFilter: "Rick Owens",
    moreFromLimit: 3,
    minCurated: 4,
    client,
  });

  assert.equal(curated.length, 4);
  assert.equal(curated[0].handle, "a");
  const moreFromHandles = new Set(moreFrom.map((p) => p.handle));
  for (const item of curated.slice(1)) {
    assert.ok(!moreFromHandles.has(item.handle), `backfill ${item.handle} should not be in moreFrom`);
  }
});
