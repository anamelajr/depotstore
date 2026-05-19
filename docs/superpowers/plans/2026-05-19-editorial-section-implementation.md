# Editorial Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Dépôt's first editorial entry (Rick Owens) at `/editorial/rick-owens`, with an `/editorial` index page, a `blocks[]`-driven body renderer, four hero layout variants, curated + dynamic product sections, nav integration, and a CLI authoring tool for AI-drafted entries.

**Architecture:** File-based content (JS modules at `content/editorial/<slug>.js`) + static imports + server components fetching curated/dynamic products via the existing Supabase anon client. Hero is a discriminated-union renderer keyed on `hero.layout`. Body iterates a `blocks[]` array; one `Block` component switches on `block.type`. No new RPCs, no schema changes — reuses `MoreFromStore.js`'s direct-query pattern, `chunkArray` for IN queries, and the existing `unaccent + ilike` brand filter semantics. Images live in `public/editorial/<slug>/`. CLI script (`scripts/draftEditorial.mjs`) uses `gpt-5.5` to draft a complete module the author then edits.

**Tech Stack:** Next.js 16 (App Router, JavaScript not TypeScript), React 19, Tailwind v4, Supabase JS client, OpenAI REST API, Node 18+ (`node:test` for CLI tests), dotenv. Existing fonts: Geist Sans, Geist Mono, Playfair Display.

**Spec reference:** [docs/superpowers/specs/2026-05-19-editorial-section-design.md](../specs/2026-05-19-editorial-section-design.md).

---

## Pre-flight

Before starting Task 1, confirm the worktree is on the editorial branch and the toolchain works.

- [ ] **Step 1: Confirm branch**

```bash
git branch --show-current
```

Expected: `claude/busy-jones-4a147f` (or whatever branch the worktree was started on; do not switch).

- [ ] **Step 2: Confirm clean tree**

```bash
git status --short
```

Expected: empty output. If untracked files exist, decide per file whether to commit, gitignore, or remove before proceeding.

- [ ] **Step 3: Confirm dev build works**

```bash
npm install && npm run build
```

Expected: build completes without errors. If it fails, fix before touching new code (this plan assumes a green starting baseline).

---

## Task 1: Scaffold the editorial route + content registry

**Goal:** Stand up the route shell and content registry so `/editorial` and `/editorial/rick-owens` resolve (rendering placeholder content). All later tasks have somewhere to wire into.

**Files:**
- Create: `content/editorial/index.js`
- Create: `content/editorial/rick-owens.js` (stub — full data in Task 2)
- Create: `app/editorial/page.js`
- Create: `app/editorial/[slug]/page.js`

- [ ] **Step 1: Create the entry stub**

`content/editorial/rick-owens.js`:

```js
const entry = {
  slug: "rick-owens",
  publishedAt: "2026-05-19",
  hero: {
    layout: "image-right",
    eyebrow: "Editorial",
    title: "Rick Owens",
    subtitle: "Stub — replaced in Task 2.",
    byline: "By DÉPÔT",
    images: ["hero.jpg"],
    imageAlt: ["Stub alt"],
  },
  brandFilter: "Rick Owens",
  curatedProducts: [],
  blocks: [],
};

export default entry;
```

- [ ] **Step 2: Create the content registry**

`content/editorial/index.js`:

```js
import rickOwens from "./rick-owens.js";

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
```

- [ ] **Step 3: Create the index page stub**

`app/editorial/page.js`:

```js
import { getAllEntries } from "../../content/editorial/index.js";

export const metadata = {
  title: "Editorial · Dépôt",
};

export default function EditorialIndexPage() {
  const entries = getAllEntries();
  return (
    <main className="min-h-screen bg-[#f5f2ed] text-zinc-900 px-8 py-12">
      <h1 className="font-mono text-[11px] uppercase tracking-[0.22em]">
        Editorial
      </h1>
      <ul className="mt-8 space-y-4">
        {entries.map((e) => (
          <li key={e.slug} className="font-sans text-[15px]">
            <a href={`/editorial/${e.slug}`} className="underline">
              {e.hero.title}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: Create the entry page stub**

`app/editorial/[slug]/page.js`:

```js
import { notFound } from "next/navigation";
import { getEntryBySlug, getAllSlugs } from "../../../content/editorial/index.js";

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const entry = getEntryBySlug(slug);
  if (!entry) return { title: "Not found · Dépôt" };
  return { title: `${entry.hero.title} · Editorial · Dépôt` };
}

export default async function EditorialEntryPage({ params }) {
  const { slug } = await params;
  const entry = getEntryBySlug(slug);
  if (!entry) notFound();

  return (
    <main className="min-h-screen bg-[#f5f2ed] text-zinc-900 px-8 py-12">
      <pre className="font-mono text-[11px] overflow-x-auto">
        {JSON.stringify(entry, null, 2)}
      </pre>
    </main>
  );
}
```

- [ ] **Step 5: Run dev server and verify both routes resolve**

```bash
npm run dev
```

Visit `http://localhost:3000/editorial` — expect to see "Editorial" with a link to "Rick Owens".
Visit `http://localhost:3000/editorial/rick-owens` — expect to see the stub JSON dumped.
Visit `http://localhost:3000/editorial/nope` — expect Next's default 404.

- [ ] **Step 6: Run build to confirm no static-param issues**

```bash
npm run build
```

Expected: build succeeds, the build log includes the `/editorial/[slug]` route with `rick-owens` prerendered.

- [ ] **Step 7: Commit**

```bash
git add app/editorial content/editorial
git commit -m "feat(editorial): scaffold /editorial routes + content registry"
```

---

## Task 2: Fill in the Rick Owens entry data + image placeholders

**Goal:** Replace the stub with the full canonical content, drop in placeholder images so the rest of the build has something to render.

**Files:**
- Modify: `content/editorial/rick-owens.js`
- Create: `public/editorial/rick-owens/hero.jpg` (placeholder)
- Create: `public/editorial/rick-owens/03.jpg` ... `06.jpg` (placeholders)
- Create: `public/editorial/rick-owens/.gitkeep`

- [ ] **Step 1: Replace the entry stub with full data**

`content/editorial/rick-owens.js`:

```js
const entry = {
  slug: "rick-owens",
  publishedAt: "2026-05-19",

  hero: {
    layout: "image-right",
    eyebrow: "Editorial",
    title: "Rick Owens",
    subtitle: "The silhouette as architecture.\nThe body as subversion.",
    byline: "By DÉPÔT",
    images: ["hero.jpg"],
    imageAlt: ["Rick Owens FW04 leather cape on concrete stairs."],
  },

  brandFilter: "Rick Owens",

  curatedProducts: [
    // Replace with real { storeDomain, handle } pairs from Supabase
    // once real curated items are picked. Stubs left here so the
    // section renders during development.
    { storeDomain: "esco.example", handle: "drkshdw-cropped-leather-cape" },
    { storeDomain: "esco.example", handle: "fw04-strobe-leather-jacket" },
    { storeDomain: "tagliatela.example", handle: "geobasket-high-black" },
    { storeDomain: "dotcomme.example", handle: "drape-wool-trouser-fw19" },
    { storeDomain: "esco.example", handle: "megalace-combat-boot" },
    { storeDomain: "tagliatela.example", handle: "cargo-pod-bomber-carbon" },
  ],

  blocks: [
    {
      type: "text",
      width: "narrow",
      dropcap: true,
      body:
        "In a fashion landscape that rarely pauses, Rick Owens continues to create in shadow — unbothered, uncompromising, and entirely his own. For over three decades, he has built more than a brand; he has constructed a world.\n\nA world of long silhouettes, softened brutality, and a devotion to cut that borders on spiritual. Owens doesn't design for attention — he designs for presence.",
    },
    { type: "section-heading", text: "Architecture as attitude" },
    {
      type: "text",
      width: "narrow",
      body:
        "Owens has often spoken about architecture as the truest expression of clothing. His collections — temples of concrete, draped in silence — echo that belief. Shoulders become structures. Drapes fall like façades. Every seam, every fold, every shadow serves a purpose.",
    },
    {
      type: "image",
      src: "03.jpg",
      width: "full-bleed",
      alt: "FW19 runway — concrete amphitheatre, draped wool.",
    },
    {
      type: "pullquote",
      text: "I am a designer of survivors. People who carry sadness with elegance.",
      attribution: "Rick Owens, 2004",
    },
    {
      type: "text",
      width: "narrow",
      body:
        "The quote is twenty years old. It still describes the cut of the FW24 cape — the way drape and weight conspire to make the body feel monumental, even at rest. Archive Owens reads like a sustained argument about how clothing should carry a person, not the other way around.",
    },
    {
      type: "image",
      src: "04.jpg",
      width: "wide",
      caption: "FW04 leather, slung shoulder.",
      alt: "FW04 leather jacket, slung shoulder, hanging on a mannequin.",
    },
    { type: "section-heading", text: "The materials, the palette" },
    {
      type: "text",
      width: "narrow",
      body:
        "Black, dust, oyster, slate. A palette that reads like weather. Leather that has been distressed, waxed, or boiled into something between fabric and architecture. Owens collaborates with mills the way a sculptor collaborates with stone — the material is never the constraint, it's the partner.",
    },
    {
      type: "image-pair",
      images: [
        { src: "05.jpg", alt: "Boiled wool detail, FW18." },
        { src: "06.jpg", alt: "Dust-tone cashmere knit, SS21." },
      ],
    },
    {
      type: "text",
      width: "narrow",
      body:
        "To wear Owens is to take a position. About bodies, about volume, about whether clothing should comfort or confront. Three decades in, the position has only sharpened.",
    },
  ],
};

export default entry;
```

