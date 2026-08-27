// Caller-side time bound shared by the homepage sections and the root layout.
//
// `work` receives an AbortSignal; the returned promise rejects once `ms`
// elapses, and the timer is cleared either way. On a cold cache miss the
// cached fetchers DO have a live request in flight — but they bound it
// themselves (see the internal aborts in stores.js / fx.js). This race is
// caller-side defense in depth: it unblocks render if that machinery ever
// fails to reject. Hence LAYOUT_GUARD_TIMEOUT_MS is deliberately LATER than
// the fetchers' 4s internal aborts, so it never wins a routine stall and
// double-logs.
export const SECTION_TIMEOUT_MS = 4000;
export const LAYOUT_GUARD_TIMEOUT_MS = 6000;

export function withTimeout(work, ms = SECTION_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return Promise.race([
    work(controller.signal),
    new Promise((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(new Error(`timed out after ${ms}ms`)),
        { once: true },
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
