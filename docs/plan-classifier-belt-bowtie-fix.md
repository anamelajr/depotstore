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
`bow[\s-]?tie | bowtie`. Two reasonable shapes — pick one:

```js
// option A: one combined alternation
if (/\b(neckties?|ties?|belts?|bow[\s-]?tie|bowtie)\b(?![\s-]?dye)/.test(text)) {
  return "Bags & Accessories";
}

// option B: keep the lookahead scoped to ties only (slightly clearer intent)
if (/\b(neckties?|ties?)\b(?![\s-]?dye)/.test(text) ||
    /\b(belts?|bow[\s-]?tie|bowtie)\b/.test(text)) {
  return "Bags & Accessories";
}
```

Option B is preferable — the `(?![\s-]?dye)` lookahead was only there for
`tie-dye`, and there is no analogous concern for `belt` or `bow tie`. Keeping
them in separate alternations also makes the intent obvious to a future
reader.

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

// in "flat buckets":
["Belt Dress", "Dresses & Skirts", null],
["Belt Skirt", "Dresses & Skirts", null],
["Pants With Belt", "Bottoms", null],

// regression: keep accessories working
// (already present at line 77 for "Belt" — add bow tie)
// in "Bags & Accessories leaves":
["Bow Tie",     "Bags & Accessories", "accessories"],
["Silk Bow Tie","Bags & Accessories", "accessories"],
```

### 3. One-time DB cleanup (Supabase SQL Editor — MCP is read-only)

The 10 currently-wrong rows have `category` set, so the COALESCE write in
the `enrich_product` RPC will NOT overwrite them on next cron run. NULL
them out so the next enrich pass re-classifies via the fixed rules.

The IDs are derivable from this query (verified in investigation):

```sql
-- Preview first:
SELECT id, handle, store_domain, brand, title, category, subcategory
FROM products
WHERE category = 'Bags & Accessories'
  AND hidden = false
  AND available = true
  AND (
    -- belt hijacks (8 rows)
    title IN (
      '2004 Baggy Pants With Sleeve Belt',
      'Velvet Skirt With Braid Belt',
      'SS98 Strapless Gown Logo Belt',
      'Nylon Dress With Belt',
      'White Karate Belt Dress',
      'Tweed Jacket With Belt',
      'FW1999 Wool Belt Jacket',
      '2012 Belt Leather Jacket'
    )
    -- bow tie hijacks (2 rows)
    OR title IN (
      'SS2008 Bow Tie Top',
      '2012 White Bow Tie Shirt'
    )
  );

-- Then NULL out:
UPDATE products
SET category = NULL, subcategory = NULL, enrich_attempts = 0
WHERE … -- same predicate
```

Resetting `enrich_attempts = 0` ensures these rows are picked up by the
next enrich drain even if they had previously maxed out.

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
