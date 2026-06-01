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
read-only), snapshot first:
```sql
UPDATE products SET title = 'FW04 Aged Velvet Wallet' WHERE id = 5139850;
```
(User chose the typo-corrected spelling `Velvet`. Brand chip `UNDERCOVER` is
already shown separately, so it is omitted from the title.)

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
key, same credentials `/api/enrich` uses; not a committed route). For each of the
169 ids it calls the improved `cleanTitle({ name, rawDescription: description })`
and, when the new title is 2–7 words, emits/executes a **title-only** UPDATE:
```sql
UPDATE products SET title = '<new>' WHERE id = <id>;  -- brand/category untouched
```
Rationale for a direct title-only UPDATE over a `title=NULL`+`enrich_attempts=0`
reset:
- Avoids the raw-name flash on the card between reset and re-enrich.
- Avoids re-running the enrich route's hide gates — a `dolcevitahub.com`
  (FILTER_BY_BRAND) row could otherwise be hidden if re-resolved brand misses
  the allowlist. Touching only `title` removes that risk.
- Avoids category churn.

Snapshot the 169 `(id, title)` before running (rollback set). Skip any row whose
new title is still ≤1 word (no improvement). The defined target set is the
single-word-title / source-name-≥4-words predicate used in diagnosis.

## Critical files

- [app/api/enrich/route.js](app/api/enrich/route.js) — fallback call-site reorder (Track 1).
- [app/lib/handleFallback.js](app/lib/handleFallback.js) — helpers (read-only reference; the bug is the composition, not the helpers).
- [app/lib/__tests__/handleFallback.test.js](app/lib/__tests__/handleFallback.test.js) — mirror update + regression test.
- [app/lib/cleanTitle.js](app/lib/cleanTitle.js) — prompt tighten (Track 2).
- New one-off backfill script under `scripts/` (Track 2) — local run, not a route.

## Verification

1. `npx vitest run app/lib/__tests__/handleFallback.test.js` — existing 7
   integrated cases + new Undercover canary all green.
2. After the Track-1 data patch, re-run the diagnostic SQL: artifact buckets
   (`new arrival`, stray paren) = 0; NULL-title-visible stays 0.
3. After the Track-2 backfill, re-run the single-word-with-rich-source query —
   count drops from 169 to ~0 (only legitimately-sparse names like
   `1017 ALYX 9SM - Belt → Belt` may remain). Confirm visible-row count and
   per-store visible counts (esp. `dolcevitahub.com`) are unchanged (nothing got
   hidden).
4. On the Vercel preview branch: inspect the Undercover product card and a
   handful of re-cleaned `yourgarmentz.com` cards via the preview tools.

## Notes / risks

- All writes route through the **Supabase SQL Editor** or the local backfill
  script (service-role); the Supabase MCP here is read-only. Snapshot before
  each destructive run (CLAUDE.md workflow).
- Branch + Vercel preview; do not push to `main`. Merge only on explicit
  instruction.
- The prompt change affects all future enrichment — the sample regression check
  on already-good titles is the guard against introducing a new defect class.
