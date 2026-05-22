# Refactor execution plan: Top 5 + warm-up

## Context

A two-pass audit (initial Claude pass + Codex rescue review) of the Dépôt
codebase identified five concrete refactor candidates plus one zero-risk
warm-up. The work targets duplication that causes silent failures when product
data contracts change: row mapping drift across 5 surfaces, a visibility filter
(`available + !hidden`) repeated in 6 places, an RPC signature drift between
`/api/products` and `fetchEditorialProducts`, a 700-line `stores.js` doing five
unrelated jobs, and the PDP page mixing a Shopify live-fetch + OpenAI
generate + Supabase write-back with rendering.

The goal is to lock the documented invariants from `CLAUDE.md` (visibility
filter, editorial COALESCE, RPC return contract) into shared code paths so
they survive future churn — without changing any user-visible behavior.

**Strategy decision: ship as 6 separate PRs, not one stack.**

Reasoning:
- `CLAUDE.md` mandates "Branch + Vercel preview every change." A single PR
  makes preview verification impossible.
- The candidates have heterogeneous blast radii: #5 touches only PDP, #4
  touches enrich + cron + feed + product page. Bundling means a bug in #4
  blocks shipping #5.
- Each refactor has different verification surfaces (PDP render, feed JSON
  diff, cron dry-run, enrich batch counts). Reviewers can only hold one
  surface in their head at a time.
- Sequencing matters: #3 must close the RPC drift window before #1 reshapes
  the row-mapping surface; #2 must centralize the visibility helper before #1
  starts using it. A single PR loses that ordering.
- Reversibility: if #4 (the stores.js split) introduces a subtle enrich
  regression, reverting one PR is trivial; unwinding it from a 5-refactor
  combined PR is not.

**Why option "Top 5 + warm-up" and not "Top 5 + Codex extras":** the Codex-
flagged extras (FeedClient pagination math, ProductCard analytics-only client
boundary, hide-update silent failures, admin `new Function` consolidation) are
real findings but architecturally heterogeneous from the Top 5. Some carry
policy questions (does ProductCard becoming a server component change
hover/focus behavior?). They deserve their own tickets, not a checkbox in a
refactor stack already long enough to fatigue review. The dead-code warm-up,
by contrast, is genuinely zero-risk and removes the "wait, which classifier is
live?" confusion before #4 touches `stores.js`'s real classifier.

## Pre-execution: branch posture

Origin currently sits on `main` with unrelated working-tree changes (one
staged `scripts/backfillTitles.mjs`, three deleted worktree dirs, untracked
`.codex/`, `.mcp.json`, `scripts/test-upsert-price.mjs`). Before PR 0:

- Stash or commit the unrelated work on a separate branch — do not let it
  ride along with refactor PRs.
- Create the first branch off a clean `main`. Each subsequent PR branches
  off `main` after the previous one merges, not off the previous branch.
  This keeps the Vercel preview signal clean per PR.

## PR 0 — Delete dead `classifyProduct`

**Why:** Verified zero callers (`grep -rn 'classifyProduct\b'` returns only
the definition). Removing it shrinks `feed-utils.js`, removes a second
keyword-based classifier that competes mentally with the live one in
`stores.js`, and warms the review loop with a trivially-correct PR.

**Files:**
- `app/lib/feed-utils.js` — remove `classifyProduct` (line 96), plus the
  unused keyword arrays it depends on (`BAG_KEYWORDS`, `ACCESSORY_KEYWORDS`,
  `TOPS_KEYWORDS`, `BOTTOMS_KEYWORDS`, `JACKETS_COATS_KEYWORDS`,
  `DRESSES_SKIRTS_KEYWORDS`, `TOPS_HOODIES_SWEATERS_KEYWORDS`,
  `TOPS_SHIRTS_BLOUSES_KEYWORDS`, `TOPS_TEES_KEYWORDS`,
  `TOPS_KNITWEAR_KEYWORDS`, `JACKETS_KEYWORDS`, `COATS_KEYWORDS`,
  `FOOTWEAR_KEYWORDS`), and helpers `containsAnyKeyword`, `hasSetsKeyword`
  if no longer referenced.
