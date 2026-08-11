# Featured Archives system + Hedi Slimane archive (first live archive)

## Context

Today's home redesign shipped the **Featured Archives band as inert placeholders** ([FeaturedArchives.js](app/components/home/FeaturedArchives.js) — five hard-coded entries, no links; the morning spec explicitly deferred the real system). This build lights the system up and launches its first archive: **Hedi Slimane — Dior Homme 2000–07 · Saint Laurent 2012–16**, with a dedicated page modeled on the user's reference mockup.

**Data reality (verified in prod):** ~66–69% of live products carry an era signal, but only as free text in `title`/`name` ("FW03 Velour Jacket") — no queryable era column. Designer tenure is destroyed at write time (`BRAND_ALIASES`: "Dior Homme"→"DIOR", "YSL"→"SAINT LAURENT"). Live: 237 DIOR / 300 SAINT LAURENT; Dior with 2000–07 signal: 64 (mostly Galliano womenswear — only ~6 carry homme/Slimane attribution); SL 2012–16 signal: 29; Hedi-named SL: 12. A naive brand+year archive would put Galliano in a Slimane archive — hence the strict rules below.

## Decisions made with the user

1. **Membership: strict + curatable** — new derived `era_year INT` column (deterministic parse, no LLM) + per-archive config rules (brand + year range + attribution text patterns) + manual include/exclude overrides. ~35–45 accurate pieces today; auto-grows with stock.
2. **Scope: general system, Hedi live only.** Other four band entries stay inert; VIEW ALL stays inert; SearchBrowseRow "Year" item stays inert; Hero CTA stays `/feed`.
3. **Archive grid: available pieces only** (`withVisibility`).
4. **Toolbar: item count only** — no FILTERS, no sort, no view toggle.
5. **No collection-story link yet**; config carries optional `editorialSlug` that renders the link when set.
6. **Assets (both verified on disk):** portrait `/Users/anamelajr/Downloads/hedi-archive.jpg` (2240×2239 B&W) → `public/archives/hedi-slimane/hero.jpg`; reference mockup `/Users/anamelajr/Downloads/reference archive section.jpeg` → copy to `docs/superpowers/specs/assets/2026-08-11-featured-archives/reference-archive-page.jpeg`. **The implementer must iterate the built page against this reference** (browser-preview screenshots, desktop + mobile, compare spacing/type hierarchy/tone) — explicit user requirement.

## Ordering (binding)

1. SQL migration applied manually in the Supabase SQL Editor (schema before dependent code merges; MCP is read-only).
2. Code (branch, never push main): parseEra → archives config → write paths → fetch → page + i18n → home band links → assets.
3. Backfill dry-run → review → `--apply` → SQL coverage verification.
4. `npm test`, `npm run build`, localhost visual walkthrough + reference iteration.
5. **Never trigger `/api/cron` or `/api/enrich` locally** (prod writes, OpenAI spend).

## 1. Schema — `scripts/sql/2026-08-11-add-products-era-year.sql` (new)

```sql
-- era_year: DERIVED — deterministic parse of season/year tokens in title/name
-- (app/lib/parseEra.js). NOT editorial: fully recomputable, no judgment; the
-- COALESCE/write-once protection deliberately does NOT apply.
ALTER TABLE products ADD COLUMN IF NOT EXISTS era_year INT;
CREATE INDEX IF NOT EXISTS idx_products_era_year
  ON products (era_year) WHERE era_year IS NOT NULL;
```

**No RPC changes** — the archive page reads `products` directly, never through the interleaved RPCs. INT (not text/range): rules are `gte`/`lte` predicates; split seasons (FW02/03) take the opening year by definition.

## 2. `app/lib/parseEra.js` (new) — deterministic era extraction

`parseEraYear(title, name) → number | null`. Pure, never throws. Runs each input through the existing `normalizeSeasonCodes` ([seasonCodes.js](app/lib/seasonCodes.js)) first — one source of truth for season grammar ("Spring 2001"→"SS01", "F/W 2004"→"FW04") — then matches three canonical shapes in priority order:

1. Season code `FW|SS|AW` + 2-digit year (split `FW02/03` → first year 2002)
2. Standalone 4-digit year 1960–2029
3. Decade marker `2000s` → 2000, `1990s` → 1990

**Pivot: `yy >= 30 → 19xx`, else `20xx`** (archive-fashion catalog: nothing past 2029 can exist, pre-1960 effectively absent). Results outside 1960–2029 are discarded. **`title` scanned fully first** (canonical, enriched); `name` only if title yields nothing.

