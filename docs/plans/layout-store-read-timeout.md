# Bound the root layout's store read with a 4s timeout + fallback

## Context

`RootLayout` ([app/layout.js:67-73](app/layout.js#L67)) awaits `getActiveStores()` inside a
`Promise.all` before any HTML is emitted. `getActiveStores` ([app/lib/stores.js:107-131](app/lib/stores.js#L107))
degrades to `FALLBACK_STORES` only on **error** — a hanging (non-erroring) Supabase read on a
cold-cache instance blocks the entire document, sitewide. Verified: no timeout, no catch, no
signal at the call site; it's the only unbounded network dependency in that `Promise.all`
(`getFxRates` self-bounds at 5s; `cookies()`/`getLanguage()` are local).

The homepage already solved this exact problem: `withTimeout` + `SECTION_TIMEOUT_MS = 4000`
([app/page.js:22-41](app/page.js#L22)), with the documented caveat that the race unblocks render
but does not abort the underlying request — acceptable here for the same reason.

Surfaced by an adversarial review of `docs/plans/vector-map-instant-load.md`. **Note:** that doc
exists only on branch `claude/vector-map-performance-90252c`, not on `main`/this branch — there
is nothing to keep unchanged here; we simply don't touch it.

## Approach

Extract the existing helper into a shared module rather than duplicating it (matches the repo's
single-source-of-truth convention):

1. **New file `app/lib/withTimeout.js`** — move `withTimeout` and `SECTION_TIMEOUT_MS`
   (rename export to `DEFAULT_TIMEOUT_MS` or keep the name — keep `SECTION_TIMEOUT_MS` to
   minimize churn) verbatim from `app/page.js`, including the comment explaining that the race
   unblocks render and does not cancel work (cached fetchers have no live request to abort).
   Export both.

2. **`app/page.js`** — delete the local definitions, import from `app/lib/withTimeout.js`.
   No behavior change.

3. **`app/layout.js`** — import `withTimeout` and `FALLBACK_STORES`, then replace the bare
   `getActiveStores()` member of the `Promise.all` with a pre-caught bounded read:

   ```js
   const storesPromise = withTimeout(() => getActiveStores()).catch(
     () => FALLBACK_STORES,
   );
   ```

   and use `storesPromise` in the `Promise.all`. **The `.catch` must be attached before the
   `Promise.all`** — otherwise the timeout rejection rejects the whole `Promise.all` and crashes
   the layout instead of degrading. Add a short comment tying it to the app/page.js pattern
   (hanging read must not block the document; fallback keeps nav store links rendering).

### Explicitly unchanged (per task constraints + CLAUDE.md invariants)

- `fetchActiveStoresFresh` and all authoritative callers (`/api/cron`, admin routes).
- The cached path's error semantics in `stores.js` — `fetchActiveStoresOrThrow` still throws;
  the fallback lives only at the layout call site, so a fallback is never cached.
- `app/feed/page.js` / `app/stores/page.js` callers. (Observation, out of scope:
  [app/stores/page.js:18](app/stores/page.js#L18) is also unbounded, but page-scoped — worth a
  follow-up task, not this PR.)

## Files

- `app/lib/withTimeout.js` (new)
- `app/page.js` (imports only)
- `app/layout.js` (bounded store read)

## Verification

1. Worktree setup (per memory note): copy `.env.local` from the main checkout into the worktree,
   `npm ci`.
2. `npm run build` (or `next build`) to catch import errors — layout is server-only, so the build
   exercises both files.
3. Run the dev server via the Browser pane (`preview_start` with a launch.json entry), load `/`:
   - Homepage renders; nav store links present (read_page → store links from live data).
   - No console/server errors.
4. Sanity: temporarily unset Supabase env vars is NOT a valid hang simulation (that errors, which
   already degrades) — the hang path can't be cheaply reproduced locally; rely on the race being
   the same audited pattern as `app/page.js` plus a code read of the `.catch` placement.
5. Read-path only — do not hit `/api/cron` or `/api/enrich`.

## Delivery

Work on the current worktree branch `claude/eager-shaw-6213b6`, commit, push the branch, open a
PR against `main` with `gh`. Do not merge; do not push to `main`.
