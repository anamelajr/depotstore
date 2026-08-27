# Bound the root layout's data reads: abort the cold-miss query, race defensively

## Context

`RootLayout` ([app/layout.js:67-73](../../app/layout.js)) awaits `getActiveStores()` and
`getFxRates()` inside a `Promise.all` before any HTML is emitted. Both cached read paths
(`fetchActiveStoresOrThrow`, `app/lib/stores.js:88-99`; `fetchFxRatesOrThrow`,
`app/lib/fx.js:32-45`) run a live Supabase query with **no abort signal and no timeout** on a
cold cache miss. Their degradation to `FALLBACK_STORES` / `FALLBACK_RATES` fires only on
**error** — a hanging (non-erroring) read blocks the entire document, sitewide. `cookies()` and
`getLanguage()` are local; these two are the only network dependencies gating first paint.

Revised after an adversarial Codex review of the first draft, which correctly showed that a
caller-side `Promise.race` alone (the original approach, borrowed from `app/page.js`) unblocks
render but leaves the cold-miss query running unbounded — the very case `stores.js:54-58`'s own
comment warns about. Server-side `statement_timeout` (8s) does not cover network-level stalls,
so the bound must be client-side.

## Approach

Two layers: abort the actual query where it lives (primary bound), keep a defensive race at the
layout (secondary bound, in case the abort machinery itself fails).

1. **`app/lib/withTimeout.js` (new)** — move `withTimeout` + `SECTION_TIMEOUT_MS` (4000) from
   `app/page.js` verbatim, **correcting the comment**: on a cold miss the cached fetchers DO
   have a live request; the race is caller-side defense in depth, the real bound is the
   fetcher-internal abort below.

2. **`app/lib/stores.js`** — inside `fetchActiveStoresOrThrow`, add an internal
   `AbortController` + `setTimeout(4000)` (module const `STORES_READ_TIMEOUT_MS`), apply
   `.abortSignal(controller.signal)` to the query, `clearTimeout` in `finally` — the exact
   pattern of `refreshFxRates` (`app/lib/fx.js:73-106`). On abort, throw a **distinct** error
   (`stores read timed out after 4000ms`) so operators can tell timeout from other failures.
   Semantics preserved: still throws on error/empty/timeout → `unstable_cache` never caches a
   fallback; the existing `dedupedActiveStores` catch (`stores.js:120-127`) already logs and
   degrades to `FALLBACK_STORES`, so every render-path caller (layout, homepage, feed,
   /stores) inherits the bound. The signal cannot be passed in from callers: `unstable_cache`
   keys on arguments, and a per-request signal object would break/bust the cache key.

3. **`app/lib/fx.js`** — same internal abort in `fetchFxRatesOrThrow` (scope addition vs the
   original task, which assumed fx was already bounded — it isn't: the 5s abort in
   `refreshFxRates` is the cron write path, not this read). Same throw-on-timeout, same
   never-cache-a-fallback contract; `dedupedFxRates`'s structured `fx_read_fallback` warn
   already covers telemetry.

4. **`app/page.js`** — delete local `withTimeout`/`SECTION_TIMEOUT_MS`, import from
   `app/lib/withTimeout.js`. No behavior change.

5. **`app/layout.js`** — replace the bare `getActiveStores()` member with a pre-caught
   defensive race:

   ```js
   const storesPromise = withTimeout(() => getActiveStores()).catch((e) => {
     console.error(
       JSON.stringify({ event: "layout_stores_fallback", reason: e?.message ?? String(e) }),
     );
     return FALLBACK_STORES;
   });
   ```

   The `.catch` MUST be attached before the `Promise.all` — an uncaught race rejection would
   reject the whole `Promise.all` and crash the layout instead of degrading. In the normal
   timeout case the internal abort (step 2) fires first and the fallback arrives via
   `dedupedActiveStores`' logged catch; this race only wins if the abort machinery itself
   fails, hence its own structured log. Do NOT rethrow unexpected errors here: a root-layout
   crash is strictly worse than fallback nav.

6. **`tests/lib/withTimeout.test.js` (new)** — `node:test` with mock timers
   (`mock.timers.enable`): a never-settling `work` → promise rejects once fake time passes
   `SECTION_TIMEOUT_MS` and the signal passed to `work` is aborted; a fast-resolving `work` →
   resolves with its value and the timer is cleared. (The fetcher-internal aborts reuse the
   already-proven `refreshFxRates` shape and supabase-js's `.abortSignal`, exercised by
   `fetchActiveStoresFresh`; mocking `supabaseAdmin`/`unstable_cache` for a direct stores.js
   test isn't worth the harness.)

### Explicitly unchanged

- `fetchActiveStoresFresh` and all authoritative callers (`/api/cron`, admin routes).
- Throw-on-error semantics of both cached inner fetchers — a fallback is still never cached.
- `app/feed/page.js` / `app/stores/page.js` call sites (they now inherit the bound via step 2).
- PDP gate (`resolveProductDetail.js`) — stays fail-closed, never routes through here.

## Files

- `app/lib/withTimeout.js` (new)
- `app/lib/stores.js` (internal abort in `fetchActiveStoresOrThrow`)
- `app/lib/fx.js` (internal abort in `fetchFxRatesOrThrow`)
- `app/page.js` (imports only)
- `app/layout.js` (defensive race + structured-log catch)
- `tests/lib/withTimeout.test.js` (new)

## Verification

1. Worktree setup: copy `.env.local` from the main checkout, `npm ci`.
2. `node --test tests/lib/withTimeout.test.js` (and the full `tests/lib` suite for regressions).
3. `npm run build` — layout/page are server components, so the build exercises all imports.
4. Dev server via Browser pane, load `/`: homepage renders, nav store links present, prices
   render (fx path), no console/server errors.
5. The hang path itself can't be cheaply reproduced against prod Supabase; the abort mechanism
   is the audited `refreshFxRates` pattern + supabase-js `.abortSignal` (already live in
   `fetchActiveStoresFresh`), and the race fallback is covered by the unit test.
6. Read-path only — never hit `/api/cron` or `/api/enrich` locally.

## Delivery

Work on `claude/eager-shaw-6213b6`, commit, push, open a PR against `main`. Do not merge; do
not push to `main`.
