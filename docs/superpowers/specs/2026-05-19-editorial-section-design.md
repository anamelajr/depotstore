# Dépôt Editorial Section — Design & Plan

## Context

Dépôt is a curated archive-fashion feed. Today the platform reads as a
shop: stores, products, filters. There is no place for the curatorial
voice — the *why* behind a designer, the visual codes, the position the
archive takes. This change introduces an editorial section: short,
opinionated, image-led pages — one per designer/brand for MVP — that
sit alongside the feed and let Dépôt act with curatorial authority
rather than only as inventory.

The goal is one entry shipped end-to-end (Rick Owens), with an
architecture that scales to many entries without a redesign per page.
The page should feel like a fashion publication, not a product page:
generous whitespace, narrow text columns, large hero typography, room
to breathe.

A secondary deliverable is a CLI authoring tool that uses GPT-5.5 to
draft editorial text given optional source material (URLs and local
files used as research / style references / personal notes). The CLI
writes a complete `.js` module the author then reviews, edits, and
commits. Hand-written entries use the same data shape; AI generation
is one path, not the only path.

## Approved decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Route | `/editorial` (index) + `/editorial/[slug]` (entry) |
| Content storage | JS module per entry at `content/editorial/<slug>.js` |
| Image storage | `public/editorial/<slug>/` (hero + inline, git-tracked) |
| Subject scope (MVP) | Designer / brand only |
| Hero typography | Inter-400 sentence-case title, mono subtitle, single-line byline |
| Hero layouts (MVP) | All four: `image-right`, `image-left`, `image-below`, `image-pair-top` |
| Body block types | `text`, `image`, `pullquote`, `section-heading`, `image-pair` |
| Curated section label | "PIECES FEATURED" with sublabel `N pieces · hand-picked` |
| Missing curated products | Silently drop; backfill from brand pool if section thins below 4 |
| "More from" section | Reuses existing brand filter (`unaccent + ilike`); excludes curated handles |
| Tail link | "← Back to editorial" linking to `/editorial` index |
| Index page (MVP) | Yes — minimal list of entries |
| AI drafting model | `gpt-5.5` (not the existing `gpt-5.4-mini` used elsewhere) |
| AI source material | Optional URLs + local text/markdown files used as research, style refs, and personal notes |

## Architecture

### Route tree (additions only)

```
app/
  editorial/
    page.js                  # index — lists all entries
    [slug]/
      page.js                # entry — renders one editorial
```

All other routes (`/`, `/feed`, `/product/[handle]`, `/stores`,
`/saved`, `/designers`) are unchanged. The root `app/layout.js` is
unchanged — editorial inherits the existing dark nav + footer.

### Content tree (additions only)

```
content/
  editorial/
    index.js                 # exports an ordered array of entries by importing each module
    rick-owens.js            # the MVP entry — the JS module described below

public/
  editorial/
    rick-owens/
      hero.jpg
      01.jpg, 02.jpg, …
```

`content/editorial/index.js` does the imports. The index page imports
from there. The `[slug]/page.js` imports the matching module by slug.
No filesystem reads at runtime — all static imports, all tree-shaken,
all server-rendered.

### Component tree (additions only)

```
app/editorial/_components/
  EditorialHero.js           # switch on layout: image-right | image-left | image-below | image-pair-top
  EditorialBody.js           # iterates blocks[], renders one Block per item
  Block.js                   # switch on type: text | image | pullquote | section-heading | image-pair
  PiecesFeatured.js          # curated products grid (server component, fetches at request time)
  MoreFromDesigner.js        # dynamic brand-filtered grid (server component)
  EditorialIndexCard.js      # used by /editorial index — one card per entry

app/editorial/_lib/
  fetchEditorialProducts.js  # combined fetch for both PiecesFeatured + MoreFromDesigner
```

The leading underscore on `_components` and `_lib` keeps Next.js from
treating them as routable.

### Data model — one entry

