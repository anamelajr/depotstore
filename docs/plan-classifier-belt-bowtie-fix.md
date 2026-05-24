# Fix `belt` / `bow tie` hijacking garment classification

## Context

Investigation (logged in this session) confirmed a deterministic
classifier bug in [app/lib/category-classifier.js:47-50](app/lib/category-classifier.js:47).
The loose-mode Bags & Accessories regex at **rule 2** contains the bare
tokens `belts?` and `bow[\s-]?tie | bowtie`. Rule 2 runs BEFORE the
garment rules (3 Jackets, 4 Dresses, 4b Tops, 5 Bottoms), so any title
containing one of those words plus a garment noun short-circuits into
"Bags & Accessories" before the garment rule can fire.

User-reported examples — all reproduced from production data:
- `MAISON MARTIN MARGIELA — 2012 Belt Leather Jacket` (in B&A, should be Jackets & Coats)
- `GUCCI — SS2008 Bow Tie Top` (in B&A, should be Tops)
- `MAISON MARGIELA — 2012 White Bow Tie Shirt` (in B&A, should be Tops)

Full DB sweep found **10 visible miscategorised rows** out of 1,053 visible
B&A items (~1%). All 10 are caused by these two tokens only — `belt` (8
rows), `bow tie` (2 rows). No other modifier token (`scarf`, `choker`,
`pouch`, `necklace`, `brooch`, `cap`) currently produces hijacks in the
dataset.

The codebase already encodes this exact class-of-bug awareness:
- Rule 2's comment ([line 33-37](app/lib/category-classifier.js:33))
  excludes `collars?`, `hoods?`, `armbands?` for being modifier-prone.
- Rule 7.5 ([line 123-132](app/lib/category-classifier.js:123)) was added
  to move bare `ties?` AFTER the garment rules so `"Tie Blouse"` correctly
  classifies as Tops.

`belts?` and `bow[\s-]?tie` just never got the same treatment. The fix
extends the existing late-rule pattern to cover them.

## Change

### 1. [app/lib/category-classifier.js](app/lib/category-classifier.js)

Move `belts?` and `bow[\s-]?tie | bowtie` out of rule 2's
`bagsAccessoriesRx` and into rule 7.5's late B&A clause.

**Rule 2 (line 47):** remove `belts?|`, `bowtie|`, `bow[\s-]?tie|` from
`bagsAccessoriesRx`.

**Rule 7.5 (line 130):** extend the existing regex from
`/\b(neckties?|ties?)\b(?![\s-]?dye)/` to also catch `belts?` and
`bow[\s-]?tie | bowtie`. Keep the `tie-dye` lookahead scoped to the
`ties?` arm only — split the regex into two alternations rather than
folding `belts?` and `bow tie` under the same lookahead:

```js
if (/\b(neckties?|ties?)\b(?![\s-]?dye)/.test(text) ||
    /\b(belts?|bow[\s-]?tie|bowtie)\b/.test(text)) {
  return "Bags & Accessories";
}
```

Why split: a single combined alternation
`/\b(neckties?|ties?|belts?|bow[\s-]?tie|bowtie)\b(?![\s-]?dye)/`
would semantically extend the `-dye` exclusion to `belt-dye` and
`bow-tie-dye` too. Those aren't real fashion terms today, so the
behavioral impact is zero — but a future reader sees the lookahead
and reasonably assumes it applies only to `ties?`. The split form
makes the scope of the exclusion obvious.

**Leaf classifiers — no changes needed:**
- [classifyBagsAccessoriesLeaf:180-185](app/lib/category-classifier.js:180)
  already lists `belts?` and `bow[\s-]?tie | bowtie` in its accessories
  arm. Genuine belts still classify as `accessories`. The `bags?` arm runs
  FIRST so `"Belt Bag" → bags` still works.
- `classifyJacketsCoatsLeaf` already matches `\bjackets?\b` →
  `"Belt Leather Jacket"` will correctly receive `jackets` leaf.
- `classifyTopsLeaf` matches `shirts?` and `blouses?` → `"Bow Tie Shirt"`
  receives `shirts_blouses`.