- [ ] **Step 2: Drop in placeholder images**

Use any 5 dark/moody JPGs at hand. If none, generate dark JPGs with ImageMagick (preferred), or fetch placeholder images via curl:

```bash
mkdir -p public/editorial/rick-owens
cd public/editorial/rick-owens

if command -v magick >/dev/null 2>&1; then
  for name in hero 03 04 05 06; do
    magick -size 1200x1500 xc:'#1a1a1d' "${name}.jpg"
  done
else
  # Fallback: download real placeholder JPGs (dark gray, correct dimensions).
  for name in hero 03 04 05 06; do
    curl -fsSL -o "${name}.jpg" "https://placehold.co/1200x1500/1a1a1d/333333.jpg?text=Editorial+placeholder"
  done
fi

cd - >/dev/null
touch public/editorial/rick-owens/.gitkeep
```

Either path produces valid JPG bytes so the `<img>` tags render during development. Replace with real assets before merging to main.

- [ ] **Step 3: Visually verify the stub still renders the new data**

```bash
npm run dev
```

Visit `http://localhost:3000/editorial/rick-owens` — expect the raw JSON dump to show the full blocks array with the new content.

- [ ] **Step 4: Commit**

```bash
git add content/editorial/rick-owens.js public/editorial/rick-owens
git commit -m "feat(editorial): add Rick Owens entry content + placeholder images"
```

---

## Task 3: `EditorialHero` — all four layout variants

**Goal:** Render the hero with the four canonical layouts (`image-right`, `image-left`, `image-below`, `image-pair-top`). All share typography (Inter-400 title, mono subtitle, mono byline) and the cream background context.

**Files:**
- Create: `app/editorial/_components/EditorialHero.js`
- Modify: `app/editorial/[slug]/page.js` (wire `<EditorialHero entry={entry} />` in place of the JSON dump)

- [ ] **Step 1: Create EditorialHero with the `image-right` variant**

`app/editorial/_components/EditorialHero.js`:

```js
const eyebrowCls =
  "font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600";
const titleCls =
  "font-sans font-normal leading-[1.0] tracking-[-0.03em] text-zinc-950";
const subtitleCls =
  "font-mono text-[11px] leading-[1.6] text-zinc-700 whitespace-pre-line";
const bylineCls = "font-mono text-[9px] text-zinc-500";

function HeroImage({ src, slug, alt, ratio = "aspect-[4/5]" }) {
  return (
    <div className={`${ratio} w-full overflow-hidden bg-zinc-900`}>
      <img
        src={`/editorial/${slug}/${src}`}
        alt={alt || ""}
        className="h-full w-full object-cover"
        loading="eager"
      />
    </div>
  );
}

function HeroText({ hero, byline, date }) {
  return (
    <div className="flex flex-col gap-5">
      <div className={eyebrowCls}>{hero.eyebrow}</div>
      <h1 className={`${titleCls} text-[clamp(40px,6vw,72px)]`}>
        {hero.title}
      </h1>
      <div className={subtitleCls}>{hero.subtitle}</div>
      <div className={bylineCls}>
        {byline} &nbsp;·&nbsp; {date}
      </div>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

export default function EditorialHero({ entry }) {
  const { hero, slug, publishedAt } = entry;
  const date = formatDate(publishedAt);

  if (hero.layout === "image-right") {
    return (
      <section className="px-6 md:px-10 pt-12 md:pt-16 pb-10 md:pb-16">
        <div className="grid grid-cols-1 md:grid-cols-[1.05fr_1fr] gap-8 md:gap-12 items-start">
          <div className="pt-2 md:pt-6">
            <HeroText hero={hero} byline={hero.byline} date={date} />
          </div>
          <HeroImage
            slug={slug}
            src={hero.images[0]}
            alt={hero.imageAlt?.[0]}
          />
        </div>
      </section>
    );
  }

  // Other layouts added in subsequent steps.
  return null;
}
```

- [ ] **Step 2: Wire EditorialHero into the entry page**

Modify `app/editorial/[slug]/page.js`:

```js
import { notFound } from "next/navigation";
import { getEntryBySlug, getAllSlugs } from "../../../content/editorial/index.js";
import EditorialHero from "../_components/EditorialHero.js";

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const entry = getEntryBySlug(slug);
  if (!entry) return { title: "Not found · Dépôt" };
  return { title: `${entry.hero.title} · Editorial · Dépôt` };
}

export default async function EditorialEntryPage({ params }) {
  const { slug } = await params;
  const entry = getEntryBySlug(slug);
  if (!entry) notFound();

  return (
    <main className="min-h-screen bg-[#f5f2ed] text-zinc-900">
      <EditorialHero entry={entry} />
    </main>
  );
}
```

- [ ] **Step 3: Verify `image-right` renders**

```bash
npm run dev
```

Visit `http://localhost:3000/editorial/rick-owens`. Expect: cream background, "Editorial" eyebrow, "Rick Owens" title left, dark image (placeholder) right. Mobile (<768px): collapses to single column, title above image.

- [ ] **Step 4: Add `image-left` variant**

Append to the `EditorialHero` switch (replace the `return null` at the bottom):

```js
  if (hero.layout === "image-left") {
    return (
      <section className="px-6 md:px-10 pt-12 md:pt-16 pb-10 md:pb-16">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.05fr] gap-8 md:gap-12 items-start">
          <HeroImage
            slug={slug}
            src={hero.images[0]}
            alt={hero.imageAlt?.[0]}
          />
          <div className="pt-2 md:pt-6">
            <HeroText hero={hero} byline={hero.byline} date={date} />
          </div>
        </div>
      </section>
    );
  }
```

- [ ] **Step 5: Verify `image-left` by editing the data and reloading**

Temporarily change `hero.layout` in `content/editorial/rick-owens.js` to `"image-left"`. Reload. Expect: image left, title right. Revert to `"image-right"` after confirming.

- [ ] **Step 6: Add `image-below` variant**

```js
  if (hero.layout === "image-below") {
    return (
      <section className="px-6 md:px-10 pt-12 md:pt-16 pb-10 md:pb-16">
        <div className="max-w-2xl mx-auto text-center mb-10 md:mb-14">
          <HeroText hero={hero} byline={hero.byline} date={date} />
        </div>
        <HeroImage
          slug={slug}
          src={hero.images[0]}
          alt={hero.imageAlt?.[0]}
          ratio="aspect-[16/9]"
        />
      </section>
    );
  }
```

