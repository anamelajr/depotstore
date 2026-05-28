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
- **Order (chosen so the site never imports a missing file):**
  1. Read `index.js`, compute `unpatchEditorialIndex(source, slug)`, write it
     **atomically** via tmp + `fs.rename` (the `save-homepage-edit` pattern:
     `${file}.tmp.${pid}.${Date.now()}`, `unlink` tmp on failure). If this fails →
     return 500, nothing else touched.
  2. `fs.unlink(content/editorial/<slug>.js)`. If it fails (e.g. ENOENT) treat as
     non-fatal — the registry entry is already gone, which is what matters for the site.
  3. `fs.rm(public/editorial/<slug>/, { recursive: true, force: true })` — best-effort,
     non-fatal (matches save route's "image dir failure is non-fatal" stance).
- Return `{ ok: true, slug, indexUpdated, slugFileRemoved, imagesRemoved }`; report which
  steps completed so a partial failure is visible. 400 on bad slug, 500 on index-write
  failure.

### 3. List page wiring

`app/admin/editorial/page.js` is a **server component**, so the delete button must be a
small client component.

- **New** `app/admin/editorial/_components/DeleteEntryButton.js` (`"use client"`):
  - Props: `slug`, `title`.
  - Renders a compact button using existing tokens — reddish `#c9806b` (the same delete
    accent used in `CuratedProductsPanel.js`), on `#2a2a2c`/transparent.
  - onClick: `confirm(`Delete "${title}"? Removes the entry, its file, and its images. This cannot be undone.`)`
    → `POST /api/admin/delete-editorial` with `{ slug }` → on `ok`, `router.refresh()`
    (from `next/navigation`) to re-render the list; on error, `alert(data.error)`.
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

- `app/lib/patchEditorialIndex.js` — add `unpatchEditorialIndex` (export).
- `app/api/admin/delete-editorial/route.js` — new route.
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
5. Unit test (if added): `node --test` (or the repo's test runner) over
   `unpatchEditorialIndex` — single-entry→empty, middle removal, first/last removal,
   idempotent-when-absent, substring-safety (`rick` vs `rickOwens`).
6. Publish check (optional, end-to-end): after a delete, use the existing Publish flow
   and confirm the resulting PR diff shows the file deletions staged.