- Keep `normalizeText`, `extractBrandTags`, `ALL_STORES_VALUE`, `PAGE_SIZE`,
  `buildFeedUrl`, `buildFreshFeedUrl` — all have live callers.

**Verification:**
- `grep -rn 'classifyProduct\|BAG_KEYWORDS\|TOPS_KEYWORDS' app/` returns no
  hits after the change.
- `npm test` and `npm run build` green.
- Vercel preview: smoke-test `/feed` default + one filtered URL.

---

## PR 1 — Close the `get_interleaved_products` RPC contract drift (was #3)

**Why:** The drift between callers is currently safe because the SQL has
`p_subcategory text DEFAULT NULL` at
`scripts/sql/2026-05-21-interleaved-rpcs.sql:20`. But the next person to
change the RPC signature will hit only one of the two callers, and the
editorial surface (`fetchEditorialProducts`) will silently return wrong
results — RPC errors at the PostgREST layer surface as `data: null` to the
caller, which the helper logs and returns `[]` from. This is exactly the
"invisible failure" CLAUDE.md is full of warnings about.

**Approach:** Co-locate the RPC parameter shape and column contract in one
module so both callers reference the same surface.

**Files:**
- New `app/lib/productQueries.js` exporting:
  - `INTERLEAVED_RPC_RETURN_COLUMNS` — the columns the RPC must return
    (includes `name`, per CLAUDE.md invariant). A const + a code comment
    citing the SQL line as source of truth.
  - `fetchInterleavedProducts({ store, category, subcategory, search, brand, limit, offset })`
  - `countInterleavedProducts({ store, category, subcategory, search, brand })`
- `app/api/products/route.js` — swap both `supabase.rpc(...)` calls (lines
  75 and 84) for the new helpers.
- `app/editorial/_lib/fetchEditorialProducts.js` — swap the `client.rpc(...)`
  call (line 76) for the new helper. This is also where the drift gets
  closed: the helper passes `p_subcategory: null` for editorial callers that
  don't supply one.

**Verification:**
- JSON-diff `/feed`, `/feed?store=…`, `/feed?brand=…`, `/feed?search=…`,
  `/feed?category=tops` against production. Zero diff expected.
- Editorial entry pages: curated grid + "more from designer" rail still
  populate with identical ordering. Compare against a known entry on
  production.
- Confirm no Supabase RPC error in logs during preview test runs.

---

## PR 2 — Visibility filter helper (was #2)

**Why:** `.eq("available", true).eq("hidden", false)` appears in 6 places.
CLAUDE.md names this an invariant precisely because it's repeated. Lock it
into one helper so a future visibility rule (e.g., `archived = false`) is a
one-line change.

**Approach:** Single helper in `productQueries.js` (from PR 1) that takes a
Supabase query builder and applies the visibility filter, OR a higher-level
`visibleProductsQuery(client)` factory that returns a pre-filtered query.

**Files:**
- `app/lib/productQueries.js` — add `withVisibility(query)` (preferred —
  composes with existing query chains).
- `app/api/products/route.js` — both `.eq("available", true).eq("hidden", false)`
  pairs (lines 128–129 and 174–175) call `withVisibility`.
- `app/components/MoreFromStore.js` — same swap at lines 9–10.
- `app/editorial/_lib/fetchEditorialProducts.js` — same swap at lines 52–53.
- `app/api/enrich/route.js` — both occurrences at lines 95–96 and 311–312.

**Open policy question (NOT a code change in this PR):** PDP at
`app/product/[handle]/page.js` does NOT filter `hidden` on its Supabase
read at lines 82–87. A hidden product linked directly is still browsable.
Whether to gate the PDP on `hidden = false` is a product policy call, not
a refactor. Surface this to the user as a separate ticket once this PR
lands. **Do not bundle the policy change into this PR.**