```js
// content/editorial/rick-owens.js
export default {
  slug: 'rick-owens',
  publishedAt: '2026-05-19',       // ISO date, used for sort + byline

  hero: {
    layout: 'image-right',          // 'image-right' | 'image-left' | 'image-below' | 'image-pair-top'
    eyebrow: 'Editorial',           // small mono label above title
    title: 'Rick Owens',
    subtitle: 'The silhouette as architecture.\nThe body as subversion.',
    byline: 'By DÉPÔT',
    images: ['hero.jpg'],           // 1 image for layouts 1/2/3; 2 images for layout 4
    imageAlt: ['Rick Owens FW04 leather cape on concrete stairs.'],
  },

  // brand filter for "More from" — separated from display title in case
  // DB casing/spelling differs (it usually does after cleanTitle).
  brandFilter: 'Rick Owens',

  // hand-picked products. {storeDomain, handle} pair — handle alone is
  // not unique across stores.
  curatedProducts: [
    { storeDomain: 'esco.example', handle: 'drkshdw-cropped-leather-cape' },
    { storeDomain: 'esco.example', handle: 'fw04-strobe-leather-jacket' },
    { storeDomain: 'tagliatela.example', handle: 'geobasket-high-black' },
    { storeDomain: 'dotcomme.example', handle: 'drape-wool-trouser-fw19' },
    { storeDomain: 'esco.example', handle: 'megalace-combat-boot' },
    { storeDomain: 'tagliatela.example', handle: 'cargo-pod-bomber-carbon' },
  ],

  blocks: [
    { type: 'text', width: 'narrow', dropcap: true, body: 'In a fashion landscape that rarely pauses...' },
    { type: 'section-heading', text: 'Architecture as attitude' },
    { type: 'text', width: 'narrow', body: 'Owens has often spoken about architecture...' },
    { type: 'image', src: '03.jpg', width: 'full-bleed', alt: '...' },
    { type: 'pullquote', text: 'I am a designer of survivors. People who carry sadness with elegance.', attribution: 'Rick Owens, 2004' },
    { type: 'text', width: 'narrow', body: 'The quote is twenty years old...' },
    { type: 'image', src: '04.jpg', width: 'wide', caption: 'FW04 leather, slung shoulder.', alt: '...' },
    { type: 'section-heading', text: 'The materials, the palette' },
    { type: 'text', width: 'narrow', body: 'Black, dust, oyster, slate...' },
    { type: 'image-pair', images: [{ src: '05.jpg', alt: '...' }, { src: '06.jpg', alt: '...' }] },
    { type: 'text', width: 'narrow', body: 'To wear Owens is to take a position...' },
  ],
};
```

Image `src` is resolved at render time as
`/editorial/<slug>/<src>` — the entry author writes filenames only.

### Block schema details

- **text** — `{ type, width: 'narrow' | 'wide', body: string, dropcap?: boolean }`. `body` is rendered as-is (newline-separated paragraphs split client-side). No Markdown in MVP — keep the renderer dumb. If italics or emphasis are needed later, swap to a small Markdown parser. Drop-cap is opt-in per block.
- **image** — `{ type, src, width: 'full-bleed' | 'wide' | 'narrow', align?: 'left' | 'right' | 'center', alt: string, caption?: string }`.
- **pullquote** — `{ type, text, attribution?: string }`. Renders with Playfair italic, left rule.
- **section-heading** — `{ type, text }`. Mono caps with thin top rule.
- **image-pair** — `{ type, images: [{ src, alt }, { src, alt }] }`. Always two; renders 2-column with even gap.

### Hero layouts

Each is a discrete renderer; selected by `hero.layout`. All share the
chrome (Dépôt nav above, footer below) and the same typography
(eyebrow mono, sentence-case sans title, mono subtitle, mono byline).

- **image-right** — 2-col grid, title left, image right (4:5 aspect).
- **image-left** — 2-col grid, mirrored.
- **image-below** — single column, title block centered, full-width photo (16:9) underneath.
- **image-pair-top** — two images at top (3:4 each), title block below.

### Product sections — fetching

Both `PiecesFeatured` and `MoreFromDesigner` are **server components**
that fetch at request time using the Supabase anon client (same
pattern as `MoreFromStore.js` — direct DB read, dodges
`NEXT_PUBLIC_BASE_URL` ambiguity).

`fetchEditorialProducts.js` does both reads:

1. **Curated** — `.in('handle', chunkArray(handles, 100))` matched
   against `store_domain` pair, plus `available=true` and `hidden=false`.
   Returns rows in the **order the author specified** (re-sort
   client-side by handle index — Supabase IN does not preserve order).
2. **More from** — `.ilike('brand', '%' + brandFilter + '%')` with the
   `unaccent` extension (same as the feed's brand filter via the
   `p_brand` path), `available=true`, `hidden=false`, excludes any
   handle in the curated list, limit 8, order `synced_at DESC, id DESC`.
