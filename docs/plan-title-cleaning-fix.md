# Fix broken & over-compressed product titles on production

## Context

A live item under **l'obscur** (`lobscur.com`) displays a malformed title:
`UNDERCOVER` + `"New Arrival) - FW04 Aged Velevet Wallet"` — note the dangling
`)` and the un-stripped `New Arrival` prefix. The user asked *why* this happened
and *how many* other displayed products have incorrect or unfulfilled title
cleaning. This plan captures the root-cause diagnosis and the agreed remediation
(user chose to address **both** problem buckets).

## Investigation findings (production, 7,270 visible rows)

The row in question (`id=5139850`) is **not** unfulfilled — `title` was written
as `"New Arrival) - FW04 Aged Velevet Wallet"`, with `brand=UNDERCOVER`,
`category`/`subcategory` set, `enrich_attempts=0`. Because `title` is non-NULL,
the `enrich_product` RPC's `COALESCE(title, p_title)` will **never** overwrite
it — it is permanently stuck unless directly patched.

Two distinct defect buckets, with two distinct root causes:

### Bucket 1 — Hard artifact (the reported item). Count: **exactly 1**
Produced by the **deterministic handle-fallback path** in
[app/api/enrich/route.js:173](app/api/enrich/route.js), not the LLM. Trace of
`name = "(New Arrival) UNDERCOVER - FW04 « But Beautiful » Aged velevet wallet"`,
handle brand `undercover`:

1. `nameWithoutBrand(name, "undercover")`
   ([app/lib/handleFallback.js:43](app/lib/handleFallback.js)) removes
   `UNDERCOVER` from the middle, then its final
   `.replace(/^[^A-Za-z0-9]+.../)` strips the **leading `(`** →
   `"New Arrival) - FW04 « But Beautiful » Aged velevet wallet"`.
2. `sanitizeFallbackTitle(...)`
   ([app/lib/handleFallback.js:27](app/lib/handleFallback.js)) strips the
   balanced `«…»`, but its parenthetical strip `/\([^)]*\)/g` requires a
   **balanced** `(...)`. The opening `(` is already gone, so the orphaned `)`
   and the `New Arrival` text survive → exactly the DB value.

The bug is **ordering**: `nameWithoutBrand` removes the leading `(` *before*
`sanitizeFallbackTitle` can delete the whole balanced `(New Arrival)`. An
artifact sweep (stray parens, guillemets/quotes, leading/trailing punctuation,
lowercase starts, brand-word leaks, double spaces, >7 words, NULL-title-visible)
found **zero** other rows — this is the only hard-artifact row, and there are
**zero** NULL-title (raw-name fallback) rows on production.

### Bucket 2 — Over-compression by the LLM. Count: **169 visible rows**
`cleanTitle` reduced rich source names to a bare generic noun, discarding
recoverable detail (material / silhouette / season). Examples:
`Roberto Cavalli shearling hand painted jacket → Jacket`,
`Dior fall 2003 velour dress → Dress`,
`Christian Lacroix runway maxi dress → Dress`. Distribution:
`Dress:51, Top:23, Jacket:20, Bag:12, Skirt:8, Set:8, …`, concentrated in
`yourgarmentz.com` (also `escoparis.com`, `dolcevitahub.com`). Root cause is the
prompt rule `[ONE detail max]` in
[app/lib/cleanTitle.js:54](app/lib/cleanTitle.js), which the model reads as
"zero or one" and routinely picks zero — despite the stated 2–7-word floor.

> **169 is the candidate set, not the change set.** A subset are *legitimately*
> sparse — names that are just `BRAND - Garment` (`ACNE STUDIOS - Sweater`,
> `Dress - Miu Miu`, `1017 ALYX 9SM - Belt`), where one word is the correct
> title. Re-running `cleanTitle` on those re-resolves to the same word, so the
> backfill's "skip if proposed ≤1 word / unchanged" rules treat them as no-ops.
> The actual rewrite count is determined by the dry-run, not assumed to be 169.

> Buckets considered and dismissed as false positives: `title == name` (12 — all
> correctly title-cased clean source names like `BEIGE TABI BOOTS → Beige Tabi
> Boots`); `runway`/`sold` (3 — legitimate archive descriptors).

## Remediation

### Track 1 — Fix the fallback artifact (code + test + data patch)

**Code** — [app/api/enrich/route.js:173-175](app/api/enrich/route.js): run
`sanitizeFallbackTitle` on the **raw name first**, so leading parentheticals are
removed while still balanced:
```js
const fallbackTitle = sanitizeFallbackTitle(
  toTitleCase(nameWithoutBrand(sanitizeFallbackTitle(row.name), handleBrand))
);
```
This produces `"FW04 Aged Velevet Wallet"` for the canary. The helper APIs in
`app/lib/handleFallback.js` are unchanged; only the composition order changes.

