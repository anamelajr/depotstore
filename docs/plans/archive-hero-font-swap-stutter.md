# Archive hero font-swap stutter: demonstrate, then fix

## Context

PR #127 (`claude/featured-archive-design-3deec9`, merged today) redesigned the
featured-archive hero (`/archives/hedi-slimane` etc.) as an ink band. The user
now sees a **visual stutter on opening the page — for a split second the text
renders in one font, then the sizes and letterforms visibly transform**. Most
noticeable on mobile, probably present on desktop too. They want to *see and
understand* what's happening, and (per follow-up) have it fixed in the same
pass.

## Root cause (already established — this is not a hypothesis to hunt for)

The site's own faces (Satoshi, General Sans) are **self-hosted locals loaded in
the root layout** ([app/layout.js:19-35](app/layout.js)) — present from the
first frame, never swap. PR #127 introduced a third face **only on the archive
route** ([app/archives/[slug]/page.js:20-27](app/archives/[slug]/page.js)):

```js
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
});
```

`display: "swap"` = paint text immediately in the generated fallback
(`__Hanken_Grotesk_Fallback_*`, a size-adjusted Arial), then **swap to Hanken
Grotesk the instant its woff2 finishes downloading**. The hero's tenure line
and description use `hanken.className`, so those blocks visibly transform
mid-view. The h1 and eyebrow use `HERO_MONO` (system `ui-monospace`) and don't
swap. Mobile is worse because the font download is slower relative to first
paint, and the face is route-local so client navigation from the home band
fetches it at open time.

## Plan

### Step 0 — Worktree setup

The worktree has no `node_modules` and no `.env.local` (known trap — see
memory `worktree-env-local-missing`):

- `cp /Users/anamelajr/depotstore/.env.local .env.local`
- `npm ci`

### Step 1 — Reproduce and capture the stutter (before frames)

1. `preview_start` the `Next.js dev` server (launch.json exists), open
   `/archives/hedi-slimane`.
2. `resize_window` to mobile preset (375×812).
3. Capture the two frames of the stutter deterministically:
   - **Frame A ("what paints first")**: via `javascript_tool`, read the
     computed `font-family` on the description `<p>` and re-apply it with the
     **first (scoped) family stripped** — next/font emits a scoped name like
     `'__Hanken_Grotesk_<hash>'`, NOT the literal `'Hanken Grotesk'`, so drop
     the leading entry of the list whatever it is, leaving the generated
     `__Hanken_Grotesk_Fallback_*`. Screenshot.
   - **Frame B ("a split second later")**: reload untouched (font cached →
     final state). Screenshot.
4. Repeat both at desktop width for a second pair.
5. **Required, once:** observe the real swap on a genuinely cold load — a
   fresh Playwright browser context (fresh profile ⇒ empty font cache), assert
   the Hanken woff2s actually transfer over the network, and watch
   `document.fonts` / take rapid screenshots around first paint. Browser font
   cache is independent of the dev server, so restarts/cache-busted reloads do
   NOT make a load cold.

### Step 2 — Fix

In [app/archives/[slug]/page.js](app/archives/[slug]/page.js), change the one
option: `display: "swap"` → `display: "optional"`.

- `optional` gives the font ~100ms: if Hanken isn't ready at paint (cold
  mobile load), the page keeps the metric-matched fallback for that view — **no
  mid-view transformation, ever**. Warm loads render true Hanken from frame one.
- **The fallback is a supported production state, not a transient.** With
  `optional` the browser may skip or abort the download entirely on slow /
  data-saver connections, so some users can keep the fallback across visits —
  "cached after first visit" is likely but not guaranteed. Frame A in the
  compare artifact IS this state; the user signing off on the artifact is the
  design acceptance of the fallback's appearance and wrapping. If they reject
  it, the escalation path is the root-layout self-hosted alternative noted
  under out-of-scope.
- `adjustFontFallback` stays default-on, so the fallback's metrics are already
  size-adjusted to Hanken — close, static, same line-wrapping by construction
  of the size-adjust.
- No other call sites: `Hanken_Grotesk` appears only in this file (verify with
  a grep before editing).

Commit on the current branch `claude/archive-visual-stutter-mobile-411847`
(never push to main; merge only on explicit instruction).

### Step 3 — Verify + deliver the comparison artifact

1. Re-capture the hero after the fix (cold-load simulation + warm load) to
   confirm no visible transformation.
2. Use the **`visual-compare` skill** to build a drag-to-compare slider page:
   - Pair 1 (mobile): Frame A "first paint" vs Frame B "after the swap" — the
     stutter the user saw, frozen so it can actually be inspected.
   - Pair 2 (desktop): same, confirming it exists there too.
   - A short section showing the post-fix state and stating what changed.
3. Publish as an Artifact and hand over the link.
4. Run the test suite touchpoint relevant here (none expected — the change is
   one font-loader option; `npm test` for safety since messages/i18n tests
   exist).

## Files touched

- `app/archives/[slug]/page.js` — one-word fix (`swap` → `optional`).
- Scratchpad only for screenshots and the compare page.

## Verification

- Browser-pane screenshots pre/post fix at mobile and desktop widths.
- **Verify against the production build, on the reported path** — dev and prod
  differ in font preload emission/timing. `npm run build` + the `Next.js prod`
  launch config, then in a fresh Playwright context (empty font cache — server
  restarts and cache-busted reloads are NOT cold) at mobile viewport: navigate
  by clicking the real archive link from `/` (the home band), plus one direct
  cold open. Confirm the woff2s transfer on the network and the hero does not
  visibly change after first paint in either case.
- **Deterministic slow-font case (the one that actually regressed):** on
  localhost the woff2 nearly always beats the ~100ms `optional` window, so an
  unthrottled check proves nothing. In Playwright, intercept the Hanken woff2
  request and hold it 1–2s (past the block period); assert the fallback has
  painted, then release the request and assert across subsequent frames that
  the rendered font and hero geometry do NOT change. Fresh contexts for the
  direct-load and client-navigation variants.
- Real-device (iOS Safari) confirmation is the user's spot check on the
  preview deploy, noted in the handoff.
- `npm test` passes.

## Explicitly out of scope

- Any change to the hero's design/geometry (that's the approved canvas).
- Self-hosting Hanken as a local font in the root layout — heavier alternative,
  only worth it if the user dislikes `optional`'s first-visit fallback.
