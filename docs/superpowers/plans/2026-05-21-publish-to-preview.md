# Publish-to-Preview button for the admin tool

## Context

Today, the local-only admin tool (`/admin/editorial/[slug]`, `/admin/homepage-edit`) writes editorial content directly to files on disk (`content/editorial/<slug>.js`, `content/homepage-edit.json`). To get those edits to production on Vercel, the user has to leave the browser, switch to a terminal, and manually run `git add / commit / push`, then open a PR on GitHub, wait for Vercel's preview, click through, and merge — five commands and three tab-switches per iteration.

The user wants to compress that loop to **one click in the admin UI** while keeping the Vercel preview gate (no direct pushes to `main`, per existing CLAUDE.md invariant). After clicking Publish they get a clickable Vercel preview link within seconds; they still merge the PR themselves on GitHub when the preview looks right.

Confirmed scope (from user):
- Covers BOTH the editorial editor and the Today's Edit page.
- Each Publish session creates a fresh dated branch off `main`; one branch = one PR = one session.
- Modal shows Vercel inspector link instantly, then auto-swaps to the real `*.vercel.app` preview URL when it lands.

## Architecture overview

```
PublishButton (client)  →  POST /api/admin/publish     →  publishOrchestrator (pure)  →  publishGit (execFile wrappers)
                                                                                          ├─ git status / fetch / checkout / commit / push
                                                                                          └─ gh pr create / gh pr list / gh pr view
                       ←  modal polls GET /api/admin/publish/preview-url?pr=<num>   ←  gh api repos/.../pulls/<num>/comments → parse Vercel URL
```

The Save routes are unchanged. Publish is a separate orchestrator that runs *after* Save has written the files.

## Files

### New

- **`app/lib/publishOrchestrator.js`** — pure function `decideBranchAction({ currentBranch, defaultBranch, newSession, openPr, mergedPr, now })` returning `{ action: "create-and-switch" | "use-current" | "refuse", ... }`. The whole branch-decision state machine, isolated for unit testing.
- **`app/lib/publishGit.js`** — thin `execFile` wrappers: `runGit`, `runGh`, `getCurrentBranch`, `isGitRepo`, `listDirtyAllowlisted` (filtered to `content/` + `public/editorial/`), `branchOpenPr`, `branchMergedPr`. Plus the only pure helper worth testing here: `parseVercelPreviewFromComments(commentsJson)` that regex-extracts the first `https://*.vercel.app` URL from a Vercel-authored PR comment.
- **`app/api/admin/publish/route.js`** — `POST`. Gated by `assertDev()`. Orchestrates the full publish flow. Returns `{ ok, branch, commitSha, prUrl, prNumber, prAction, vercelInspectorUrl }`.
- **`app/api/admin/publish/preview-url/route.js`** — `GET ?pr=<num>`. Gated by `assertDev()`. Reads PR comments via `gh api`, returns `{ url }` or 202 `{ status: "pending" }`.
- **`app/admin/_components/PublishButton.js`** — client component. Props: `files: string[]`, `label: string`, `disabled?: boolean`. Owns the success/error modal, loading state, and the preview-URL polling loop.
- **`tests/lib/publishOrchestrator.test.js`** — one `it()` per row of the decision table; deterministic `now` injection.
- **`tests/lib/publishGit.test.js`** — `parseVercelPreviewFromComments` cases (real fixture, empty comments, non-Vercel author, Vercel comment without preview URL).

### Modified

- **`app/admin/editorial/[slug]/_components/Editor.js`** — render `<PublishButton files={["content/editorial/<slug>.js", "content/editorial/index.js"]} label={effectiveSlug} />` next to the existing Save button. Same header styling.
- **`app/admin/homepage-edit/_components/PicksEditor.js`** — render `<PublishButton files={["content/homepage-edit.json"]} label="todays-edit" />` next to its existing Save button.
- **`CLAUDE.md`** — one-line invariant addition under the "Admin tool is local-only" section: "Publish-to-preview route is also dev-only; refuses when `HEAD == main` unless `{ newSession: true }` is passed."

The Save routes (`app/api/admin/save/route.js`, `app/api/admin/save-homepage-edit/route.js`) are **not touched** — Publish is fully decoupled.

## API surface

### `POST /api/admin/publish`

Request:
```json
{ "files": ["content/editorial/rick-owens.js", "content/editorial/index.js"],
  "newSession": false,
  "label": "rick-owens" }
```

- `files` — informational only. The route always commits whatever is currently dirty under the allowlist (`content/`, `public/editorial/`) via `git status --porcelain`. This means images dropped into `public/editorial/<slug>/` by hand are picked up automatically.
- `newSession` — if `true`, force-create a new dated branch off `main` even if a `content/edit-*` branch is already checked out. The "Start new editing session" button in the error modal re-POSTs with this set.
- `label` — short string used in the commit message. Falls back to filenames if omitted.