- [ ] **Step 7: Verify `image-below` by toggling the layout key**

Switch `hero.layout` to `"image-below"`. Reload. Expect: centered title block, wide photo beneath. Revert.

- [ ] **Step 8: Add `image-pair-top` variant**

```js
  if (hero.layout === "image-pair-top") {
    return (
      <section className="px-6 md:px-10 pt-12 md:pt-16 pb-10 md:pb-16">
        <div className="grid grid-cols-2 gap-3 md:gap-4 mb-8 md:mb-12">
          <HeroImage
            slug={slug}
            src={hero.images[0]}
            alt={hero.imageAlt?.[0]}
            ratio="aspect-[3/4]"
          />
          <HeroImage
            slug={slug}
            src={hero.images[1]}
            alt={hero.imageAlt?.[1]}
            ratio="aspect-[3/4]"
          />
        </div>
        <div className="max-w-2xl">
          <HeroText hero={hero} byline={hero.byline} date={date} />
        </div>
      </section>
    );
  }

  // Unknown layout — render nothing so a typo doesn't crash the page.
  return null;
```

- [ ] **Step 9: Verify `image-pair-top`**

Switch `hero.layout` to `"image-pair-top"` and add a second image entry (`images: ["hero.jpg", "03.jpg"]`, `imageAlt: ["...", "..."]`). Reload. Expect: two photos at top, title beneath. Revert layout and images afterward.

- [ ] **Step 10: Commit**

```bash
git add app/editorial/_components/EditorialHero.js app/editorial/[slug]/page.js
git commit -m "feat(editorial): add EditorialHero with four layout variants"
```

---

## Task 4: `EditorialBody` + `Block` — all five block types

**Goal:** Iterate `entry.blocks[]` and render each block with the correct treatment. Text columns are narrow (~56ch). Drop-cap is opt-in. Image widths are `full-bleed`, `wide`, `narrow`. Pull-quote uses Playfair italic + left rule. Section-heading is mono caps with a thin top rule. Image-pair is a 2-col grid.

**Files:**
- Create: `app/editorial/_components/Block.js`
- Create: `app/editorial/_components/EditorialBody.js`
- Modify: `app/editorial/[slug]/page.js` (add `<EditorialBody entry={entry} />` after the hero)

- [ ] **Step 1: Create the `Block` component**

`app/editorial/_components/Block.js`:

```js
function paragraphs(body) {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function TextBlock({ block }) {
  const widthCls = block.width === "wide" ? "max-w-3xl" : "max-w-[56ch]";
  const dropcapCls = block.dropcap
    ? "first-letter:font-serif first-letter:text-[4.2em] first-letter:leading-[0.85] first-letter:float-left first-letter:pr-3 first-letter:pt-1"
    : "";
  const paras = paragraphs(block.body);
  return (
    <div className={`mx-auto ${widthCls} font-sans text-[16px] leading-[1.7] text-zinc-800`}>
      {paras.map((p, i) => (
        <p key={i} className={i === 0 ? dropcapCls : ""}>
          {p}
        </p>
      ))}
    </div>
  );
}

function SectionHeadingBlock({ block }) {
  return (
    <div className="mx-auto max-w-[56ch] pt-4">
      <div className="border-t border-zinc-900/20 pt-4 font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-950">
        {block.text}
      </div>
    </div>
  );
}

function ImageBlock({ block, slug }) {
  const src = `/editorial/${slug}/${block.src}`;
  const wrapperCls =
    block.width === "full-bleed"
      ? "w-full"
      : block.width === "wide"
        ? "max-w-3xl mx-auto"
        : "max-w-xl mx-auto";
  return (
    <figure className={wrapperCls}>
      <div className="w-full overflow-hidden bg-zinc-900">
        <img
          src={src}
          alt={block.alt || ""}
          className="block w-full h-auto"
          loading="lazy"
        />
      </div>
      {block.caption ? (
        <figcaption className="mt-2 font-mono text-[10px] text-zinc-600 tracking-[0.05em] px-1">
          {block.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

function PullquoteBlock({ block }) {
  return (
    <blockquote className="mx-auto max-w-[42ch] border-l-2 border-zinc-950 pl-5 font-serif italic text-[26px] leading-[1.25] text-zinc-950">
      &ldquo;{block.text}&rdquo;
      {block.attribution ? (
        <div className="mt-3 font-mono not-italic text-[10px] uppercase tracking-[0.18em] text-zinc-600">
          — {block.attribution}
        </div>
      ) : null}
    </blockquote>
  );
}

function ImagePairBlock({ block, slug }) {
  return (
    <div className="mx-auto max-w-3xl grid grid-cols-2 gap-3 md:gap-4">
      {block.images.map((img, i) => (
        <div key={i} className="aspect-[4/5] overflow-hidden bg-zinc-900">
          <img
            src={`/editorial/${slug}/${img.src}`}
            alt={img.alt || ""}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ))}
    </div>
  );
}

export default function Block({ block, slug }) {
  switch (block.type) {
    case "text":          return <TextBlock block={block} />;
    case "section-heading": return <SectionHeadingBlock block={block} />;
    case "image":         return <ImageBlock block={block} slug={slug} />;
    case "pullquote":     return <PullquoteBlock block={block} />;
    case "image-pair":    return <ImagePairBlock block={block} slug={slug} />;
    default:              return null; // unknown type renders nothing
  }
}
```

- [ ] **Step 2: Create the `EditorialBody` container**

`app/editorial/_components/EditorialBody.js`:

```js
import Block from "./Block.js";

export default function EditorialBody({ entry }) {
  const { blocks, slug } = entry;
  return (
    <section className="px-6 md:px-10 pb-16 md:pb-20">
      <div className="flex flex-col gap-10 md:gap-14">
        {blocks.map((block, i) => (
          <Block key={i} block={block} slug={slug} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Wire `EditorialBody` into the entry page**

Modify `app/editorial/[slug]/page.js` — add the import and render:

```js
import EditorialBody from "../_components/EditorialBody.js";
```

And in the JSX, after `<EditorialHero entry={entry} />`:

```js
        <EditorialBody entry={entry} />
```

The full main now reads:

```js
    <main className="min-h-screen bg-[#f5f2ed] text-zinc-900">
      <EditorialHero entry={entry} />
      <EditorialBody entry={entry} />
    </main>
```

- [ ] **Step 4: Verify each block type renders**

```bash
npm run dev
```

Visit `http://localhost:3000/editorial/rick-owens`. Walk through the page:
- First text block: drop-cap visible on "In".
- "Architecture as attitude" renders as a small mono caps line with a thin rule above.
- Full-bleed image: edge-to-edge (no horizontal padding).
- Pull-quote: Playfair italic, left rule, smart quotes around the text, attribution mono caps beneath.
- Wide image with caption: contained at `max-w-3xl`, caption in mono below.
- "The materials, the palette" section-heading.
- Image-pair: two stacked square-ish images side by side.

Mobile (<768px): no horizontal scroll, text column shrinks but stays narrow.

- [ ] **Step 5: Commit**

```bash
git add app/editorial/_components/Block.js app/editorial/_components/EditorialBody.js app/editorial/[slug]/page.js
git commit -m "feat(editorial): add EditorialBody renderer with five block types"
```

---

## Task 5: `fetchEditorialProducts` lib + node:test

**Goal:** A pure data layer that fetches the curated handles and the brand pool from Supabase, in one place, with the CLAUDE.md invariants baked in (`available=true` + `hidden=false`, `chunkArray` for IN queries, brand `ilike` filter). Tested standalone with `node:test` and a fake Supabase shim.

