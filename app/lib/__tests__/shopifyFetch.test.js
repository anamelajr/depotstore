import { describe, it, expect, vi, afterEach } from "vitest";
import {
  dedupeByHandle,
  passesBrandFilter,
  fetchPageWithRetry,
  fetchStoreProducts,
} from "../shopifyFetch.js";

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

// Transient Shopify 503s (origin flakiness, seen in production store_errors)
// must get exactly one retry; exhausted retries must still THROW, never
// return partial data — the cron's scoped stale delete depends on it.

const okResponse = { ok: true, status: 200 };
const res503 = { ok: false, status: 503, statusText: "Service Unavailable" };
const res404 = { ok: false, status: 404, statusText: "Not Found" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPageWithRetry", () => {
  it("returns the response on first success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse);
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPageWithRetry("https://x/products.json", { domain: "x", page: 1 })
    ).resolves.toBe(okResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on a 5xx then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res503)
      .mockResolvedValueOnce(okResponse);
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPageWithRetry("https://x/products.json", { domain: "x", page: 2 })
    ).resolves.toBe(okResponse);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws after the retry also 5xxs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res503);
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPageWithRetry("https://x/products.json", { domain: "x", page: 3 })
    ).rejects.toThrow("Shopify fetch failed for x page 3: 503");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res404);
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPageWithRetry("https://x/products.json", { domain: "x", page: 1 })
    ).rejects.toThrow("404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on a network error then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(okResponse);
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPageWithRetry("https://x/products.json", { domain: "x", page: 1 })
    ).resolves.toBe(okResponse);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws after network errors exhaust the retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket hang up"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPageWithRetry("https://x/products.json", { domain: "x", page: 1 })
    ).rejects.toThrow("Shopify fetch failed for x page 1: socket hang up");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses to start an attempt past the deadline", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPageWithRetry("https://x/products.json", {
        domain: "x",
        page: 4,
        deadline: Date.now() - 1,
      })
    ).rejects.toThrow("Sync deadline exceeded for x (fetch page 4, attempt 1)");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the retry when the deadline passes during the first attempt", async () => {
    // First attempt consumes the remaining budget (~50ms) via a slow network
    // failure; the retry must then throw the deadline error, not re-fetch.
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("socket hang up")), 60)
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPageWithRetry("https://x/products.json", {
        domain: "x",
        page: 5,
        deadline: Date.now() + 50,
      })
    ).rejects.toThrow("Sync deadline exceeded for x (fetch page 5, attempt 2)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps the abort timeout at the remaining deadline budget", async () => {
    // A hung fetch must be aborted at the remaining budget (~100ms), not
    // FETCH_TIMEOUT_MS (10s) — the whole call resolves well under a second.
    const fetchMock = vi.fn().mockImplementation((url, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const start = Date.now();
    await expect(
      fetchPageWithRetry("https://x/products.json", {
        domain: "x",
        page: 6,
        deadline: Date.now() + 100,
      })
    ).rejects.toThrow("Sync deadline exceeded for x (fetch page 6, attempt 2)");
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe("fetchStoreProducts deadline", () => {
  it("throws before fetching when the sync deadline has passed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchStoreProducts(
        { domain: "example.com", storeName: "Example" },
        { deadline: Date.now() - 1 }
      )
    ).rejects.toThrow("Sync deadline exceeded for example.com (fetch page 1)");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws mid-pagination when the deadline passes between pages", async () => {
    // Full page of 250 → loop continues to page 2, where the deadline
    // (already breached after the ~150ms inter-page sleep) must throw.
    const fullPage = {
      ok: true,
      status: 200,
      json: async () => ({
        products: Array.from({ length: 250 }, (_, i) => ({
          id: i,
          handle: `h${i}`,
          title: `T${i}`,
        })),
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(fullPage);
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchStoreProducts(
        { domain: "example.com", storeName: "Example" },
        { deadline: Date.now() + 50 }
      )
    ).rejects.toThrow("Sync deadline exceeded for example.com (fetch page 2)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