**Tests `app/lib/__tests__/parseEra.test.js`**: "FW03 Velour Dress"→2003; "2000s Crossbody Bag"→2000; "AW2016 Saint Laurent…"→2016; "Dior spring 2001 silk set"→2001; "YVES SAINT LAURENT FW 1992…"→1992; "FW02/03"→2002; pivot boundaries SS29→2029, FW99→1999, FW30→null; year beats decade in "1990s archive 2004 jacket"→2004; title precedence; garbage no-ops ("1017 ALYX 9SM"→null).

## 3. Write paths (era_year = plain overwrite everywhere; derived-data exemption commented at each site)

- **Cron ([app/api/cron/route.js](app/api/cron/route.js)) — recompute in Step 2**, which already fetches per-batch editorial state (`route.js:204`) and thus has `title` in hand: extend the select to `"handle, brand, title, category, era_year"`, compute `parseEraYear(ex.title, p.name)` per row, upsert changed rows as a separate small `eraRows` batch (`onConflict: "handle,store_domain"`, behind the existing deadline check). NOT in Step-1 `syncRows` (name-only value would clobber title-derived values back to NULL) and NOT added to `editorialRows` (keeps the editorial-protected write surface untouched). Steady-state ≈ zero rows/run.
- **Enrich ([app/api/enrich/route.js](app/api/enrich/route.js))**: after a successful title write (model path + handle-fallback path, small shared helper), recompute and plain-`update` `era_year` if changed; add `era_year` to the batch SELECT (line 69 — selected *columns*, not filters, so the batch/remaining-count filter-parity invariant is untouched). Freshness optimization only; cron reconverges hourly regardless.
- **Backfill `scripts/backfillEraYear.mjs` (new)**: modeled on `scripts/backfillSeasonCodes.mjs` (dotenv, service role, dry-run default / `--apply`, `ORDER BY id` paging 1000). All rows (incl. hidden/sold). Apply groups changed rows by computed year, `update({era_year: Y}).in("id", chunk)` with `chunkArray(ids, 100)`. **Convergence protocol (adversarial-review finding):** writers compute the same function but possibly from different input snapshots — a concurrent enrich can land a title (and title-derived era_year) after the backfill read its page, and the stale name-derived value would overwrite it. Rather than per-row CAS (which would break the grouped batch updates), the apply loop re-runs the dry-run scan after each apply pass and applies again until it reports 0 pending — a stale overwrite manifests as a fresh diff on re-scan, so the loop converges (the collision window is a few minutes of script vs an hourly enrich batch; residual risk is additionally repaired by the hourly cron recompute). The script performs this loop itself (cap ~5 iterations, exit nonzero if still dirty).

## 4. Config — `app/lib/archives.js` (new)

The module FeaturedArchives.js's comment already reserves. `ARCHIVES` array in today's exact band order; four inert entries stay `{ name, years, live: false }`. Hedi entry:

```js
{
  live: true,
  slug: "hedi-slimane",
  name: "HEDI SLIMANE",
  years: "2000–07 · 2012–16",          // matches home band exactly
  image: "/archives/hedi-slimane/hero.jpg",
  imageAlt: "Hedi Slimane portrait",
  editorialSlug: null,                  // when set → VIEW COLLECTION STORY link
  description: "Hedi Slimane reshaped modern menswear at Dior Homme (2000–2007), defining a radically slim, youthful silhouette that became one of the most influential aesthetics of the 2000s. He later revisited and brought his signature visuals to Saint Laurent during the early 2010s, merging sharp tailoring with rock and youth culture. It is a testament to Slimane's influence that the silhouettes he propelled into the mainstream have found renewed relevance nearly two decades later with the \"Hedi Boy\" movement.",   // user-supplied, verbatim
  rules: [
    // Attribution REQUIRED: 2000–07 Dior stock is dominated by Galliano womenswear.
    { brand: "DIOR", eraStart: 2000, eraEnd: 2007, attribution: ["homme", "hedi", "slimane"] },
    { brand: "SAINT LAURENT", eraStart: 2012, eraEnd: 2016 },
    // Named but UN-YEARED pieces only (e.g. "SL10H … by Hedi Slimane" sneakers with
    // no season token). eraYearNull guards against future out-of-tenure listings whose
    // copy merely mentions Slimane ("succeeding Hedi Slimane"): attributed rows WITH a
    // year are covered by the range rule above or correctly excluded by it.
    { brand: "SAINT LAURENT", eraYearNull: true, attribution: ["hedi", "slimane"] },
  ],
  include: [], exclude: [],             // [{ storeDomain, handle }] curation overrides
}
```

