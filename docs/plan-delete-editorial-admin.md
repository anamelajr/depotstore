# Plan: Delete editorials from the admin list page

## Context

The admin editorial tool can create, edit, and publish entries but has **no way to
delete one**. Removing an editorial today is a manual 3-file chore (delete
`content/editorial/<slug>.js`, hand-edit the `ENTRIES` array + import in
`content/editorial/index.js`, and delete `public/editorial/<slug>/`). Forgetting the
`index.js` step crashes the editorial section, because `index.js` statically imports
every slug file.

This plan adds a one-click **Delete** action to each row of `/admin/editorial` that
removes all three pieces atomically and safely, behind the existing dev-only gate.

User decisions for this feature:
- **Location:** list page rows only (not the editor header).
- **Images:** delete `public/editorial/<slug>/` along with the entry.
- **Confirmation:** a simple `confirm()` dialog (no type-to-confirm).

## Approach

Three changes: a new index-unpatch helper, a new delete API route, and a client-side
delete button wired into the (server-rendered) list page.

### 1. `app/lib/patchEditorialIndex.js` — add `unpatchEditorialIndex(source, slug)`

Counterpart to the existing add-only `patchEditorialIndex`. Reuse `slugToIdentifier`.

- Compute `ident = slugToIdentifier(slug)` and `importLine = `import ${ident} from "./${slug}.js";``.
- **Idempotent:** if `importLine` is absent, return `source` unchanged (so deleting an
  already-unregistered entry still lets the route proceed to file removal).
- Remove the import line **and** its trailing newline.
- Remove the identifier from `const ENTRIES = [...]` using the **same anchored regex**
  the add path uses (`/const ENTRIES = \[([^\]]*)\];/`). Parse the inner list by
  splitting on `,`, `trim()`, filter out exactly `ident` (exact-match, not substring —
  avoids clobbering `rickOwens` when deleting `rick`), rejoin with `, `. Empty → `[]`.
- Throw if the ENTRIES anchor is missing (mirrors add-path behavior; route catches).

### 2. `app/api/admin/delete-editorial/route.js` (new, POST)

Mirror the conventions in `app/api/admin/save/route.js` and
`app/api/admin/save-homepage-edit/route.js`:

- `const gate = assertDev(); if (gate) return gate;` (dev-only; `middleware.js` also
  404s `/api/admin/*` in prod — defense in depth).
- Read `{ slug }` from `request.json()`. Validate with the same regex the save route
  uses: `/^[a-z0-9][a-z0-9-]*$/`. Reject otherwise with 400.
- Resolve paths from `process.cwd()`: `content/editorial/<slug>.js`,
  `content/editorial/index.js`, `public/editorial/<slug>/`.
- **Serialize the registry critical section (Codex finding 1).** Steps 1–2 below run
  inside a shared in-process lock (see helper in change 4) so two requests can never
  interleave their read-modify-write of `index.js`. This closes the concurrent-delete
  crash: without it, two deletes for `[a, b]` can each read the same starting index, and
  the stale last writer restores the other's import for a file that's already been
  unlinked — and because `index.js` statically imports slug files, the public editorial
  section then crashes. (Note the asymmetry vs the existing save race: a stale *create*
  orphans a file harmlessly; a stale *delete* imports a *missing* file → crash, so this
  is worth closing rather than just documenting.) The same lock should also wrap the save
  route's index patch so both writers share one queue.
