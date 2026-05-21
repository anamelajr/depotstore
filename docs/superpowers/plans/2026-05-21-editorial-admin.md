# Editorial Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Suggested permanent location:** Once plan mode exits, copy this to `docs/superpowers/plans/2026-05-21-editorial-admin.md`. Plan mode constrained the initial write path.

**Goal:** A local-only browser admin tool for visually authoring editorial entries (with GPT-5.5 drafting) and hand-curating the homepage "Today's Edit" — built on the existing content-module format and shared with the existing CLI drafting script.

**Architecture:** New `/admin/*` routes (Next.js App Router) gated by `NODE_ENV` middleware. The editor renders a form on the left and the real `Block.js` components on the right for live preview. Saving writes a `content/editorial/<slug>.js` content module and idempotently patches `content/editorial/index.js`. Today's Edit is curated by writing `content/homepage-edit.json` (a plain JSON array of `{ storeDomain, handle }` objects); `app/page.js` reads it dynamically inside try/catch with a fallback to the date-seeded rotation when the file is missing, empty, or malformed. GPT integration: the prompt-building + OpenAI-calling logic in `scripts/draftEditorial.mjs` is extracted to `app/lib/draftEditorialPrompt.js`, shared by the CLI and a new `/api/admin/draft` route that injects a structural plan (derived from the editor's current image-block placements) so generated text doesn't dangle into image breaks. The draft route accepts only HTTP URLs and pasted text — never filesystem paths — to prevent a hostile localhost requestor from exfiltrating `.env.local` through the OpenAI prompt.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind v4, Supabase (Frankfurt), OpenAI (`gpt-5.5`), Node ESM. Adding **vitest** for unit testing pure helpers.

---

## Revisions

**2026-05-21 (post-Codex adversarial review):**
- **API trust boundary tightened.** The shared `loadSource` helper no longer reads filesystem paths by default. The CLI must explicitly opt in via `{ allowFiles: true }`. `/api/admin/draft` only accepts HTTP/HTTPS URLs and pasted text — closes a DNS-rebinding / hostile-local-process vector that would have let request-controlled paths read `.env.local` and exfiltrate the contents through the OpenAI prompt.
- **Homepage picks moved from `.js` to `.json`.** A static `import` of a `.js` content module would crash module evaluation on syntax error, defeating the documented "fall back to date-seeded rotation" invariant. Switching to JSON + dynamic `fs.readFile` + `JSON.parse` inside a try/catch makes the fallback actually catchable. Writes are atomic (temp file + `fs.rename`) to prevent truncation.
- **Save adds a rollback step.** If the slug file write succeeds but the `index.js` patch fails *and* the slug file did not previously exist, the slug file is unlinked. Avoids orphaned entries on the rare partial-write failure.
- **`mergeGeneratedBlocks` validates block counts.** If GPT returns fewer text-shaped blocks than the structure plan asked for, the merge falls back to "append all generated blocks before the user's image blocks" and surfaces a UI warning instead of silently shuffling content.
- **Engineer must confirm `gpt-5.5` is a current model** before relying on it (Task 4 adds an explicit verification step).

**2026-05-21 (second-pass clarification, post second Codex review):**
- **Task 13 rewritten** to remove contradictory language about RSC boundaries. Previous wording said "client components can render server components only via composition, NOT direct calls" right next to instructions that directly imported `Block` and `EditorialHero` from a client component — which read as a contradiction. The reality is narrower: that rule applies only to *true* server components that use server-only APIs (`cookies()`, `headers()`, `import "server-only"`, async data fetching in the component body). `Block.js` and `EditorialHero.js` are **shared components** — files without `"use client"` *and* without server-only APIs — which Next.js bundles for whichever side imports them. The new Task 13 makes this explicit, adds a `grep` gate in Step 1 to confirm the shared-component assumption still holds at implementation time, and keeps the fallback (Client*.js clones) documented for the day either file picks up a server-only dependency.

---

## Existing code touched/reused (read these before starting)

- `scripts/draftEditorial.mjs` — CLI; we extract `buildPrompt`, `callOpenAI`, `extractJson`, `serialize`, `buildModule` into a shared library
- `content/editorial/index.js` — registry; auto-patched by the save route
- `content/editorial/rick-owens.js` — canonical shape of an entry
- `app/editorial/[slug]/page.js` — read path that hydrates entries
- `app/editorial/_components/Block.js` — block renderer, reused in editor preview
- `app/editorial/_lib/fetchEditorialProducts.js` — chunked `.in()` + `orderIndex` pattern; new homepage hydration mirrors this
- `app/lib/chunk.js` — `chunkArray(arr, 100)` for PostgREST IN-query batching
- `app/lib/stores.js` — `STORES`, `FALLBACK_STORES` for the product search and picks display
- `app/page.js:84-116` — current "Today's Edit" date-seeded rotation; replaced (with fallback)

## Invariants (from CLAUDE.md and brainstorming)

1. All `/admin/*` and `/api/admin/*` return 404 when `NODE_ENV === "production"`.
2. Save writes `content/editorial/<slug>.js` AND patches `content/editorial/index.js` to add the import + push to `ENTRIES`. Idempotent — re-saving an existing entry only rewrites the slug file.
3. Generate replaces text content only. Image blocks, hero images, and `curatedProducts` are preserved.
4. Generate prompt includes a structural plan derived from the current block list. Every text block must end on a complete sentence + complete idea.
5. `content/homepage-edit.json` is a JSON file (not a JS module) containing `[{ "storeDomain": "...", "handle": "..." }, ...]`. Hydration reuses the chunked `.in()` + `orderIndex` Map pattern. JSON parse errors are catchable, unlike module-evaluation errors from a malformed `.js` content module.
6. Homepage fallback: `app/page.js` loads `content/homepage-edit.json` with `fs.readFile` + `JSON.parse` inside a try/catch. If the read or parse fails OR the array is empty, the homepage falls back to the date-seeded rotation. The feature must never produce an empty (or crashing) homepage section. **Static `import` of the picks file is forbidden** — it would defeat the catchable fallback.
7. The admin tool never writes to `products.brand/title/category` in Supabase (editorial protection from CLAUDE.md).
8. Image filename autocomplete reads `public/editorial/<slug>/` only via a server route — never expose arbitrary filesystem reads.
9. `/api/admin/draft` does NOT accept filesystem paths in `sourceValues` / `styleValues`. Only HTTP/HTTPS URLs and pasted text strings. The shared `loadSource` helper defaults to `allowFiles: false`; only the CLI (`scripts/draftEditorial.mjs`) opts in to filesystem reads, since it runs from your shell with your trust.
10. Save is rollback-safe for new entries: if the `<slug>.js` write succeeds but the `index.js` patch fails AND the slug file did not previously exist on disk, the route unlinks the slug file before returning the error. Re-saving an existing entry never rolls back the slug file (the prior content is already gone).
11. `content/homepage-edit.json` writes are atomic: serialize → write to `homepage-edit.json.tmp` → `fs.rename` to the final path. Prevents truncated files crashing the homepage.

## File map

**Create:**

```
app/admin/layout.js
app/admin/page.js
app/admin/editorial/page.js
app/admin/editorial/[slug]/page.js
app/admin/editorial/[slug]/_components/Editor.js
app/admin/editorial/[slug]/_components/HeroPanel.js
app/admin/editorial/[slug]/_components/BlockCard.js
app/admin/editorial/[slug]/_components/AddBlockMenu.js
app/admin/editorial/[slug]/_components/CuratedProductsPanel.js
app/admin/editorial/[slug]/_components/PreviewPane.js
app/admin/editorial/[slug]/_components/GenerateModal.js
app/admin/editorial/[slug]/_components/ImageFilenameInput.js
app/admin/homepage-edit/page.js
app/admin/homepage-edit/_components/PicksList.js
app/admin/homepage-edit/_components/ProductSearch.js
app/api/admin/_gate.js
app/api/admin/save/route.js
app/api/admin/save-homepage-edit/route.js
app/api/admin/draft/route.js
app/api/admin/list-files/route.js
app/api/admin/list-entries/route.js
app/api/admin/search-products/route.js
app/lib/draftEditorialPrompt.js
app/lib/serializeEditorialModule.js
app/lib/patchEditorialIndex.js
app/lib/structurePlan.js
app/editorial/_lib/fetchHomepagePicks.js
app/lib/loadHomepagePicks.js
content/homepage-edit.json
middleware.js
tests/lib/serializeEditorialModule.test.js
tests/lib/patchEditorialIndex.test.js
tests/lib/structurePlan.test.js
tests/lib/draftEditorialPrompt.test.js
vitest.config.js
```

**Modify:**

```
scripts/draftEditorial.mjs    — import shared prompt module
app/page.js                   — read homepage-edit, fallback to rotation
package.json                  — add vitest + test script
.gitignore                    — add .superpowers/, drafts/
CLAUDE.md                     — admin tool entry in "Sharp edges"
```

---

## Phase 0: Setup

### Task 1: Install vitest and configure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`

- [ ] **Step 1: Install vitest**

Run:
```bash
npm install --save-dev vitest
```

Expected: vitest added under `devDependencies`. No other deps touched.

- [ ] **Step 2: Create vitest config**

Write `vitest.config.js`:
```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    environment: "node",
  },
});
```

- [ ] **Step 3: Add test script to package.json**

Modify the `"scripts"` block in `package.json` to add `"test": "vitest run"` and `"test:watch": "vitest"`. Final scripts block:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 4: Smoke-run vitest**

Run:
```bash
npm test
```

Expected: `No test files found, exiting with code 0.` (no error). Confirms vitest is installed and wired.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.js
git commit -m "chore: add vitest for admin tool unit tests"
```

---

### Task 2: Update .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add brainstorm + drafts directories**

Append the following lines to `.gitignore`:
```
# brainstorming session artifacts (visual companion)
.superpowers/

# raw GPT outputs from the CLI drafting script on parse failure
drafts/
```

- [ ] **Step 2: Verify**

Run:
```bash
git check-ignore .superpowers/ drafts/
```

Expected: both paths printed, confirming they are ignored.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore .superpowers and drafts directories"
```

---

## Phase 1: Extract drafting prompt into shared module

### Task 3: Create `app/lib/draftEditorialPrompt.js`

**Files:**
- Create: `app/lib/draftEditorialPrompt.js`
- Test: `tests/lib/draftEditorialPrompt.test.js`

Moves `buildPrompt`, `loadSource`, `loadAll`, `callOpenAI`, `extractJson` from `scripts/draftEditorial.mjs` into a single ESM module. New optional parameter: `structurePlan` (string, default empty) — when present, appended to the prompt so the model is told exactly how many blocks to produce and which positions are image breaks.

- [ ] **Step 1: Write the failing test**

Write `tests/lib/draftEditorialPrompt.test.js`:
```js
import { describe, it, expect } from "vitest";
import { buildPrompt } from "../../app/lib/draftEditorialPrompt.js";

describe("buildPrompt", () => {
  it("includes the title and layout", () => {
    const out = buildPrompt({
      title: "Rick Owens",
      brand: "Rick Owens",
      layout: "image-right",
      sources: [],
      styles: [],
      notes: [],
    });
    expect(out).toContain("Rick Owens");
    expect(out).toContain('"image-right"');
  });

  it("appends a structure plan when provided", () => {
    const out = buildPrompt({
      title: "X",
      brand: "X",
      layout: "image-right",
      sources: [],
      styles: [],
      notes: [],
      structurePlan: "STRUCTURE: 5 text blocks, image break after block 2.",
    });
    expect(out).toContain("STRUCTURE: 5 text blocks, image break after block 2.");
  });

  it("renders research and note tags from input arrays", () => {
    const out = buildPrompt({
      title: "X",
      brand: "X",
      layout: "image-right",
      sources: [{ value: "https://x.com/a", text: "hello world" }],
      styles: [],
      notes: ["keep it short"],
    });
    expect(out).toMatch(/<research source="https:\/\/x\.com\/a"/);
    expect(out).toContain("hello world");
    expect(out).toMatch(/<note index="1">keep it short<\/note>/);
  });
});

describe("loadSource", () => {
  it("treats non-HTTP values as pasted text by default (allowFiles: false)", async () => {
    const { loadSource } = await import("../../app/lib/draftEditorialPrompt.js");
    const r = await loadSource("/etc/hosts");
    // Must NOT read the file. The value is treated as inline text.
    expect(r.error).toBe(null);
    expect(r.text).toBe("/etc/hosts");
    expect(r.value).toBe("pasted");
  });

  it("reads files when allowFiles: true (CLI use)", async () => {
    const { loadSource } = await import("../../app/lib/draftEditorialPrompt.js");
    // package.json definitely exists at repo root; use it as a harmless probe.
    const r = await loadSource("package.json", { allowFiles: true });
    expect(r.error).toBe(null);
    expect(r.text).toMatch(/"name":\s*"archiveapp"/);
  });
});

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm test -- draftEditorialPrompt
```

Expected: FAIL — `Cannot find module '../../app/lib/draftEditorialPrompt.js'`.

- [ ] **Step 3: Create the module**

Write `app/lib/draftEditorialPrompt.js`:
```js
// Shared drafting prompt + OpenAI call. Used by both
// scripts/draftEditorial.mjs (CLI) and app/api/admin/draft/route.js.
import { promises as fs } from "node:fs";

export const VALID_LAYOUTS = [
  "image-right",
  "image-left",
  "image-below",
  "image-pair-top",
];

const MAX_SOURCE_CHARS = 6000;
const FETCH_TIMEOUT_MS = 15000;

// Treat any non-HTTP value as either a filesystem path (CLI only) or
// pasted text. The API route MUST NOT pass allowFiles: true — request-
// controlled paths would let a hostile local process exfiltrate .env.local
// via the OpenAI prompt.
export async function loadSource(value, { allowFiles = false } = {}) {
  if (/^https?:\/\//i.test(value)) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(value, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        },
        signal: controller.signal,
      });
      if (!res.ok) return { value, error: `HTTP ${res.status}`, text: null };
      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { value, error: null, text: text.slice(0, MAX_SOURCE_CHARS) };
    } catch (err) {
      return { value, error: err.message || String(err), text: null };
    } finally {
      clearTimeout(t);
    }
  }

  if (!allowFiles) {
    // The API route reaches here. Treat the value as inline text rather
    // than a filesystem path. The label is shown to the model as the
    // source identifier ("pasted-1", "pasted-2", …) since there's no URL.
    return {
      value: "pasted",
      error: null,
      text: String(value).slice(0, MAX_SOURCE_CHARS),
    };
  }

  // CLI only: load from disk.
  try {
    const text = await fs.readFile(value, "utf8");
    return { value, error: null, text: text.slice(0, MAX_SOURCE_CHARS) };
  } catch (err) {
    return { value, error: err.message || String(err), text: null };
  }
}

export async function loadAll(values, { allowFiles = false } = {}) {
  const results = [];
  for (const v of values) {
    const r = await loadSource(v, { allowFiles });
    if (r.error) {
      console.warn(`[draftEditorial] skipping ${v}: ${r.error}`);
    } else {
      results.push(r);
    }
  }
  return results;
}

export function buildPrompt({
  title,
  brand,
  layout,
  sources,
  styles,
  notes,
  structurePlan = "",
}) {
  const research = sources
    .map(
      (s, i) =>
        `<research source="${s.value}" index="${i + 1}">\n${s.text}\n</research>`
    )
    .join("\n\n");
  const style = styles
    .map(
      (s, i) =>
        `<style-reference source="${s.value}" index="${i + 1}">\n${s.text}\n</style-reference>`
    )
    .join("\n\n");
  const noteBlock = notes.length
    ? notes.map((n, i) => `<note index="${i + 1}">${n}</note>`).join("\n")
    : "";

  const structureSection = structurePlan
    ? `\n\nSTRUCTURE (you must produce exactly this block sequence):\n${structurePlan}\n\nEvery text block must end on a complete sentence AND a complete idea — no clauses that depend on the next block, because there may be an image break before the next text block.\n`
    : "";

  return `You are drafting an editorial profile for Dépôt, a curated Paris archive-fashion platform. Dépôt's voice is short, opinionated, image-led, confident — closer to a fashion zine than to SEO copy.