**Note on unaccent:** The CLAUDE.md invariant for brand filtering is `unaccent + ILIKE`. That `unaccent` is applied inside the `get_interleaved_products` RPC; a plain `.ilike("brand", "%X%")` from JS does NOT apply it. For the MVP entry (Rick Owens — ASCII), this difference is invisible. For diacritic-heavy designers later (e.g. "Yohji Yamamoto pour Homme" vs accented variants), revisit by either (a) calling the existing RPC with `p_brand` set, or (b) adding a small read-only `get_brand_pool` RPC. Keep the limitation explicit in code via a one-line comment in the lib so a future reader knows the seam.

**Files:**
- Create: `app/editorial/_lib/fetchEditorialProducts.js`
- Create: `app/editorial/_lib/fetchEditorialProducts.test.mjs`

- [ ] **Step 1: Write the fetch lib**

`app/editorial/_lib/fetchEditorialProducts.js`:

```js
import { chunkArray } from "../../lib/chunk.js";
import { supabase } from "../../lib/supabase.js";

const ROW_SELECT =
  "id, name, title, brand, price, image_url, store_name, store_domain, product_url, available, handle";

function mapRow(row) {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    brand: row.brand,
    price: row.price,
    imageUrl: row.image_url,
    storeName: row.store_name,
    storeDomain: row.store_domain,
    productUrl: row.product_url,
    available: row.available,
    handle: row.handle,
  };
}

function pairKey(p) {
  return `${p.storeDomain}::${p.handle}`;
}

// Group curated pairs by storeDomain so we can do one .in('handle', ...)
// per store, keeping the WHERE small and the URL well under PostgREST's cap.
function groupByDomain(pairs) {
  const map = new Map();
  for (const p of pairs) {
    if (!map.has(p.storeDomain)) map.set(p.storeDomain, []);
    map.get(p.storeDomain).push(p.handle);
  }
  return map;
}

async function fetchCurated(client, curatedProducts) {
  if (!curatedProducts?.length) return [];
  const byDomain = groupByDomain(curatedProducts);
  const wanted = new Set(curatedProducts.map(pairKey));
  const rows = [];

  for (const [domain, handles] of byDomain.entries()) {
    for (const chunk of chunkArray(handles, 100)) {
      const { data, error } = await client
        .from("products")
        .select(ROW_SELECT)
        .eq("store_domain", domain)
        .eq("available", true)
        .eq("hidden", false)
        .in("handle", chunk);
      if (error) {
        console.error("[fetchEditorialProducts] curated fetch error:", error.message);
        continue;
      }
      for (const row of data || []) {
        const mapped = mapRow(row);
        if (wanted.has(pairKey(mapped))) rows.push(mapped);
      }
    }
  }

  // Re-sort by author's curated order — Supabase IN does not preserve order.
  const orderIndex = new Map(
    curatedProducts.map((p, i) => [pairKey(p), i])
  );
  rows.sort((a, b) => orderIndex.get(pairKey(a)) - orderIndex.get(pairKey(b)));
  return rows;
}

async function fetchBrandPool(client, brandFilter, excludeKeys, limit) {
  if (!brandFilter || limit <= 0) return [];
  // NOTE: plain ilike — no unaccent. See "Note on unaccent" in the plan / spec.
  // ASCII brand names match correctly; diacritic-heavy names need an RPC.
  const { data, error } = await client
    .from("products")
    .select(ROW_SELECT)
    .ilike("brand", `%${brandFilter}%`)
    .eq("available", true)
    .eq("hidden", false)
    .order("synced_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + excludeKeys.size + 4); // pull a few extra to survive exclusions
  if (error) {
    console.error("[fetchEditorialProducts] brand-pool fetch error:", error.message);
    return [];
  }
  const out = [];
  for (const row of data || []) {
    const mapped = mapRow(row);
    if (excludeKeys.has(pairKey(mapped))) continue;
    out.push(mapped);
    if (out.length >= limit) break;
  }
  return out;
}

// Public API. Returns { curated, moreFrom } where each is an array of
// mapped product rows. Curated is backfilled from the brand pool if the
// curated rows fall below `minCurated` (defaults to 4) — and the backfill
// excludes handles that will appear in moreFrom, to avoid duplication.
export async function fetchEditorialProducts({
  curatedProducts = [],
  brandFilter = null,
  moreFromLimit = 8,
  minCurated = 4,
  client = supabase,
} = {}) {
  const curated = await fetchCurated(client, curatedProducts);
  const curatedKeys = new Set(curated.map(pairKey));

  // Reserve a "more from" pool first so we can backfill curated without
  // duplicating moreFrom items.
  const moreFrom = await fetchBrandPool(
    client,
    brandFilter,
    curatedKeys,
    moreFromLimit
  );

  let backfilled = curated;
  if (curated.length < minCurated && brandFilter) {
    const moreFromKeys = new Set(moreFrom.map(pairKey));
    const exclude = new Set([...curatedKeys, ...moreFromKeys]);
    const fillers = await fetchBrandPool(
      client,
      brandFilter,
      exclude,
      minCurated - curated.length
    );
    backfilled = [...curated, ...fillers];
  }

  return { curated: backfilled, moreFrom };
}
```

- [ ] **Step 2: Write the node:test**

`app/editorial/_lib/fetchEditorialProducts.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { fetchEditorialProducts } from "./fetchEditorialProducts.js";

// Tiny Supabase shim: records the predicates a query receives and returns
// a configurable result. Each .from() returns a fresh builder.
function makeFakeClient(rowsByCall) {
  const calls = [];
  return {
    calls,
    from(table) {
      const state = { table, filters: [], order: [], limit: null, op: null };
      const builder = {
        select(cols) { state.cols = cols; return builder; },
        eq(col, val) { state.filters.push(["eq", col, val]); return builder; },
        ilike(col, val) { state.filters.push(["ilike", col, val]); return builder; },
        in(col, val) { state.filters.push(["in", col, val]); return builder; },
        order(col, opts) { state.order.push([col, opts]); return builder; },
        limit(n) { state.limit = n; return builder; },
        then(resolve) {
          const result = rowsByCall(state, calls.length);
          calls.push(state);
          return Promise.resolve(result).then(resolve);
        },
      };
      return builder;
    },
  };
}

function row(handle, domain, brand = "Rick Owens", extras = {}) {
  return {
    id: `${domain}-${handle}`,
    name: handle,
    title: null,
    brand,
    price: "€100",
    image_url: null,
    store_name: domain,
    store_domain: domain,
    product_url: null,
    available: true,
    handle,
    ...extras,
  };
}

test("curated query is split per store_domain and filters available + hidden", async () => {
  const client = makeFakeClient((state, i) => {
    // First call should be a curated fetch (eq store_domain, eq available, eq hidden, in handle)
    if (i === 0) {
      const got = Object.fromEntries(
        state.filters.map(([op, col, val]) => [`${op}:${col}`, val])
      );
      assert.equal(got["eq:store_domain"], "esco.test");
      assert.equal(got["eq:available"], true);
      assert.equal(got["eq:hidden"], false);
      assert.deepEqual(got["in:handle"], ["a", "b"]);
      return { data: [row("a", "esco.test"), row("b", "esco.test")] };
    }
    return { data: [] };
  });

  const { curated } = await fetchEditorialProducts({
    curatedProducts: [
      { storeDomain: "esco.test", handle: "a" },
      { storeDomain: "esco.test", handle: "b" },
    ],
    brandFilter: null,
    moreFromLimit: 0,
    client,
  });
  assert.equal(curated.length, 2);
  assert.equal(curated[0].handle, "a"); // preserves author order
  assert.equal(curated[1].handle, "b");
});

test("more-from uses ilike + excludes curated handles", async () => {
  const client = makeFakeClient((state, i) => {
    if (i === 0) return { data: [row("a", "esco.test")] };
    // The brand-pool call: should use ilike brand and exclude "a"
    const got = Object.fromEntries(
      state.filters.map(([op, col, val]) => [`${op}:${col}`, val])
    );
    assert.equal(got["ilike:brand"], "%Rick Owens%");
    assert.equal(got["eq:available"], true);
    assert.equal(got["eq:hidden"], false);
    return { data: [row("a", "esco.test"), row("x", "esco.test"), row("y", "esco.test")] };
  });

  const { moreFrom } = await fetchEditorialProducts({
    curatedProducts: [{ storeDomain: "esco.test", handle: "a" }],
    brandFilter: "Rick Owens",
    moreFromLimit: 2,
    client,
  });
  const handles = moreFrom.map((p) => p.handle);
  assert.deepEqual(handles, ["x", "y"]); // "a" excluded
});

test("backfills curated from brand pool when below minCurated and excludes moreFrom handles", async () => {
  let call = 0;
  const client = makeFakeClient(() => {
    call++;
    if (call === 1) return { data: [row("a", "esco.test")] };       // curated returns 1
    if (call === 2) return {                                          // moreFrom pool
      data: [row("x", "esco.test"), row("y", "esco.test"), row("z", "esco.test")],
    };
    if (call === 3) return { data: [row("p", "esco.test"), row("q", "esco.test"), row("r", "esco.test"), row("s", "esco.test")] }; // backfill
    return { data: [] };
  });

  const { curated, moreFrom } = await fetchEditorialProducts({
    curatedProducts: [{ storeDomain: "esco.test", handle: "a" }],
    brandFilter: "Rick Owens",
    moreFromLimit: 3,
    minCurated: 4,
    client,
  });

  assert.equal(curated.length, 4);
  assert.equal(curated[0].handle, "a"); // original curated kept first
  const moreFromHandles = new Set(moreFrom.map((p) => p.handle));
  // backfill items must not appear in moreFrom
  for (const item of curated.slice(1)) {
    assert.ok(!moreFromHandles.has(item.handle), `backfill ${item.handle} should not be in moreFrom`);
  }
});
```

