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
     primary `'Hanken Grotesk'` entry removed, leaving only the generated
     fallback — this is pixel-identical to the pre-swap paint. Screenshot.
   - **Frame B ("a split second later")**: reload untouched (font cached →
     final state). Screenshot.
4. Repeat both at desktop width for a second pair.
5. Optionally confirm the live swap really occurs on a cold load (DevTools-less
   check: `document.fonts` status + a throttled reload) — evidence, not needed
   for the fix.

### Step 2 — Fix

In [app/archives/[slug]/page.js](app/archives/[slug]/page.js), change the one
option: `display: "swap"` → `display: "optional"`.

- `optional` gives the font ~100ms: if Hanken isn't ready at paint (cold
  mobile load), the page keeps the metric-matched fallback for that view — **no
  mid-view transformation, ever**. Warm/cached loads (every visit after the
  first) render true Hanken from frame one.
- `adjustFontFallback` stays default-on, so the fallback's metrics are already
  size-adjusted to Hanken — the "degraded" first-visit state is the same Frame
  A the user will have just seen, which is close, static, and unobjectionable.
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
- Cold-load check: with the Hanken files freshly fetched (dev server restart or
  cache-busted reload), the hero must not visibly change after first paint.
- `npm test` passes.

## Explicitly out of scope

- Any change to the hero's design/geometry (that's the approved canvas).
- Self-hosting Hanken as a local font in the root layout — heavier alternative,
  only worth it if the user dislikes `optional`'s first-visit fallback.