Write a profile of ${title}${brand && brand !== title ? ` (brand: ${brand})` : ""}. The hero layout will be "${layout}".

Output STRICT JSON only — no prose before or after, no markdown fences. The JSON object must match this shape exactly:

{
  "hero": {
    "eyebrow": "Editorial",
    "title": "<short, can match input>",
    "subtitle": "<one or two short lines, can use \\n for a line break>",
    "byline": "By DÉPÔT",
    "imageAlt": ["<short alt for hero image>"]
  },
  "blocks": [
    { "type": "text", "width": "narrow", "dropcap": true, "body": "<3-6 sentences, opens the piece>" },
    { "type": "section-heading", "text": "<3-5 word eyebrow>" },
    { "type": "text", "width": "narrow", "body": "<2-4 sentences>" },
    { "type": "image", "src": "", "width": "full-bleed", "alt": "<describe what should go here>" },
    { "type": "pullquote", "text": "<a short, opinionated quote>", "attribution": "<who said it, year if known, or 'Attributed'>" },
    { "type": "text", "width": "narrow", "body": "<2-4 sentences>" }
  ]
}

Rules:
- Text blocks: 2-6 sentences each. No filler. Strong, declarative voice. No "this designer", "this brand" — name them.
- Section-headings: 3-5 words, like a magazine eyebrow ("Architecture as attitude", "The Antwerp instinct").
- Pull quote: short (one or two sentences). If you don't have a real attributed quote from the research, you may write one in the designer's voice but set attribution to "Attributed".
- Image blocks: leave "src" empty (the author drops images in later). Use "alt" to describe what photo should fit there.
- Vary block order — don't always go text/image/text/image. Two text blocks in a row are fine. Two images in a row become a pair (use "image-pair" with two images).
- Treat <research> tags as factual sources to draw from. Treat <style-reference> tags as voice/tone you should echo. Treat <note> tags as personal direction from the editor that you must honor.
- Total blocks: between 8 and 14.${structureSection}

${research || "(no research provided)"}

${style || "(no style references provided)"}

${noteBlock || "(no personal notes provided)"}`;
}

export async function callOpenAI(prompt, { apiKey = process.env.OPENAI_API_KEY } = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5.5",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");
  return content;
}

export function extractJson(content) {
  const cleaned = content
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
  return JSON.parse(cleaned);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npm test -- draftEditorialPrompt
```

Expected: 5 tests pass (3 buildPrompt + 2 loadSource).

- [ ] **Step 5: Commit**

```bash
git add app/lib/draftEditorialPrompt.js tests/lib/draftEditorialPrompt.test.js
git commit -m "feat: extract draft prompt + OpenAI call into shared module"
```

---

### Task 4: Update CLI to use the shared module + verify model

**Files:**
- Modify: `scripts/draftEditorial.mjs`

- [ ] **Step 1: Verify `gpt-5.5` is a current OpenAI model**

The existing CLI hard-codes `model: "gpt-5.5"`. Before relying on this in production, confirm the model identifier is valid against your account:

```bash
curl -s https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  | grep -o '"id": *"[^"]*"' | sort -u | grep -E "(gpt-5|gpt-4)" | head -20
```

Expected: the list includes an entry like `"id": "gpt-5.5"` (or whichever variant the codebase uses). If `gpt-5.5` is not in the response, update the constant in `app/lib/draftEditorialPrompt.js` (the `callOpenAI` function) to the closest current model before proceeding. Do NOT silently swap the model — if it changes, note it in the commit message.

- [ ] **Step 2: Replace inline functions with imports**

In `scripts/draftEditorial.mjs`:

Delete lines 85–216 (the `MAX_SOURCE_CHARS` constant through the `extractJson` function definition).

Delete the `VALID_LAYOUTS` const on line 12.

At the top of the file (after the existing imports), add:
```js
import {
  VALID_LAYOUTS,
  loadAll,
  buildPrompt,
  callOpenAI,
  extractJson,
} from "../app/lib/draftEditorialPrompt.js";
```

- [ ] **Step 3: CLI must opt into file reads**

Find the two `loadAll(...)` calls inside `main()`:
```js
  const sources = await loadAll(args.sources);
  const styles = await loadAll(args.styles);
```

Replace with:
```js
  const sources = await loadAll(args.sources, { allowFiles: true });
  const styles = await loadAll(args.styles, { allowFiles: true });
```

Without this, the CLI silently treats `--source ./notes.txt` as the literal text "./notes.txt" rather than the file contents.

- [ ] **Step 4: Run the CLI to confirm regression-free behavior**