- [ ] **Step 3: Run the test**

```bash
node --test app/editorial/_lib/fetchEditorialProducts.test.mjs
```

Expected: all three tests pass. Fix any failures by adjusting the lib (not the test) until they pass.

- [ ] **Step 4: Commit**

```bash
git add app/editorial/_lib
git commit -m "feat(editorial): add fetchEditorialProducts data layer + tests"
```

---

## Task 6: `PiecesFeatured` component

**Goal:** Render the curated product grid using the fetch lib. Cream-friendly styling (light-on-dark inverted to dark-on-light), 4 columns on desktop, 2 columns on mobile. Section heading "PIECES FEATURED" with sublabel `N pieces · hand-picked`. If the section returns zero items, render nothing.

**Files:**
- Create: `app/editorial/_components/PiecesFeatured.js`

**Note:** This component uses the row shape returned by `fetchEditorialProducts` (camelCase fields). We render an editorial-styled card inline rather than reuse `ProductCard.js`, because `ProductCard` is built for dark backgrounds; editorial pages are cream.

- [ ] **Step 1: Write the component**

`app/editorial/_components/PiecesFeatured.js`:

```js
import Link from "next/link";

function EditorialProductCard({ product }) {
  const href =
    product.handle && product.storeDomain
      ? `/product/${product.handle}?store=${product.storeDomain}&available=${product.available !== false}`
      : null;
  const displayTitle = product.title ?? product.name ?? "Untitled";
  const card = (
    <div className="group">
      <div className="aspect-[4/5] w-full overflow-hidden bg-zinc-200">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={displayTitle}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : null}
      </div>
      {product.brand ? (
        <p className="mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-900">
          {product.brand}
        </p>
      ) : null}
      <p className={`font-sans text-[13px] leading-snug text-zinc-700 line-clamp-2${product.brand ? " mt-0.5" : " mt-3"}`}>
        {displayTitle}
      </p>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] text-zinc-800">{product.price ?? "—"}</span>
        {product.storeName ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500 whitespace-nowrap">
            {product.storeName}
          </span>
        ) : null}
      </div>
    </div>
  );
  if (!href) return card;
  return (
    <Link href={href} className="block focus:outline-none">
      {card}
    </Link>
  );
}

export default function PiecesFeatured({ products }) {
  if (!products?.length) return null;
  return (
    <section className="px-6 md:px-10 pt-14 md:pt-20 pb-4">
      <header className="flex items-baseline justify-between mb-7 md:mb-10">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-950 font-medium">
          Pieces featured
        </h2>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-600">
          {products.length} {products.length === 1 ? "piece" : "pieces"} · hand-picked
        </span>
      </header>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 md:gap-x-6 gap-y-9 md:gap-y-11">
        {products.map((p) => (
          <EditorialProductCard key={`${p.storeDomain}::${p.handle}`} product={p} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit (component is ready, wiring follows in Task 8)**

```bash
git add app/editorial/_components/PiecesFeatured.js
git commit -m "feat(editorial): add PiecesFeatured curated grid component"
```

---

## Task 7: `MoreFromDesigner` component

**Goal:** Render the dynamic brand-filtered grid. Same card styling as `PiecesFeatured` (cream-themed). Section heading is `More from {entry.hero.title}`. If zero items, render nothing.

**Files:**
- Create: `app/editorial/_components/MoreFromDesigner.js`

- [ ] **Step 1: Write the component**

`app/editorial/_components/MoreFromDesigner.js`:

```js
import Link from "next/link";

function EditorialProductCard({ product }) {
  const href =
    product.handle && product.storeDomain
      ? `/product/${product.handle}?store=${product.storeDomain}&available=${product.available !== false}`
      : null;
  const displayTitle = product.title ?? product.name ?? "Untitled";
  const card = (
    <div className="group">
      <div className="aspect-[4/5] w-full overflow-hidden bg-zinc-200">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={displayTitle}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : null}
      </div>
      {product.brand ? (
        <p className="mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-900">
          {product.brand}
        </p>
      ) : null}
      <p className={`font-sans text-[13px] leading-snug text-zinc-700 line-clamp-2${product.brand ? " mt-0.5" : " mt-3"}`}>
        {displayTitle}
      </p>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] text-zinc-800">{product.price ?? "—"}</span>
        {product.storeName ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500 whitespace-nowrap">
            {product.storeName}
          </span>
        ) : null}
      </div>
    </div>
  );
  if (!href) return card;
  return (
    <Link href={href} className="block focus:outline-none">
      {card}
    </Link>
  );
}

export default function MoreFromDesigner({ designerName, products }) {
  if (!products?.length) return null;
  return (
    <section className="px-6 md:px-10 pt-14 md:pt-20 pb-16 md:pb-24 border-t border-zinc-900/10">
      <header className="flex items-baseline justify-between mb-7 md:mb-10">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-950 font-medium">
          More from {designerName}
        </h2>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-600">
          Live inventory · {products.length} in stock
        </span>
      </header>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 md:gap-x-6 gap-y-9 md:gap-y-11">
        {products.map((p) => (
          <EditorialProductCard key={`${p.storeDomain}::${p.handle}`} product={p} />
        ))}
      </div>
    </section>
  );
}
```

Note: the `EditorialProductCard` is duplicated between `PiecesFeatured.js` and `MoreFromDesigner.js`. We accept the duplication for MVP (two ~30-line copies). If a third consumer appears, extract into a shared file.

- [ ] **Step 2: Commit**

```bash
git add app/editorial/_components/MoreFromDesigner.js
git commit -m "feat(editorial): add MoreFromDesigner dynamic grid component"
```

---

## Task 8: Wire entry page end-to-end + tail link

**Goal:** Compose all components in the entry page. Fetch products via `fetchEditorialProducts`. Add the "← Back to editorial" tail link. Final visual verification of the whole page in dev.

**Files:**
- Modify: `app/editorial/[slug]/page.js`

- [ ] **Step 1: Rewrite the entry page composing all parts**

`app/editorial/[slug]/page.js`:

```js
import { notFound } from "next/navigation";
import Link from "next/link";
import { getEntryBySlug, getAllSlugs } from "../../../content/editorial/index.js";
import EditorialHero from "../_components/EditorialHero.js";
import EditorialBody from "../_components/EditorialBody.js";
import PiecesFeatured from "../_components/PiecesFeatured.js";
import MoreFromDesigner from "../_components/MoreFromDesigner.js";
import { fetchEditorialProducts } from "../_lib/fetchEditorialProducts.js";

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const entry = getEntryBySlug(slug);
  if (!entry) return { title: "Not found · Dépôt" };
  return {
    title: `${entry.hero.title} · Editorial · Dépôt`,
    description: entry.hero.subtitle?.replace(/\n/g, " ").slice(0, 200),
  };
}