- **Order, inside the lock (chosen so the site never imports a missing file, and so a
  partial failure leaves NO dirty state):**
  1. Read `index.js` into `originalIndex` (keep it in memory for rollback). Compute
     `unpatchEditorialIndex(originalIndex, slug)` and write it **atomically** via tmp +
     `fs.rename` (the `save-homepage-edit` pattern: `${file}.tmp.${pid}.${Date.now()}`,
     `unlink` tmp on failure). If this fails → return 500, nothing else touched.
  2. `fs.unlink(content/editorial/<slug>.js)`.
     - **ENOENT is benign** — the file is already gone, so the delete is effectively done
       (idempotent success).
     - **Any other error (EACCES, EBUSY, EPERM, …) is blocking → roll back `index.js` to
       `originalIndex` (same atomic tmp+rename), then return 500.** Rationale (Codex
       finding 2): the admin list discovers entries by reading `content/editorial/*.js`
       from disk (`loadEntries()` in `page.js`), NOT from `ENTRIES`. If we left the
       modified `index.js` in place on failure, the entry would be gone from the public
       registry while still visible in admin — AND that dirty `index.js` is under the
       publish allowlist (`listDirtyAllowlisted` scans `content/`), so a *failed* delete
       could later be published as a silent partial delete. Rolling back restores the
       all-or-nothing invariant: either fully deleted, or fully intact.