### 2. [app/lib/__tests__/stores.test.js](app/lib/__tests__/stores.test.js)

The existing `"Belt" → B&A/accessories` assertion (line 77) still passes
because the late rule catches it. Add **positive coverage for the new
behavior** in the relevant describe blocks:

```js
// in "Jackets & Coats leaves":
["Belt Leather Jacket",   "Jackets & Coats", "jackets"],
["Tweed Jacket With Belt","Jackets & Coats", "jackets"],

// in "Tops leaves":
["Bow Tie Top",   "Tops", "shirts_blouses"],
["Bow Tie Shirt", "Tops", "shirts_blouses"],
["Tie Dye Shirt", "Tops", "shirts_blouses"], // lookahead boundary: rule 4b wins before 7.5

// in "flat buckets":
["Belt Dress", "Dresses & Skirts", null],
["Belt Skirt", "Dresses & Skirts", null],
["Pants With Belt", "Bottoms", null],

// regression: keep accessories working
// (already present at line 77 for "Belt" — add bow tie)
// in "Bags & Accessories leaves":
["Bow Tie",     "Bags & Accessories", "accessories"],
["Silk Bow Tie","Bags & Accessories", "accessories"],
["Tie Dye Bag", "Bags & Accessories", "bags"],   // lookahead boundary: rule 2 `bags?` wins
```

### 3. One-time DB cleanup (Supabase SQL Editor — MCP is read-only)

The 10 currently-wrong rows have `category` set, so the COALESCE write in
the `enrich_product` RPC will NOT overwrite them on next cron run. NULL
them out so the next enrich pass re-classifies via the fixed rules.

Target rows by `(store_domain, handle)` — the table's UNIQUE constraint,
the same key the `enrich_product` RPC writes against, and what the app
treats as product identity. Title-based predicates were rejected in
adversarial review: `title` has no uniqueness constraint, so a PDP edit
or a same-titled sibling row syncing in between writing and running the
SQL could silently mutate the wrong row (and the `enrich_attempts = 0`
reset would burn OpenAI quota on it next cron).

```sql
-- Step 1 — Preview. Run this on its own and confirm exactly 10 rows.
SELECT id, store_domain, handle, brand, title, category, subcategory
FROM products
WHERE (store_domain, handle) IN (
  ('dolcevitahub.com',    '2004-dolce-gabbana-sleeve-belt-pants'),
  ('dolcevitahub.com',    '2012-maison-martin-margiela-x-h-m-belt-leather-jacket'),
  ('dolcevitahub.com',    '2012-maison-margiela-h-m-white-bow-tie-trompe-l-oeil-shirt'),
  ('graindesell.shop',    'gucci-fw1999-wool-belt-jacket'),
  ('graindesell.shop',    'prada-ss2000-nylon-dress-with-belt'),
  ('dolcevitahub.com',    'ss2008-gucci-black-propaganda-bow-tie-top'),
  ('yourgarmentz.com',    'gucci-tom-ford-1998-black-strapless-gown-logo-belt'),
  ('yourgarmentz.com',    'dolce-gabbana-swarovski-tweed-jacket-special-piece'),
  ('lesarchivesparis.com','gucci-by-tom-ford-fw-2002-velvet-skirt-with-braid-belt'),
  ('www.dotcomme.net',    'yohji-yamamoto-white-karate-belt-dress')
);

-- Step 2 — Apply. The DO block is atomic: if RAISE EXCEPTION fires,
-- the UPDATE rolls back automatically. No operator vigilance required.
-- A previous version of this script used BEGIN/COMMIT with a SELECT
-- count(*) "guard" and a "COMMIT only if ..." comment — that guard
-- was advisory only and would still commit on a wrong row count.
DO $$
DECLARE
  affected     INT;
  updated_ids  BIGINT[];
BEGIN
  WITH updated AS (
    UPDATE products p
    SET category = NULL, subcategory = NULL, enrich_attempts = 0
    FROM (VALUES
      ('dolcevitahub.com',    '2004-dolce-gabbana-sleeve-belt-pants'),
      ('dolcevitahub.com',    '2012-maison-martin-margiela-x-h-m-belt-leather-jacket'),
      ('dolcevitahub.com',    '2012-maison-margiela-h-m-white-bow-tie-trompe-l-oeil-shirt'),
      ('graindesell.shop',    'gucci-fw1999-wool-belt-jacket'),
      ('graindesell.shop',    'prada-ss2000-nylon-dress-with-belt'),
      ('dolcevitahub.com',    'ss2008-gucci-black-propaganda-bow-tie-top'),
      ('yourgarmentz.com',    'gucci-tom-ford-1998-black-strapless-gown-logo-belt'),
      ('yourgarmentz.com',    'dolce-gabbana-swarovski-tweed-jacket-special-piece'),
      ('lesarchivesparis.com','gucci-by-tom-ford-fw-2002-velvet-skirt-with-braid-belt'),
      ('www.dotcomme.net',    'yohji-yamamoto-white-karate-belt-dress')
    ) AS t(store_domain, handle)
    WHERE p.store_domain = t.store_domain
      AND p.handle       = t.handle
      AND p.category     = 'Bags & Accessories'  -- defensive: skip if already corrected
    RETURNING p.id
  )
  SELECT count(*), array_agg(id ORDER BY id)
    INTO affected, updated_ids
    FROM updated;

  IF affected <> 10 THEN
    RAISE EXCEPTION
      'Expected 10 rows updated, got % (ids=%)', affected, updated_ids;
  END IF;

  RAISE NOTICE 'Cleanup OK: % rows updated, ids=%', affected, updated_ids;
END $$;
```