**Verification:**
- Pick one product, set `hidden = true` via Supabase SQL Editor. Hit `/feed`,
  `/feed?store=<its-store>`, the editorial entries it appears in, PDP's
  "More from store" rail (open a different product in the same store) —
  none should render it. Direct PDP URL: still renders (intentional, see
  open policy question).
- Revert. Confirm reappearance everywhere.
- Run enrich against a tiny batch (`scripts/test-enrich.mjs`); row counts
  match baseline.

---

## PR 3 — Centralize product row select + mapper (was #1)

**Why:** Five mapping sites (`/api/products/route.js` lines 99, 152, 196;
`fetchEditorialProducts.js` line 11; `MoreFromStore.js` line 19) with three
drifted SELECT-column strings. Builds on PR 2's helper: the new query
builder + the new mapper are colocated, so every product read goes through
one shape contract.

**Approach:**
- New module exporting `PRODUCT_ROW_SELECT` and `mapProductRow(row)`.
- One variant or one option for "include category/subcategory" — feed needs
  it, MoreFromStore doesn't. Either a second constant
  (`PRODUCT_ROW_SELECT_WITH_CATEGORY`) or an option arg on the mapper.
  Decide during implementation; either is fine, but pick one and stick.

**Files:**
- `app/lib/productQueries.js` — add `PRODUCT_ROW_SELECT`, optional
  `PRODUCT_ROW_SELECT_WITH_CATEGORY`, `mapProductRow(row)`.
- `app/api/products/route.js` — replace `selectCols` (line 120) and three
  inline map blocks (99, 152, 196).
- `app/editorial/_lib/fetchEditorialProducts.js` — replace `ROW_SELECT`
  (line 8) and `mapRow` (line 11).
- `app/components/MoreFromStore.js` — replace inline select (line 7) and
  inline mapping (line 19).

**Verification:**
- JSON-diff `/feed` (all sort variants), editorial entries, and PDP "More
  from store" rail before/after. Zero diff expected.
- Run existing tests under `tests/lib/` and `app/lib/__tests__/`.

---

## PR 4 — Extract PDP description + Shopify fetch (was #5)

**Why:** `app/product/[handle]/page.js` mixes a Shopify live-fetch
(`getProduct`, lines 11–23), three orphan helpers (`stripHtml`, `nonEmpty`,
`formatSizes`, lines 25–45), and a description fetch/generate/cache-back
pattern (lines 108–124) into a page component. This is the last meaningful
piece of "old Shopify-live-fetch architecture" still entangled with
rendering. Extracting it makes the contract visible and testable.

**Approach:** New `app/lib/resolveProductDetail.js` exposing one function
that returns the resolved product detail (Shopify product, normalized
images/variants/sizes/price, brand/title/storeName with Supabase overlay,
description with cache-back). Page component becomes pure rendering.

**Files:**
- New `app/lib/resolveProductDetail.js`.
- `app/product/[handle]/page.js` — remove `getProduct`, `stripHtml`,
  `nonEmpty`, `formatSizes`, and the description fetch/cache block.
  Call the new resolver; render its result.

**Behavioral preservation (must remain identical):**
- Product-not-found path: render "Product not found." (current behavior at
  page line 58).
- Cache-back write failure is still swallowed silently — page still renders
  with the generated description.
- `?available=false` still shows the "Sold" badge.

**Verification:**
- PDP for a product with cached `editorial_description`: renders, no
  Supabase write (check Supabase logs for the product row).
- PDP for a product with null `editorial_description`: renders, Supabase
  row gets the generated string (verify via Supabase Table editor).
- PDP for a Shopify-404 handle: still shows "Product not found."
- PDP with `?available=false`: still shows "Sold."

---

## PR 5 — Split `app/lib/stores.js` (was #4)

