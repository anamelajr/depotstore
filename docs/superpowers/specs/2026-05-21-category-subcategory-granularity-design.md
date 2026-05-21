# Sub-category Granularity — Diagnostic + Design

## Part 1 — Diagnostic Report

### Context (the bug)

User reports that products appear under the wrong category filter in the feed:
- Jackets under **Bags**
- Coats under **Jackets**
- Bags under **Accessories**
- Crewnecks / sweatshirts / hoodies under **Tees**

### Root cause

**Taxonomy / slug-mapping bug, not a classifier bug.**

`products.category` stores only **7 broad parent buckets** (`Tops`, `Jackets & Coats`, `Bags & Accessories`, `Bottoms`, `Footwear`, `Dresses & Skirts`, `Sets`). The UI exposes **11 narrower slugs** (`tops_tees`, `tops_hoodies_sweaters`, `tops_shirts_blouses`, `tops_knitwear`, `jackets`, `coats`, `bags`, `accessories`, plus parents and standalones). **Every child slug collapses to its parent's `dbName`** via `CATEGORY_SLUG_TO_DB` in [app/lib/categories.js:56](app/lib/categories.js), so the filter `tops_tees` runs as `category = 'Tops'` and returns the entire Tops bucket.

`assignCategory()` is doing what it was designed to do — pick one of the 7 broad buckets. The row data is mostly fine. The bug is on the read side.

### Evidence from production Supabase

20,304 rows in `products` (available + not hidden).

| Reported pattern | What's actually happening |
|---|---|
| Jackets under **Bags** | `Bags & Accessories` bucket = 432 bags + 426 accessories + 183 other + 4 hybrid jacket/bag pieces. Clicking **Bags** surfaces everything, not just bags. |
| Coats under **Jackets** | `Jackets & Coats` bucket = 1,756 jackets + **319 coat-like rows**. 237 of those coats from `dolcevitahub.com`. No `Coats` DB value exists. |
| Bags under **Accessories** | Symmetric to the first row — same bucket, viewed through the other slug. |
| Crewnecks under **Tees** | `Tops` bucket = 1,638 rows. Only **283 (17%)** match "tee"/"t-shirt". Other 1,355: 530 knits, 328 shirts, 87 sweatshirts/hoodies, 410 other tops. All surface under the Tees slug. |

---

## Part 2 — Design Spec

### Goal

Make the data match the granularity the UI promises. Each leaf slug should return only its own subcategory, not the entire parent bucket.

### Decisions locked in (with user)

1. **Schema:** add a `subcategory` column alongside `category`. Parent slugs filter on `category` unchanged; leaf slugs filter on `subcategory`. Indeterminate rows land as `subcategory = NULL` and remain visible under the parent filter — the UI's promise stays honest at both levels.
2. **Classifier:** extend the deterministic regex in `tryClassify()`. No LLM. Same philosophy as `brandFromHandle` allowlist.
3. **Process:** tests written BEFORE rules. Dry-run backfill produces a distribution report; report is reviewed before any DB writes. Wet backfill is via a SQL file pasted into the Supabase SQL Editor (auditable), not via a service-role script.
4. **Edge-case principle:** the most specific garment noun in the title wins. A specific silhouette word ("bomber") overrides a generic word ("coat"). A garment noun ("sweater", "shirt") overrides a material adjective ("knit", "cashmere"). Bare ambiguous words → NULL.

### Scope

In: the three grouped buckets (`Tops`, `Jackets & Coats`, `Bags & Accessories`) and their 8 leaves.
Out: the four flat buckets (`Bottoms`, `Footwear`, `Dresses & Skirts`, `Sets`) — already 1:1 with data. The 30 existing NULL-category rows — adjacent bug, deferred. Pre-existing fragility in `tryClassify()` rule ordering for broad buckets — touch only what we need to decompose.

### Schema change

```sql
ALTER TABLE public.products
  ADD COLUMN subcategory text NULL;

ALTER TABLE public.products
  ADD CONSTRAINT products_subcategory_matches_category
  CHECK (
    subcategory IS NULL
    OR (category = 'Tops' AND subcategory IN ('tees','hoodies_sweaters','shirts_blouses','knitwear'))
    OR (category = 'Jackets & Coats' AND subcategory IN ('jackets','coats'))
    OR (category = 'Bags & Accessories' AND subcategory IN ('bags','accessories'))
  );
```

CHECK constraint enforces leaf-belongs-to-parent. Drift from a partial write or future bug is rejected at the DB. Applied via Supabase SQL Editor per CLAUDE.md (MCP is read-only).

