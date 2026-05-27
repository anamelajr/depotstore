# Search alias: CDG → Comme des Garçons (general system, ship CDG only)

## Context

On the live site, typing `CDG` into the feed search returns zero results. The current search path tokenises the query on whitespace and requires every token to substring-match `title || ' ' || brand || ' ' || name` (case-insensitive ILIKE, no unaccent on the search side — confirmed in the `get_interleaved_products` RPC at [scripts/sql/2026-05-21-interleaved-rpcs.sql:71-84](../../../scripts/sql/2026-05-21-interleaved-rpcs.sql#L71)). No DB row contains the string `CDG` anywhere across those three columns, so the token never matches.

This is a real shopper miss. The DB holds **140 available Comme des Garçons products** spread across **8 brand-string variants** (canonical `COMME DES GARÇONS` plus unaccented spellings, `HOMME`, `HOMME PLUS`, `TRICOT`, and the `JUNYA WATANABE COMME DES GARÇONS` collab). Two of those variants are already short-handed to "CDG" in `ProductCard`'s display map ([app/components/ProductCard.js:25-27](../../../app/components/ProductCard.js#L25)) — so the user sees "CDG" on the product card but can't search for it. We want `?search=CDG` to surface those 140 products.

User chose **Option B** from brainstorming: keep the URL/chip showing `CDG` literally, expand the term server-side before it hits the DB. Alias scope is **"build a general system; ship CDG only"** — one tiny helper module with a map, populated with one entry today.

## Change

**One new file** (with two exports — the expander and a drift probe), **two call-site edits** (one in `/api/products`, one in `/api/cron`), **one new unit-test file**, **augmented assertions in the existing route test**.

### 1. New file: `app/lib/searchAliases.js`

```js
// SEARCH_ALIASES — lower-cased single-word search token → replacement token.
// The replacement must substring-match the intended brand inside DB
// (title || ' ' || brand || ' ' || name), case-insensitive — this is the
// shape the get_interleaved_products RPC and applySearchFilter both query.
//
// Ship: CDG only. "comme" hits all 8 in-DB Comme des Garçons brand variants
// (verified 2026-05-27: 140 brand-pure hits + 3 collab rows where "Comme des
// Garçons" appears in the product name — net positive). Future entries
// (mmm, jpg, …) follow the same shape: pick a replacement substring that's
// present in every target brand variant and not in unrelated brands.
//
// Out of scope here: multi-word aliases (e.g. "ann d" → "demeulemeester")
// would need a phrase-matching pass; file a separate spec when there's a
// second data point.
const SEARCH_ALIASES = {
  cdg: "comme",
};

export function expandSearchAliases(query) {
  if (!query || typeof query !== "string") return query;
  let changed = false;
  const expanded = query
    .trim()
    .split(/\s+/)
    .map((token) => {
      const replacement = SEARCH_ALIASES[token.toLowerCase()];
      if (replacement) {
        changed = true;
        return replacement;
      }
      return token;
    });
  return changed ? expanded.join(" ") : query;
}

// checkCdgAliasDrift — structural false-positive probe for the cdg→comme
// expansion. Returns rows whose search corpus (title || brand || name)
// contains "comme" but whose brand isn't a Comme des Garçons variant AND
// whose name doesn't carry the documented collab marker ("comme des"). As
// of 2026-05-27 the expected count is 0: the 3 known collab rows
// (CHROME HEARTS, JUNYA WATANABE, NOIR KEI NINOMIYA × CDG) all have
// "comme des" in their name. Anything > 0 means an unrelated row has
// joined the catalog and is being silently surfaced as a CDG search hit.
//
// Run from /api/cron post-sync (see section 4 below). Never throws — the
// caller treats a non-empty result as a log signal, not a hard failure,
// mirroring the existing enrich_runs telemetry pattern at
// app/api/cron/route.js:284.
export async function checkCdgAliasDrift(supabase) {
  const { data, error } = await supabase
    .from("products")
    .select("brand,title,name,store_domain")
    .eq("available", true)
    .eq("hidden", false)
    .or("title.ilike.%comme%,brand.ilike.%comme%,name.ilike.%comme%")
    .not("brand", "ilike", "%comme%");
  if (error) return { error, count: 0, samples: [] };
  const unexpected = (data ?? []).filter(
    (row) => !(row.name ?? "").toLowerCase().includes("comme des"),
  );
  return {
    error: null,
    count: unexpected.length,
    samples: unexpected.slice(0, 10),
  };
}
```

When a second alias gets added, generalise this into `checkSearchAliasDrift(supabase, alias)` driven by a per-alias `{ replacement, brandIlike, collabNameMarker }` map. Not worth the abstraction at one entry — explicit beats parameterised until there's a second data point.

Notes on the shape:
- **Returns the original string unchanged when no alias matches** — preserves any user-significant whitespace/casing for unrelated queries; only normalises when we've actually rewritten something.
- **Token-level**, not phrase-level. Compound queries like `"CDG jacket"` expand cleanly to `"comme jacket"` and intersect with the existing per-word AND semantics in the RPC.
- **Lower-cased lookup, replacement inserted as-is**. ILIKE is case-insensitive so casing of the replacement doesn't matter.
- **No double-trip**: typing `"comme"` directly stays as `"comme"`. Typing `"cdg comme"` → `"comme comme"` — harmless (every word must appear, and "comme" appears in the same string twice trivially).

### 2. Call-site edit: `app/api/products/route.js`

One change to the existing search-param read, currently at [app/api/products/route.js:65](../../../app/api/products/route.js#L65):

```js
import { expandSearchAliases } from "../../lib/searchAliases.js";
// …
const search = expandSearchAliases(searchParams.get("search"));
```

The relative `.js` import is deliberate: the repo's `vitest.config.js` declares no `resolve.alias` and no tsconfig-paths plugin, while `jsconfig.json` defines `"@/*": ["./*"]` only for Next.js/IDE resolution. Every existing import in [app/api/products/route.js:1-3](../../../app/api/products/route.js#L1) and its sibling test [app/api/products/__tests__/route.test.js](../../../app/api/products/__tests__/route.test.js) is a relative `.js` path — using `@/…` here would resolve in `next dev`/`next build` but break the route's Vitest suite at module-resolution time before any behaviour runs.

This is the only user-facing search entry point. Both downstream paths consume the same `search` local:

- The direct-query path through `applySearchFilter` at [app/api/products/route.js:44-55](../../../app/api/products/route.js#L44) (price-sort branch).
- The RPC path through `fetchInterleavedProducts({ search, … })` in [app/lib/productQueries.js:91-111](../../../app/lib/productQueries.js#L91) (default branch).

Both receive the expanded form transparently. The URL stays `?search=CDG`. The search chip rendered by `FilterChip` stays "CDG". `FeedClient`'s `searchQuery = searchParams.get("search")` stays "CDG". Only the SQL sees `"comme"`.

### 3. Unit tests: `app/lib/__tests__/searchAliases.test.js`

Mirroring the pattern of [app/lib/__tests__/handleFallback.test.js](../../../app/lib/__tests__/handleFallback.test.js). Cases:

- `expandSearchAliases(null)` → `null`
- `expandSearchAliases("")` → `""`
- `expandSearchAliases("CDG")` → `"comme"`
- `expandSearchAliases("cdg")` → `"comme"`
- `expandSearchAliases("CdG")` → `"comme"` (case-insensitive lookup)
- `expandSearchAliases("cdg dress")` → `"comme dress"`
- `expandSearchAliases("  cdg   shirt  ")` → `"comme shirt"` (trim + whitespace collapse)
- `expandSearchAliases("dress")` → `"dress"` (no alias, untouched)
- `expandSearchAliases("comme")` → `"comme"` (no double-trip)
- `expandSearchAliases("cdg comme")` → `"comme comme"` (idempotent under repetition)

### 4. Route-level integration tests in `app/api/products/__tests__/route.test.js`

The existing suite mocks `fetchInterleavedProducts` and `countInterleavedProducts` ([route.test.js:7-15](../../../app/api/products/__tests__/route.test.js#L7)) but every current `toHaveBeenCalledWith` assertion is about category/subcategory routing — no test asserts on the `search` field. Without coverage there, a typo in the wrap (`expandSearchAlias` vs `expandSearchAliases`), or simply forgetting to wrap, would pass `npm test -- app/api/products` silently. Add three cases:

- `it("alias-aware search: cdg → comme on both fetch and count")` — `await GET(makeReq({ search: "CDG" }))`, then assert **both** `fetchInterleavedProducts` and `countInterleavedProducts` were called with an object containing `search: "comme"`. (The route uses one `search` local feeding both call sites, so this is one bug-class with one assertion pair — but the assertion has to exist.)
- `it("alias passthrough: unrelated search unchanged")` — `search: "dress"` → both RPCs called with `search: "dress"`.
- `it("alias-aware compound search: cdg + jacket")` — `search: "CDG jacket"` → both RPCs called with `search: "comme jacket"`.

These three close the propagation gap exactly: any bug that drops or mis-wires the wrap fails at least one of them.

### 5. Drift logging in `app/api/cron/route.js`

After the existing sync loop and before `return Response.json(summary)` at [route.js:287](../../../app/api/cron/route.js#L287), add:

```js
import { checkCdgAliasDrift } from "../../lib/searchAliases.js";
// …
const aliasDrift = await checkCdgAliasDrift(supabaseAdmin);
if (aliasDrift.error) {
  console.error("alias drift probe failed:", aliasDrift.error.message ?? aliasDrift.error);
} else if (aliasDrift.count > 0) {
  console.warn(
    JSON.stringify({
      event: "search_alias_drift",
      alias: "cdg",
      count: aliasDrift.count,
      samples: aliasDrift.samples,
    }),
  );
}
summary.aliasDrift = { cdg: aliasDrift.error ? null : aliasDrift.count };
```

Design constraints — all consistent with existing cron conventions:

- **Never throws.** Probe failure is caught and logged via `console.error`, mirroring the `enrich_runs cron log failed` swallow at [route.js:284](../../../app/api/cron/route.js#L284). The cron's success criteria (sync drain + return 200) are untouched. Drift logging is observability, not enforcement — it cannot break the hourly sync. Preserves the CLAUDE.md invariant: `maxDuration = 300` on `/api/cron`, sync drain protected.
- **Two visibility surfaces.** `console.warn` with a structured JSON payload surfaces in Vercel function logs (searchable by `event: "search_alias_drift"`); the `summary.aliasDrift.cdg` count surfaces in the JSON response, which the GitHub Actions cron runner already captures per-run. Two channels means whichever the operator looks at first catches it.
- **No new tables, no new env, no migration.** Reuses `supabaseAdmin` already in the cron, the existing `summary` object the cron already returns, and `console.warn` which Vercel already collects.
- **Cost is ~one extra SELECT per cron tick** against the `products` table — a single ILIKE OR-filter that the existing search indexes (if any) help; full-table-scan worst case is the same shape as a regular feed search, well within the cron's 5-minute budget.

### What is deliberately NOT changed

- **Brand filter (`?brand=`)** — untouched. The RPC's `unaccent + ILIKE` substring filter on `brand` already matches all 7 of the accent/spelling variants when given any reasonable substring; only the collab variant `JUNYA WATANABE COMME DES GARÇONS` lives outside the strict-brand consensus, which is correct.
- **`normalizeBrand` ALIASES in [app/lib/brand.js](../../../app/lib/brand.js)** — different surface. That map canonicalises model-extracted brand strings on the **write path** (enrichment) and operates on whole brand strings. The search surface uses fuzzy substring matching and operates on user-typed search tokens. Sharing data between them would tie two unrelated semantics together; the next time someone wants `"YYY" → "Yohji Yamamoto"` on search-only, they'd have to disentangle.
- **`/api/admin/search-products/route.js`** — local-only (gated to 404 in production by `middleware.js`), used as an exact-ish product lookup for admin tooling, takes `?q=` not `?search=`. Aliasing it would surprise the admin operator.
- **Existing search RPC SQL** — no change. The alias expansion is a Node-side string transform; the RPC keeps its current contract.

## Critical files

- **New**: [app/lib/searchAliases.js](../../../app/lib/searchAliases.js) — exports `expandSearchAliases` and `checkCdgAliasDrift`.
- **New**: [app/lib/__tests__/searchAliases.test.js](../../../app/lib/__tests__/searchAliases.test.js) — unit tests for the expander; the drift probe is covered at integration scope (preview run + cron tick) since it's a thin Supabase query.
- **Modified** (single line + import): [app/api/products/route.js:65](../../../app/api/products/route.js#L65) — wrap `searchParams.get("search")`.
- **Modified** (test additions): [app/api/products/__tests__/route.test.js](../../../app/api/products/__tests__/route.test.js) — add the three propagation cases described in section 4.
- **Modified** (post-sync hook + summary field): [app/api/cron/route.js:287](../../../app/api/cron/route.js#L287) — drift probe, structured log, response augmentation.

## Verification

Per project convention (CLAUDE.md): verify on Vercel preview, not localhost.

1. **Unit tests, helper only:** `npm test -- searchAliases` — all cases above pass.
2. **Unit tests, full route suite:** `npm test -- app/api/products` — both the existing routing-decision cases and the three new propagation cases (`cdg → comme on both fetch and count`, `unrelated unchanged`, `compound`) must pass. The new cases are the structural guard that the wrap is actually wired; absence of one of them failing is meaningful — re-confirm they were added before shipping.
3. **Pre-deploy drift check** — read-only SQL via the Supabase MCP or SQL editor. The alias expansion will surface any row whose `title || ' ' || brand || ' ' || name` contains `comme`; today that's 140 brand-pure CDG rows + 3 documented collab rows. Anything beyond that set is silent leakage masquerading as a CDG search result. Run this query and confirm it returns the 3 known collab rows and no others:
   ```sql
   SELECT brand, title, name, store_domain
   FROM products
   WHERE available = true AND hidden = false
     AND (COALESCE(title,'') || ' ' || COALESCE(brand,'') || ' ' || COALESCE(name,''))
         ILIKE '%comme%'
     AND (brand IS NULL OR brand NOT ILIKE '%comme%')
   ORDER BY brand NULLS FIRST, title;
   ```
   Expected as of 2026-05-27: exactly 3 rows — `CHROME HEARTS / Tee / Chrome Hearts X Comme des Garçons Tee`, `JUNYA WATANABE / 2000s Grey Blazer / Junya Watanabe Comme des Garçons Grey Blazer Jacket`, `NOIR KEI NINOMIYA / Comme Des Garçons Double Dress / noir kei ninomiya COMME des GARÇONS double dress`. If the query returns more than 3 rows, or rows whose `name` does not contain `comme des` (e.g. a French listing using the word `comme` as a comparative), **do not ship** — revisit the alias scope before merging. This same query is the recommended periodic drift probe post-merge (see Known follow-ups).
4. **Preview deploy** the branch and open the preview URL.
5. **Visit `/feed?search=CDG`:**
   - Count surfaced as ≥ 140 (140 brand-pure CDG + 3 collab where title contains "Comme des Garçons" — verified 2026-05-27 against production data).
   - Search chip reads `SEARCH: CDG`, not `comme`. Confirms the URL/UI side is untouched.
   - Spot-click 3 cards across page 1 — every result is CDG, a CDG sub-label (Homme/Homme Plus/Shirt/Tricot), or a documented collab (Junya, Noir Kei Ninomiya, Chrome Hearts × CDG).
6. **Compound query**: `/feed?search=cdg+jacket` (URL-encoded space) — returns the subset of the above 140+ that have "jacket" in title/brand/name. Confirms per-word AND semantics still work after expansion.
7. **Search input regression**: type `CDG` in the desktop nav search box and submit. URL should become `/feed?search=CDG` via `buildFeedUrl` ([app/lib/feed-utils.js:6-26](../../../app/lib/feed-utils.js#L6)); same 140+ result set. Confirms there's no client-side leak point that bypasses `/api/products`.
8. **Negative regression**: `/feed?search=comme` still returns the same set (no double-expansion, no loss).
9. **Unrelated-query regression**: `/feed?search=dress` returns the existing dress feed unchanged.
10. **Brand filter still works**: `/feed?brand=Comme+des+Gar%C3%A7ons` still returns all 140. Confirms the brand path is untouched.
11. **Admin path untouched**: locally hit `/api/admin/search-products?q=CDG` — should behave exactly as before (returns whatever it returns today; we didn't change the file).
12. **Cron drift logging — happy path**: trigger `/api/cron` (`curl -H "Authorization: Bearer $CRON_SECRET" $PREVIEW_URL/api/cron`). The JSON response must include `aliasDrift: { cdg: 0 }`. Vercel function logs should show no `event: "search_alias_drift"` `console.warn`. Confirms the probe ran clean against current data.
13. **Cron drift logging — synthetic leak**: from the Supabase SQL editor (write surface, not MCP), `INSERT` a single throwaway row with `available=true, hidden=false, brand='TEST BRAND', title='Comme Test', name='Comme Test'` (any product fields needed to satisfy NOT-NULL constraints). Re-trigger the cron. Response must now show `aliasDrift: { cdg: 1 }` and the function log must carry the `event: "search_alias_drift"` warn with the test row in `samples`. Then `DELETE` the test row and re-run once to confirm it returns to `0`. **Skip this step in production** — run it against the preview environment only.
14. **Cron drift logging — swallow path, code review:** confirm by reading the diff that `checkCdgAliasDrift` is invoked under `try/catch`-equivalent control flow (the helper already returns `{ error, count: 0, samples: [] }` instead of throwing, and the call site only branches on `aliasDrift.error` to log + set `summary.aliasDrift.cdg = null`). No `throw` reachable from the probe path; no return-early from the cron. The runtime-level test of this swallow is implicit in step 13 (which exercises the happy path) plus the helper's own return-shape contract — a runtime failure injection isn't practical because anything that breaks the probe's Supabase call also breaks the cron's upsert step.

### Known follow-ups not addressed here

- **No "did you mean" hint** in the UI. User picked Option B (silent expansion) over Option C (visible interpretation). If shopper feedback later wants confirmation that we interpreted "CDG" as the brand, revisit Option C — adds a small `<p>` between the chip row and the count.
- **Single-word aliases only.** Multi-word inputs like `"ann d"` or `"a.p.c."` would need phrase-matching; deferred until there's a second alias whose canonical form can't be reduced to a single substring token.
- **Replacement is not unaccented at the source.** We replace with `"comme"` (no accent on the e) because every DB brand variant happens to start with un-accented `COMME`. If a future alias maps to a brand whose distinguishing substring carries diacritics (e.g. a hypothetical `"hed" → "hédi"`), we'd need to either pick a non-accented anchor inside the brand string or pass that alias through `unaccent` on the SQL side. Not a problem for CDG; flagged so the next maintainer doesn't pick a diacritic-bearing replacement without thinking about it.
- **Drift surveillance is automated logging, not blocking enforcement.** Today the only non-CDG-brand rows whose corpus contains `comme` are three documented CDG collabs (verified 2026-05-27, all with `comme des` in their name — filtered out by `checkCdgAliasDrift`). The expansion is therefore safe today. Long-term, the catalog is Paris-archive resellers and French-language titles using `comme` as a comparative (`"comme neuf"`, `"robe comme une étoile"`) are plausible as new stores join. The probe in section 5 runs every hour after each cron sync; new leaks surface in two places — a structured `console.warn` in Vercel function logs (`event: "search_alias_drift"`), and the `aliasDrift.cdg` count in the cron's JSON response (already captured by the GitHub Actions cron runner per existing CRON_SECRET flow). When a leak appears, the response is **not** to roll back the alias automatically — it's to inspect the offending rows and decide between (a) extending the collab filter (`%comme des%`) to cover a new pattern, (b) OR-joining an explicit brand allowlist into the search RPC, or (c) migrating CDG to a brand-scoped redirect (Option A from the original brainstorming). What the spec deliberately does **not** do: alert routing (email/Slack), CI failure on drift, or automatic alias disablement. Each of those is a one-line follow-up once a real drift event teaches us which response is correct.
