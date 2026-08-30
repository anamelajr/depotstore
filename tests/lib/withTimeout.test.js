import { describe, it, expect, vi, afterEach } from "vitest";

import {
  withTimeout,
  SECTION_TIMEOUT_MS,
  LAYOUT_GUARD_TIMEOUT_MS,
} from "../../app/lib/withTimeout.js";

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects at the default deadline and aborts the signal it handed out", async () => {
    vi.useFakeTimers();
    let seen;
    const p = withTimeout((signal) => {
      seen = signal;
      return new Promise(() => {});
    });
    const settled = expect(p).rejects.toThrow(/timed out after 4000ms/);

    expect(seen.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS);
    await settled;
    expect(seen.aborted).toBe(true);
  });

  it("a custom ms staggers the deadline past the default", async () => {
    vi.useFakeTimers();
    let rejected = false;
    const p = withTimeout(() => new Promise(() => {}), LAYOUT_GUARD_TIMEOUT_MS);
    const settled = expect(p).rejects.toThrow(/timed out after 6000ms/);
    p.catch(() => {
      rejected = true;
    });

    // The 4s internal fetcher aborts must win a routine stall, not this guard.
    await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS);
    expect(rejected).toBe(false);

    await vi.advanceTimersByTimeAsync(
      LAYOUT_GUARD_TIMEOUT_MS - SECTION_TIMEOUT_MS,
    );
    await settled;
  });

  it("resolves with the work's value when it settles first", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(async () => "ok")).resolves.toBe("ok");
  });
});