Why these specifics:
- `(store_domain, handle)` is the table's UNIQUE constraint, so each pair
  matches at most one row by definition — no silent multi-row mutations.
- The defensive `p.category = 'Bags & Accessories'` clause makes the
  statement idempotent: a re-run after a partial fix is a no-op.
- The DO block is implicitly transactional in Postgres. `RAISE EXCEPTION`
  aborts the block and rolls back the UPDATE — so a wrong row count
  cannot commit. The `RAISE NOTICE` on success surfaces the count and IDs
  in the SQL Editor output for after-the-fact verification.
- `enrich_attempts = 0` ensures the cron drain picks these up even if
  they had previously maxed out the attempt counter.

## Verification

1. **Unit tests pass:** `npm test -- stores.test.js` (or full `npm test`).
   The four new garment-with-belt rows and two new bow-tie-garment rows
   should classify correctly; existing belt/tie/necktie accessory rows
   should still pass.
2. **Re-classify in a Node REPL** (optional sanity check):
   ```js
   import { assignCategory } from "./app/lib/stores.js";
   for (const title of [
     "2012 Belt Leather Jacket",
     "SS2008 Bow Tie Top",
     "2012 White Bow Tie Shirt",
     "Black Leather Belt",
     "Silk Bow Tie",
     "Belt Bag",
   ]) console.log(title, "→", assignCategory({ title }));
   ```
3. **Branch + Vercel preview** (per CLAUDE.md workflow — no direct push to
   main). On the preview:
   - Filter feed by Jackets & Coats → confirm the 3 belt-jacket rows appear.
   - Filter feed by Tops → confirm the 2 bow-tie rows appear.
   - Filter feed by Bags & Accessories → confirm pure belt / bow-tie items
     (e.g. plain Hermes belts) still appear.
4. **Run the SQL NULL-out in Supabase SQL Editor** (manual, snapshot
   first per CLAUDE.md). Trigger `/api/cron` or wait for the next hourly
   run; verify the 10 rows now hold their correct category.

## Out of scope

- No broader audit of strict-mode description hits (Pass 3/4) — current
  data shows no regressions from those paths.
- No proactive moves for `scarf`, `choker`, `pouch`, `cap` — investigation
  found zero collisions in production. Revisit if drift appears.
- No changes to `classifyBagsAccessoriesLeaf` — `belts?` and `bow tie`
  must stay there so the late-rule items still get the `accessories`
  leaf.