Exports `getLiveArchives()`, `getArchiveBySlug(slug)`. Name/years/description are content — English-only, not i18n messages. **Test `app/lib/__tests__/archives.test.js`**: unique live slugs; required fields on live entries; rules well-formed (uppercase brand; era pair 1960–2029 with start≤end, `eraYearNull` boolean mutually exclusive with the era pair, or non-empty lowercase attribution); override entries have storeDomain+handle; exactly five entries.

## 5. Query — `app/lib/fetchArchiveProducts.js` (new)

Server-side; `fetchArchiveProducts(archive, { client })` with productQueries' dynamic-import default-client pattern. Per rule (all via `Promise.all`, 3 queries for Hedi):

```js
let q = client.from("products").select(`${PRODUCT_ROW_SELECT}, synced_at`).eq("brand", rule.brand);
q = withVisibility(q);                                 // available + !hidden + zero-price exclusion
if (rule.eraStart != null) q = q.gte("era_year", rule.eraStart).lte("era_year", rule.eraEnd);
if (rule.eraYearNull) q = q.is("era_year", null);      // un-yeared-only rules (see config §4)
if (rule.attribution?.length) q = q.or(rule.attribution.flatMap((t) => [
  `name.ilike.${escapePostgrestValue(`%${t}%`)}`,
  `description.ilike.${escapePostgrestValue(`%${t}%`)}`,
]).join(","));
```