export default async function EditorialEntryPage({ params }) {
  const { slug } = await params;
  const entry = getEntryBySlug(slug);
  if (!entry) notFound();

  const { curated, moreFrom } = await fetchEditorialProducts({
    curatedProducts: entry.curatedProducts,
    brandFilter: entry.brandFilter,
    moreFromLimit: 8,
    minCurated: 4,
  });

  return (
    <main className="min-h-screen bg-[#f5f2ed] text-zinc-900">
      <EditorialHero entry={entry} />
      <EditorialBody entry={entry} />
      <PiecesFeatured products={curated} />
      <MoreFromDesigner designerName={entry.hero.title} products={moreFrom} />
      <div className="text-center pb-16 md:pb-20">
        <Link
          href="/editorial"
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600 border-b border-zinc-900/20 pb-1"
        >
          ← Back to editorial
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Visually verify the full page**

```bash
npm run dev
```

Visit `http://localhost:3000/editorial/rick-owens`. Expect (in this order):
1. Hero (`image-right`, cream bg).
2. Body blocks (text, section-heading, full-bleed image, pullquote, text, wide image, section-heading, text, image-pair, text).
3. "PIECES FEATURED" section — likely empty initially because the placeholder `esco.example` handles don't match real DB rows. Section returns null and renders nothing — that's correct behavior.
4. "More from Rick Owens" — if your DB has Rick Owens rows, they appear here; otherwise the section is also empty.
5. "← Back to editorial" link at the bottom.

Mobile width (resize browser <768px): no horizontal scroll, sections collapse to 2-column grids, text still narrow.

- [ ] **Step 3: Optional — swap a real curated entry to verify the curated path**

If your Supabase has any real Rick Owens product, edit `content/editorial/rick-owens.js` `curatedProducts` to include its `{ storeDomain, handle }` and reload. Confirm: section renders the card with the real image. Revert to placeholder pairs if needed.

- [ ] **Step 4: Build to confirm no errors**

```bash
npm run build
```

Expected: build completes; the editorial routes show up in the route map.

- [ ] **Step 5: Commit**

```bash
git add app/editorial/[slug]/page.js
git commit -m "feat(editorial): wire entry page with products + back link"
```

---

## Task 9: Index page + index card

**Goal:** `/editorial` shows a clean list of entries (just Rick Owens now), each card with hero image, title, subtitle excerpt, date.

**Files:**
- Create: `app/editorial/_components/EditorialIndexCard.js`
- Modify: `app/editorial/page.js`

- [ ] **Step 1: Create the index card component**

`app/editorial/_components/EditorialIndexCard.js`:

```js
import Link from "next/link";

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

export default function EditorialIndexCard({ entry }) {
  const { slug, hero, publishedAt } = entry;
  return (
    <Link
      href={`/editorial/${slug}`}
      className="block group"
    >
      <div className="aspect-[4/5] w-full overflow-hidden bg-zinc-900">
        <img
          src={`/editorial/${slug}/${hero.images[0]}`}
          alt={hero.imageAlt?.[0] || ""}
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
          loading="lazy"
        />
      </div>
      <div className="mt-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">
          {hero.eyebrow}
        </div>
        <h2 className="mt-3 font-sans text-[28px] leading-[1.05] tracking-[-0.02em] text-zinc-950">
          {hero.title}
        </h2>
        {hero.subtitle ? (
          <p className="mt-3 font-mono text-[11px] leading-[1.6] text-zinc-700 whitespace-pre-line line-clamp-2">
            {hero.subtitle}
          </p>
        ) : null}
        <div className="mt-4 font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-500">
          {formatDate(publishedAt)}
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Rewrite the index page**

`app/editorial/page.js`:

```js
import { getAllEntries } from "../../content/editorial/index.js";
import EditorialIndexCard from "./_components/EditorialIndexCard.js";

export const metadata = {
  title: "Editorial · Dépôt",
  description: "Editorial perspectives on archive fashion.",
};

export default function EditorialIndexPage() {
  const entries = getAllEntries();

  return (
    <main className="min-h-screen bg-[#f5f2ed] text-zinc-900">
      <section className="px-6 md:px-10 pt-14 md:pt-20 pb-16 md:pb-24">
        <header className="mb-12 md:mb-16">
          <h1 className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-950">
            Editorial
          </h1>
          <p className="mt-3 max-w-xl font-sans text-[15px] leading-relaxed text-zinc-700">
            Short, opinionated pieces on the designers and houses that shape archive fashion.
          </p>
        </header>
        {entries.length === 0 ? (
          <p className="font-mono text-[11px] text-zinc-600">No entries yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 md:gap-12">
            {entries.map((entry) => (
              <EditorialIndexCard key={entry.slug} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Visually verify**

```bash
npm run dev
```

Visit `http://localhost:3000/editorial`. Expect: a "Editorial" eyebrow, a one-line subtitle, then one card (Rick Owens) with hero image, eyebrow "Editorial", "Rick Owens" title, subtitle excerpt, date. Clicking the card navigates to `/editorial/rick-owens`.

- [ ] **Step 4: Commit**

```bash
git add app/editorial/page.js app/editorial/_components/EditorialIndexCard.js
git commit -m "feat(editorial): add /editorial index page with cards"
```

---

## Task 10: Add Editorial link to mobile + desktop nav menus

**Goal:** Both menus link to `/editorial`. Mobile: in the root view between STORES and DESIGNERS or after DESIGNERS. Desktop: in `Column1`'s "Browse" group as a third item (a plain Link, not expandable).

**Files:**
- Modify: `app/components/MobileNavMenu.js`
- Modify: `app/components/nav/Column1.js`

- [ ] **Step 1: Add Editorial to the mobile nav RootView**

In `app/components/MobileNavMenu.js`, find the `RootView` component (around line 53). After the `/designers` Link block, insert:

```js
        <Link
          href="/editorial"
          onClick={onClose}
          className="flex items-center justify-between py-6 font-mono text-[10px] tracking-[0.34em] uppercase text-zinc-50"
        >
          <span>EDITORIAL</span><span className="text-zinc-600 text-[14px] font-light">›</span>
        </Link>
```

(Insert it between the `/designers` Link and the `<div className="mt-auto ...">` About/Contact footer block.)

- [ ] **Step 2: Add Editorial to the desktop nav Column1**

In `app/components/nav/Column1.js`, the "Browse" section currently has two expandable buttons (Designers, Stores). Add an Editorial link as a third item.

Find the block (around line 58):

```js
      <div className="mt-8">
        <div className={labelStyle}>Browse</div>
        <button ...>Designers</button>
        <button ...>Stores</button>
      </div>
```

Append an `<Link>` after the Stores button:

```js
        <Link
          href="/editorial"
          onClick={onClose}
          className={itemBase}
        >
          Editorial
        </Link>
```

(The file already imports `Link` from `"next/link"` at the top, so no new import needed.)

- [ ] **Step 3: Visually verify both menus**

```bash
npm run dev
```

- Mobile (DevTools <768px): open the burger menu, confirm an "EDITORIAL" row sits between/after DESIGNERS. Click it — navigates to `/editorial`.
- Desktop: open the menu (top-left "Menu" button), in the "Browse" column confirm "Editorial" appears under Stores. Click it — navigates to `/editorial`.

- [ ] **Step 4: Commit**

```bash
git add app/components/MobileNavMenu.js app/components/nav/Column1.js
git commit -m "feat(editorial): add Editorial link to mobile + desktop nav menus"
```

---

## Task 11: CLI scaffold — argument parsing + slug validation

**Goal:** A working `scripts/draftEditorial.mjs` that parses flags and prints what it would do. No OpenAI call yet, no file writes. Sets up the structure for Task 12.

**Files:**
- Create: `scripts/draftEditorial.mjs`

- [ ] **Step 1: Write the script skeleton**

`scripts/draftEditorial.mjs`:

```js
#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
dotenv.config({ path: join(repoRoot, ".env.local") });

const VALID_LAYOUTS = ["image-right", "image-left", "image-below", "image-pair-top"];

function parseArgs(argv) {
  const args = {
    slug: null,
    title: null,
    brand: null,
    layout: "image-right",
    sources: [],
    styles: [],
    notes: [],
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--slug":    args.slug = next(); break;
      case "--title":   args.title = next(); break;
      case "--brand":   args.brand = next(); break;
      case "--layout":  args.layout = next(); break;
      case "--source":  args.sources.push(next()); break;
      case "--style":   args.styles.push(next()); break;
      case "--note":    args.notes.push(next()); break;
      case "--force":   args.force = true; break;
      case "--help":
      case "-h":        printHelp(); process.exit(0);
      default:
        if (a.startsWith("--")) {
          console.error(`Unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/draftEditorial.mjs --slug <slug> [options]

Options:
  --slug <slug>       Required. Output: content/editorial/<slug>.js
  --title <title>     Display title (e.g. "Rick Owens")
  --brand <brand>     Brand filter for "More from" (defaults to --title)
  --layout <name>     One of: ${VALID_LAYOUTS.join(", ")} (default: image-right)
  --source <path|url> Research material; repeatable
  --style  <path|url> Voice/tone reference; repeatable
  --note   <text>     Personal direction for the model; repeatable
  --force             Overwrite existing content/editorial/<slug>.js
  -h, --help          This help
`);
}

function validateArgs(args) {
  if (!args.slug) {
    console.error("Error: --slug is required.");
    process.exit(2);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(args.slug)) {
    console.error(`Error: --slug must be kebab-case (got "${args.slug}").`);
    process.exit(2);
  }
  if (!VALID_LAYOUTS.includes(args.layout)) {
    console.error(`Error: --layout must be one of: ${VALID_LAYOUTS.join(", ")}.`);
    process.exit(2);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY is not set (check .env.local).");
    process.exit(2);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);

  const outFile = join(repoRoot, "content", "editorial", `${args.slug}.js`);
  const imgDir = join(repoRoot, "public", "editorial", args.slug);

  if (existsSync(outFile) && !args.force) {
    console.error(`Error: ${outFile} already exists. Pass --force to overwrite.`);
    process.exit(1);
  }

  // Scaffold phase: print intent only. Real generation in Task 12.
  console.log("[draftEditorial] dry-run scaffold — Task 12 will wire OpenAI + file write");
  console.log("[draftEditorial] args:", JSON.stringify(args, null, 2));
  console.log("[draftEditorial] would write:", outFile);
  console.log("[draftEditorial] would mkdir:", imgDir);
}

main().catch((err) => {
  console.error("[draftEditorial] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script with valid args (dry-run)**

```bash
node scripts/draftEditorial.mjs --slug test-margiela --title "Maison Margiela" --layout image-below --note "Focus on the blank label."
```

Expected: prints the parsed args + the intended output paths. No file writes.

- [ ] **Step 3: Run with missing slug (expect error)**

```bash
node scripts/draftEditorial.mjs --title "Test"
```

Expected: exits with `Error: --slug is required.` and exit code 2.

- [ ] **Step 4: Run with --slug colliding with existing file**

```bash
node scripts/draftEditorial.mjs --slug rick-owens --title "Test"
```

Expected: `Error: ... already exists. Pass --force to overwrite.` and exit code 1.

- [ ] **Step 5: Commit**

```bash
git add scripts/draftEditorial.mjs
git commit -m "feat(editorial): scaffold draftEditorial CLI with arg parsing"
```

---

## Task 12: CLI core — source loading, OpenAI call, file write

**Goal:** Fill in the rest of the CLI. Loads `--source`/`--style` content (URL or file), calls `gpt-5.5`, parses JSON, writes the module + `.gitkeep` for the image dir. Refuses to overwrite without `--force`.

**Files:**
- Modify: `scripts/draftEditorial.mjs`

- [ ] **Step 1: Add source loader (file + URL)**

Append above `async function main()` in `scripts/draftEditorial.mjs`:

```js
const MAX_SOURCE_CHARS = 6000;
const FETCH_TIMEOUT_MS = 15000;

async function loadSource(value) {
  // Detect URL vs path
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

  // Local path
  try {
    const text = await fs.readFile(value, "utf8");
    return { value, error: null, text: text.slice(0, MAX_SOURCE_CHARS) };
  } catch (err) {
    return { value, error: err.message || String(err), text: null };
  }
}

async function loadAll(values) {
  const results = [];
  for (const v of values) {
    const r = await loadSource(v);
    if (r.error) {
      console.warn(`[draftEditorial] skipping ${v}: ${r.error}`);
    } else {
      results.push(r);
    }
  }
  return results;
}
```

- [ ] **Step 2: Add OpenAI caller + prompt builder**

Append:

```js
function buildPrompt({ title, brand, layout, sources, styles, notes }) {
  const research = sources
    .map((s, i) => `<research source="${s.value}" index="${i + 1}">\n${s.text}\n</research>`)
    .join("\n\n");
  const style = styles
    .map((s, i) => `<style-reference source="${s.value}" index="${i + 1}">\n${s.text}\n</style-reference>`)
    .join("\n\n");
  const noteBlock = notes.length
    ? notes.map((n, i) => `<note index="${i + 1}">${n}</note>`).join("\n")
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
    /* 8 to 14 blocks, mixing types. Image blocks leave src empty for manual fill. */
    { "type": "text", "width": "narrow", "dropcap": true, "body": "<3-6 sentences, opens the piece>" },
    { "type": "section-heading", "text": "<3-5 word eyebrow>" },
    { "type": "text", "width": "narrow", "body": "<2-4 sentences>" },
    { "type": "image", "src": "", "width": "full-bleed", "alt": "<describe what should go here>" },
    { "type": "pullquote", "text": "<a short, opinionated quote — fictional is OK if marked as such>", "attribution": "<who said it, year if known, or 'Attributed'>" },
    { "type": "text", "width": "narrow", "body": "<2-4 sentences>" }
    /* ...mix freely; keep total between 8 and 14 blocks */
  ]
}

Rules:
- Text blocks: 2-6 sentences each. No filler. Strong, declarative voice. No "this designer", "this brand" — name them.
- Section-headings: 3-5 words, like a magazine eyebrow ("Architecture as attitude", "The Antwerp instinct").
- Pull quote: short (one or two sentences). If you don't have a real attributed quote from the research, you may write one in the designer's voice but set attribution to "Attributed".
- Image blocks: leave "src" empty (the author drops images in later). Use "alt" to describe what photo should fit there.
- Vary block order — don't always go text/image/text/image. Two text blocks in a row are fine. Two images in a row become a pair (use "image-pair" with two images).
- Treat <research> tags as factual sources to draw from. Treat <style-reference> tags as voice/tone you should echo. Treat <note> tags as personal direction from the editor that you must honor.

${research || "(no research provided)"}

${style || "(no style references provided)"}

${noteBlock || "(no personal notes provided)"}`;
}

async function callOpenAI(prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
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

function extractJson(content) {
  // Strip ```json fences if the model used them despite instructions.
  const cleaned = content
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
  return JSON.parse(cleaned);
}
```

- [ ] **Step 3: Add module serializer + file writer**

Append:

```js
function serialize(value, indent = 0) {
  const pad = "  ".repeat(indent);
  const pad2 = "  ".repeat(indent + 1);
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") {
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

function buildModule({ slug, publishedAt, hero, brandFilter, blocks }) {
  const entry = {
    slug,
    publishedAt,
    hero,
    brandFilter,
    curatedProducts: [],
    blocks,
  };
  return `const entry = ${serialize(entry, 0)};\n\nexport default entry;\n`;
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
```

- [ ] **Step 4: Replace the dry-run scaffold in `main` with the real flow**

Replace the body of `async function main()` (everything after `validateArgs(args);`) with:

```js
  const outFile = join(repoRoot, "content", "editorial", `${args.slug}.js`);
  const imgDir = join(repoRoot, "public", "editorial", args.slug);
  const draftsDir = join(repoRoot, "drafts");

  if (existsSync(outFile) && !args.force) {
    console.error(`Error: ${outFile} already exists. Pass --force to overwrite.`);
    process.exit(1);
  }

  console.log("[draftEditorial] loading sources…");
  const sources = await loadAll(args.sources);
  const styles = await loadAll(args.styles);
  console.log(`[draftEditorial] sources=${sources.length} styles=${styles.length} notes=${args.notes.length}`);

  console.log("[draftEditorial] calling gpt-5.5 (this may take 10-30s)…");
  const prompt = buildPrompt({
    title: args.title || args.slug,
    brand: args.brand || args.title || args.slug,
    layout: args.layout,
    sources,
    styles,
    notes: args.notes,
  });

  let raw;
  try {
    raw = await callOpenAI(prompt);
  } catch (err) {
    console.error(`[draftEditorial] OpenAI failed: ${err.message}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    await fs.mkdir(draftsDir, { recursive: true });
    const dump = join(draftsDir, `${args.slug}.raw.txt`);
    await fs.writeFile(dump, raw, "utf8");
    console.error(`[draftEditorial] JSON parse failed: ${err.message}`);
    console.error(`[draftEditorial] raw response saved to ${dump}`);
    process.exit(1);
  }

  const hero = {
    layout: args.layout,
    eyebrow: parsed.hero?.eyebrow || "Editorial",
    title: parsed.hero?.title || args.title || args.slug,
    subtitle: parsed.hero?.subtitle || "",
    byline: parsed.hero?.byline || "By DÉPÔT",
    images: args.layout === "image-pair-top" ? ["hero-1.jpg", "hero-2.jpg"] : ["hero.jpg"],
    imageAlt: parsed.hero?.imageAlt || [""],
  };

  const moduleSource = buildModule({
    slug: args.slug,
    publishedAt: todayIso(),
    hero,
    brandFilter: args.brand || args.title || args.slug,
    blocks: parsed.blocks || [],
  });

  await fs.mkdir(dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, moduleSource, "utf8");
  await fs.mkdir(imgDir, { recursive: true });
  await fs.writeFile(join(imgDir, ".gitkeep"), "", "utf8");

  console.log(`[draftEditorial] wrote ${outFile}`);
  console.log(`[draftEditorial] image dir ready: ${imgDir}`);
  console.log("[draftEditorial] next steps:");
  console.log(`  1. Open ${outFile}, review and edit the text.`);
  console.log(`  2. Drop hero + inline images into ${imgDir}.`);
  console.log(`  3. Add the entry to content/editorial/index.js (import + ENTRIES array).`);
  console.log(`  4. npm run dev — preview at /editorial/${args.slug}`);
```

(Keep the `main().catch(...)` wrapper at the bottom of the file unchanged.)

- [ ] **Step 5: End-to-end test the CLI**

Pick a throwaway slug. With no sources, no styles, no notes:

```bash
node scripts/draftEditorial.mjs --slug test-cli --title "Test Designer" --layout image-right
```

Expected:
- Console shows "loading sources… sources=0 styles=0 notes=0".
- "calling gpt-5.5…" then ~10-30s later.
- Writes `content/editorial/test-cli.js`.
- Creates `public/editorial/test-cli/.gitkeep`.
- Prints next steps.

- [ ] **Step 6: Verify the generated file is valid JS that parses**

```bash
node -e "import('./content/editorial/test-cli.js').then(m => console.log(JSON.stringify(m.default, null, 2)))"
```

Expected: prints the entry object with `slug`, `publishedAt`, `hero`, `brandFilter`, `curatedProducts: []`, `blocks: [...]`. If parse fails, fix `serialize()` until it does.

- [ ] **Step 7: Test with a real source file**

```bash
mkdir -p drafts/research
cat > drafts/research/note.md <<'EOF'
# Notes for the model
The designer's signature is monochrome silhouettes and architectural shoulders.
The brand was founded in Antwerp in 1987.
EOF

node scripts/draftEditorial.mjs --slug test-with-source --title "Test Designer" --source drafts/research/note.md --note "Lean into the Antwerp connection."
```

Expected: writes `content/editorial/test-with-source.js`; text blocks reflect the source material (Antwerp 1987 mention) and the note (Antwerp connection emphasized).

- [ ] **Step 8: Clean up test artifacts (don't commit them)**

```bash
rm -rf content/editorial/test-cli.js content/editorial/test-with-source.js
rm -rf public/editorial/test-cli public/editorial/test-with-source
rm -rf drafts/research/note.md
# Keep drafts/ if empty? remove if so
[ -d drafts ] && rmdir drafts/research 2>/dev/null
[ -d drafts ] && rmdir drafts 2>/dev/null
```

- [ ] **Step 9: Commit the completed CLI**

```bash
git add scripts/draftEditorial.mjs
git commit -m "feat(editorial): wire CLI source loading + gpt-5.5 + module write"
```

---

## Final acceptance

After all 12 tasks, run the full verification sequence:

- [ ] **Build**

```bash
npm run build
```

Expected: green, no errors, `/editorial` and `/editorial/[slug]` (prerendered with `rick-owens`) appear in the route map.

- [ ] **Run the fetch lib tests**

```bash
node --test app/editorial/_lib/fetchEditorialProducts.test.mjs
```

Expected: all 3 tests pass.

- [ ] **Dev server walkthrough**

```bash
npm run dev
```

Walk through:

1. `/editorial` — Rick Owens card visible, eyebrow + title + subtitle + date.
2. Click card → `/editorial/rick-owens`.
3. Hero (image-right, cream bg).
4. Body — all block types render correctly: drop-cap text → section-heading → text → full-bleed image → pullquote → text → wide image with caption → section-heading → text → image-pair → text.
5. "Pieces featured" section renders (may be empty if curated handles are placeholders — that's expected for now; pick real handles before merging).
6. "More from Rick Owens" renders (depends on Supabase content).
7. "← Back to editorial" link at bottom navigates to `/editorial`.
8. Mobile (browser <768px): no horizontal scroll, sections collapse to 2-col grids, text columns shrink.
9. Open the desktop nav menu → "Browse" column → "Editorial" link works.
10. Open the mobile nav menu → tap "EDITORIAL" → navigates.

- [ ] **Toggle hero layouts as a smoke test**

Edit `content/editorial/rick-owens.js` `hero.layout` through each of: `"image-right"`, `"image-left"`, `"image-below"`, `"image-pair-top"`. For `image-pair-top`, also add a second image: `images: ["hero.jpg", "03.jpg"]`, `imageAlt: ["...", "..."]`. Confirm each renders. Revert to `"image-right"` and the single-image array.

- [ ] **Push the branch and verify on Vercel preview**

```bash
git push -u origin claude/busy-jones-4a147f
```

Open the Vercel preview URL and repeat the walkthrough above. Vercel preview is the canonical verification per CLAUDE.md ("Verify on Vercel, not localhost").

- [ ] **Replace placeholder images and curated handles before merge**

Before opening a PR:
1. Drop real images into `public/editorial/rick-owens/` (hero.jpg, 03.jpg, 04.jpg, 05.jpg, 06.jpg).
2. Replace placeholder `{ storeDomain, handle }` pairs in `curatedProducts` with real ones from Supabase (use the SQL editor to pick handles that exist and have `available=true, hidden=false`).
3. Re-verify the Vercel preview shows real imagery and a populated "Pieces featured" section.
