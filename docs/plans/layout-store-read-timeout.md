# Bound the root layout's data reads: abort the cold-miss query, race defensively

Status: plan approved after two adversarial Codex review rounds; ready to execute.
Branch: `claude/eager-shaw-6213b6`. Do not merge; do not push to `main`.

## Context

`RootLayout` ([app/layout.js:67-73](../../app/layout.js)) awaits `getActiveStores()` and
`getFxRates()` inside a `Promise.all` before any HTML is emitted. Both cached read paths
(`fetchActiveStoresOrThrow`, `app/lib/stores.js:88-99`; `fetchFxRatesOrThrow`,
`app/lib/fx.js:32-45`) run a live Supabase query with **no abort signal and no timeout** on a
cold cache miss. Their degradation to `FALLBACK_STORES` / `FALLBACK_RATES` fires only on
**error** — a hanging (non-erroring) read blocks the entire document, sitewide. `cookies()` and
`getLanguage()` are local; these two are the only network dependencies gating first paint.

Review round 1 established that a caller-side `Promise.race` alone (the original approach,
borrowed from `app/page.js`) unblocks render but leaves the cold-miss query running unbounded —
the very case `stores.js:54-58`'s own comment warns about. Server-side `statement_timeout` (8s)
does not cover network-level stalls, so the bound must be client-side. Review round 2 added:
the defensive layout race must cover BOTH network members (not just stores), and its deadline
must be strictly LATER than the fetcher-internal one — with equal 4000ms deadlines the outer
race timer (armed before the work is invoked) wins routine timeouts, firing the
"abort machinery failed" log on every ordinary stall and double-logging.

## Approach

Two layers. Primary bound: abort the actual query inside each cached inner fetcher at **4s**.
Secondary bound: a defensive race at the layout at **6s** per network member, which only fires
if the primary abort machinery itself failed (e.g. supabase-js not rejecting on abort).

1. **`app/lib/withTimeout.js` (new)** — move `withTimeout` + `SECTION_TIMEOUT_MS` (4000) from
   `app/page.js` verbatim, then generalize the signature to
   `withTimeout(work, ms = SECTION_TIMEOUT_MS)` and add
   `export const LAYOUT_GUARD_TIMEOUT_MS = 6000;`. Correct the moved comment: on a cold miss
   the cached fetchers DO have a live request; this race is caller-side defense in depth — the
   real bound is the fetcher-internal abort. The 6s guard is deliberately later than the 4s
   internal aborts so it never wins a routine stall.

2. **`app/lib/stores.js`** — inside `fetchActiveStoresOrThrow`, add an internal
   `AbortController` + `setTimeout` (module const `STORES_READ_TIMEOUT_MS = 4000`), apply
   `.abortSignal(controller.signal)` to the query, `clearTimeout` in `finally` — the exact
   pattern of `refreshFxRates` (`app/lib/fx.js:73-106`). On abort, throw a **distinct** error
   (`stores read timed out after 4000ms`) so operators can tell timeout from other failures.
   Semantics preserved: still throws on error/empty/timeout → `unstable_cache` never caches a
   fallback; the existing `dedupedActiveStores` catch (`stores.js:120-127`) already logs and
   degrades to `FALLBACK_STORES`, so every render-path caller (layout, homepage, feed,
   /stores) inherits the bound. The signal cannot be passed in from callers: `unstable_cache`
   keys on arguments, and a per-request signal object would break/bust the cache key.

3. **`app/lib/fx.js`** — same internal abort in `fetchFxRatesOrThrow`
   (`FX_READ_TIMEOUT_MS = 4000`, distinct timeout error). Scope addition vs the original task,
   which assumed fx was already bounded — it isn't: the 5s abort in `refreshFxRates` is the
   cron write path, not this read. Same throw-on-timeout, same never-cache-a-fallback
   contract; `dedupedFxRates`'s structured `fx_read_fallback` warn already covers telemetry.

4. **`app/page.js`** — delete local `withTimeout`/`SECTION_TIMEOUT_MS`, import from
   `app/lib/withTimeout.js`. No behavior change (call sites keep the 4s default).