Response 200:
```json
{ "ok": true,
  "branch": "content/edit-20260521-1632",
  "commitSha": "a1b2c3d",
  "prUrl": "https://github.com/anamelajr/depotstore/pull/46",
  "prNumber": 46,
  "prAction": "created",
  "vercelInspectorUrl": "https://vercel.com/.../inspector" }
```

Refuse codes (4xx) — all carry `{ error, suggestion?, mergedPrUrl? }`:
- `400 no editable changes detected` — `git status` under allowlist is empty (Publish clicked without Save).
- `400 file outside allowlist: <path>` — caller asked to publish a non-content path.
- `409 on main; pass { newSession: true } to start an editing branch` — first publish of a session. Modal shows "Start new editing session" button.
- `409 branch has merged PR; start a new session` — current branch's PR is already merged. Modal shows "Start new editing session" button + link to the merged PR.
- `409 on non-editing branch '<name>'` — unexpected branch like `feat/*`. User must switch manually.
- `500 git push failed`, `gh CLI not found`, etc. — surface stderr first line.
- `404` (from `assertDev()`) in production.

### `GET /api/admin/publish/preview-url?pr=<num>`

- 200 `{ url: "https://depotstore-git-...vercel.app" }` once Vercel has commented with the preview URL.
- 202 `{ status: "pending" }` if the comment hasn't landed yet.
- 500 on `gh` errors.

## Branch + commit logic (exact sequence)

All `execFile` calls use arg arrays (no shell), `cwd = process.cwd()`. Stop on first non-zero exit; surface stderr.

1. **Preflight:** `git rev-parse --git-dir` (confirm repo), `gh --version` (confirm CLI), `git rev-parse --abbrev-ref HEAD`, `git status --porcelain=v1 -z` filtered to allowlist. If empty → 400.
2. **Decide branch:** call `branchOpenPr(currentBranch)` and `branchMergedPr(currentBranch)` (only if branch matches `content/edit-*`). Run `decideBranchAction(...)`:

   | currentBranch | newSession | openPr | mergedPr | result |
   |---|---|---|---|---|
   | `main` | false | — | — | refuse `on-main` |
   | `main` | true | — | — | create-and-switch `content/edit-<ts>` |
   | `content/edit-*` | false | exists | — | use-current (push updates PR) |
   | `content/edit-*` | false | null | exists | refuse `merged-pr` |
   | `content/edit-*` | false | null | null | use-current (first commit; needs PR create after push) |
   | `content/edit-*` | true | — | — | create-and-switch (fresh dated branch off main) |
   | other | * | * | * | refuse `non-editing-branch` |

3. **If create-and-switch:**
   ```
   git fetch origin main
   git checkout main
   git pull --ff-only origin main
   git checkout -b content/edit-<yyyymmdd-hhmm>
   ```
   If `git pull --ff-only` fails (local main has commits not on remote), refuse — don't paper over a dirty local main.

4. **Stage and commit:**
   ```
   git add -- <each allowlisted dirty path>
   git commit -m "content: <auto-generated label summary>"
   ```
   Commit message generator groups dirty paths by category: `edit <slug>` for editorial entries, `+ registry` for `index.js`, `Today's Edit` for the homepage JSON, `+ images` per slug for new files under `public/editorial/<slug>/`. Joined with `, `, prefixed `content:`, truncated to 70 chars with ellipsis.

5. **Push:**
   ```
   git push --set-upstream origin <branchName>
   ```
   Falls back to plain `git push origin <branchName>` if upstream already exists (re-publishing on same branch). Non-fast-forward → 500 with clear message.

6. **PR:**
   - If `branchOpenPr(branchName)` already returned a PR → reuse it, `prAction: "updated"`.
   - Else `gh pr create --base main --head <branchName> --title "Content: <label>" --body "Local admin edit. Verify on the Vercel preview, then merge."`, parse URL/number from stdout, `prAction: "created"`.

7. **Best-effort inspector URL (3s timeout):** `gh pr view <prNumber> --json statusCheckRollup`. If a Vercel check is already registered, return its `targetUrl` as `vercelInspectorUrl`. Otherwise `null` — modal polling will resolve the preview URL later.

## UI behavior

**Button:** matches existing Save styling (`background: "#d6d2c4"`, `color: "#18181a"`, `borderRadius: 4`, `padding: "6px 14px"`, `fontSize: 12`). Label `Publish →` when idle, `Publishing…` when in flight (disabled, same width — no layout shift).

