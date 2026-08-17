import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The route imports the Supabase admin client and the OpenAI wrapper at module
// scope; neither is exercised by these tests.
vi.mock("../../../lib/supabase.js", () => ({ supabaseAdmin: {} }));
vi.mock("../../../lib/generateDescription.js", () => ({
  generateDescription: vi.fn(),
}));

import { runPool } from "../route.js";

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

describe("runPool attempt accounting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports every row attempted when the pool drains normally", async () => {
    const attempted = await runPool(rows(12), async () => {}, Date.now());
    expect(attempted.size).toBe(12);
  });

  it("excludes rows stranded past the deadline so their claim can be released", async () => {
    // The first dequeued call pushes the clock past DEADLINE_MS, so every
    // later dequeue attempt bails out. The stranded rows must NOT appear in
    // the attempted set — the route decrements their description_attempts,
    // otherwise three degraded runs would exhaust them without a single
    // OpenAI call (Codex review P1).
    const startMs = Date.now();
    const attempted = await runPool(
      rows(20),
      async () => {
        vi.advanceTimersByTime(300_000);
      },
      startMs,
    );
    expect(attempted.size).toBe(1);
    expect(attempted.has(1)).toBe(true);
  });

  it("attempts nothing when the deadline has already passed at start", async () => {
    const startMs = Date.now();
    vi.advanceTimersByTime(300_000);
    const worker = vi.fn(async () => {});
    const attempted = await runPool(rows(10), worker, startMs);
    expect(attempted.size).toBe(0);
    expect(worker).not.toHaveBeenCalled();
  });
});