3. **Backfill** — if the curated rows returned < 4, top up with rows
   from the brand pool (excluding both curated handles and "More from"
   handles to avoid the same product appearing twice).

Both functions chunk handle arrays through `app/lib/chunk.js` (size 100).

## Files to create

```
app/editorial/page.js                                # index
app/editorial/[slug]/page.js                         # entry — generateStaticParams + generateMetadata
app/editorial/_components/EditorialHero.js
app/editorial/_components/EditorialBody.js
app/editorial/_components/Block.js
app/editorial/_components/PiecesFeatured.js
app/editorial/_components/MoreFromDesigner.js
app/editorial/_components/EditorialIndexCard.js
app/editorial/_lib/fetchEditorialProducts.js
content/editorial/index.js
content/editorial/rick-owens.js
public/editorial/rick-owens/hero.jpg                 # placeholder until real assets
public/editorial/rick-owens/{01..06}.jpg             # placeholders
scripts/draftEditorial.mjs                           # CLI for AI drafts
```

## Files to modify

- **`app/components/DesktopNav.js` + `app/components/Nav.js`** — add an "Editorial" link to the nav. Use `buildFreshFeedUrl` semantics if you want a top-level link that wipes feed params (not relevant here — editorial isn't the feed). Just a plain `<Link href="/editorial">`.
- **No other modifications.** No changes to `/api/products`, no RPC changes, no schema changes.

## Reuse from the existing codebase

| Surface | File | What we reuse |
|---|---|---|
| Anon Supabase client | `app/lib/supabase.js` | Direct anon-client reads from server components |
| Product-handle IN chunking | `app/lib/chunk.js` (`chunkArray`, size 100) | Curated query handle list |
| Brand filter semantics | `unaccent + ilike` pattern from `/api/products` | "More from Designer" |
| Live row → card mapping | `ProductCard.js` (existing) | Both curated and "More from" grids render through `ProductCard` |
| Missing title fallback | `ProductCard` already falls back `title ?? name ?? 'Untitled'` | No changes needed |
| Fonts | `Playfair_Display`, `Geist`, `Geist_Mono` already loaded in `app/layout.js` | All editorial typography uses these |
| Cream background | `#f5f2ed` (homepage hero) | Editorial page background |

## CLI: `scripts/draftEditorial.mjs`

### Usage

```bash
node scripts/draftEditorial.mjs \
  --slug rick-owens \
  --title "Rick Owens" \
  --brand "Rick Owens" \
  --layout image-right \
  --source ./drafts/research/owens-bof-profile.md \
  --source ./drafts/research/owens-interview.txt \
  --source https://example.com/owens-runway-review \
  --style ./drafts/style/dépôt-voice-guide.md \
  --note "Lean into the architecture metaphor. Owens FW04 era is the heart."
```

All flags except `--slug` are optional. `--source`, `--style`, and
`--note` are repeatable.

### Behavior

1. Loads `.env.local` via `dotenv`, reads `OPENAI_API_KEY`.
2. Collects source material:
   - For each `--source <path-or-url>`: if a URL, fetch with a 15s
     timeout and a normal browser UA, strip HTML to plain text
     (a tiny regex pass — no Cheerio dep). If a local path, read as
     UTF-8. Truncate each source to ~6000 characters so the total
     prompt stays reasonable.
   - Tag each source with a label so the model knows what it is:
     `--source` = research, `--style` = style reference, `--note` = personal direction.
3. Prompts `gpt-5.5` with a system prompt that:
   - Establishes Dépôt's voice (short, opinionated, image-led).
   - Instructs the model to produce a `blocks[]` array of 8–14 items,
     mixing `text`, `section-heading`, `image`, `pullquote`,
     `image-pair` types, with `image` blocks leaving `src` empty for
     manual fill.
   - Frames `--source` as research, `--style` as voice/tone reference,
     `--note` as creative direction the writer must honor.
   - Outputs strict JSON (the entry object minus `slug`/`publishedAt`,
     which the script fills in).
4. Parses the JSON. On parse failure, writes the raw response to
   `drafts/<slug>.raw.txt` and exits non-zero with a clear message —
   the author can copy/paste manually.
5. Writes the final `content/editorial/<slug>.js` module by serializing
   the parsed object with a small template wrapper. **Refuses to
   overwrite** an existing file — `--force` flag required.
6. Also creates `public/editorial/<slug>/` as an empty directory
   (with a `.gitkeep`) so the author knows where to drop images.
7. Prints next steps: "Edit `content/editorial/<slug>.js`, drop your
   images into `public/editorial/<slug>/`, then `npm run dev`."

### Notes

- The script does **not** write to Supabase. Editorial text is repo-only.
- Model is `gpt-5.5` per user direction, distinct from the
  `gpt-5.4-mini` used by `cleanTitle.js` / `generateDescription.js`.
  Don't consolidate.
- Failure modes (timeout, non-200, malformed JSON) all exit non-zero
  with the raw response saved to disk. Never silently produce a
  half-baked module.

## CLAUDE.md invariants to honor

- **`available = true` AND `hidden = false`** filter on every product
  read in both `PiecesFeatured` and `MoreFromDesigner`. Never one
  without the other. `.eq('hidden', false)` (excludes NULL).
- **PostgREST IN queries on handle lists** must use `chunkArray`
  (size 100). Curated section's handle list is small in practice
  but route it through the helper anyway.
- **Brand filter semantics match the feed** — `unaccent + ilike '%X%'`
  via the same column. Don't bypass — that's the established casing/
  diacritic tolerance.
- **No new RPCs, no schema changes.** The feature must work against
  the existing `products` table and existing RPCs untouched.
- **Don't push to `main`.** Branch, Vercel preview, merge after
  explicit user instruction.

## Out of scope for MVP

(Listed so we agree on what we're *not* doing.)

- Markdown / MDX in `text` blocks (plain string + newline-split only).
- Per-block CSS overrides (no `style` / `className` fields exposed).
- Topic-style entries (designer/brand only for MVP).
- Share icons (Facebook/Twitter/Pinterest in the references).
- Newsletter signup module in the editorial page.
- Editorial-page comments or social.
- SEO sitemap entry for editorial (can add `generateStaticParams` +
  basic `<meta>` via `generateMetadata` in `[slug]/page.js`, but
  no sitemap.xml work).
- Admin UI for editing entries (file-only).

## Verification plan

End-to-end check on Vercel preview after the branch is pushed:

1. **Build passes** — `npm run build` locally first; check there are
   no missing-import errors and that `generateStaticParams` resolves.
2. **`/editorial` renders** — index page loads, shows one card
   (Rick Owens), card image and metadata correct.
3. **`/editorial/rick-owens` renders end-to-end:**
   - Hero displays with `image-right` layout, cream background, dark
     nav above.
   - All body blocks render: text columns at narrow width, drop-cap
     visible on first text block, section-heading rules, pullquote
     with Playfair italic + left rule, image blocks at correct
     widths, image-pair side-by-side.
   - Mobile: hero collapses to single column, image blocks adjust
     widths, no horizontal scroll, no `position: sticky` breakage
     (CLAUDE.md flag: `overflow-x-clip` not `overflow-x-hidden` on
     any wrapper).
4. **PiecesFeatured grid:**
   - 6 curated handles → 6 cards (assuming all available).
   - Manually hide one of the curated rows in Supabase (set
     `hidden=true`), reload, confirm: card silently disappears,
     and (since section drops below 4 in the artificial case)
     backfill from brand pool fills in.
5. **More from Rick Owens grid:**
   - Up to 8 cards, all branded "Rick Owens", none duplicating
     curated handles.
   - Brand filter case-insensitivity check: rename one row's brand
     to `RICK OWENS` (all caps) via SQL Editor, confirm it still
     appears.
6. **Back-link:** "← Back to editorial" navigates to `/editorial`.
7. **CLI:**
   - `node scripts/draftEditorial.mjs --slug test-margiela --title 'Maison Margiela' --brand 'Maison Margiela' --layout image-below`
   - Produces `content/editorial/test-margiela.js` with `blocks[]`
     populated, `images: []` slots empty, hero layout correct.
   - `--force` refusal on existing slug verified.
   - With `--source <url>` and `--style <file>`: confirm the
     resulting text reflects the source material (spot check —
     not automated).
8. **Delete the test entry** before merging to `main`.

## Open follow-ups (post-merge)

- Add more entries via the CLI workflow once one is live.
- Add `/editorial` link to the desktop & mobile nav menus (this is
  in the spec but worth a separate visual review).
- Consider adding `generateMetadata` for OG tags (hero image as
  `og:image`) when an entry actually gets shared.
- Revisit whether Markdown emphasis in `text` blocks is needed
  after writing 3–4 entries.