**Success modal:**
- Title: "Published to preview"
- Body, two rows:
  - **Pull request** → `<prUrl>` (clickable) + Copy button
  - **Preview deploy** → state-dependent:
    - On open: "Vercel is building… [open inspector](vercelInspectorUrl)" if inspector URL available, else "Waiting for Vercel…"
    - After polling resolves: actual `*.vercel.app` URL (clickable) + Copy button
- Polling: `setInterval(5_000)` calls `GET /api/admin/publish/preview-url?pr=<num>`, max ~18 attempts (90s). Stops on 200 or modal close.
- Dismiss: `×` top-right + `Done` bottom-right.

**Error modal:**
- Title: "Publish failed"
- Body: error message in mono font.
- If `suggestion: "newSession"` returned: primary button "Start new editing session" that re-POSTs with `{ newSession: true }`.
- Dismiss button.

**Modal styling:** inline-styled `<div>` overlay, `position: fixed`, no new dependencies. Matches the inline-CSS convention used throughout `/admin/*`.

## Test plan

### Unit (vitest, additive)

- **`tests/lib/publishOrchestrator.test.js`** — one case per row of the decision table. Inject `now: new Date("2026-05-21T16:32:00Z")` for deterministic branch names. Assert `action`, `newBranchName`, refuse `code`.
- **`tests/lib/publishGit.test.js`** — `parseVercelPreviewFromComments`:
  - Real-world fixture (e.g. comments JSON from PR #44) → extracts the deployed preview URL.
  - Empty comments → `null`.
  - Vercel author but no `*.vercel.app` URL → `null`.
  - Non-Vercel author with a `*.vercel.app` URL in body → `null`.

Both test files belong under `tests/lib/` (the editorial-admin test directory), which the merged `vitest.config.js` already includes.

### Manual integration (end-to-end on user's main checkout)

1. `git checkout main && git pull && npm install && npm run dev`.
2. Open `http://localhost:3000/admin/editorial/rick-owens`. Change a word. Click Save. Click Publish.
3. Modal: refuse with "Start new editing session" (we're on main). Click it.
4. Modal opens with PR URL + inspector link within ~5s. Open PR URL — diff matches the change.
5. Wait ~60s. Modal swaps inspector for `*.vercel.app` URL. Click — page loads with the edit visible.
6. Click Publish again without changing anything → modal: "no editable changes detected." Dismiss.
7. Change a different word. Save → Publish. Modal: same PR URL, `prAction: "updated"`. Preview rebuilds.
8. Open `/admin/homepage-edit`. Add a pick. Save → Publish. Same PR is updated with combined commits.
9. Merge that PR on GitHub. Return to admin tool. Make another edit. Click Publish.
10. Modal refuses with "branch has merged PR" + "Start new editing session" button. Click it. Fresh branch, fresh PR.
11. Build for production: `NODE_ENV=production npm run build && npm start`. `GET /api/admin/publish` → 404. `/admin/editorial` → 404. Dev gate confirmed.

## Verification (end-to-end)

1. **Unit tests pass:** `npm test` includes the two new files; all decision-table cases and Vercel-comment-parse cases green.
2. **Production build still succeeds:** `npm run build` exits 0 with no new errors. New routes render in the route table.
3. **Dev gate intact:** running steps 11 above shows 404 for both new routes in production mode.
4. **Manual flow (steps 1–10 above) walks end-to-end without errors:** PR opens on first Publish, updates on subsequent Publishes within the same session, preview URL resolves in the modal, "new session" affordance kicks in after merge.

## Out of scope (v2 or later)

- Auth on the publish route beyond the existing dev gate (already 404 in prod and behind localhost).
- Multi-machine concurrency (edits from two laptops on the same branch).
- Undo / revert from the UI (use GitHub's PR revert).
- Custom commit messages — auto-generated only.
- Squash/rebase of session commits — handled at merge time on GitHub.
- Polling Vercel beyond ~90s — user clicks through to PR if Vercel is unusually slow.
- A permanent "New editing session" button in the admin header (currently only in the error modal).
- Image upload UI — images stay placed manually under `public/editorial/<slug>/`; the publish route picks them up via the dirty-file scan.
- Replacing `alert()` calls in the Save handlers — separate cleanup.

## Sequencing for implementation

1. `app/lib/publishOrchestrator.js` + its test (pure, no risk).
2. `app/lib/publishGit.js` + the comment-parse test.
3. `app/api/admin/publish/route.js` — wires 1 + 2. Smoke-test with `curl` against the dev server.
4. `app/api/admin/publish/preview-url/route.js` — small follow-up after step 3 works.
5. `app/admin/_components/PublishButton.js` — modal + polling UI.
6. Mount in `Editor.js` + `PicksEditor.js`.
7. CLAUDE.md invariant line.

Steps 1–4 are server-side and can be exercised via `curl` before any UI lands.
