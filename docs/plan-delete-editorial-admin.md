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
- **Remove the import line and the `ENTRIES` identifier INDEPENDENTLY** (Codex finding —
  do NOT key idempotency off the import line alone):
  - If `importLine` is present, remove it **and** its trailing newline. If absent, skip.
  - Separately, remove `ident` from `const ENTRIES = [...]` using the **same anchored
    regex** the add path uses (`/const ENTRIES = \[([^\]]*)\];/`). Parse the inner list by
    splitting on `,`, `trim()`, filter out exactly `ident` (exact-match, not substring —
    avoids clobbering `rickOwens` when deleting `rick`), rejoin with `, `. Empty → `[]`.
  - **Rationale:** the dangerous one-sided state is *import gone but `ENTRIES` still
    references the identifier* — that file already throws an undefined-identifier
    ReferenceError on load. A registry-cleanup tool must repair it, not no-op on it. This
    state is reachable through ordinary manual editing (the exact error this feature
    exists to prevent), so the helper must remove each part on its own.
- **Idempotent:** return `source` unchanged only when BOTH the import line and the
  `ENTRIES` identifier are already absent (so re-running a delete, or deleting an
  already-unregistered entry, is a safe no-op and the route still proceeds to file
  removal).
- Throw if the ENTRIES anchor (`const ENTRIES = [...]`) is missing entirely (mirrors
  add-path behavior; route catches).

### 2. `app/api/admin/delete-editorial/route.js` (new, POST)

Mirror the conventions in `app/api/admin/save/route.js` and
`app/api/admin/save-homepage-edit/route.js`:

- `const gate = assertDev(); if (gate) return gate;` (dev-only; `middleware.js` also
  404s `/api/admin/*` in prod — defense in depth).
- Read `{ slug }` from `request.json()`. Validate with the same regex the save route
  uses: `/^[a-z0-9][a-z0-9-]*$/`. Reject otherwise with 400.
- Resolve paths from `process.cwd()`: `content/editorial/<slug>.js`,
  `content/editorial/index.js`, `public/editorial/<slug>/`.
- **Order (chosen so the site never imports a missing file, and so a partial failure
  leaves NO dirty state):**
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
  3. Image cleanup (best-effort, reported): `fs.rm(public/editorial/<slug>/, { recursive:
     true, force: true })`. `force: true` swallows ENOENT (missing dir = success). On a
     real failure (EPERM/EBUSY/…) do NOT fail the request — the registry+slug-file
     deletion (the actual intent) already succeeded — but capture `imagesRemoved: false`
     so the result is honest (Codex finding 3: don't report clean success while orphaned
     public assets remain).
- Return `{ ok: true, slug, indexUpdated, imagesRemoved }` on success (`imagesRemoved`
  may be `false` if step 3 failed — a soft warning, not an error). 400 on bad slug; 500
  on index-write failure (step 1) or non-ENOENT slug-file deletion failure (step 2, with
  `index.js` rolled back first), each with a descriptive `error` message.

**Concurrency: documented single-writer assumption (NOT a lock).** Step 1 is a
read-modify-write of `index.js` and is intentionally NOT serialized. The crash this could
theoretically produce (two near-simultaneous mutations interleaving so the last writer
restores an import for an already-deleted file) requires concurrent registry mutations
from a *single human operator* — through a `confirm()`-gated button, on a route that
`middleware.js` 404s in production, served by one local `npm run dev` process. That path
does not exist in real use, and the worst case is a local crash recoverable with
`git checkout content/editorial/index.js`, caught before merge by the Vercel-preview gate.
A lock was proposed and rejected across the adversarial-review rounds: scoping it
correctly would require
restructuring the save route's full read→write-slug-file→write-index critical section to
share one queue — real surgery on stable code to defend a zero-probability scenario, and a
partially-scoped lock is worse (complexity + false confidence) than an honest assumption.
**Trigger to revisit:** if `/admin` ever becomes multi-user or moves server-side (i.e.
more than one concurrent writer is possible), add a shared in-process promise-queue lock
wrapping the *entire* registry+slug-file critical section in **both** the save and delete
routes — not just the index write.

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

### Out of scope / note
- **Publishing the deletion** to preview/main already works through the existing
  Publish flow: `listDirtyAllowlisted()` reports deleted paths and `git add -- <path>`
  stages deletions. No publish-route change needed; just verify (below).
- No editor-header delete button (per decision).

## Files

- `app/lib/patchEditorialIndex.js` — add `unpatchEditorialIndex` (export); remove import
  line and `ENTRIES` identifier independently.
- `app/api/admin/delete-editorial/route.js` — new route (index write → slug unlink with
  index rollback on failure → best-effort image cleanup reporting `imagesRemoved`).
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
7. Unit test (if added): `node --test` (or the repo's test runner) over
   `unpatchEditorialIndex` — single-entry→empty, middle removal, first/last removal,
   idempotent-when-both-absent, substring-safety (`rick` vs `rickOwens`), and the
   **one-sided-corruption case**: import already gone but `ENTRIES` still references the
   identifier → the identifier is still stripped from `ENTRIES` (repairs a half-corrupt
   registry rather than no-opping).
8. Publish check (optional, end-to-end): after a delete, use the existing Publish flow
   and confirm the resulting PR diff shows the file deletions staged.