### Classifier rule decomposition

`tryClassify()` returns `{ category, subcategory }` (subcategory `null` for flat buckets and indeterminate cases). Existing broad rules in [app/lib/stores.js](app/lib/stores.js) stay where they are; the three grouped buckets each get an internal sub-pass that runs after the broad rule has identified the parent.

**Tops sub-pass** (first match wins):

1. `tees` — `\b(t[\s-]?shirts?|tee[\s-]?shirts?|tees?)\b`
2. `hoodies_sweaters` — `\b(hoodies?|sweatshirts?|sweaters?|crewnecks?|cardigans?|pullovers?|fleeces?|half[\s-]?zips?)\b`
3. `shirts_blouses` — `\b(shirts?|blouses?|polo[\s-]?shirts?|polos?|button[\s-]?ups?|button[\s-]?downs?|overshirts?|tunics?|tank[\s-]?tops?|tanks?|camisoles?|cami|bodysuits?|bras?|corsets?|bustiers?|vests?|waistcoats?|jerseys?)\b`
4. `knitwear` — `\b(knitwears?|knits?|turtlenecks?|roll[\s-]?necks?)\b`
5. Else → `null`

Ordering rationale: garment nouns (tee/sweater/shirt/polo) win before material adjectives (knit). "Cashmere Shirt" → `shirts_blouses`. "Knit Polo" → `shirts_blouses`. "Knit" alone → `knitwear`.

**Jackets & Coats sub-pass:**

1. **Jacket-specific silhouettes (always jacket):** `\b(bombers?|blazers?|anoraks?|windbreakers?|boleros?|perfectos?)\b` → `jackets`
2. **Coat-specific silhouettes (always coat):** `\b(trench(?:coats?|es)?|parkas?|peacoats?|overcoats?|raincoats?)\b` → `coats`
3. **Generic jacket:** `\b(jackets?)\b` → `jackets`
4. **Generic coat:** `\b(coats?)\b` → `coats`
5. Else → `null`

Ordering rationale: specific silhouettes override generic words. "Bomber Coat" → `jackets`. "Trench Jacket" → `coats`. Bare ambiguous words (puffer, shearling, cape, caban) fall through to `null`.

**Bags & Accessories sub-pass:**

1. `bags` — `\b(bags?|totes?|clutch(?:es)?|purses?|handbags?|backpacks?|satchels?|pouch(?:es)?|wallets?|briefcases?|duffels?|crossbody|baguettes?|pouchettes?|card[\s-]?holders?)\b`
2. `accessories` — `\b(belts?|scarves|scarf|headscarves|headscarfs?|gloves?|sunglasses|eyeglasses|glasses|eyewear|beanies?|hats?|caps?|berets?|headbands?|necklaces?|chokers?|bracelets?|earrings?|rings?|brooch(?:es)?|jewelry|jewellery|watch(?:es)?|bowtie|bow[\s-]?tie|pendants?|dog[\s-]?tags?|bangles?|mittens?|neckpieces?|umbrellas?|compact[\s-]?mirrors?|chapkas?|neckties?|ties?)\b`
3. Else → `null`

Ordering rationale: "Belt Bag" → `bags` (bag noun wins over belt modifier).

### Test cases (written BEFORE rules)

These drive the implementation. Each row is a failing test that the new rules must turn green.

**Tops:**

| Input title | Expected category | Expected subcategory |
|---|---|---|
| "T-Shirt" | Tops | `tees` |
| "Tee" | Tops | `tees` |
| "Tee Shirt" | Tops | `tees` |
| "Knit Tee" | Tops | `tees` |
| "Knit Polo Sweater" | Tops | `hoodies_sweaters` |
| "Crewneck Sweatshirt" | Tops | `hoodies_sweaters` |
| "Sweater Vest" | Tops | `hoodies_sweaters` |
| "Cardigan" | Tops | `hoodies_sweaters` |
| "Cashmere Shirt" | Tops | `shirts_blouses` |
| "Polo Shirt" | Tops | `shirts_blouses` |
| "Knit Polo" | Tops | `shirts_blouses` |
| "Button-Up Shirt" | Tops | `shirts_blouses` |
| "Blouse" | Tops | `shirts_blouses` |
| "Tank Top" | Tops | `shirts_blouses` |
| "Knit Turtleneck" | Tops | `knitwear` |
| "Turtleneck" | Tops | `knitwear` |
| "Knit" alone | Tops | `knitwear` |
| "Knitwear" | Tops | `knitwear` |
| "Comme des Garçons Special Piece" | Tops | `null` |
| "Top" alone | Tops | `null` |