Run a smoke test with no source material (won't actually generate, but should validate args and reach the OpenAI call):
```bash
node scripts/draftEditorial.mjs --slug smoke-test --title "Smoke Test" --note "test parity"
```

Expected: either the CLI completes and writes `content/editorial/smoke-test.js`, or it errors with a real OpenAI error (rate limit, etc.). It must NOT error with "function not defined" or import errors.

Then run a second test that actually exercises the file-load path:
```bash
echo "test source content from a file" > /tmp/draftsrc.txt
node scripts/draftEditorial.mjs --slug smoke-test --title "Smoke Test" --note "use the file" --source /tmp/draftsrc.txt --force 2>&1 | head -30
```

Expected: log line `[draftEditorial] sources=1 …` (NOT `sources=0`, which would mean the file path was rejected as text).

- [ ] **Step 5: Clean up the smoke test artifacts**

```bash
rm -f content/editorial/smoke-test.js /tmp/draftsrc.txt
rm -rf public/editorial/smoke-test
```

- [ ] **Step 6: Commit**

```bash
git add scripts/draftEditorial.mjs
git commit -m "refactor: CLI uses shared draftEditorialPrompt module with allowFiles opt-in"
```

---

## Phase 2: Admin route gate

### Task 5: Add NODE_ENV-gated middleware

**Files:**
- Create: `middleware.js`

- [ ] **Step 1: Create middleware**

Write `middleware.js` at the project root:
```js
import { NextResponse } from "next/server";

// Local-only admin tool: every /admin and /api/admin route returns 404
// in production builds. Runs only during `npm run dev` (NODE_ENV=development).
export function middleware(request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
```

- [ ] **Step 2: Verify dev mode passes through**

Run:
```bash
npm run dev
```

In another terminal:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin
```

Expected: `404` (admin routes don't exist yet — that's fine; we're verifying the middleware doesn't itself reject in dev).

Stop the dev server (Ctrl-C).

- [ ] **Step 3: Verify production build blocks**

Run:
```bash
npm run build && NODE_ENV=production npm run start
```

In another terminal:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/admin/save
```

Expected: both `404`.

Stop the prod server.

- [ ] **Step 4: Commit**

```bash
git add middleware.js
git commit -m "feat: NODE_ENV gate for /admin and /api/admin routes"
```

---

### Task 6: Add the API-route gate helper (defense in depth)

**Files:**
- Create: `app/api/admin/_gate.js`

- [ ] **Step 1: Create the helper**

Write `app/api/admin/_gate.js`:
```js
import { NextResponse } from "next/server";

// Per-route guard. Middleware already blocks /api/admin/* in production,
// but every route also calls assertDev() — defense in depth, and a
// clearer error if middleware is misconfigured.
export function assertDev() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/_gate.js
git commit -m "feat: per-route admin gate helper"
```

---

## Phase 3: Pure helpers (filesystem + serialization)

### Task 7: serializeEditorialModule

**Files:**
- Create: `app/lib/serializeEditorialModule.js`
- Test: `tests/lib/serializeEditorialModule.test.js`

Produces the JS source string for a `content/editorial/<slug>.js` file. Uses the same `serialize()` function the CLI already has — extracted to share.

- [ ] **Step 1: Write the failing test**

Write `tests/lib/serializeEditorialModule.test.js`:
```js
import { describe, it, expect } from "vitest";
import { serializeEditorialModule } from "../../app/lib/serializeEditorialModule.js";

describe("serializeEditorialModule", () => {
  it("produces a parseable JS module ending in export default entry", () => {
    const out = serializeEditorialModule({
      slug: "test-designer",
      publishedAt: "2026-05-21",
      hero: {
        layout: "image-right",
        eyebrow: "Editorial",
        title: "Test",
        subtitle: "Line one\nLine two",
        byline: "By DÉPÔT",
        images: ["hero.webp"],
        imageAlt: ["alt"],
      },
      brandFilter: "Test",
      curatedProducts: [
        { storeDomain: "esco.example", handle: "h1" },
      ],
      blocks: [
        { type: "text", width: "narrow", dropcap: true, body: "Hello." },
      ],
    });
    expect(out).toContain("const entry = {");
    expect(out).toMatch(/export default entry;\s*$/);
    expect(out).toContain('slug: "test-designer"');
    expect(out).toContain('storeDomain: "esco.example"');
    expect(out).toContain('"Line one\\nLine two"');
  });

  it("emits empty arrays as []", () => {
    const out = serializeEditorialModule({
      slug: "x",
      publishedAt: "2026-01-01",
      hero: {
        layout: "image-right",
        eyebrow: "",
        title: "X",
        subtitle: "",
        byline: "",
        images: ["hero.jpg"],
        imageAlt: [""],
      },
      brandFilter: "X",
      curatedProducts: [],
      blocks: [],
    });
    expect(out).toContain("curatedProducts: []");
    expect(out).toContain("blocks: []");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm test -- serializeEditorialModule
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Write `app/lib/serializeEditorialModule.js`:
```js
// Pretty-prints an editorial entry object into a JS source string suitable
// for content/editorial/<slug>.js. Mirrors the format hand-authored
// rick-owens.js uses (2-space indent, trailing commas inside arrays/objects).
function serialize(value, indent = 0) {
  const pad = "  ".repeat(indent);
  const pad2 = "  ".repeat(indent + 1);
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") {
    // JSON.stringify gives us proper escaping; replace double-escaped \n.
    return JSON.stringify(value).replace(/\\\\n/g, "\\n");
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => `${pad2}${serialize(v, indent + 1)}`);
    return `[\n${items.join(",\n")},\n${pad}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    const lines = keys.map((k) => `${pad2}${k}: ${serialize(value[k], indent + 1)}`);
    return `{\n${lines.join(",\n")},\n${pad}}`;
  }
  return JSON.stringify(value);
}

export function serializeEditorialModule(entry) {
  const ordered = {
    slug: entry.slug,
    publishedAt: entry.publishedAt,
    hero: entry.hero,
    brandFilter: entry.brandFilter,
    curatedProducts: entry.curatedProducts ?? [],
    blocks: entry.blocks ?? [],
  };
  return `const entry = ${serialize(ordered, 0)};\n\nexport default entry;\n`;
}
```

- [ ] **Step 4: Run tests**

Run:
```bash
npm test -- serializeEditorialModule
```

Expected: 2 tests pass.

- [ ] **Step 5: Sanity-check round-trip**

Run:
```bash
node --input-type=module -e "
import { serializeEditorialModule } from './app/lib/serializeEditorialModule.js';
const fs = await import('node:fs/promises');
const path = await import('node:path');
const src = serializeEditorialModule({
  slug: 'rt',
  publishedAt: '2026-05-21',
  hero: { layout: 'image-right', eyebrow: 'E', title: 'T', subtitle: 'S', byline: 'B', images: ['h.webp'], imageAlt: ['a'] },
  brandFilter: 'T',
  curatedProducts: [],
  blocks: [{ type: 'text', width: 'narrow', body: 'x' }]
});
const f = path.join(process.cwd(), 'tests', 'tmp-rt.mjs');
await fs.writeFile(f, src);
const mod = await import(f);
console.log(JSON.stringify(mod.default));
await fs.unlink(f);
"
```

Expected: prints valid JSON of the entry — confirms the generated source is importable.

- [ ] **Step 6: Commit**

```bash
git add app/lib/serializeEditorialModule.js tests/lib/serializeEditorialModule.test.js
git commit -m "feat: serializeEditorialModule helper"
```

---

### Task 8: patchEditorialIndex

**Files:**
- Create: `app/lib/patchEditorialIndex.js`
- Test: `tests/lib/patchEditorialIndex.test.js`

Idempotently inserts a new entry into `content/editorial/index.js`. Operates on the file's text via anchored regex (the file is small and stable: import block at top, `const ENTRIES = [...]` array). Returns the new file source. Throws if the anchors aren't found — saves abort, no `<slug>.js` is written without a registry entry.

- [ ] **Step 1: Write failing tests**

Write `tests/lib/patchEditorialIndex.test.js`:
```js
import { describe, it, expect } from "vitest";
import { patchEditorialIndex, slugToIdentifier } from "../../app/lib/patchEditorialIndex.js";

const SAMPLE = `import rickOwens from "./rick-owens.js";

const ENTRIES = [rickOwens];

const BY_SLUG = new Map(ENTRIES.map((e) => [e.slug, e]));

export function getAllEntries() {
  return [...ENTRIES].sort(
    (a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || "")
  );
}

export function getEntryBySlug(slug) {
  return BY_SLUG.get(slug) ?? null;
}

export function getAllSlugs() {
  return ENTRIES.map((e) => e.slug);
}
`;

describe("slugToIdentifier", () => {
  it("kebab → camelCase", () => {
    expect(slugToIdentifier("rick-owens")).toBe("rickOwens");
    expect(slugToIdentifier("yohji-yamamoto")).toBe("yohjiYamamoto");
    expect(slugToIdentifier("comme")).toBe("comme");
    expect(slugToIdentifier("a-b-c-d")).toBe("aBCD");
  });
});

describe("patchEditorialIndex", () => {
  it("inserts a new import and pushes into ENTRIES", () => {
    const out = patchEditorialIndex(SAMPLE, "yohji-yamamoto");
    expect(out).toContain('import yohjiYamamoto from "./yohji-yamamoto.js";');
    expect(out).toMatch(/const ENTRIES = \[rickOwens, yohjiYamamoto\];/);
  });

  it("is idempotent if the slug is already registered", () => {
    const once = patchEditorialIndex(SAMPLE, "yohji-yamamoto");
    const twice = patchEditorialIndex(once, "yohji-yamamoto");
    expect(twice).toBe(once);
  });

  it("inserts after the last import line", () => {
    const out = patchEditorialIndex(SAMPLE, "comme-des-garcons");
    const importLines = out.split("\n").filter((l) => l.startsWith("import "));
    expect(importLines.length).toBe(2);
    expect(importLines[1]).toBe(
      'import commeDesGarcons from "./comme-des-garcons.js";'
    );
  });

  it("throws if ENTRIES anchor is missing", () => {
    expect(() => patchEditorialIndex("// no entries here", "x")).toThrow(
      /ENTRIES/
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run:
```bash
npm test -- patchEditorialIndex
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Write `app/lib/patchEditorialIndex.js`:
```js
// Idempotently inserts a new entry into content/editorial/index.js.
// Anchored regex against the stable shape of that file:
//   import xxx from "./xxx.js";   ← we add ours after the last one
//   const ENTRIES = [...];        ← we push our identifier into this array
//
// Returns the new file source. Throws if anchors are missing — the save
// route catches the throw, abandons the write, and surfaces the error.

export function slugToIdentifier(slug) {
  return slug
    .split("-")
    .map((part, i) =>
      i === 0
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join("");
}

export function patchEditorialIndex(source, slug) {
  const ident = slugToIdentifier(slug);
  const importLine = `import ${ident} from "./${slug}.js";`;

  // Idempotent — bail if the import already exists.
  if (source.includes(importLine)) {
    return source;
  }

  // 1. Insert import after the last existing import line.
  const lines = source.split("\n");
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("import ")) lastImportIdx = i;
  }
  if (lastImportIdx === -1) {
    throw new Error(
      "patchEditorialIndex: no existing import line found in index.js"
    );
  }
  lines.splice(lastImportIdx + 1, 0, importLine);

  // 2. Push identifier into ENTRIES array.
  const entriesRe = /const ENTRIES = \[([^\]]*)\];/;
  const joined = lines.join("\n");
  const match = joined.match(entriesRe);
  if (!match) {
    throw new Error(
      "patchEditorialIndex: could not locate `const ENTRIES = [...]` anchor"
    );
  }
  const inner = match[1].trim();
  const newInner = inner ? `${inner}, ${ident}` : ident;
  return joined.replace(entriesRe, `const ENTRIES = [${newInner}];`);
}
```

- [ ] **Step 4: Run tests**

Run:
```bash
npm test -- patchEditorialIndex
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/lib/patchEditorialIndex.js tests/lib/patchEditorialIndex.test.js
git commit -m "feat: idempotent index.js patcher for editorial entries"
```

---

### Task 9: `/api/admin/list-files` — list files in `public/editorial/<slug>/`

**Files:**
- Create: `app/api/admin/list-files/route.js`

- [ ] **Step 1: Create the route**

Write `app/api/admin/list-files/route.js`:
```js
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { NextResponse } from "next/server";
import { assertDev } from "../_gate.js";

export async function GET(request) {
  const gate = assertDev();
  if (gate) return gate;

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }

  // Resolve and confirm we're still inside public/editorial/ — defense
  // against `..` traversal even though the regex prevents it.
  const root = resolve(process.cwd(), "public", "editorial");
  const dir = resolve(root, slug);
  if (!dir.startsWith(root + "/") && dir !== root) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }

  try {
    const entries = await fs.readdir(dir);
    const files = entries
      .filter((name) => !name.startsWith("."))
      .filter((name) => /\.(webp|jpg|jpeg|png|avif)$/i.test(name))
      .sort();
    return NextResponse.json({ files });
  } catch (err) {
    if (err.code === "ENOENT") return NextResponse.json({ files: [] });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Manual verification**

Run `npm run dev`. In another terminal:
```bash
curl -s "http://localhost:3000/api/admin/list-files?slug=rick-owens" | head -c 200
```

Expected: a JSON `{"files":[...]}` listing image files actually in `public/editorial/rick-owens/`.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/list-files/route.js
git commit -m "feat: list-files admin route for image autocomplete"
```

---

### Task 10: `/api/admin/list-entries` — list existing entries

**Files:**
- Create: `app/api/admin/list-entries/route.js`

- [ ] **Step 1: Create the route**

Write `app/api/admin/list-entries/route.js`:
```js
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { assertDev } from "../_gate.js";

export async function GET() {
  const gate = assertDev();
  if (gate) return gate;

  const dir = join(process.cwd(), "content", "editorial");
  const files = await fs.readdir(dir);

  const entries = [];
  for (const file of files) {
    if (!file.endsWith(".js") || file === "index.js") continue;
    const slug = file.replace(/\.js$/, "");
    try {
      // Cache-bust so we always get the latest file content during dev.
      const mod = await import(join(dir, file) + `?t=${Date.now()}`);
      const entry = mod.default;
      entries.push({
        slug,
        title: entry?.hero?.title ?? slug,
        publishedAt: entry?.publishedAt ?? "",
        brandFilter: entry?.brandFilter ?? "",
      });
    } catch (err) {
      entries.push({ slug, title: slug, error: err.message });
    }
  }

  entries.sort((a, b) =>
    (b.publishedAt || "").localeCompare(a.publishedAt || "")
  );
  return NextResponse.json({ entries });
}
```

- [ ] **Step 2: Manual verification**

Run `npm run dev`. In another terminal:
```bash
curl -s http://localhost:3000/api/admin/list-entries | head -c 400
```

Expected: JSON with the current `rick-owens` entry included.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/list-entries/route.js
git commit -m "feat: list-entries admin route"
```

---

## Phase 4: Admin shell + editor read path

### Task 11: `/admin` landing page

**Files:**
- Create: `app/admin/layout.js`
- Create: `app/admin/page.js`

- [ ] **Step 1: Create the layout**

Write `app/admin/layout.js`:
```js
// Admin shell. Visual identity is intentionally plain — this is a local
// dev tool, not part of the public site. Matches Dépôt's font/theme so
// the live preview pane looks correct.
export const metadata = { robots: "noindex, nofollow" };

export default function AdminLayout({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: "#0f0f10", color: "#e7e7e2" }}>
      <header
        style={{
          borderBottom: "1px solid #2a2a2c",
          padding: "12px 20px",
          fontSize: 13,
          display: "flex",
          gap: 20,
          alignItems: "center",
        }}
      >
        <a href="/admin" style={{ color: "#e7e7e2", textDecoration: "none", fontWeight: 500 }}>
          Dépôt · Admin
        </a>
        <a href="/admin/editorial" style={{ color: "#b6b6ad", textDecoration: "none" }}>
          Editorial
        </a>
        <a href="/admin/homepage-edit" style={{ color: "#b6b6ad", textDecoration: "none" }}>
          Today's Edit
        </a>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#6b6b62" }}>
          local-only · NODE_ENV={process.env.NODE_ENV}
        </span>
      </header>
      <main style={{ padding: 20 }}>{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Create the landing page**

Write `app/admin/page.js`:
```js
export default function AdminLanding() {
  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={{ fontSize: 24, fontWeight: 400, marginBottom: 16 }}>
        What do you want to edit?
      </h1>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        <li>
          <a
            href="/admin/editorial"
            style={{
              display: "block",
              padding: 16,
              background: "#18181a",
              border: "1px solid #2a2a2c",
              borderRadius: 6,
              color: "#e7e7e2",
              textDecoration: "none",
            }}
          >
            <strong>Editorial entries</strong>
            <div style={{ fontSize: 12, color: "#8a8a80", marginTop: 4 }}>
              Designer profiles. Create, edit, generate drafts.
            </div>
          </a>
        </li>
        <li>
          <a
            href="/admin/homepage-edit"
            style={{
              display: "block",
              padding: 16,
              background: "#18181a",
              border: "1px solid #2a2a2c",
              borderRadius: 6,
              color: "#e7e7e2",
              textDecoration: "none",
            }}
          >
            <strong>Today's Edit</strong>
            <div style={{ fontSize: 12, color: "#8a8a80", marginTop: 4 }}>
              Hand-pick which 8 products appear on the homepage.
            </div>
          </a>
        </li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

Run `npm run dev`. Visit `http://localhost:3000/admin` — confirm the two cards render. Click both to confirm 404s (those routes come next).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/admin/layout.js app/admin/page.js
git commit -m "feat: admin shell + landing page"
```

---

### Task 12: `/admin/editorial` list page

**Files:**
- Create: `app/admin/editorial/page.js`

- [ ] **Step 1: Create the page**

Write `app/admin/editorial/page.js`:
```js
import Link from "next/link";
import { promises as fs } from "node:fs";
import { join } from "node:path";

async function loadEntries() {
  const dir = join(process.cwd(), "content", "editorial");
  const files = await fs.readdir(dir);
  const entries = [];
  for (const file of files) {
    if (!file.endsWith(".js") || file === "index.js") continue;
    const slug = file.replace(/\.js$/, "");
    try {
      const mod = await import(join(dir, file) + `?t=${Date.now()}`);
      const e = mod.default;
      entries.push({
        slug,
        title: e?.hero?.title ?? slug,
        publishedAt: e?.publishedAt ?? "",
      });
    } catch (err) {
      entries.push({ slug, title: slug, error: err.message });
    }
  }
  entries.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  return entries;
}

export default async function EditorialList() {
  const entries = await loadEntries();
  return (
    <div style={{ maxWidth: 720 }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: 0 }}>Editorial entries</h1>
        <Link
          href="/admin/editorial/new"
          style={{
            marginLeft: "auto",
            padding: "6px 14px",
            background: "#d6d2c4",
            color: "#18181a",
            borderRadius: 4,
            fontSize: 12,
            textDecoration: "none",
          }}
        >
          + New entry
        </Link>
      </header>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {entries.map((e) => (
          <li key={e.slug}>
            <Link
              href={`/admin/editorial/${e.slug}`}
              style={{
                display: "flex",
                padding: 12,
                background: "#18181a",
                border: "1px solid #2a2a2c",
                borderRadius: 6,
                color: "#e7e7e2",
                textDecoration: "none",
              }}
            >
              <span style={{ fontWeight: 500 }}>{e.title}</span>
              <span style={{ marginLeft: 8, color: "#6b6b62", fontSize: 12 }}>
                /{e.slug}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "#8a8a80" }}>
                {e.publishedAt}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Run `npm run dev`. Visit `http://localhost:3000/admin/editorial`. Expected: the Rick Owens entry appears with title, slug, and date. The "+ New entry" button is visible.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/admin/editorial/page.js
git commit -m "feat: admin editorial list page"
```

---

### Task 13: PreviewPane component

**Files:**
- Create: `app/admin/editorial/[slug]/_components/PreviewPane.js`

The preview renders the entry through the **real** `Block.js` and `EditorialHero.js` components. To avoid divergence between live `/editorial/<slug>` and the editor's preview, we reuse those components directly.

**Why this is safe in Next.js App Router:** `Block.js` and `EditorialHero.js` are **shared components** in RSC parlance — files without `"use client"` *and* without any server-only API usage (no `cookies()`, no `headers()`, no `next/image` server-side props, no async data fetching in the component body, no `import "server-only"`). Shared components are bundled for whichever side imports them. Importing them from a server component → they render on the server. Importing them from a client component → they render on the client. The "client components can't import server components directly" rule only applies to *true* server components that use server-only APIs.

- [ ] **Step 1: Confirm Block.js and EditorialHero.js are still shared components**

The plan assumes both files are pure presentational (props in → JSX out). Verify with:

```bash
grep -l "use client" app/editorial/_components/Block.js app/editorial/_components/EditorialHero.js
grep -E "cookies\(|headers\(|server-only|^async function|fetch\(" app/editorial/_components/Block.js app/editorial/_components/EditorialHero.js
```

Expected: **both commands print nothing.** If either grep finds anything, the assumption is broken — skip to the **Fallback** section at the end of this task. As of this plan's authoring (2026-05-21), both files were clean.

Also confirm the signatures the preview will call:
- `Block` accepts `{ block, slug }` props
- `EditorialHero` accepts `{ entry }` and reads `entry.hero`

- [ ] **Step 2: Write PreviewPane**

Write `app/admin/editorial/[slug]/_components/PreviewPane.js`:
```js
"use client";

// PreviewPane is a client component because the editor lifts state into
// React useState and PreviewPane needs to re-render on every keystroke.
// Block and EditorialHero are shared components (verified in Step 1) —
// importing them here causes Next.js to bundle them for the client.
// This is the supported pattern; only true server components (those that
// use cookies/headers/server-only) require the children-via-props
// composition trick.
import Block from "../../../../editorial/_components/Block.js";
import EditorialHero from "../../../../editorial/_components/EditorialHero.js";

export default function PreviewPane({ entry }) {
  if (!entry) return null;
  return (
    <div
      style={{
        background: "#f6f3ec",
        color: "#18181a",
        padding: 24,
        borderRadius: 6,
        maxHeight: "calc(100vh - 140px)",
        overflowY: "auto",
        position: "sticky",
        top: 80,
      }}
    >
      <EditorialHero entry={entry} />
      {(entry.blocks ?? []).map((block, i) => (
        <Block key={i} block={block} slug={entry.slug} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/editorial/[slug]/_components/PreviewPane.js
git commit -m "feat: PreviewPane reusing Block.js + EditorialHero.js"
```

**Fallback (only if Step 1's grep found server-only API usage in either file):**

Create `app/admin/editorial/[slug]/_components/ClientBlock.js` and `ClientEditorialHero.js` — thin client-side clones covering all 5 block types (text, section-heading, image, pullquote, image-pair) and the 4 hero layouts. Use the same JSX/CSS classes as the originals so visual parity is preserved. Add a code comment on both files referencing the original they shadow, so future block-type additions update both copies. PreviewPane then imports the Client* versions instead.

This path is documented but should not be needed today — the grep in Step 1 is the gate.

---

### Task 14: `/admin/editorial/[slug]` read-only viewer

**Files:**
- Create: `app/admin/editorial/[slug]/page.js`

- [ ] **Step 1: Create the page**

Write `app/admin/editorial/[slug]/page.js`:
```js
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import PreviewPane from "./_components/PreviewPane.js";
import Editor from "./_components/Editor.js";

async function loadEntry(slug) {
  if (slug === "new") return null;
  const file = join(process.cwd(), "content", "editorial", `${slug}.js`);
  try {
    const mod = await import(file + `?t=${Date.now()}`);
    return mod.default;
  } catch {
    return null;
  }
}

export default async function EditorialEditor({ params }) {
  const { slug } = await params;
  const entry = await loadEntry(slug);
  if (slug !== "new" && !entry) notFound();

  return <Editor initialEntry={entry} slug={slug} />;
}
```

- [ ] **Step 2: Commit (stub — Editor component comes next)**

This will not yet render correctly because `Editor` doesn't exist. Don't commit until Task 15 adds it.

---

### Task 15: Editor component (state model — read-only first)

**Files:**
- Create: `app/admin/editorial/[slug]/_components/Editor.js`

For this task, Editor is a "use client" component that holds the entry state and renders a sketch of the editor UI **without editing controls yet** — only PreviewPane + a JSON dump on the left. We add editing controls in Phase 5. This lets us verify the read path and state shape before committing to editing UX.

- [ ] **Step 1: Write the read-only Editor**

Write `app/admin/editorial/[slug]/_components/Editor.js`:
```js
"use client";

import { useState } from "react";
import PreviewPane from "./PreviewPane.js";

const EMPTY_ENTRY = {
  slug: "",
  publishedAt: new Date().toISOString().slice(0, 10),
  hero: {
    layout: "image-right",
    eyebrow: "Editorial",
    title: "",
    subtitle: "",
    byline: "By DÉPÔT",
    images: ["hero.webp"],
    imageAlt: [""],
  },
  brandFilter: "",
  curatedProducts: [],
  blocks: [],
};

export default function Editor({ initialEntry, slug }) {
  const [entry, setEntry] = useState(
    initialEntry ?? { ...EMPTY_ENTRY, slug: slug === "new" ? "" : slug }
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
        alignItems: "start",
      }}
    >
      <div
        style={{
          background: "#18181a",
          border: "1px solid #2a2a2c",
          borderRadius: 6,
          padding: 14,
          maxHeight: "calc(100vh - 100px)",
          overflowY: "auto",
        }}
      >
        <div style={{ fontSize: 12, color: "#8a8a80", marginBottom: 8 }}>
          editor state (read-only stub — editing controls land in Phase 5)
        </div>
        <pre
          style={{
            fontSize: 11,
            lineHeight: 1.5,
            color: "#b6b6ad",
            whiteSpace: "pre-wrap",
          }}
        >
          {JSON.stringify(entry, null, 2)}
        </pre>
      </div>
      <PreviewPane entry={entry} />
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Run `npm run dev`. Visit `http://localhost:3000/admin/editorial/rick-owens`. Expected: left pane shows the JSON of the Rick Owens entry; right pane renders the same hero + blocks as `/editorial/rick-owens` does.

Also visit `http://localhost:3000/admin/editorial/new`. Expected: left pane shows an empty entry skeleton; right pane is mostly empty (no blocks).

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/admin/editorial/[slug]/page.js app/admin/editorial/[slug]/_components/Editor.js
git commit -m "feat: editor read-only stub with live PreviewPane"
```

---

## Phase 5: Editor write path

### Task 16: HeroPanel component

**Files:**
- Create: `app/admin/editorial/[slug]/_components/HeroPanel.js`

- [ ] **Step 1: Write the component**

Write `app/admin/editorial/[slug]/_components/HeroPanel.js`:
```js
"use client";

const LAYOUTS = ["image-right", "image-left", "image-below", "image-pair-top"];

function Field({ label, children, hint }) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span
        style={{
          display: "block",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#8a8a80",
          marginBottom: 4,
        }}
      >
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ display: "block", fontSize: 11, color: "#6b6b62", marginTop: 3 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  background: "#0f0f10",
  border: "1px solid #2a2a2c",
  color: "#e7e7e2",
  padding: "6px 8px",
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "inherit",
};

export default function HeroPanel({ hero, onChange, slug, brandFilter, onBrandFilterChange, publishedAt, onPublishedAtChange }) {
  const update = (patch) => onChange({ ...hero, ...patch });

  return (
    <section
      style={{
        background: "#18181a",
        border: "1px solid #2a2a2c",
        borderRadius: 6,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b6b6ad", margin: "0 0 12px" }}>
        Hero · Metadata
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Slug">
          <input style={inputStyle} value={slug} disabled />
        </Field>
        <Field label="Published">
          <input
            style={inputStyle}
            type="date"
            value={publishedAt}
            onChange={(e) => onPublishedAtChange(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Layout">
        <select
          style={inputStyle}
          value={hero.layout}
          onChange={(e) => update({ layout: e.target.value })}
        >
          {LAYOUTS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </Field>

      <Field label="Eyebrow">
        <input
          style={inputStyle}
          value={hero.eyebrow}
          onChange={(e) => update({ eyebrow: e.target.value })}
        />
      </Field>

      <Field label="Title">
        <input
          style={inputStyle}
          value={hero.title}
          onChange={(e) => update({ title: e.target.value })}
        />
      </Field>

      <Field label="Subtitle" hint="Use \\n for a line break.">
        <textarea
          style={{ ...inputStyle, minHeight: 60, resize: "vertical", lineHeight: 1.5 }}
          value={hero.subtitle}
          onChange={(e) => update({ subtitle: e.target.value })}
        />
      </Field>

      <Field label="Byline">
        <input
          style={inputStyle}
          value={hero.byline}
          onChange={(e) => update({ byline: e.target.value })}
        />
      </Field>

      <Field label="Hero image filename" hint={`File goes in public/editorial/${slug}/`}>
        <input
          style={inputStyle}
          value={hero.images?.[0] ?? ""}
          onChange={(e) => update({ images: [e.target.value] })}
        />
      </Field>

      <Field label="Hero image alt">
        <input
          style={inputStyle}
          value={hero.imageAlt?.[0] ?? ""}
          onChange={(e) => update({ imageAlt: [e.target.value] })}
        />
      </Field>

      <Field label="Brand filter" hint="Used for the 'More from designer' grid + Generate prompt.">
        <input
          style={inputStyle}
          value={brandFilter}
          onChange={(e) => onBrandFilterChange(e.target.value)}
        />
      </Field>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/admin/editorial/[slug]/_components/HeroPanel.js
git commit -m "feat: HeroPanel editor component"
```

---

### Task 17: BlockCard + AddBlockMenu

**Files:**
- Create: `app/admin/editorial/[slug]/_components/BlockCard.js`
- Create: `app/admin/editorial/[slug]/_components/AddBlockMenu.js`

- [ ] **Step 1: Write BlockCard**

Write `app/admin/editorial/[slug]/_components/BlockCard.js`:
```js
"use client";

const inputStyle = {
  width: "100%",
  background: "#0f0f10",
  border: "1px solid #2a2a2c",
  color: "#e7e7e2",
  padding: 6,
  borderRadius: 3,
  fontSize: 12,
  fontFamily: "inherit",
};

const textareaStyle = { ...inputStyle, minHeight: 80, resize: "vertical", lineHeight: 1.5 };

function Pill({ label, active, onClick }) {
  return (
    <span
      onClick={onClick}
      style={{
        padding: "2px 8px",
        border: `1px solid ${active ? "#d6d2c4" : "#2a2a2c"}`,
        background: active ? "#d6d2c4" : "transparent",
        color: active ? "#18181a" : "#b6b6ad",
        borderRadius: 10,
        fontSize: 10,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {label}
    </span>
  );
}

export default function BlockCard({ block, index, total, onChange, onMoveUp, onMoveDown, onDelete }) {
  const update = (patch) => onChange({ ...block, ...patch });

  return (
    <div
      style={{
        background: "#18181a",
        border: "1px solid #2a2a2c",
        borderRadius: 6,
        padding: 10,
        marginBottom: 8,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <span
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            background: "#2a2a2c",
            color: "#b6b6ad",
            padding: "2px 6px",
            borderRadius: 3,
          }}
        >
          {block.type}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button onClick={onMoveUp} disabled={index === 0} style={btnStyle}>↑</button>
          <button onClick={onMoveDown} disabled={index === total - 1} style={btnStyle}>↓</button>
          <button onClick={onDelete} style={{ ...btnStyle, color: "#c9806b" }}>×</button>
        </div>
      </header>

      {block.type === "text" && (
        <>
          <textarea
            style={textareaStyle}
            value={block.body ?? ""}
            onChange={(e) => update({ body: e.target.value })}
            placeholder="Paragraph text…"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 10, color: "#8a8a80", alignItems: "center" }}>
            <span>width:</span>
            <Pill label="narrow" active={block.width === "narrow"} onClick={() => update({ width: "narrow" })} />
            <Pill label="wide" active={block.width === "wide"} onClick={() => update({ width: "wide" })} />
            <span style={{ marginLeft: 12 }}>
              <label>
                <input
                  type="checkbox"
                  checked={!!block.dropcap}
                  onChange={(e) => update({ dropcap: e.target.checked })}
                /> dropcap
              </label>
            </span>
          </div>
        </>
      )}

      {block.type === "section-heading" && (
        <input
          style={inputStyle}
          value={block.text ?? ""}
          onChange={(e) => update({ text: e.target.value })}
          placeholder="Section heading…"
        />
      )}

      {block.type === "pullquote" && (
        <>
          <input
            style={inputStyle}
            value={block.text ?? ""}
            onChange={(e) => update({ text: e.target.value })}
            placeholder="Quote text…"
          />
          <input
            style={{ ...inputStyle, marginTop: 6 }}
            value={block.attribution ?? ""}
            onChange={(e) => update({ attribution: e.target.value })}
            placeholder="Attribution"
          />
        </>
      )}

      {block.type === "image" && (
        <>
          <input
            style={inputStyle}
            value={block.src ?? ""}
            onChange={(e) => update({ src: e.target.value })}
            placeholder="filename in public/editorial/<slug>/"
          />
          <input
            style={{ ...inputStyle, marginTop: 6 }}
            value={block.alt ?? ""}
            onChange={(e) => update({ alt: e.target.value })}
            placeholder="alt text"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 10, color: "#8a8a80", alignItems: "center" }}>
            <span>width:</span>
            <Pill label="narrow" active={block.width === "narrow"} onClick={() => update({ width: "narrow" })} />
            <Pill label="wide" active={block.width === "wide"} onClick={() => update({ width: "wide" })} />
            <Pill label="full-bleed" active={block.width === "full-bleed"} onClick={() => update({ width: "full-bleed" })} />
          </div>
        </>
      )}

      {block.type === "image-pair" && (
        <>
          {[0, 1].map((i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <input
                style={inputStyle}
                value={block.images?.[i]?.src ?? ""}
                onChange={(e) => {
                  const next = [...(block.images ?? [{}, {}])];
                  next[i] = { ...next[i], src: e.target.value };
                  update({ images: next });
                }}
                placeholder={`image ${i + 1} filename`}
              />
              <input
                style={{ ...inputStyle, marginTop: 4 }}
                value={block.images?.[i]?.alt ?? ""}
                onChange={(e) => {
                  const next = [...(block.images ?? [{}, {}])];
                  next[i] = { ...next[i], alt: e.target.value };
                  update({ images: next });
                }}
                placeholder={`image ${i + 1} alt`}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const btnStyle = {
  background: "transparent",
  border: "1px solid #2a2a2c",
  color: "#b6b6ad",
  width: 22,
  height: 22,
  borderRadius: 3,
  fontSize: 11,
  cursor: "pointer",
};
```

- [ ] **Step 2: Write AddBlockMenu**

Write `app/admin/editorial/[slug]/_components/AddBlockMenu.js`:
```js
"use client";

import { useState } from "react";

const TYPES = [
  { type: "text",            label: "Text paragraph",     factory: () => ({ type: "text", width: "narrow", body: "" }) },
  { type: "section-heading", label: "Section heading",    factory: () => ({ type: "section-heading", text: "" }) },
  { type: "pullquote",       label: "Pullquote",          factory: () => ({ type: "pullquote", text: "", attribution: "" }) },
  { type: "image",           label: "Image — single",     factory: () => ({ type: "image", src: "", width: "wide", alt: "" }) },
  { type: "image-pair",      label: "Image — pair",       factory: () => ({ type: "image-pair", images: [{ src: "", alt: "" }, { src: "", alt: "" }] }) },
];

export default function AddBlockMenu({ onAdd }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: 8,
          background: "transparent",
          border: "1px dashed #2a2a2c",
          color: "#8a8a80",
          borderRadius: 4,
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        + Add block
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: "#18181a",
            border: "1px solid #2a2a2c",
            borderRadius: 6,
            padding: 6,
            zIndex: 10,
          }}
        >
          {TYPES.map((t) => (
            <div
              key={t.type}
              onClick={() => {
                onAdd(t.factory());
                setOpen(false);
              }}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                color: "#e7e7e2",
                cursor: "pointer",
                borderRadius: 3,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2a2c")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {t.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/editorial/[slug]/_components/BlockCard.js app/admin/editorial/[slug]/_components/AddBlockMenu.js
git commit -m "feat: BlockCard + AddBlockMenu editor components"
```

---

### Task 18: Wire HeroPanel + blocks into Editor

**Files:**
- Modify: `app/admin/editorial/[slug]/_components/Editor.js`

- [ ] **Step 1: Replace the read-only stub with the full editor**

Overwrite `app/admin/editorial/[slug]/_components/Editor.js`:
```js
"use client";

import { useState } from "react";
import HeroPanel from "./HeroPanel.js";
import BlockCard from "./BlockCard.js";
import AddBlockMenu from "./AddBlockMenu.js";
import PreviewPane from "./PreviewPane.js";

const EMPTY_ENTRY = {
  slug: "",
  publishedAt: new Date().toISOString().slice(0, 10),
  hero: {
    layout: "image-right",
    eyebrow: "Editorial",
    title: "",
    subtitle: "",
    byline: "By DÉPÔT",
    images: ["hero.webp"],
    imageAlt: [""],
  },
  brandFilter: "",
  curatedProducts: [],
  blocks: [],
};

export default function Editor({ initialEntry, slug }) {
  const isNew = slug === "new";
  const [entry, setEntry] = useState(
    initialEntry ?? { ...EMPTY_ENTRY, slug: "" }
  );
  const [draftSlug, setDraftSlug] = useState(entry.slug || "");
  const effectiveSlug = isNew ? draftSlug : slug;

  function updateHero(hero) { setEntry({ ...entry, hero }); }
  function updateBrand(brandFilter) { setEntry({ ...entry, brandFilter }); }
  function updatePublishedAt(publishedAt) { setEntry({ ...entry, publishedAt }); }
  function updateBlock(i, next) {
    const blocks = entry.blocks.slice();
    blocks[i] = next;
    setEntry({ ...entry, blocks });
  }
  function deleteBlock(i) {
    setEntry({ ...entry, blocks: entry.blocks.filter((_, j) => j !== i) });
  }
  function moveBlock(i, dir) {
    const blocks = entry.blocks.slice();
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    setEntry({ ...entry, blocks });
  }
  function addBlock(block) {
    setEntry({ ...entry, blocks: [...entry.blocks, block] });
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(420px, 1fr) 1fr",
        gap: 16,
        alignItems: "start",
      }}
    >
      <div style={{ maxHeight: "calc(100vh - 100px)", overflowY: "auto" }}>
        {isNew && (
          <section
            style={{
              background: "#18181a",
              border: "1px solid #2a2a2c",
              borderRadius: 6,
              padding: 14,
              marginBottom: 12,
            }}
          >
            <label style={{ display: "block" }}>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a8a80" }}>
                Slug (kebab-case, locked after first save)
              </span>
              <input
                value={draftSlug}
                onChange={(e) => setDraftSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="e.g. yohji-yamamoto"
                style={{
                  marginTop: 4,
                  width: "100%",
                  background: "#0f0f10",
                  border: "1px solid #2a2a2c",
                  color: "#e7e7e2",
                  padding: "6px 8px",
                  borderRadius: 4,
                  fontSize: 13,
                }}
              />
            </label>
          </section>
        )}

        <HeroPanel
          hero={entry.hero}
          onChange={updateHero}
          slug={effectiveSlug || "(slug)"}
          brandFilter={entry.brandFilter}
          onBrandFilterChange={updateBrand}
          publishedAt={entry.publishedAt}
          onPublishedAtChange={updatePublishedAt}
        />

        <section
          style={{
            background: "#18181a",
            border: "1px solid #2a2a2c",
            borderRadius: 6,
            padding: 14,
            marginBottom: 12,
          }}
        >
          <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b6b6ad", margin: "0 0 12px" }}>
            Blocks ({entry.blocks.length})
          </h3>
          {entry.blocks.map((block, i) => (
            <BlockCard
              key={i}
              block={block}
              index={i}
              total={entry.blocks.length}
              onChange={(next) => updateBlock(i, next)}
              onMoveUp={() => moveBlock(i, -1)}
              onMoveDown={() => moveBlock(i, +1)}
              onDelete={() => deleteBlock(i)}
            />
          ))}
          <AddBlockMenu onAdd={addBlock} />
        </section>
      </div>

      <PreviewPane entry={{ ...entry, slug: effectiveSlug }} />
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Run `npm run dev`. Visit `http://localhost:3000/admin/editorial/rick-owens`. Confirm:
- Hero fields are populated and editable
- Each existing block appears as a card with edit fields
- Editing a text block updates the preview pane
- ↑↓ buttons reorder blocks
- × removes a block (preview updates)
- + Add block menu opens and inserts the chosen block type

Visit `/admin/editorial/new`. Type a slug, fill hero, add a couple of blocks. Confirm preview renders.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/admin/editorial/[slug]/_components/Editor.js
git commit -m "feat: editor write path — hero, blocks, add/reorder/delete"
```

---

### Task 19: Save API route

**Files:**
- Create: `app/api/admin/save/route.js`

- [ ] **Step 1: Write the route**

Write `app/api/admin/save/route.js`:
```js
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { assertDev } from "../_gate.js";
import { serializeEditorialModule } from "../../../lib/serializeEditorialModule.js";
import { patchEditorialIndex } from "../../../lib/patchEditorialIndex.js";

export async function POST(request) {
  const gate = assertDev();
  if (gate) return gate;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const entry = body.entry;
  if (!entry || typeof entry !== "object") {
    return NextResponse.json({ error: "missing entry" }, { status: 400 });
  }

  const slug = entry.slug;
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return NextResponse.json({ error: "invalid slug" }, { status: 400 });
  }

  const root = process.cwd();
  const slugFile = join(root, "content", "editorial", `${slug}.js`);
  const indexFile = join(root, "content", "editorial", "index.js");
  const imgDir = join(root, "public", "editorial", slug);

  let indexSource;
  try {
    indexSource = await fs.readFile(indexFile, "utf8");
  } catch (err) {
    return NextResponse.json(
      { error: `cannot read index.js: ${err.message}` },
      { status: 500 }
    );
  }

  let nextIndex;
  try {
    nextIndex = patchEditorialIndex(indexSource, slug);
  } catch (err) {
    return NextResponse.json(
      { error: `index.js patch failed: ${err.message}` },
      { status: 500 }
    );
  }

  // Serialize and write the slug file.
  let source;
  try {
    source = serializeEditorialModule(entry);
  } catch (err) {
    return NextResponse.json(
      { error: `serialize failed: ${err.message}` },
      { status: 500 }
    );
  }

  // Track whether the slug file existed before this save so we can roll
  // back cleanly on partial failure (orphan-slug-without-registry-entry).
  let slugFileExistedBefore = true;
  try {
    await fs.access(slugFile);
  } catch {
    slugFileExistedBefore = false;
  }

  try {
    await fs.writeFile(slugFile, source, "utf8");
  } catch (err) {
    return NextResponse.json(
      { error: `slug-file write failed: ${err.message}` },
      { status: 500 }
    );
  }

  if (nextIndex !== indexSource) {
    try {
      await fs.writeFile(indexFile, nextIndex, "utf8");
    } catch (err) {
      // Rollback: if we just created a brand-new slug file but failed to
      // update the registry, unlink the slug file so we don't leave an
      // orphan that fails public lookup but appears in /admin/editorial.
      // For existing entries we leave the slug file in place — the prior
      // content is already gone and the index entry already points at it.
      if (!slugFileExistedBefore) {
        await fs.unlink(slugFile).catch(() => {});
      }
      return NextResponse.json(
        {
          error: `index.js write failed (rolled back: ${!slugFileExistedBefore}): ${err.message}`,
        },
        { status: 500 }
      );
    }
  }

  try {
    await fs.mkdir(imgDir, { recursive: true });
  } catch {
    // Image dir creation failure is non-fatal — user can mkdir manually.
  }

  return NextResponse.json({
    ok: true,
    slugFile: `content/editorial/${slug}.js`,
    indexUpdated: nextIndex !== indexSource,
  });
}
```

- [ ] **Step 2: Add a Save button to the Editor**

Modify `app/admin/editorial/[slug]/_components/Editor.js`. At the top of the component (just inside the return, before the grid), add a topbar:

Find this line:
```js
  return (
    <div
      style={{
        display: "grid",
```

Replace with:
```js
  async function handleSave() {
    if (!effectiveSlug || !/^[a-z0-9][a-z0-9-]*$/.test(effectiveSlug)) {
      alert("Slug is required and must be kebab-case.");
      return;
    }
    const payload = { ...entry, slug: effectiveSlug };
    const res = await fetch("/api/admin/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`Save failed: ${data.error || res.status}`);
      return;
    }
    alert(`Saved ${data.slugFile}${data.indexUpdated ? " (+ index.js)" : ""}`);
    if (isNew) {
      window.location.href = `/admin/editorial/${effectiveSlug}`;
    }
  }

  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: 12,
          gap: 8,
        }}
      >
        <a href="/admin/editorial" style={{ color: "#b6b6ad", fontSize: 12, textDecoration: "none" }}>
          ← Editorial list
        </a>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8a8a80" }}>
          {effectiveSlug ? `content/editorial/${effectiveSlug}.js` : "(unsaved)"}
        </span>
        <button
          onClick={handleSave}
          style={{
            background: "#d6d2c4",
            color: "#18181a",
            border: "none",
            padding: "6px 14px",
            borderRadius: 4,
            fontSize: 12,
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          Save
        </button>
      </header>
    <div
      style={{
        display: "grid",
```

And at the very end of the JSX (after the closing `</div>` of the grid), add another `</div>` to close the wrapping header div.

- [ ] **Step 3: Manual verification — edit an existing entry**

Run `npm run dev`. Visit `/admin/editorial/rick-owens`. Change the title to "Rick Owens (test)". Click Save. Expected alert: `Saved content/editorial/rick-owens.js`. Open `content/editorial/rick-owens.js` in your editor — confirm the title field reads "Rick Owens (test)". Revert it back to "Rick Owens" and Save again.

- [ ] **Step 4: Manual verification — create a new entry**

Visit `/admin/editorial/new`. Slug `save-test`. Fill hero, add a text block. Click Save. Expected alert: `Saved content/editorial/save-test.js (+ index.js)`. Confirm:
- `content/editorial/save-test.js` exists with the expected shape
- `content/editorial/index.js` now has `import saveTest from "./save-test.js";` and `saveTest` in `ENTRIES`

Visit `/editorial/save-test` — confirm the entry renders on the real public page.

Clean up:
```bash
rm content/editorial/save-test.js
# Manually remove the saveTest import + entry from content/editorial/index.js
```

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/save/route.js app/admin/editorial/[slug]/_components/Editor.js
git commit -m "feat: save admin route with auto-patched index.js"
```

---

## Phase 6: GPT draft

### Task 20: structurePlan helper

**Files:**
- Create: `app/lib/structurePlan.js`
- Test: `tests/lib/structurePlan.test.js`

Given the current editor's block list (which may contain user-placed image / image-pair blocks) and a length target, returns a human-readable structure plan string for the prompt, plus a target text-block count.

- [ ] **Step 1: Write failing tests**

Write `tests/lib/structurePlan.test.js`:
```js
import { describe, it, expect } from "vitest";
import { buildStructurePlan } from "../../app/lib/structurePlan.js";

describe("buildStructurePlan", () => {
  it("counts text-shaped blocks the model should produce", () => {
    const { textBlockCount } = buildStructurePlan({
      currentBlocks: [
        { type: "image", src: "01.webp" },
        { type: "image-pair", images: [{ src: "a" }, { src: "b" }] },
      ],
      length: "medium",
    });
    // medium → 6 text-shaped blocks total
    expect(textBlockCount).toBe(6);
  });

  it("describes image breaks at their positions in the plan", () => {
    const { plan } = buildStructurePlan({
      currentBlocks: [
        { type: "image", src: "01.webp", width: "full-bleed" },
      ],
      length: "short",
    });
    expect(plan).toMatch(/IMAGE BREAK/);
    expect(plan).toMatch(/full-bleed/);
  });

  it("instructs blocks to end on complete thoughts", () => {
    const { plan } = buildStructurePlan({ currentBlocks: [], length: "short" });
    expect(plan).toMatch(/complete (sentence|thought)/i);
  });

  it("varies block count by length", () => {
    const short = buildStructurePlan({ currentBlocks: [], length: "short" }).textBlockCount;
    const long = buildStructurePlan({ currentBlocks: [], length: "long" }).textBlockCount;
    expect(long).toBeGreaterThan(short);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run:
```bash
npm test -- structurePlan
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Write `app/lib/structurePlan.js`:
```js
// Given the editor's current block list and a length target, build a
// structural plan that we paste into the OpenAI prompt so the model
// produces exactly the right number of text-shaped blocks (text /
// section-heading / pullquote) threaded around the user's pre-placed
// image and image-pair blocks.

const LENGTH_TARGETS = {
  short:  { textBlockCount: 4,  words: 400  },
  medium: { textBlockCount: 6,  words: 800  },
  long:   { textBlockCount: 9,  words: 1500 },
};

function isImageBlock(b) {
  return b.type === "image" || b.type === "image-pair";
}

export function buildStructurePlan({ currentBlocks = [], length = "medium" }) {
  const target = LENGTH_TARGETS[length] || LENGTH_TARGETS.medium;
  const textBlockCount = target.textBlockCount;

  // Find the positions of pre-placed image blocks relative to where the
  // text blocks will live. Image blocks split the text into segments.
  const imageBlocks = currentBlocks.filter(isImageBlock);
  const segments = imageBlocks.length + 1;
  const blocksPerSegment = Math.max(1, Math.floor(textBlockCount / segments));
  const wordsPerBlock = Math.round(target.words / textBlockCount);

  const lines = [];
  let textIdx = 0;
  let remaining = textBlockCount;
  for (let s = 0; s < segments; s++) {
    const isLast = s === segments - 1;
    const count = isLast ? remaining : Math.min(remaining, blocksPerSegment);
    for (let i = 0; i < count; i++) {
      textIdx += 1;
      const isOpening = textIdx === 1;
      const role = isOpening
        ? "opening paragraph (apply dropcap on this block only)"
        : "continues the section";
      lines.push(`  ${textIdx}. text — ~${wordsPerBlock} words, ${role}`);
      remaining -= 1;
    }
    if (!isLast) {
      const img = imageBlocks[s];
      const desc =
        img.type === "image-pair"
          ? "image-pair (two images side by side)"
          : `image (${img.width || "wide"})`;
      lines.push(`  -- IMAGE BREAK -- ${desc} -- the next text block starts a NEW thought, never continues the previous one.`);
    }
  }

  // Encourage occasional section-headings and a single pullquote.
  const hint =
    "Sprinkle 1-2 section-heading blocks and exactly 1 pullquote block into the text sequence above where they fit naturally. Keep the total text-shaped block count at " +
    `${textBlockCount} (text + section-heading + pullquote combined). Each block must end on a complete sentence and a complete thought.`;

  const plan = lines.join("\n") + "\n\n" + hint;
  return { plan, textBlockCount, targetWords: target.words };
}
```

- [ ] **Step 4: Run tests**

Run:
```bash
npm test -- structurePlan
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/lib/structurePlan.js tests/lib/structurePlan.test.js
git commit -m "feat: structurePlan helper for GPT draft prompt"
```

---

### Task 21: `/api/admin/draft` route

**Files:**
- Create: `app/api/admin/draft/route.js`

- [ ] **Step 1: Write the route**

Write `app/api/admin/draft/route.js`:
```js
import { NextResponse } from "next/server";
import { assertDev } from "../_gate.js";
import {
  loadAll,
  buildPrompt,
  callOpenAI,
  extractJson,
  VALID_LAYOUTS,
} from "../../../lib/draftEditorialPrompt.js";
import { buildStructurePlan } from "../../../lib/structurePlan.js";

export const maxDuration = 60;

export async function POST(request) {
  const gate = assertDev();
  if (gate) return gate;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const {
    title,
    brand,
    layout = "image-right",
    sourceValues = [],
    styleValues = [],
    notes = [],
    length = "medium",
    currentBlocks = [],
  } = body;

  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  if (!VALID_LAYOUTS.includes(layout)) {
    return NextResponse.json({ error: "invalid layout" }, { status: 400 });
  }

  // SECURITY: do NOT pass allowFiles: true here. The shared loadSource
  // helper defaults to "treat non-HTTP values as inline text" precisely
  // so request-controlled values can't escape into fs.readFile and
  // exfiltrate .env.local through the OpenAI prompt. See invariant #9.
  const sources = await loadAll(sourceValues);
  const styles = await loadAll(styleValues);
  const { plan, textBlockCount } = buildStructurePlan({ currentBlocks, length });

  const prompt = buildPrompt({
    title,
    brand: brand || title,
    layout,
    sources,
    styles,
    notes,
    structurePlan: plan,
  });

  let raw;
  try {
    raw = await callOpenAI(prompt);
  } catch (err) {
    return NextResponse.json({ error: `OpenAI: ${err.message}` }, { status: 502 });
  }

  let parsed;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    return NextResponse.json(
      { error: `JSON parse failed: ${err.message}`, raw },
      { status: 502 }
    );
  }

  return NextResponse.json({
    hero: parsed.hero ?? null,
    generatedBlocks: parsed.blocks ?? [],
    expectedTextCount: textBlockCount,
  });
}
```

- [ ] **Step 2: Smoke-verify manually**

Run `npm run dev`. In another terminal (requires `OPENAI_API_KEY` in `.env.local`):
```bash
curl -s -X POST http://localhost:3000/api/admin/draft \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Designer",
    "layout": "image-right",
    "length": "short",
    "notes": ["return a minimal but valid response"],
    "currentBlocks": []
  }' | head -c 600
```

Expected: JSON with `hero` and `generatedBlocks` (an array of blocks).

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/draft/route.js
git commit -m "feat: /api/admin/draft route with structural plan"
```

---

### Task 22: GenerateModal component

**Files:**
- Create: `app/admin/editorial/[slug]/_components/GenerateModal.js`

- [ ] **Step 1: Write the component**

Write `app/admin/editorial/[slug]/_components/GenerateModal.js`:
```js
"use client";

import { useState } from "react";

const LENGTHS = [
  { value: "short",  label: "Short",  detail: "~400 words · 3-4 text blocks" },
  { value: "medium", label: "Medium", detail: "~800 words · 5-7 text blocks" },
  { value: "long",   label: "Long",   detail: "~1500 words · 8-10 text blocks" },
];

const inputStyle = {
  width: "100%",
  background: "#0f0f10",
  border: "1px solid #2a2a2c",
  color: "#e7e7e2",
  padding: "7px 9px",
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "inherit",
};

function RowList({ label, hint, values, onChange, placeholder }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a8a80", marginBottom: 4 }}>
        {label}
      </div>
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            background: "#0f0f10",
            border: "1px solid #2a2a2c",
            borderRadius: 4,
            padding: "6px 9px",
            marginBottom: 4,
            fontSize: 12,
            alignItems: "center",
          }}
        >
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
          <span
            style={{ color: "#6b6b62", cursor: "pointer", marginLeft: 8 }}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            ×
          </span>
        </div>
      ))}
      <input
        style={inputStyle}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.currentTarget.value.trim()) {
            onChange([...values, e.currentTarget.value.trim()]);
            e.currentTarget.value = "";
            e.preventDefault();
          }
        }}
      />
      {hint && <div style={{ fontSize: 11, color: "#6b6b62", marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

export default function GenerateModal({ entry, onClose, onApply }) {
  const [title, setTitle] = useState(entry.hero?.title || "");
  const [layout, setLayout] = useState(entry.hero?.layout || "image-right");
  const [sources, setSources] = useState([]);
  const [styles, setStyles] = useState([]);
  const [notes, setNotes] = useState("");
  const [length, setLength] = useState("medium");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          brand: entry.brandFilter || title,
          layout,
          sourceValues: sources,
          styleValues: styles,
          notes: notes ? [notes] : [],
          length,
          currentBlocks: entry.blocks,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      onApply(data);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#18181a",
          border: "1px solid #2a2a2c",
          borderRadius: 8,
          maxWidth: 640,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <header style={{ padding: "14px 18px", borderBottom: "1px solid #2a2a2c", display: "flex", alignItems: "center" }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "#e7e7e2" }}>✦ Generate draft</h4>
          <span onClick={onClose} style={{ marginLeft: "auto", color: "#6b6b62", fontSize: 16, cursor: "pointer" }}>×</span>
        </header>

        <div style={{ padding: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <label>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a8a80", marginBottom: 4 }}>Designer</div>
              <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a8a80", marginBottom: 4 }}>Layout</div>
              <select style={inputStyle} value={layout} onChange={(e) => setLayout(e.target.value)}>
                {["image-right", "image-left", "image-below", "image-pair-top"].map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a8a80", marginBottom: 4 }}>Length</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {LENGTHS.map((l) => (
                <div
                  key={l.value}
                  onClick={() => setLength(l.value)}
                  style={{
                    background: "#0f0f10",
                    border: `1px solid ${length === l.value ? "#d6d2c4" : "#2a2a2c"}`,
                    borderRadius: 4,
                    padding: 10,
                    textAlign: "center",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 13, color: "#e7e7e2" }}>{l.label}</div>
                  <div style={{ fontSize: 10, color: "#8a8a80" }}>{l.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <RowList
            label="Source material"
            hint="URL, file path, or pasted text. Press Enter to add a row."
            values={sources}
            onChange={setSources}
            placeholder="https://… or path/to/file.txt"
          />

          <RowList
            label="Style references"
            hint="Existing editorials whose voice you want to echo."
            values={styles}
            onChange={setStyles}
            placeholder="https://…"
          />

          <label>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8a8a80", marginBottom: 4 }}>Editor notes</div>
            <textarea
              style={{ ...inputStyle, minHeight: 60, resize: "vertical", lineHeight: 1.5 }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Personal direction. Tone, what to emphasize, what to avoid."
            />
          </label>

          {error && (
            <div style={{ marginTop: 10, padding: 10, background: "#3a1e1e", borderRadius: 4, fontSize: 12, color: "#e7c0b6" }}>
              {error}
            </div>
          )}
        </div>

        <footer style={{ padding: "12px 18px", background: "#0f0f10", borderTop: "1px solid #2a2a2c", display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#6b6b62" }}>
            Will replace text blocks. Image blocks and curated products are preserved.
          </span>
          <button
            onClick={submit}
            disabled={loading || !title}
            style={{
              marginLeft: "auto",
              background: loading ? "#3a3072" : "linear-gradient(135deg, #6a4ba6, #4a3578)",
              color: "#fff",
              border: "none",
              padding: "8px 16px",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 500,
              cursor: loading || !title ? "not-allowed" : "pointer",
              opacity: !title ? 0.5 : 1,
            }}
          >
            {loading ? "Generating…" : "✦ Generate"}
          </button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/admin/editorial/[slug]/_components/GenerateModal.js
git commit -m "feat: GenerateModal component"
```

---

### Task 23: Wire GenerateModal into Editor

**Files:**
- Modify: `app/admin/editorial/[slug]/_components/Editor.js`

The merge rule: text-shaped blocks (`text`, `section-heading`, `pullquote`) generated by GPT are threaded around the user's existing image blocks. Image blocks and curated products are preserved.

- [ ] **Step 1: Add the merge helper at the top of Editor.js**

Insert after the imports, before `const EMPTY_ENTRY`:
```js
function mergeGeneratedBlocks(currentBlocks, generatedBlocks, expectedTextCount) {
  // currentBlocks may include user-placed image / image-pair blocks.
  // generatedBlocks comes from GPT — text / section-heading / pullquote
  // (and possibly image blocks we ignore).
  //
  // The structural plan was built assuming text blocks split into N+1
  // segments around N image breaks. We replay that split here.
  //
  // Returns { merged, warning } where `warning` is a string the caller
  // surfaces to the user, or null if the merge proceeded cleanly.
  const isImage = (b) => b.type === "image" || b.type === "image-pair";
  const imageSlots = currentBlocks.filter(isImage);
  const generatedTextish = generatedBlocks.filter((b) => !isImage(b));

  const segments = imageSlots.length + 1;

  // GPT can return fewer (or more) text-shaped blocks than the plan asked
  // for. If the count doesn't match, the per-segment split silently
  // shifts content across image breaks — exactly the failure mode we
  // built the structural plan to avoid. Detect and fall back to a
  // conservative merge: put every generated block before the user's
  // image blocks, in order. Less elegant but obviously correct.
  if (
    typeof expectedTextCount === "number" &&
    generatedTextish.length !== expectedTextCount
  ) {
    return {
      merged: [...generatedTextish, ...imageSlots],
      warning:
        `GPT returned ${generatedTextish.length} text-shaped blocks; ` +
        `the structure plan asked for ${expectedTextCount}. ` +
        `Generated content placed before your image blocks instead of threaded around them. ` +
        `Drag blocks to rearrange, or regenerate.`,
    };
  }

  const perSegment = Math.max(1, Math.floor(generatedTextish.length / segments));
  const merged = [];
  let cursor = 0;
  for (let s = 0; s < segments; s++) {
    const isLast = s === segments - 1;
    const take = isLast ? generatedTextish.length - cursor : perSegment;
    merged.push(...generatedTextish.slice(cursor, cursor + take));
    cursor += take;
    if (!isLast) merged.push(imageSlots[s]);
  }
  return { merged, warning: null };
}
```

- [ ] **Step 2: Add the modal state + button + apply handler**

Inside the Editor component, add state for `showGenerate`:
```js
  const [showGenerate, setShowGenerate] = useState(false);
```

Add the apply handler:
```js
  function applyGenerated({ hero, generatedBlocks, expectedTextCount }) {
    const { merged, warning } = mergeGeneratedBlocks(
      entry.blocks,
      generatedBlocks,
      expectedTextCount
    );
    setEntry({
      ...entry,
      hero: hero
        ? {
            ...entry.hero,
            eyebrow: hero.eyebrow ?? entry.hero.eyebrow,
            title: hero.title ?? entry.hero.title,
            subtitle: hero.subtitle ?? entry.hero.subtitle,
            byline: hero.byline ?? entry.hero.byline,
            imageAlt: hero.imageAlt ?? entry.hero.imageAlt,
            // layout and images intentionally preserved
          }
        : entry.hero,
      blocks: merged,
    });
    if (warning) {
      // Surface to the user. A toast component would be nicer than alert
      // but keeps zero deps; swap to a non-blocking notice once the
      // editor grows a status bar.
      alert(warning);
    }
  }
```

Add a Generate button to the header (next to Save):
```js
        <button
          onClick={() => setShowGenerate(true)}
          style={{
            background: "linear-gradient(135deg, #6a4ba6, #4a3578)",
            color: "#fff",
            border: "none",
            padding: "6px 14px",
            borderRadius: 4,
            fontSize: 12,
            cursor: "pointer",
            marginRight: 6,
          }}
        >
          ✦ Generate draft
        </button>
```

At the end of the JSX (after the grid `</div>`, before the outermost closing `</div>`), conditionally render the modal:
```js
        {showGenerate && (
          <GenerateModal
            entry={{ ...entry, slug: effectiveSlug }}
            onClose={() => setShowGenerate(false)}
            onApply={applyGenerated}
          />
        )}
```

And add the import at the top:
```js
import GenerateModal from "./GenerateModal.js";
```

- [ ] **Step 3: Manual verification**

Run `npm run dev`. Visit `/admin/editorial/new`. Slug `gpt-test`. In the Blocks section, add a single image block (any filename, doesn't need to exist). Click **Generate draft**. Fill in Designer "Test Designer", set length Short, add one note like "test the structural prompting, make it short". Click Generate. Wait ~20-40s.

Expected: modal closes, blocks list now has GPT-produced text/heading/pullquote blocks threaded around your image block. Preview pane updates.

Verify the text block immediately before your image block ends on a complete sentence (no dangling clause).

Don't save (or save and clean up manually if you want to verify save).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/admin/editorial/[slug]/_components/Editor.js
git commit -m "feat: wire GenerateModal into editor with structure-aware merge"
```

---

## Phase 7: Image filename autocomplete

### Task 24: ImageFilenameInput component + wire-up

**Files:**
- Create: `app/admin/editorial/[slug]/_components/ImageFilenameInput.js`
- Modify: `app/admin/editorial/[slug]/_components/BlockCard.js`
- Modify: `app/admin/editorial/[slug]/_components/HeroPanel.js`

- [ ] **Step 1: Write the component**

Write `app/admin/editorial/[slug]/_components/ImageFilenameInput.js`:
```js
"use client";

import { useEffect, useState } from "react";

const inputStyle = {
  width: "100%",
  background: "#0f0f10",
  border: "1px solid #2a2a2c",
  color: "#e7e7e2",
  padding: "6px 8px",
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "inherit",
};

export default function ImageFilenameInput({ slug, value, onChange, placeholder }) {
  const [files, setFiles] = useState([]);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!slug || slug === "(slug)") return;
    let cancelled = false;
    fetch(`/api/admin/list-files?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setFiles(data.files || []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);

  const matches = focused && value
    ? files.filter((f) => f.toLowerCase().includes(value.toLowerCase())).slice(0, 8)
    : focused ? files.slice(0, 8) : [];

  const hasFile = files.includes(value);

  return (
    <div style={{ position: "relative" }}>
      <input
        style={inputStyle}
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {value && !hasFile && (
        <div style={{ fontSize: 10, color: "#c9806b", marginTop: 3 }}>
          File not found in public/editorial/{slug}/
        </div>
      )}
      {matches.length > 0 && focused && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 2,
            background: "#18181a",
            border: "1px solid #2a2a2c",
            borderRadius: 4,
            zIndex: 5,
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {matches.map((f) => (
            <div
              key={f}
              onClick={() => onChange(f)}
              style={{ padding: "5px 8px", fontSize: 12, cursor: "pointer", color: "#e7e7e2" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2a2c")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {f}
            </div>
          ))}
        </div>
      )}
      {hasFile && (
        <img
          src={`/editorial/${slug}/${value}`}
          alt=""
          style={{ marginTop: 6, maxWidth: 120, maxHeight: 80, objectFit: "cover", borderRadius: 3 }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Use it in BlockCard for image src fields**

In `BlockCard.js`, add the import:
```js
import ImageFilenameInput from "./ImageFilenameInput.js";
```

Modify `BlockCard` to accept a `slug` prop. In the `image` block branch, replace the `<input ... value={block.src}>` with:
```js
<ImageFilenameInput
  slug={slug}
  value={block.src}
  onChange={(v) => update({ src: v })}
  placeholder="filename"
/>
```

In the `image-pair` branch, replace each filename `<input>` with:
```js
<ImageFilenameInput
  slug={slug}
  value={block.images?.[i]?.src ?? ""}
  onChange={(v) => {
    const next = [...(block.images ?? [{}, {}])];
    next[i] = { ...next[i], src: v };
    update({ images: next });
  }}
  placeholder={`image ${i + 1} filename`}
/>
```

- [ ] **Step 3: Pass slug from Editor → BlockCard**

In `Editor.js`, where BlockCard is used, add `slug={effectiveSlug}`:
```js
            <BlockCard
              key={i}
              block={block}
              index={i}
              total={entry.blocks.length}
              slug={effectiveSlug}
              onChange={(next) => updateBlock(i, next)}
              onMoveUp={() => moveBlock(i, -1)}
              onMoveDown={() => moveBlock(i, +1)}
              onDelete={() => deleteBlock(i)}
            />
```

- [ ] **Step 4: Use it for the hero image too**

In `HeroPanel.js`, import ImageFilenameInput. Replace the "Hero image filename" Field's `<input>` with:
```js
<ImageFilenameInput
  slug={slug}
  value={hero.images?.[0] ?? ""}
  onChange={(v) => update({ images: [v] })}
  placeholder="hero image filename"
/>
```

- [ ] **Step 5: Manual verification**

Run `npm run dev`. Visit `/admin/editorial/rick-owens`. Click into the hero image filename field — dropdown should show actual files from `public/editorial/rick-owens/`. Click one; thumbnail appears below.

Add an image block; click into its filename — same dropdown. Type a garbage filename — "File not found" warning appears in red.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/admin/editorial/[slug]/_components/ImageFilenameInput.js \
        app/admin/editorial/[slug]/_components/BlockCard.js \
        app/admin/editorial/[slug]/_components/HeroPanel.js \
        app/admin/editorial/[slug]/_components/Editor.js
git commit -m "feat: image filename autocomplete with thumbnail preview"
```

---

## Phase 8: Curated products picker

### Task 25: `/api/admin/search-products` route

**Files:**
- Create: `app/api/admin/search-products/route.js`

- [ ] **Step 1: Write the route**

Write `app/api/admin/search-products/route.js`:
```js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertDev } from "../_gate.js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const gate = assertDev();
  if (gate) return gate;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ products: [] });
  }

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, handle, store_domain, name, title, brand, price, image_url, store_name, available"
    )
    .eq("available", true)
    .eq("hidden", false)
    .or(`name.ilike.%${q}%,title.ilike.%${q}%,brand.ilike.%${q}%`)
    .limit(30);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ products: data || [] });
}
```

- [ ] **Step 2: Manual verification**

Run `npm run dev`. In another terminal:
```bash
curl -s "http://localhost:3000/api/admin/search-products?q=rick" | head -c 600
```

Expected: JSON `products` array with results (assuming Rick Owens products exist in Supabase).

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/search-products/route.js
git commit -m "feat: admin product search route"
```

---

### Task 26: CuratedProductsPanel + Editor integration

**Files:**
- Create: `app/admin/editorial/[slug]/_components/CuratedProductsPanel.js`
- Modify: `app/admin/editorial/[slug]/_components/Editor.js`

- [ ] **Step 1: Write CuratedProductsPanel**

Write `app/admin/editorial/[slug]/_components/CuratedProductsPanel.js`:
```js
"use client";

import { useEffect, useState } from "react";

const inputStyle = {
  width: "100%",
  background: "#0f0f10",
  border: "1px solid #2a2a2c",
  color: "#e7e7e2",
  padding: "6px 8px",
  borderRadius: 4,
  fontSize: 12,
};

export default function CuratedProductsPanel({ curatedProducts, onChange }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/search-products?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.products || []);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  function add(p) {
    const pair = { storeDomain: p.store_domain, handle: p.handle };
    if (curatedProducts.some((c) => c.storeDomain === pair.storeDomain && c.handle === pair.handle)) return;
    onChange([...curatedProducts, pair]);
  }
  function remove(i) {
    onChange(curatedProducts.filter((_, j) => j !== i));
  }
  function move(i, dir) {
    const next = curatedProducts.slice();
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <section
      style={{
        background: "#18181a",
        border: "1px solid #2a2a2c",
        borderRadius: 6,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b6b6ad", margin: "0 0 12px" }}>
        Curated products ({curatedProducts.length})
      </h3>

      {curatedProducts.map((p, i) => (
        <div
          key={`${p.storeDomain}/${p.handle}`}
          style={{
            display: "flex",
            background: "#0f0f10",
            border: "1px solid #2a2a2c",
            borderRadius: 4,
            padding: "6px 9px",
            marginBottom: 4,
            fontSize: 12,
            alignItems: "center",
          }}
        >
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{ color: "#8a8a80" }}>{p.storeDomain}</span> / {p.handle}
          </span>
          <button onClick={() => move(i, -1)} disabled={i === 0} style={smallBtn}>↑</button>
          <button onClick={() => move(i, +1)} disabled={i === curatedProducts.length - 1} style={smallBtn}>↓</button>
          <button onClick={() => remove(i)} style={{ ...smallBtn, color: "#c9806b" }}>×</button>
        </div>
      ))}

      <input
        style={{ ...inputStyle, marginTop: 8 }}
        placeholder="Search products by name, title, or brand…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {searching && <div style={{ fontSize: 11, color: "#8a8a80", marginTop: 4 }}>Searching…</div>}
      {results.length > 0 && (
        <div style={{ marginTop: 6, maxHeight: 240, overflowY: "auto", border: "1px solid #2a2a2c", borderRadius: 4 }}>
          {results.map((p) => (
            <div
              key={`${p.store_domain}/${p.handle}`}
              onClick={() => add(p)}
              style={{ display: "flex", padding: "6px 8px", fontSize: 12, cursor: "pointer", alignItems: "center", gap: 8 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2a2c")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ flex: 1 }}>
                <span style={{ color: "#e7e7e2" }}>{p.title || p.name}</span>
                <span style={{ color: "#8a8a80", marginLeft: 6 }}>· {p.brand || "—"}</span>
              </span>
              <span style={{ color: "#6b6b62", fontSize: 10 }}>{p.store_domain}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const smallBtn = {
  background: "transparent",
  border: "1px solid #2a2a2c",
  color: "#b6b6ad",
  width: 22,
  height: 22,
  borderRadius: 3,
  fontSize: 11,
  cursor: "pointer",
  marginLeft: 4,
};
```

- [ ] **Step 2: Wire into Editor**

In `Editor.js`, import:
```js
import CuratedProductsPanel from "./CuratedProductsPanel.js";
```

Add a handler:
```js
function updateCurated(curatedProducts) { setEntry({ ...entry, curatedProducts }); }
```

Render it inside the left column (between the Hero section and the Blocks section, or after Blocks — author preference):
```js
<CuratedProductsPanel
  curatedProducts={entry.curatedProducts}
  onChange={updateCurated}
/>
```

- [ ] **Step 3: Manual verification**

Run `npm run dev`. Visit `/admin/editorial/rick-owens`. Confirm the curated products section shows the existing stub products. Type "rick" in the search — results appear. Click one to add (or attempt to: stub products may not match real Supabase data). Try removing a product, reordering. Save and check the resulting JS file.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/admin/editorial/[slug]/_components/CuratedProductsPanel.js \
        app/admin/editorial/[slug]/_components/Editor.js
git commit -m "feat: curated products picker with Supabase search"
```

---

## Phase 9: Today's Edit

### Task 27: Initial homepage-edit.json file + shared loader

**Files:**
- Create: `content/homepage-edit.json`
- Create: `app/lib/loadHomepagePicks.js`

**Why JSON, not a JS module:** A static `import` of a `.js` content module evaluates at module-load time. A truncated write, syntax error, or bad manual edit would crash `app/page.js` in *production*, defeating the documented "fall back to date-seeded rotation" invariant. JSON is parsed at runtime inside a try/catch — failures are catchable.

- [ ] **Step 1: Create the empty JSON file**

Write `content/homepage-edit.json`:
```json
[]
```

That's the entire file — a JSON array literal, nothing else. The schema is `[{ "storeDomain": string, "handle": string }, ...]`.

- [ ] **Step 2: Create the shared loader**

Write `app/lib/loadHomepagePicks.js`:
```js
import { promises as fs } from "node:fs";
import { join } from "node:path";

const PICKS_FILE = join(process.cwd(), "content", "homepage-edit.json");

// Loads the hand-curated homepage picks. Returns [] on:
//   - file missing (ENOENT)
//   - empty file or empty array
//   - malformed JSON
//   - non-array root (e.g. an object got written by mistake)
//   - any individual pick missing storeDomain/handle
//
// The homepage uses [] as the signal to fall back to the date-seeded
// rotation. Never throw from this function — production homepage rendering
// depends on it being infallible.
export async function loadHomepagePicks() {
  let raw;
  try {
    raw = await fs.readFile(PICKS_FILE, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(`[loadHomepagePicks] read failed: ${err.message}`);
    }
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[loadHomepagePicks] JSON.parse failed: ${err.message}`);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn("[loadHomepagePicks] expected array, got", typeof parsed);
    return [];
  }

  // Filter out malformed entries rather than throwing — one bad row
  // shouldn't kill the whole list.
  return parsed.filter(
    (p) =>
      p &&
      typeof p.storeDomain === "string" &&
      typeof p.handle === "string"
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add content/homepage-edit.json app/lib/loadHomepagePicks.js
git commit -m "feat: homepage-edit.json + infallible loadHomepagePicks helper"
```

---

### Task 28: `fetchHomepagePicks` helper

**Files:**
- Create: `app/editorial/_lib/fetchHomepagePicks.js`

Mirrors the chunked `.in()` + `orderIndex` Map pattern from `fetchEditorialProducts.js`. Returns the 8 (or fewer) curated picks, preserving the order from the picks file.

- [ ] **Step 1: Read fetchEditorialProducts to mirror its pattern**

Read `app/editorial/_lib/fetchEditorialProducts.js`. Note the helpers it uses: `chunkArray`, the orderIndex Map, the `select` field list, the `.eq("available", true).eq("hidden", false)` filters.

- [ ] **Step 2: Write the helper**

Write `app/editorial/_lib/fetchHomepagePicks.js`:
```js
import { createClient } from "@supabase/supabase-js";
import { chunkArray } from "../../lib/chunk.js";

function pairKey(p) {
  return `${p.storeDomain}::${p.handle}`;
}

export async function fetchHomepagePicks(picks, { client } = {}) {
  if (!picks || picks.length === 0) return [];

  const supabase =
    client ||
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

  const orderIndex = new Map(picks.map((p, i) => [pairKey(p), i]));

  // Group handles by store_domain.
  const byStore = new Map();
  for (const p of picks) {
    if (!byStore.has(p.storeDomain)) byStore.set(p.storeDomain, []);
    byStore.get(p.storeDomain).push(p.handle);
  }

  const all = [];
  for (const [storeDomain, handles] of byStore) {
    for (const chunk of chunkArray(handles, 100)) {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, handle, store_domain, name, title, brand, price, image_url, store_name, product_url, available"
        )
        .eq("store_domain", storeDomain)
        .eq("available", true)
        .eq("hidden", false)
        .in("handle", chunk);
      if (error) {
        console.warn(`[fetchHomepagePicks] ${storeDomain}: ${error.message}`);
        continue;
      }
      all.push(...(data || []));
    }
  }

  all.sort((a, b) => {
    const ai = orderIndex.get(`${a.store_domain}::${a.handle}`) ?? 1e9;
    const bi = orderIndex.get(`${b.store_domain}::${b.handle}`) ?? 1e9;
    return ai - bi;
  });

  return all.slice(0, 8);
}
```

- [ ] **Step 3: Commit**

```bash
git add app/editorial/_lib/fetchHomepagePicks.js
git commit -m "feat: fetchHomepagePicks helper for curated Today's Edit"
```

---

### Task 29: `/api/admin/save-homepage-edit` route

**Files:**
- Create: `app/api/admin/save-homepage-edit/route.js`

- [ ] **Step 1: Write the route**

Write `app/api/admin/save-homepage-edit/route.js`:
```js
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { assertDev } from "../_gate.js";

export async function POST(request) {
  const gate = assertDev();
  if (gate) return gate;

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.picks)) {
    return NextResponse.json({ error: "expected { picks: [] }" }, { status: 400 });
  }
  if (body.picks.length > 8) {
    return NextResponse.json({ error: "max 8 picks" }, { status: 400 });
  }
  // Normalize and validate. Only `storeDomain` and `handle` make it into
  // the file — anything else the client sent (e.g. a `_preview` cache) is
  // stripped here so it never appears on disk.
  const normalized = [];
  for (const p of body.picks) {
    if (!p || typeof p.storeDomain !== "string" || typeof p.handle !== "string") {
      return NextResponse.json(
        { error: "each pick must be { storeDomain: string, handle: string }" },
        { status: 400 }
      );
    }
    normalized.push({ storeDomain: p.storeDomain, handle: p.handle });
  }

  const file = join(process.cwd(), "content", "homepage-edit.json");
  const tmpFile = `${file}.tmp.${process.pid}.${Date.now()}`;

  // Atomic write: serialize → write to tmp → fsync via flush → rename.
  // fs.rename on POSIX is atomic for paths on the same filesystem, so
  // app/page.js's loadHomepagePicks() can never read a half-written file.
  // Prevents the truncated-file production crash that prompted moving
  // from `.js` to `.json`.
  const json = JSON.stringify(normalized, null, 2) + "\n";
  try {
    await fs.writeFile(tmpFile, json, "utf8");
    await fs.rename(tmpFile, file);
  } catch (err) {
    // Best-effort cleanup if rename failed and tmp file lingers.
    await fs.unlink(tmpFile).catch(() => {});
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: normalized.length });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/save-homepage-edit/route.js
git commit -m "feat: save-homepage-edit route"
```

---

### Task 30: `/admin/homepage-edit` page

**Files:**
- Create: `app/admin/homepage-edit/page.js`
- Create: `app/admin/homepage-edit/_components/PicksEditor.js`

- [ ] **Step 1: Write the server page**

Write `app/admin/homepage-edit/page.js`:
```js
import { loadHomepagePicks } from "../../lib/loadHomepagePicks.js";
import PicksEditor from "./_components/PicksEditor.js";

export default async function HomepageEditPage() {
  const picks = await loadHomepagePicks();
  return <PicksEditor initialPicks={picks} />;
}
```

The shared `loadHomepagePicks` helper handles missing-file, malformed-JSON, and bad-row cases — the page never crashes on a bad save.

- [ ] **Step 2: Write the client editor**

Write `app/admin/homepage-edit/_components/PicksEditor.js`:
```js
"use client";

import { useEffect, useState } from "react";

const inputStyle = {
  width: "100%",
  background: "#0f0f10",
  border: "1px solid #2a2a2c",
  color: "#e7e7e2",
  padding: "6px 8px",
  borderRadius: 4,
  fontSize: 12,
};

export default function PicksEditor({ initialPicks }) {
  const [picks, setPicks] = useState(initialPicks);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const h = setTimeout(async () => {
      const res = await fetch(`/api/admin/search-products?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data.products || []);
    }, 300);
    return () => clearTimeout(h);
  }, [query]);

  function add(p) {
    if (picks.length >= 8) return;
    if (picks.some((c) => c.storeDomain === p.store_domain && c.handle === p.handle)) return;
    setPicks([...picks, { storeDomain: p.store_domain, handle: p.handle, _preview: p }]);
  }
  function remove(i) { setPicks(picks.filter((_, j) => j !== i)); }
  function move(i, dir) {
    const next = picks.slice();
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setPicks(next);
  }
  async function save() {
    setSaving(true);
    const payload = picks.map((p) => ({ storeDomain: p.storeDomain, handle: p.handle }));
    const res = await fetch("/api/admin/save-homepage-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picks: payload }),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) alert(`Save failed: ${data.error || res.status}`);
    else alert(`Saved ${data.count} pick(s) → content/homepage-edit.json`);
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <header style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 400, margin: 0 }}>Today's Edit</h1>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8a8a80" }}>{picks.length}/8 picks</span>
        <button
          onClick={save}
          disabled={saving}
          style={{
            marginLeft: 12,
            background: "#d6d2c4",
            color: "#18181a",
            border: "none",
            padding: "6px 14px",
            borderRadius: 4,
            fontSize: 12,
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      <section style={{ background: "#18181a", border: "1px solid #2a2a2c", borderRadius: 6, padding: 14, marginBottom: 14 }}>
        <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b6b6ad", margin: "0 0 10px" }}>
          Current picks
        </h3>
        {picks.length === 0 && <div style={{ fontSize: 12, color: "#8a8a80" }}>No picks yet — homepage will fall back to the date-seeded rotation.</div>}
        {picks.map((p, i) => (
          <div
            key={`${p.storeDomain}/${p.handle}`}
            style={{
              display: "flex",
              alignItems: "center",
              background: "#0f0f10",
              border: "1px solid #2a2a2c",
              borderRadius: 4,
              padding: "6px 9px",
              marginBottom: 4,
              fontSize: 12,
              gap: 8,
            }}
          >
            <span style={{ flex: 1 }}>
              <span style={{ color: "#8a8a80" }}>{p.storeDomain}</span> / {p.handle}
            </span>
            <button onClick={() => move(i, -1)} disabled={i === 0} style={smallBtn}>↑</button>
            <button onClick={() => move(i, +1)} disabled={i === picks.length - 1} style={smallBtn}>↓</button>
            <button onClick={() => remove(i)} style={{ ...smallBtn, color: "#c9806b" }}>×</button>
          </div>
        ))}
      </section>

      <section style={{ background: "#18181a", border: "1px solid #2a2a2c", borderRadius: 6, padding: 14 }}>
        <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#b6b6ad", margin: "0 0 10px" }}>
          Search products
        </h3>
        <input
          style={inputStyle}
          placeholder="Name, title, or brand…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length > 0 && (
          <div style={{ marginTop: 6, maxHeight: 280, overflowY: "auto", border: "1px solid #2a2a2c", borderRadius: 4 }}>
            {results.map((p) => (
              <div
                key={`${p.store_domain}/${p.handle}`}
                onClick={() => add(p)}
                style={{ display: "flex", padding: "6px 8px", fontSize: 12, cursor: "pointer", alignItems: "center", gap: 8 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2a2c")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {p.image_url && (
                  <img src={p.image_url} alt="" style={{ width: 32, height: 40, objectFit: "cover", borderRadius: 2 }} />
                )}
                <span style={{ flex: 1 }}>
                  <span style={{ color: "#e7e7e2" }}>{p.title || p.name}</span>
                  <span style={{ color: "#8a8a80", marginLeft: 6 }}>· {p.brand || "—"}</span>
                </span>
                <span style={{ color: "#6b6b62", fontSize: 10 }}>{p.store_domain}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const smallBtn = {
  background: "transparent",
  border: "1px solid #2a2a2c",
  color: "#b6b6ad",
  width: 22,
  height: 22,
  borderRadius: 3,
  fontSize: 11,
  cursor: "pointer",
};
```

- [ ] **Step 3: Manual verification**

Run `npm run dev`. Visit `/admin/homepage-edit`. Search "owens" — confirm results appear. Click to add 1-2 products. Save. Confirm `content/homepage-edit.json` now contains a JSON array with those picks (and only `storeDomain` + `handle` keys — any client-side `_preview` cache should be stripped).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/admin/homepage-edit/page.js app/admin/homepage-edit/_components/PicksEditor.js
git commit -m "feat: /admin/homepage-edit page"
```

---

### Task 31: Modify `app/page.js` to read picks with fallback

**Files:**
- Modify: `app/page.js`

- [ ] **Step 1: Read the current rotation logic**

Read `app/page.js` lines 1-50 first to confirm imports, then lines 84-116 for the rotation block. Note exactly which variables (`recentProducts`, `STORES`, `baseUrl`, `seed`) the existing code uses.

- [ ] **Step 2: Add the imports**

At the top of `app/page.js`, add:
```js
import { fetchHomepagePicks } from "./editorial/_lib/fetchHomepagePicks.js";
import { loadHomepagePicks } from "./lib/loadHomepagePicks.js";
```

**Do NOT add `import homepagePicks from "../content/homepage-edit.js"` or any static import of the picks data.** A static import evaluates at module-load time; any syntax error in the picks file would crash `app/page.js` in production before the runtime try/catch could rescue it. The rule (invariant #6) is: read picks dynamically inside try/catch.

- [ ] **Step 3: Try picks first, fall back to rotation**

Locate the existing `recentProducts` initialization (around lines 17–36 — the `STORES.map(async (store) => …)` block). Replace the existing block (the `const perStore = await Promise.all(...)` through `recentProducts = perStore.flat().filter(Boolean).slice(0, 8);`) with:

```js
let recentProducts = [];

// loadHomepagePicks is infallible — it returns [] on any read/parse
// failure rather than throwing. The try/catch around fetchHomepagePicks
// catches downstream Supabase failures only.
const homepagePicks = await loadHomepagePicks();
if (homepagePicks.length > 0) {
  try {
    recentProducts = await fetchHomepagePicks(homepagePicks);
  } catch (err) {
    console.warn("[homepage] fetchHomepagePicks failed, falling back:", err.message);
  }
}

if (recentProducts.length === 0) {
  // Existing date-seeded rotation — preserves current behavior when
  // no picks have been curated OR when the picks file is unreadable.
  const perStore = await Promise.all(
    STORES.map(async (store) => {
      const res = await fetch(
        `${baseUrl}/api/products?limit=20&store=${store.domain}&sort=newest`,
        { next: { revalidate: 3600 } }
      );
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      const products = data.products ?? [];
      if (products.length === 0) return [];
      const idx = seed % products.length;
      return [products[idx]];
    })
  );
  recentProducts = perStore.flat().filter(Boolean).slice(0, 8);
}
```

Verify the field-name mapping: `fetchHomepagePicks` returns Supabase rows with `store_domain`, `image_url`, etc. (snake_case). The existing card component on `app/page.js` may expect camelCase. **Check `app/page.js`** to see how `recentProducts` is consumed downstream, and either rename fields in `fetchHomepagePicks` or in `page.js` to match. Whichever is simpler. The plan defaults to renaming inside `fetchHomepagePicks` if the card consumer expects camelCase (it likely does — see ProductCard.js requirements).

If renaming is needed: in `app/editorial/_lib/fetchHomepagePicks.js`, add a final mapping step before `return all.slice(0, 8)`:
```js
return all
  .slice(0, 8)
  .map((p) => ({
    id: p.id,
    handle: p.handle,
    storeDomain: p.store_domain,
    name: p.name,
    title: p.title,
    brand: p.brand,
    price: p.price,
    imageUrl: p.image_url,
    storeName: p.store_name,
    productUrl: p.product_url,
    available: p.available,
  }));
```

- [ ] **Step 4: Manual verification with picks**

Run `npm run dev`. Curate 2-3 picks via `/admin/homepage-edit`. Visit `/`. Confirm "Today's Edit" shows those exact products in that exact order.

- [ ] **Step 5: Manual verification with fallback (empty picks)**

Edit `content/homepage-edit.json` and set its content to `[]`. Visit `/`. Confirm the date-seeded rotation kicks back in (you'll see 1 newest product per store).

- [ ] **Step 6: Regression test — homepage survives a malformed picks file**

This is the bug the JSON-over-JS switch was designed to prevent. Write garbage into the picks file and confirm the homepage renders the fallback rather than crashing:

```bash
echo "this is not valid json {{" > content/homepage-edit.json
```

Visit `http://localhost:3000/`. Expected:
- Page returns 200 (NOT a 500 error)
- "Today's Edit" section renders with the date-seeded rotation
- Server console shows `[loadHomepagePicks] JSON.parse failed: …` warning

Now corrupt it differently — an object instead of an array:
```bash
echo '{"oops": "wrong shape"}' > content/homepage-edit.json
```

Refresh `/`. Expected:
- Page returns 200
- Fallback rotation still appears
- Console shows `[loadHomepagePicks] expected array, got object`

Restore:
```bash
echo "[]" > content/homepage-edit.json
```

If the page 500s in any of those cases, something in `app/page.js` is still throwing — most likely a static import of the picks file slipped through. Search for `import .* homepage-edit` and remove it.

- [ ] **Step 7: Commit**

```bash
git add app/page.js app/editorial/_lib/fetchHomepagePicks.js
git commit -m "feat: homepage reads hand-curated picks with rotation fallback"
```

---

## Phase 10: Polish + final verification

### Task 32: Update CLAUDE.md with the admin tool

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add "Sharp edges" entries and invariants**

In `CLAUDE.md`, locate the "Sharp edges" section. Append a bullet:

```markdown
- **Admin tool is local-only.** `/admin/*` and `/api/admin/*` return 404 in
  production via `middleware.js`. Tool runs only during `npm run dev`,
  writes to the filesystem (`content/editorial/<slug>.js` + auto-patched
  `content/editorial/index.js`, or `content/homepage-edit.json`). Editorial
  drafting via OpenAI lives in `app/lib/draftEditorialPrompt.js`, shared
  by `scripts/draftEditorial.mjs` (CLI) and `/api/admin/draft`. If you
  rename the `ENTRIES` constant in `content/editorial/index.js`, update
  `app/lib/patchEditorialIndex.js`'s anchor regex too.
- **`loadSource` defaults to `allowFiles: false`.** The shared draft helper
  treats non-HTTP values as inline text unless the caller explicitly opts
  in. Only the CLI opts in. **Never pass `allowFiles: true` from an HTTP
  route** — request-controlled paths could read `.env.local` and
  exfiltrate the contents through the OpenAI prompt (DNS rebind / hostile
  local process). Documented as invariant #9 of the editorial-admin plan.
```

In the "Invariants" section, append:

```markdown
- **Homepage picks are stored as JSON, loaded dynamically, with a runtime
  fallback to the date-seeded rotation.** `content/homepage-edit.json` is
  read by `app/lib/loadHomepagePicks.js` via `fs.readFile` + `JSON.parse`
  inside try/catch. Returns `[]` on any read/parse failure. Never `import`
  the picks file statically — a syntax error would crash production
  homepage rendering before the fallback could trigger.
- **`save-homepage-edit` writes atomically.** Serialize → write to
  `homepage-edit.json.tmp.<pid>.<ts>` → `fs.rename` to the final path.
  Prevents truncated files crashing the homepage during a mid-write
  interruption.
- **Editorial save rollback is asymmetric.** If `<slug>.js` writes but
  `index.js` patch fails AND the slug file did not exist before this
  save, the slug file is unlinked. For existing entries, no rollback —
  prior content is already overwritten.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note admin tool + homepage fallback invariant in CLAUDE.md"
```

---

### Task 33: End-to-end verification

- [ ] **Step 1: Run all unit tests**

Run:
```bash
npm test
```

Expected: all tests pass (`draftEditorialPrompt`, `serializeEditorialModule`, `patchEditorialIndex`, `structurePlan`).

- [ ] **Step 2: Production-mode gate check**

Run:
```bash
npm run build
NODE_ENV=production npm run start &
sleep 3
curl -s -o /dev/null -w "/admin → %{http_code}\n" http://localhost:3000/admin
curl -s -o /dev/null -w "/admin/editorial → %{http_code}\n" http://localhost:3000/admin/editorial
curl -s -o /dev/null -w "/admin/homepage-edit → %{http_code}\n" http://localhost:3000/admin/homepage-edit
curl -s -o /dev/null -w "/api/admin/save → %{http_code}\n" http://localhost:3000/api/admin/save
kill %1
```

Expected: all four print `404`.

- [ ] **Step 3: Full dev e2e flow**

Run `npm run dev`. Walk through this sequence:

1. Navigate to `/admin/editorial` — see existing entries listed.
2. Click "+ New entry," slug `e2e-test`.
3. Drop a real test image into `public/editorial/e2e-test/` (or use an existing image from `public/editorial/rick-owens/` copied over).
4. In the editor: set title "E2E Test," fill subtitle, pick hero image from the autocomplete dropdown. Add one image block (full-bleed) using the autocomplete. Place it between two empty text-block stubs.
5. Click **Generate draft**: title "E2E Test," length Short, add one note "Test the structural prompting." Click Generate. Wait for response.
6. After generation: verify text blocks before and after your image block each end on a complete sentence.
7. Edit one paragraph manually. Add a pullquote. Reorder a block.
8. Click **Save**. Confirm alert: `Saved content/editorial/e2e-test.js (+ index.js)`.
9. Verify `content/editorial/e2e-test.js` exists with the expected shape.
10. Verify `content/editorial/index.js` has `import e2eTest from "./e2e-test.js";` and `e2eTest` in `ENTRIES`.
11. Visit `/editorial/e2e-test` — page renders end-to-end.
12. Navigate to `/admin/homepage-edit`. Search a real product. Add 2-3 to picks. Save.
13. Visit `/` — confirm "Today's Edit" shows the curated picks.
14. Set `content/homepage-edit.json` to `[]`. Visit `/` — confirm rotation fallback kicks in.
14b. **Regression check (the JSON-over-JS switch):** corrupt the picks file with `echo "not json" > content/homepage-edit.json`, visit `/`, confirm it still returns 200 with the rotation fallback. Restore to `[]` afterward.
15. Clean up: remove `content/editorial/e2e-test.js`, remove `e2e-test` import/entry from `index.js`, remove `public/editorial/e2e-test/`, reset picks.

- [ ] **Step 4: Final commit (only if Step 1-3 surfaced fixes)**

If any of the verification steps needed code changes, commit them. Otherwise, no commit needed — the tool is verified working.

---

## Self-Review Notes

(For the agent before handing off — verify each before declaring done.)

- **Spec coverage:** Each of the six design pieces from the brainstorm maps to tasks: routing/gating → Tasks 5-6, editor pane → 11-18, GPT draft → 20-23, save flow → 19, Today's Edit → 27-31, image handling → 24.
- **Placeholder scan:** Every code step has full code. The one judgment call is in Task 13 (PreviewPane) where the engineer must inspect Block.js first to confirm client-component compatibility; the fallback path (ClientBlock.js) is documented in the same task.
- **Type consistency:** `entry`, `hero`, `block`, `curatedProducts: [{storeDomain, handle}]`, `picks: [{storeDomain, handle}]` — consistent across all tasks. `BlockCard` accepts `slug` prop (added in Task 24 — verify Editor.js wiring updated in same task).
- **Field-name caveat:** `fetchHomepagePicks` returns snake_case from Supabase; Task 31 Step 3 includes the camelCase mapping. Verify `app/page.js`'s downstream consumer matches.
- **Idempotency:** Save (`patchEditorialIndex`) and Generate (preserves user-placed image blocks) are both idempotent / non-destructive in the documented sense.