**Test** — [app/lib/__tests__/handleFallback.test.js](app/lib/__tests__/handleFallback.test.js):
update the `recoverFromHandleFallback` mirror (line 15-17) to the new ordering,
and add a regression case:
```js
recoverFromHandleFallback(
  "(New Arrival) UNDERCOVER - FW04 « But Beautiful » Aged velevet wallet",
  "new-arrival-undercover-fw04-but-beautiful-aged-velevet-wallet",
) // → { brand: "UNDERCOVER", title: "FW04 Aged Velevet Wallet" }
```
All seven existing integrated cases still pass under the new order (verified by
hand-trace; confirm with the test run). First confirm `brandFromHandle` resolves
`undercover` from that handle.

**Data patch** — the code fix only protects future syncs; the existing row is
COALESCE-locked. Direct UPDATE via the **Supabase SQL Editor** (MCP is
read-only). **State-guarded compare-and-swap** so it is a no-op if the row was
already corrected or changed since diagnosis:
```sql
UPDATE products SET title = 'FW04 Aged Velvet Wallet'
WHERE id = 5139850
  AND store_domain = 'lobscur.com'
  AND title = 'New Arrival) - FW04 Aged Velevet Wallet'
RETURNING id, title;
```
Expect exactly one row returned. Zero rows ⇒ the row drifted — re-inspect before
forcing. (User chose the typo-corrected spelling `Velvet`. Brand chip
`UNDERCOVER` is already shown separately, so it is omitted from the title.)

### Track 2 — Re-clean the 169 over-compressed titles (prompt + backfill)

**Prompt** — [app/lib/cleanTitle.js:53-60](app/lib/cleanTitle.js): tighten the
TITLE rules so a distinguishing detail is retained when present — e.g. replace
`[ONE detail max]` with guidance to *include the single most distinctive detail
(material, silhouette, color, or season) when the source name carries one; never
reduce to a bare garment noun if a usable descriptor exists*, while keeping the
≤7-word cap and 2-word floor. Validate the new prompt on a ~15-row sample of the
over-compressed names (expect detail retained) **and** a sample of already-good
titles (expect no regression, still ≤7 words) before any mass write.

**Backfill** — a one-off local maintenance script (service-role key + OpenAI
key, the same credentials `/api/enrich` already writes with; not a committed
route). The frozen target set lives in
[docs/snapshots/2026-06-01-title-backfill-targets.json](docs/snapshots/2026-06-01-title-backfill-targets.json)
(170 ids: 1 artifact + 169 over-compression). Procedure:

1. **Re-derive & diff.** Run the bucket-2 predicate (below) against production,
   diff the live id set against the frozen snapshot, and **log** additions /
   removals. Drift is expected (hourly sync) — surface it, don't silently widen
   or narrow the run.
2. **Recompute.** For each candidate, call the improved
   `cleanTitle({ name, rawDescription: description })`.
3. **Decide per row** — write only if ALL hold; otherwise skip with a logged
   reason:
   - `cleanTitle` returned non-null (skip + log on null — transient OpenAI
     failure or echo/brand-leak guard rejection; never write a null result).
   - new title is **2–7 words** (skip ≤1-word: legitimately-sparse names like
     `ACNE STUDIOS - Sweater → Sweater` correctly re-resolve to one word).
   - new title **differs** from the current title.
4. **Write — parameterized, never string-built SQL.** Use the Supabase JS client
   exactly as `/api/enrich` does — `supabaseAdmin.from("products").update({ title:
   newTitle }).eq("id", id).eq("title", oldTitle).select("id, title")`. The
   `.eq("title", oldTitle)` is a **compare-and-swap**: a row whose title changed
   since step 1 updates zero rows (logged, not forced). This removes the
   apostrophe/escaping and injection surface entirely — `newTitle` is bound as a
   parameter, never interpolated into a SQL literal. **Touch `title` only**;
   `brand`/`category`/`enrich_attempts` untouched.
5. **Dry-run first.** A `--dry-run` flag prints `id, store_domain, old_title,
   proposed_title, decision` for every candidate and writes nothing. Review the
   diff, then re-run to apply.

Rationale for a direct title-only UPDATE over a `title=NULL`+`enrich_attempts=0`
reset: avoids the raw-name flash between reset and re-enrich; avoids re-running
the enrich route's hide gates (a `dolcevitahub.com` FILTER_BY_BRAND row could
otherwise be hidden if the re-resolved brand misses the allowlist); avoids
category churn.