**Jackets & Coats:**

| Input title | Expected category | Expected subcategory |
|---|---|---|
| "Denim Jacket" | Jackets & Coats | `jackets` |
| "Bomber" | Jackets & Coats | `jackets` |
| "Bomber Coat" | Jackets & Coats | `jackets` |
| "Shearling Jacket" | Jackets & Coats | `jackets` |
| "Puffer Jacket" | Jackets & Coats | `jackets` |
| "Blazer" | Jackets & Coats | `jackets` |
| "Anorak" | Jackets & Coats | `jackets` |
| "Windbreaker" | Jackets & Coats | `jackets` |
| "Bolero" | Jackets & Coats | `jackets` |
| "Denim Coat" | Jackets & Coats | `coats` |
| "Trench" | Jackets & Coats | `coats` |
| "Trench Coat" | Jackets & Coats | `coats` |
| "Trench Jacket" (rare) | Jackets & Coats | `coats` |
| "Parka" | Jackets & Coats | `coats` |
| "Peacoat" | Jackets & Coats | `coats` |
| "Overcoat" | Jackets & Coats | `coats` |
| "Puffer Coat" | Jackets & Coats | `coats` |
| "Shearling Coat" | Jackets & Coats | `coats` |
| "Puffer" alone | Jackets & Coats | `null` |
| "Shearling" alone | Jackets & Coats | `null` |
| "Cape" | Jackets & Coats | `null` |
| "Caban" | Jackets & Coats | `null` |

**Bags & Accessories:**

| Input title | Expected category | Expected subcategory |
|---|---|---|
| "Tote Bag" | Bags & Accessories | `bags` |
| "Belt Bag" | Bags & Accessories | `bags` |
| "Crossbody" | Bags & Accessories | `bags` |
| "Clutch" | Bags & Accessories | `bags` |
| "Backpack" | Bags & Accessories | `bags` |
| "Card Holder" | Bags & Accessories | `bags` |
| "Wallet" | Bags & Accessories | `bags` |
| "Belt" | Bags & Accessories | `accessories` |
| "Silk Scarf" | Bags & Accessories | `accessories` |
| "Sunglasses" | Bags & Accessories | `accessories` |
| "Beanie" | Bags & Accessories | `accessories` |
| "Tie" | Bags & Accessories | `accessories` |
| "Necktie" | Bags & Accessories | `accessories` |
| "Bracelet" | Bags & Accessories | `accessories` |
| "Watch" | Bags & Accessories | `accessories` |

Test framework: confirm during implementation. Likely vitest. Tests live next to [app/lib/stores.js](app/lib/stores.js).

### enrich_product RPC update

Add `p_subcategory text` parameter; COALESCE-write same as other editorial fields:

```sql
UPDATE products SET
  brand       = COALESCE(brand,       p_brand),
  title       = COALESCE(title,       p_title),
  category    = COALESCE(category,    p_category),
  subcategory = COALESCE(subcategory, p_subcategory)
WHERE handle = p_handle AND store_domain = p_store_domain;
```

Editorial-field invariant extended: subcategory writes only if NULL. Future re-enrich passes can fill NULLs but can't clobber a curated leaf.

### Dry-run backfill

Standalone Node script `scripts/backfillSubcategory.mjs`:

1. Reads every row where `available = true AND hidden = false AND category IN ('Tops','Jackets & Coats','Bags & Accessories')` (~4,775 rows).
2. Runs new `tryClassify()` against each row's existing `{ name, title, brand, productType, description }` — same inputs the live enrich uses.
3. **Writes nothing.** Outputs:
   - Per-parent leaf distribution: how many rows map to each leaf, how many to NULL.
   - Per-store same breakdown (spot domain-specific quirks).
   - 10 random sample rows per leaf (full title shown) for spot-check.
   - 20 random sample NULL rows so user can judge whether NULL-rate is acceptable.
   - Optional CSV with `{id, store_domain, handle, name, title, current_category, proposed_subcategory}` for offline review.

**Review gate:** results are reported back to user. User approves, or flags cases needing rule tweaks. Iterate until distribution looks right.

### Wet backfill (SQL file)

Only after dry-run approval. Same script, `--emit-sql` flag flips it from print-mode to file-mode. Emits a single `.sql` file containing:

```sql
BEGIN;
-- snapshot for rollback
CREATE TABLE products_subcategory_backfill_snapshot_<DATE> AS
  SELECT id, category, subcategory FROM products WHERE category IN ('Tops','Jackets & Coats','Bags & Accessories');

UPDATE products SET subcategory = 'tees' WHERE id IN (...);
UPDATE products SET subcategory = 'hoodies_sweaters' WHERE id IN (...);
-- ... etc per leaf
COMMIT;
```

User opens Supabase SQL Editor, pastes file, reviews, runs. Transaction-wrapped — all or nothing.

### Read-site updates

All in one PR per CLAUDE.md "Before editing" rule:

- **[app/lib/categories.js](app/lib/categories.js)** — replace `CATEGORY_SLUG_TO_DB` with `resolveCategoryFilter(slug)` returning `{ categoryDbValues: string[] | null, subcategorySlugs: string[] | null }`. Single source of truth.
- **[app/api/products/route.js](app/api/products/route.js)** — call new resolver; apply `.in("category", ...)` and/or `.in("subcategory", ...)` accordingly.
- **`get_interleaved_products` RPC** — add `p_subcategory text` parameter; filter on it when non-empty. Updated via SQL Editor.
- **`count_interleaved_products` RPC** — same parameter and filter.
- **Direct Supabase reads** ([MoreFromStore.js](app/components/MoreFromStore.js), PDP, homepage) — audit; most filter by store/brand/handle, not category. Update any that filter by category to also handle subcategory.

### Sequencing (deploy order)

Per CLAUDE.md "Schema/RPC changes apply to Supabase before dependent code merges":

1. Write tests + new `tryClassify()` rules. PR open, not merged.
2. Run dry-run backfill locally against production data (read-only). Report results. **Pause for user review.**
3. After approval: apply schema (`ADD COLUMN subcategory` + CHECK constraint) and RPC updates via SQL Editor.
4. Generate and run wet-backfill SQL file in SQL Editor.
5. Update read sites + `categories.js` resolver + `enrich/route.js` call sites. Push to PR.
6. Verify on Vercel preview before merging to main per workflow rule.

### Files touched

- [app/lib/stores.js](app/lib/stores.js) — `tryClassify()` sub-passes, new return shape
- [app/lib/categories.js](app/lib/categories.js) — slug-resolution shape change
- [app/api/products/route.js](app/api/products/route.js) — leaf-aware filter resolution
- [app/api/enrich/route.js](app/api/enrich/route.js) — both `assignCategory()` call sites pass new `subcategory` to RPC
- `scripts/backfillSubcategory.mjs` (new) — dry-run + SQL-emission
- Tests next to `app/lib/stores.js`
- Supabase via SQL Editor: `products` schema (column + CHECK), `enrich_product` RPC, `get_interleaved_products` RPC, `count_interleaved_products` RPC

### Verification

After deploy on Vercel preview:

1. **Leaf filter narrows.** Visit `/feed?category=tops_tees`. Result count should be ~283 (per investigation), not 1,638. Spot-check titles — should all be tee-shaped.
2. **Parent filter unchanged.** Visit `/feed?category=tops`. Result count and titles should match pre-deploy `/feed?category=tops`.
3. **NULL rows visible under parent.** Visit `/feed?category=jackets_coats`. Should include the indeterminate puffer/shearling/cape rows. Visit `/feed?category=jackets` and `/feed?category=coats` — neither should show those indeterminate rows.
4. **Each leaf returns disjoint sets.** Sum of leaf-filter counts ≤ parent-filter count. (May be less, due to NULL subcategory.)
5. **Mobile + desktop filter panel.** `MobileFilterPanel`'s atomic-commit invariant from CLAUDE.md still holds — APPLY does one `router.push` with the new leaf slug.
6. **PDP / homepage / `MoreFromStore`.** Spot-check that direct Supabase reads still work (they likely don't filter by category at all, but verify).
7. **`enrich_runs` telemetry.** Confirm next cron tick logs `subcategory_assigned` / `subcategory_null` counters (extend telemetry as part of the implementation).
8. **DB constraint.** Try an offending insert in SQL Editor (e.g. `UPDATE products SET subcategory = 'jackets' WHERE category = 'Tops' LIMIT 1`); CHECK should reject it.

### Open follow-ups (deferred, not in this spec)

- The 30 existing NULL-category rows — separate fix.
- Pre-existing fragility in `tryClassify()` rule ordering for broad buckets (irregular plurals, `productType` prepended unconditionally, 250-char description cap) — separate cleanup.
- Future fifth-leaf additions (e.g. splitting `bottoms` into `pants`/`shorts`/`skirts`) — same pattern can extend, but not now.