- **Fail-closed error semantics (adversarial-review finding):** supabase-js builders resolve to `{ data, error }` and never reject, so `Promise.all` provides no protection. Every rule query AND every include-chunk query must inspect `error`, `console.error` with rule/chunk context, and **throw** — partial membership must never be returned. Throwing is load-bearing for caching: `unstable_cache` does not cache thrown errors, whereas a silently-merged partial result would be served as an authoritative "3 ITEMS" for an hour. (Same convention as [fetchProductsPage.js:68](app/lib/fetchProductsPage.js) — "throws on Supabase error; callers decide how to degrade"; the archive page lets the error surface to Next's error boundary.)
- Attribution deliberately searches `name`/`description` only, NOT `title`: enrichment strips brand/designer tokens from titles (`titleLeaksAllowedBrandStrict` + prompt), and a full-table check confirmed zero rows carry title-only attribution — titles cannot carry a signal their source `name` lacks. (Adversarial-review finding 1 rejected on this evidence; finding 2 produced the `eraYearNull` guard above.)
- **Membership tests** (in the `fetchArchiveProducts` stub-client test): positive — attribution-only match with NULL era_year included; negative — attributed row with out-of-range era_year (e.g. 2018) excluded; failure — a rule query returning `{ error }` throws (nothing partial returned), and an include-chunk query returning `{ error }` throws.

- `escapePostgrestValue` imported from [fetchProductsPage.js:24](app/lib/fetchProductsPage.js) (CLAUDE.md's pointer to `/api/products/route.js` is stale). Quote unconditionally per the `.or()` invariant.
- Chained `.or()`s AND together (documented at productQueries.js:24–26), so visibility's zero-price `.or` composes with the attribution `.or` as intended.
- Merge + dedupe by `store_domain::handle` (rules ordered most-specific first) → drop `exclude` keys → fetch `include` rows like `fetchCurated` in [fetchEditorialProducts.js](app/editorial/_lib/fetchEditorialProducts.js) (group by domain, `chunkArray(handles, 100)`, still `withVisibility`) → sort `synced_at` desc → `mapProductRow`.
- Budget: 3 concurrent reads, ≤ ~65 rows each, eq/indexed predicates — far inside the 8s REST timeout. Expected membership today ≈ 35–45.

## 6. Page — `app/archives/[slug]/page.js` (new)

**Rendering:** follow the editorial precedent, not home's force-dynamic: `export const revalidate = 3600` + `generateStaticParams` from `getLiveArchives()` + product fetch in `unstable_cache(..., ["archive-products", slug], { revalidate: 3600 })` (same rationale/comment as [app/editorial/[slug]/page.js](app/editorial/[slug]/page.js): layout cookies force per-request rendering; the cache keeps Supabase on the hourly sync cadence). Unknown/inert slugs → `notFound()`. `generateMetadata` from archive name/description. Language via server `getLanguage()` + `t(key, lang)` — threads active lang (silent-English sharp edge).

**Layout** (tokens from [tokens.js](app/components/home/tokens.js); ground `GROUND`, band `HERO_GROUND`; use inline `style`/literal classes — dynamic `bg-[${VAR}]` never reaches the JIT scanner, per Hero.js):

1. **Hero band** directly under the nav, full-width `HERO_GROUND`, desktop two-column ≈ `55/45`:
   - Left (vertically centered, Hero.js-style left padding): small-caps eyebrow `t("archive.eyebrow")`; two-line light-weight Satoshi title — name, then years — clamp-sized a step below the home hero, per reference; description in muted ~14px/1.6 `text-zinc-600`, max-w ~46ch; conditional `editorialSlug` link (renders nothing today).
   - Right: `next/image` fill + `priority`, `object-cover`, portrait bleeding to band top/right/bottom, `sizes="(max-width: 768px) 100vw, 45vw"`.
   - Mobile: copy first, image below (`aspect-[4/5]`-ish), mirroring home Hero's mobile order.
2. **Toolbar:** `HAIRLINE` top border, `CONTAINER`, single count — `{products.length} {t("archive.items", lang)}` in `UTILITY_CAPS` treatment. Nothing else.
3. **Grid:** feed's exact conventions ([FeedClient.js:483](app/feed/FeedClient.js)) — `grid-cols-2 gap-10 lg:grid-cols-4 lg:gap-x-3.5 lg:gap-y-16`, reuse [ProductCard](app/components/ProductCard.js) with `imageSizes="(min-width: 1024px) 25vw, 50vw"`. All items at once; empty state is just "0 ITEMS".

**i18n ([messages.js](app/lib/i18n/messages.js), both langs — parity test enforces):** `archive.eyebrow` "Featured Archive"/"Archive à la une"; `archive.items` "items"/"articles"; `archive.viewStory` "View collection story"/"Voir l'histoire de la collection".

## 7. Home band — [FeaturedArchives.js](app/components/home/FeaturedArchives.js) (modify)

Replace local `ENTRIES` with `ARCHIVES` import (update the header comment — the promised phase has arrived). In **both** DOM blocks (mobile swipe + desktop band): `live` entries become `Link href={/archives/${slug}}` with `transition-opacity hover:opacity-60`, dropping `cursor-default`; inert entries unchanged. VIEW ALL stays inert. Typography classes identical.

## 8. Verification

1. Migration applied (SQL Editor) → `information_schema.columns` check for `era_year`.
2. `npm test` (new: parseEra, archives; existing suites incl. i18n parity stay green) and `npm run build`.
3. Backfill: dry-run (expect ~66–69% coverage) → sample review → `--apply` (loops apply→rescan internally until 0 pending, per §3) → final standalone dry-run confirms 0. SQL coverage + Hedi-membership preview query (mirrors the three rules; expect ~35–45).
4. Localhost walkthrough (read-only, safe): home → HEDI SLIMANE cell links (others inert) → `/archives/hedi-slimane` hero/count/grid render; card click-through; `/archives/martin-margiela` + garbage slugs 404; FR toggle translates eyebrow/count only.
5. **Reference iteration (explicit requirement):** browser-preview screenshots at desktop + mobile vs `docs/superpowers/specs/assets/2026-08-11-featured-archives/reference-archive-page.jpeg` — spacing, type hierarchy, tone; iterate until it matches. Note the deliberate deltas: no FILTERS/sort/toggle, no story link.
6. Commit this design as `docs/superpowers/specs/2026-08-11-featured-archives-hedi-slimane-design.md` alongside the copied reference image.

## Files

**Create:** `scripts/sql/2026-08-11-add-products-era-year.sql` · `app/lib/parseEra.js` · `app/lib/__tests__/parseEra.test.js` · `app/lib/archives.js` · `app/lib/__tests__/archives.test.js` · `app/lib/fetchArchiveProducts.js` · `app/archives/[slug]/page.js` · `scripts/backfillEraYear.mjs` · `public/archives/hedi-slimane/hero.jpg` · spec doc + reference asset copy.

**Modify:** `app/api/cron/route.js` · `app/api/enrich/route.js` · `app/lib/i18n/messages.js` · `app/components/home/FeaturedArchives.js`.