- **After the lock — image cleanup (best-effort, reported):**
  3. `fs.rm(public/editorial/<slug>/, { recursive: true, force: true })`. `force: true`
     swallows ENOENT (missing dir = success). On a real failure (EPERM/EBUSY/…) do NOT
     fail the request — the registry+slug-file deletion (the actual intent) already
     succeeded — but capture `imagesRemoved: false` so the result is honest (Codex
     finding 3: don't report clean success while orphaned public assets remain). Runs
     outside the lock; it touches only this slug's own folder.
- Return `{ ok: true, slug, indexUpdated, imagesRemoved }` on success (`imagesRemoved`
  may be `false` if step 3 failed — a soft warning, not an error). 400 on bad slug; 500
  on index-write failure (step 1) or non-ENOENT slug-file deletion failure (step 2, with
  `index.js` rolled back first), each with a descriptive `error` message.

**Lock scope caveat:** the lock is a module-level in-process promise queue — it serializes
within a single Node process, which is exactly the dev-server model here (one
`npm run dev`, route 404'd in prod via `middleware.js`). It is not, and does not need to
be, distributed locking; the plan should state this explicitly so the guarantee isn't
overread.

### 3. List page wiring

`app/admin/editorial/page.js` is a **server component**, so the delete button must be a
small client component.

- **New** `app/admin/editorial/_components/DeleteEntryButton.js` (`"use client"`):
  - Props: `slug`, `title`.
  - Renders a compact button using existing tokens — reddish `#c9806b` (the same delete
    accent used in `CuratedProductsPanel.js`), on `#2a2a2c`/transparent.
  - onClick: `confirm(`Delete "${title}"? Removes the entry, its file, and its images. This cannot be undone.`)`
    → `POST /api/admin/delete-editorial` with `{ slug }`.
    - On `ok` with `imagesRemoved !== false`: `router.refresh()` (from `next/navigation`)
      to re-render the list.
    - On `ok` with `imagesRemoved === false`: `router.refresh()` AND `alert` a soft
      warning that the entry was deleted but its image folder couldn't be removed and
      needs manual cleanup (finding 3 — honest reporting, not a hard failure).
    - On non-`ok` (incl. the 500 from a blocked, rolled-back slug-file deletion):
      `alert(data.error)` and do NOT refresh — the row legitimately still exists.
- **Edit** `app/admin/editorial/page.js`: the row is currently a single `<Link>`
  wrapping all content. Restructure each `<li>` to a flex container with the `<Link>`
  (title/slug/date) as one child and `<DeleteEntryButton>` as a **sibling** — NOT nested
  inside the Link — so clicking delete never navigates. Keep all existing list styling.

### 4. `app/lib/indexMutationLock.js` (new) — shared in-process serialization

A minimal module-level promise queue so registry mutations never interleave. No deps, no
new infra:

```js
let queue = Promise.resolve();
export function withIndexLock(fn) {
  const run = queue.then(fn, fn);     // run after the previous job settles
  queue = run.then(() => {}, () => {}); // swallow so one failure can't poison the chain
  return run;                          // caller still sees fn's resolution/rejection
}
```

- The delete route wraps steps 1–2 in `withIndexLock(...)`.
- **Also wrap the save route's `index.js` patch** (`app/api/admin/save/route.js`) in the
  same `withIndexLock` so save and delete share one queue — otherwise a concurrent
  save+delete could still interleave. This is the only edit to the save route.
- Scope is per-process (see caveat above), which matches the single dev-server model.

### Out of scope / note
- **Publishing the deletion** to preview/main already works through the existing
  Publish flow: `listDirtyAllowlisted()` reports deleted paths and `git add -- <path>`
  stages deletions. No publish-route change needed; just verify (below).
- No editor-header delete button (per decision).

## Files

- `app/lib/patchEditorialIndex.js` — add `unpatchEditorialIndex` (export).
- `app/lib/indexMutationLock.js` — **new**: shared in-process `withIndexLock` queue.
- `app/api/admin/delete-editorial/route.js` — new route (steps 1–2 inside the lock,
  index rollback on step-2 failure, image cleanup outside the lock with `imagesRemoved`).
- `app/api/admin/save/route.js` — wrap the existing `index.js` patch in `withIndexLock`
  (shared queue with delete). Only change to this file.
- `app/admin/editorial/_components/DeleteEntryButton.js` — new client component.
- `app/admin/editorial/page.js` — restructure `<li>` to add the button as a sibling.
- (Optional) `app/lib/__tests__/patchEditorialIndex*.test.*` — add `unpatchEditorialIndex`
  unit cases if a test file for this module exists; mirror its style.

## Verification

1. `npm run dev`.
2. Create a throwaway entry at `/admin/editorial/new` (slug e.g. `zz-test`), Save —
   confirm `content/editorial/zz-test.js`, an `index.js` import + ENTRIES entry, and
   `public/editorial/zz-test/` all exist.
3. On `/admin/editorial`, click Delete on that row → accept the confirm.
   - Row disappears (list refreshes).
   - `content/editorial/zz-test.js` gone; `public/editorial/zz-test/` gone.
   - `index.js` no longer has the `zzTest` import or array entry, and the file still
     parses (open `/editorial` and another entry's page — no crash).
4. Delete the seeded `rick-owens` only as a final regression check of multi→single→empty
   array handling **in a throwaway git state** (or test with two dummy entries so the
   real one is untouched): remove one of two → array keeps the other with correct commas;
   remove the last → `const ENTRIES = [];`.
5. **Blocked-deletion rollback (finding 2):** simulate a non-ENOENT unlink failure
   (e.g. `chmod 000` the slug file's parent dir, or make the file read-only on a system
   that enforces it) → click Delete → the route returns 500, the UI shows `alert(error)`
   and the row does NOT disappear, AND `git status`/`git diff` shows `index.js` is
   **clean** (rolled back, not left dirty). This is the key assertion: a failed delete
   leaves zero working-tree changes.
6. **Image-failure reporting (finding 3):** make `public/editorial/<slug>/` undeletable
   (e.g. `chmod 000` it) → Delete → response is `ok` with `imagesRemoved: false`; the
   entry/registry are gone but the UI alerts a manual-cleanup warning. A missing image
   dir still yields `ok` with `imagesRemoved: true`.
7. **Concurrency (finding 1):** with two dummy entries `[aa-x, bb-y]`, fire two delete
   requests near-simultaneously (e.g. two `curl` POSTs in a `&` pair, or two rapid button
   clicks across tabs). Assert the final `index.js` imports neither, references no missing
   file, and still parses — the lock must serialize them. Run a few times.
8. Unit test (if added): `node --test` (or the repo's test runner) over
   `unpatchEditorialIndex` — single-entry→empty, middle removal, first/last removal,
   idempotent-when-absent, substring-safety (`rick` vs `rickOwens`).
9. Publish check (optional, end-to-end): after a delete, use the existing Publish flow
   and confirm the resulting PR diff shows the file deletions staged.