**Why:** 700 lines bundling brand allowlist + `brandFromHandle` +
`normalizeBrand`, self-branded store config + `isSelfBranded`, fallback
stores + Supabase loaders + `mapStoreRow`, category classifier
(`tryClassify` + `assignCategory`), Shopify normalization + pagination +
`fetchStoreProducts`. Different cadences, different callers, different
review contexts. Splitting last means PRs 1–4 are already in production
and providing test signal; any incidental breakage from the move is easier
to bisect.

**Approach:** Pure mechanical move. For one release cycle, `stores.js`
re-exports the moved symbols so callers don't all change at once. After
that cycle, sweep imports.

**Files:**
- New `app/lib/brand.js` — `normalizeBrand`, brand allowlist, `brandFromHandle`.
- New `app/lib/selfBranded.js` — `SELF_BRANDED_STORES`, `isSelfBranded`.
- New `app/lib/category-classifier.js` — `tryClassify`, `assignCategory`.
- New `app/lib/shopifyFetch.js` — `fetchStoreProducts` + the Shopify
  normalization helpers it depends on (around `stores.js:557, :623`).
  Note: also bundles `FILTER_BY_BRAND` handling and the
  `fetchExistingEditorialByHandle` utility used only by
  `FILTER_BY_BRAND` stores — they can move with `fetchStoreProducts` or
  to their own `storeSyncPolicy.js`.
- Slimmed `app/lib/stores.js` — only `FALLBACK_STORES`, `getActiveStores`,
  `getAllStores`, `mapStoreRow`. Plus re-exports from the new modules for
  one cycle.
- `app/lib/cleanTitle.js` — leave the local `normalize` helper at line 88
  alone. Per Codex's correction, it is NOT a duplicate of `normalizeBrand`
  (no alias table). Do not merge them in this PR.

**Verification:**
- `app/lib/__tests__/stores.test.js` — rename imports where needed, all
  tests still pass.
- Dry-run `scripts/test-enrich.mjs` against a small batch; brand
  assignments and hide counts match a baseline snapshot.
- Manual cron run in dev for a single domain: upsert counts match baseline.
- Spot-check 3 known self-branded stores: success-branch hide on first
  resolve, null-branch hides only at retry exhaustion. (Asymmetry
  preserved.)
- Confirm `enrich_attempts` is still selected in the batch `.select()` and
  still read inside the loop — both will live in the moved code.

---

## Cross-cutting verification (every PR)

Run before requesting review on each PR:

- `npm test` green.
- `npm run build` green.
- Vercel preview deploys.
- Visit `/`, `/feed`, `/feed?store=<one>`, `/feed?brand=<one>`,
  `/feed?category=tops,jackets`, `/feed?sort=price_asc`, one editorial
  entry, one PDP with description, one PDP without, one PDP for a sold
  product. Visually diff against production.
- For PR 1: explicitly hit a URL that exercises the editorial RPC path
  (any designer page).
- For PR 5: dry-run cron + enrich against staging Supabase (or with
  `enrich_attempts` snapshot + revert) and confirm row counts match
  baseline.

## Things deliberately NOT in this plan

- **PDP `hidden` gate** — surface as a separate product-policy ticket
  after PR 2 lands.
- **FeedClient pagination math fix** — separate ticket; bug surface but
  not part of the architectural cleanup.
- **ProductCard analytics-only RSC split** — separate ticket; carries
  hover/focus behavior considerations.
- **Enrich hide-update silent failures** — separate ticket; observability
  improvement, not a refactor.
- **Admin `new Function` consolidation** — separate ticket; admin path is
  dev-gated and lower priority.
- **CLAUDE.md staleness sweep** — the "DB objects not in git" line is
  factually wrong (`scripts/sql/` exists). Update during or after PR 1
  when the RPC contract gets pinned in code.
- **`cleanTitle.js` `normalize` merge with `normalizeBrand`** — Codex's
  correction shows they have different contracts. Don't merge.