5. **`app/layout.js`** — wrap BOTH network members in independently pre-caught 6s defensive
   races (round-2 fix: guarding only stores would leave the identical hang mode open via fx):

   ```js
   const storesPromise = withTimeout(
     () => getActiveStores(),
     LAYOUT_GUARD_TIMEOUT_MS,
   ).catch((e) => {
     console.error(
       JSON.stringify({ event: "layout_stores_fallback", reason: e?.message ?? String(e) }),
     );
     return FALLBACK_STORES;
   });
   const fxPromise = withTimeout(
     () => getFxRates(),
     LAYOUT_GUARD_TIMEOUT_MS,
   ).catch((e) => {
     console.error(
       JSON.stringify({ event: "layout_fx_fallback", reason: e?.message ?? String(e) }),
     );
     return { rates: { ...FALLBACK_RATES }, source: "fallback" };
   });
   ```

   Use both in the existing `Promise.all` in place of the bare calls (the destructuring of
   `{ rates, source }` from the fx member is unchanged). Each `.catch` MUST be attached before
   the `Promise.all` — an uncaught race rejection would reject the whole `Promise.all` and
   crash the layout instead of degrading. In the normal stall case the 4s internal aborts fire
   first and fallbacks arrive via the fetchers' own logged catches; these 6s races fire ONLY
   if that machinery failed, hence their own structured logs. Do NOT rethrow unexpected errors
   here: a root-layout crash is strictly worse than fallback nav/rates. Import `FALLBACK_RATES`
   from `./lib/fx.js` and `FALLBACK_STORES` from `./lib/stores.js`.

6. **`tests/lib/withTimeout.test.js` (new)** — `node:test` with mock timers
   (`mock.timers.enable`):
   - never-settling `work` → rejects once fake time passes the default 4000ms, and the signal
     passed to `work` is aborted;
   - custom `ms` (e.g. 6000) → does NOT reject at 4000ms, rejects after 6000ms — proving the
     staggering knob works;
   - fast-resolving `work` → resolves with its value (timer cleared, no stray rejection).

   (The fetcher-internal aborts reuse the already-proven `refreshFxRates` shape and
   supabase-js's `.abortSignal`, exercised in production by `fetchActiveStoresFresh`; mocking
   `supabaseAdmin`/`unstable_cache`/`React.cache` for direct fetcher tests is a
   disproportionate harness and is deliberately skipped.)

### Explicitly unchanged

- `fetchActiveStoresFresh` and all authoritative callers (`/api/cron`, admin routes).
- Throw-on-error semantics of both cached inner fetchers — a fallback is still never cached.
- `app/feed/page.js` / `app/stores/page.js` call sites (they now inherit the bound via step 2).
- PDP gate (`resolveProductDetail.js`) — stays fail-closed, never routes through here.
- `refreshFxRates` (cron write path) — already bounded, untouched.

## Files

- `app/lib/withTimeout.js` (new: `withTimeout(work, ms)`, `SECTION_TIMEOUT_MS`,
  `LAYOUT_GUARD_TIMEOUT_MS`)
- `app/lib/stores.js` (internal 4s abort in `fetchActiveStoresOrThrow`)
- `app/lib/fx.js` (internal 4s abort in `fetchFxRatesOrThrow`)
- `app/page.js` (imports only)
- `app/layout.js` (6s defensive races + structured-log catches on both network members)
- `tests/lib/withTimeout.test.js` (new)

## Verification

1. Worktree setup: copy `.env.local` from the main checkout into the worktree, `npm ci`.
2. `node --test tests/lib/withTimeout.test.js` (and the full `tests/lib` suite for regressions).
3. `npm run build` — layout/page are server components, so the build exercises all imports.
4. Dev server via the Browser pane (`preview_start`), load `/`: homepage renders, nav store
   links present, prices render (fx path), no console/server errors.
5. The hang path itself can't be cheaply reproduced against prod Supabase (there is no dev DB);
   the abort mechanism is the audited `refreshFxRates` pattern + supabase-js `.abortSignal`
   (already live in `fetchActiveStoresFresh`), and the race staggering is covered by the unit
   test. Do NOT simulate by unsetting Supabase env vars — that errors, which already degrades.
6. Read-path only — never hit `/api/cron` or `/api/enrich` locally (prod writes + OpenAI spend).

## Delivery

Commit on `claude/eager-shaw-6213b6`, push, open a PR against `main` with `gh`. Do not merge;
do not push to `main`.