> Why a script with `supabaseAdmin` rather than SQL pasted into the Editor:
> CLAUDE.md routes *ad-hoc* manual SQL through the Editor, but this is a
> programmatic, LLM-generated backfill — `/api/enrich` itself writes via the
> service-role client, so this is consistent, and parameterized writes are the
> only safe way to handle generated text.

## Diagnostic SQL (reproducible)

All counts in this plan come from these exact queries (run read-only via the
Supabase MCP, project `pnjewddyeslsbozoeyks`, against `available=true AND
hidden=false`). Re-run them at execution time to confirm the picture hasn't
drifted.

```sql
-- Bucket A: unfulfilled (NULL title, visible). Diagnosed = 0.
SELECT count(*) FROM products WHERE available AND NOT hidden AND title IS NULL;

-- Bucket 1: hard artifacts (stray paren / "new arrival"). Diagnosed = 1 (id 5139850).
SELECT id, store_domain, brand, title, name FROM products
WHERE available AND NOT hidden
  AND (title ILIKE '%new arrival%' OR title LIKE '%(%' OR title LIKE '%)%');

-- Artifact sweep (all 0): guillemets/quotes, leading/trailing punct, lowercase
-- start, brand-word leak, double space, >7 words.
-- (See git history of this plan for the full battery; each returned 0.)

-- Bucket 2: over-compression — single-word title from a >=4-word source name.
-- Diagnosed = 169 (frozen in docs/snapshots/2026-06-01-title-backfill-targets.json).
SELECT id, store_domain, brand, title AS old_title, name FROM products
WHERE available AND NOT hidden AND title IS NOT NULL
  AND array_length(regexp_split_to_array(btrim(title),'\s+'),1) = 1
  AND array_length(regexp_split_to_array(btrim(name),'\s+'),1) >= 4
ORDER BY id;
```

## Critical files

- [app/api/enrich/route.js](app/api/enrich/route.js) — fallback call-site reorder (Track 1).
- [app/lib/handleFallback.js](app/lib/handleFallback.js) — helpers (read-only reference; the bug is the composition, not the helpers).
- [app/lib/__tests__/handleFallback.test.js](app/lib/__tests__/handleFallback.test.js) — mirror update + regression test.
- [app/lib/cleanTitle.js](app/lib/cleanTitle.js) — prompt tighten (Track 2).
- [docs/snapshots/2026-06-01-title-backfill-targets.json](docs/snapshots/2026-06-01-title-backfill-targets.json) — frozen Track-2 target set (audit baseline).
- New one-off backfill script under `scripts/` (Track 2) — local run, `supabaseAdmin` parameterized writes + `--dry-run`, not a route.

## Verification

1. `npx vitest run app/lib/__tests__/handleFallback.test.js` — existing 7
   integrated cases + new Undercover canary all green.
2. After the Track-1 data patch, re-run the diagnostic SQL: artifact buckets
   (`new arrival`, stray paren) = 0; NULL-title-visible stays 0.
3. Track-2 dry-run: review the `id, old_title, proposed_title, decision` table
   and the snapshot add/remove diff before applying. After the apply, re-run the
   bucket-2 predicate — the count drops, but **not to 0**: legitimately-sparse
   names (`1017 ALYX 9SM - Belt → Belt`, `Dress - Miu Miu → Dress`) correctly
   stay single-word and are expected to remain. Confirm total visible-row count
   and per-store visible counts (esp. `dolcevitahub.com`) are unchanged (the
   title-only writes touch no visibility column, so nothing should hide).
4. On the Vercel preview branch: inspect the Undercover product card and a
   handful of re-cleaned `yourgarmentz.com` cards via the preview tools.

## Notes / risks

- All writes route through the **Supabase SQL Editor** (the single Track-1 patch)
  or the local backfill script's parameterized `supabaseAdmin` writes; the
  Supabase MCP here is read-only.
- Every production write is **state-guarded** (compare-and-swap on the current
  title) so reruns and concurrent edits can't clobber newer state — the backfill
  is idempotent.
- Backfill titles are **never** interpolated into SQL strings; they bind as
  parameters through the JS client. Avoids the apostrophe-breakage / generated-
  text-to-SQL hazard.
- Branch + Vercel preview; do not push to `main`. Merge only on explicit
  instruction.
- The prompt change affects all future enrichment — the sample regression check
  on already-good titles is the guard against introducing a new defect class.

## Revision history

- 2026-06-01: Hardened the Track-2 backfill after a Codex adversarial review —
  parameterized state-guarded writes (was raw SQL by id), embedded the exact
  diagnostic SQL, and froze the target set in `docs/snapshots/`.
