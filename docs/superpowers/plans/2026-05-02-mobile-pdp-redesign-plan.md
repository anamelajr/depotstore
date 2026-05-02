# Mobile PDP Redesign + Global Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the mobile branch of `app/product/[handle]/page.js` around a new editorial visual rhythm, and introduce a single `Footer` component used on every page of the site (replacing the homepage's inline footer).

**Architecture:** Purely presentational. Three new client components (`Accordion`, `SaveShareRow`) and two new server components (`Footer`, `MoreFromStore`). The desktop PDP layout is preserved unchanged. No backend, schema, or data-flow changes. Save is a visual-only toggle for v1 (no persistence) because `/saved` is currently a stub.

**Tech Stack:** Next.js App Router (no TypeScript), Tailwind v4, Supabase, existing Inter sans + system mono fonts. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-02-mobile-pdp-redesign-design.md](../specs/2026-05-02-mobile-pdp-redesign-design.md)

**Verification:** Per CLAUDE.md, Vercel preview is the source of truth. Localhost may mislead on hydration. Each commit can be pushed and visually verified on the Vercel preview URL.

**No tests in this codebase.** The repo has no test framework configured; verification per task is "build passes" + "lint passes" + Vercel visual check at the end.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `app/components/Accordion.js` | NEW | Reusable expand/collapse row used twice on the PDP. Client component (uses `useState`). |
| `app/components/SaveShareRow.js` | NEW | Two-cell row with visual-only Save toggle and real Share (Web Share API + clipboard fallback). Client component. |
| `app/components/MoreFromStore.js` | NEW | Async server component that fetches 5 newest products from a store, filters out the current handle, slices to 4, renders 2×2 grid. |
| `app/components/Footer.js` | NEW | Global site footer with logo, tagline, NewsletterForm, two link columns, copyright row. Server component. |
| `app/layout.js` | MODIFY | Mount `<Footer />` after the existing `<LayoutClient>` so it renders on every page. |
| `app/page.js` | MODIFY | Remove the inline `<footer>` block at the bottom; the global Footer now covers it. |
| `app/product/[handle]/page.js` | MODIFY | Add `storeRow` query for Store Profile data; replace the existing single info-column with a desktop-only column + a new mobile-only block that uses the new components. |
| `docs/superpowers/specs/2026-05-02-mobile-pdp-redesign-design.md` | MODIFY | Amend the Save section to reflect Option B (visual-only toggle) and update Risks accordingly. |

---

## Task 1: Amend design doc to reflect visual-only Save (Option B)

**Files:**
- Modify: `docs/superpowers/specs/2026-05-02-mobile-pdp-redesign-design.md`

- [ ] **Step 1: Replace the "Save behavior" section**

In the spec, find:

```markdown
## Save behavior

- The PDP renders a Save button; clicking it adds/removes the current `(storeDomain, handle)` pair from the saved list using whatever mechanism `/saved` already uses today.
- The button reflects saved state with a filled-bookmark icon when saved.
- No new persistence layer. Whatever `/saved` does today is what the button hands off to.
- Implementation detail to confirm during implementation: read `/app/saved/page.js` to identify the existing client store/key — the implementation plan will pin this down.
```

Replace it with:

```markdown
## Save behavior

- v1 scope: visual-only toggle. The PDP Save button toggles a local React state inside `SaveShareRow` — clicking fills the bookmark icon, clicking again unfills it. State does not persist across page navigation or browser sessions.
- This was an explicit scope decision: `/saved` is currently a "Coming soon" stub (`app/saved/page.js`). Building a real persistence layer (localStorage, DB, or auth-based) is out of scope here and will get its own spec.
- The button is wired so that when a future Save mechanism lands, only `SaveShareRow.js` needs to change; no other PDP code touches save state.
```

- [ ] **Step 2: Replace the matching item in the Risks section**

Find:

```markdown
- **`/saved` integration shape** — the implementation plan must read the existing `/saved` page's client store before committing to a Save button binding. If `/saved` uses a different shape than `(storeDomain, handle)`, the Save component will need to match it.
```

Replace with:

```markdown
- **Save persistence is deliberately deferred.** v1 uses an ephemeral toggle inside `SaveShareRow`. A future spec covers real persistence + an updated `/saved` page that lists items.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-02-mobile-pdp-redesign-design.md
git commit -m "docs(pdp): amend Save section — v1 is visual-only toggle"
```

---

## Task 2: Create the Accordion component

**Files:**
- Create: `app/components/Accordion.js`

- [ ] **Step 1: Write the component**

Create `app/components/Accordion.js` with this exact content:

```jsx
"use client";

import { useState } from "react";

export default function Accordion({ label, children, isLast = false }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`border-t border-zinc-100 ${isLast ? "border-b" : ""}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between py-[22px] font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-900"
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-zinc-400 text-[14px] leading-none">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div className="pb-6 font-sans text-[13px] leading-[1.7] text-zinc-600">
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run the build to confirm no syntax errors**

Run: `npm run build`
Expected: build completes without errors. If it fails on the new file, fix the syntax and re-run.

- [ ] **Step 3: Run the linter**

Run: `npm run lint`
Expected: no errors related to `app/components/Accordion.js`.

- [ ] **Step 4: Commit**

```bash
git add app/components/Accordion.js
git commit -m "feat(pdp): add Accordion component"
```

---

## Task 3: Create the Footer component

**Files:**
- Create: `app/components/Footer.js`

- [ ] **Step 1: Write the component**

Create `app/components/Footer.js` with this exact content:

```jsx
import Link from "next/link";
import NewsletterForm from "./NewsletterForm";

const CONTACT_EMAIL = "hello@depot.paris";

export default function Footer() {
  return (
    <footer className="bg-[#0a0a0a] text-zinc-50 px-6 py-16 sm:px-10 sm:py-20">
      <div className="mx-auto max-w-4xl">
        <p className="text-[clamp(28px,5vw,40px)] font-bold uppercase leading-none tracking-tight">
          DÉPÔT
        </p>
        <p className="mt-3 font-mono text-[11px] text-zinc-500">
          Paris. Archive. One feed.
        </p>

        <div id="newsletter" className="mt-12 max-w-sm scroll-mt-[80px]">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
            Newsletter
          </p>
          <div className="mt-3">
            <NewsletterForm />
          </div>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-8 max-w-sm">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
              Explore
            </p>
            <ul className="mt-3 space-y-2 font-mono text-[12px] text-zinc-100">
              <li><Link href="/feed" className="hover:text-white transition-colors">Feed</Link></li>
              <li><Link href="/stores" className="hover:text-white transition-colors">Stores</Link></li>
              <li><Link href="/saved" className="hover:text-white transition-colors">Saved</Link></li>
            </ul>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
              Connect
            </p>
            <ul className="mt-3 space-y-2 font-mono text-[12px] text-zinc-100">
              <li>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="hover:text-white transition-colors"
                >
                  Contact
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 border-t border-zinc-800 pt-6 flex justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
          <span>© 2026 Dépôt</span>
          <span>Paris</span>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: build completes without errors.

- [ ] **Step 3: Run the linter**

Run: `npm run lint`
Expected: no errors related to `app/components/Footer.js`.

- [ ] **Step 4: Commit**

```bash
git add app/components/Footer.js
git commit -m "feat(footer): add global Footer component"
```

---

## Task 4: Mount Footer globally and remove homepage inline footer

**Atomic commit** — both edits land together so the homepage never has zero footers or two footers in flight.

**Files:**
- Modify: `app/layout.js`
- Modify: `app/page.js`

- [ ] **Step 1: Update `app/layout.js`**

Open `app/layout.js`. Add the Footer import and render `<Footer />` directly inside `<body>` after the `<Suspense>` block. The full file should read:

```jsx
import { Suspense } from "react";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import LayoutClient from "./components/LayoutClient";
import Footer from "./components/Footer";
import { getActiveStores } from "./lib/stores.js";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

export const metadata = {
  title: "Create Next App",
  description: "Generated by create next app",
};

export default async function RootLayout({ children }) {
  const stores = await getActiveStores();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${playfairDisplay.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Suspense fallback={null}>
          <LayoutClient stores={stores}>{children}</LayoutClient>
        </Suspense>
        <Footer />
      </body>
      <Analytics />
    </html>
  );
}
```

- [ ] **Step 2: Remove the inline `<footer>` block from `app/page.js`**

Open `app/page.js`. Find the existing footer block, which currently looks like:

```jsx
{/* Footer / Newsletter */}
<footer className="border-t border-zinc-800 bg-[#0a0a0a] py-24 text-zinc-50">
  <div className="mx-auto max-w-4xl px-6">
    <div className="flex flex-col items-start gap-12 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-[clamp(32px,5vw,56px)] font-bold uppercase leading-none tracking-tight">
          DÉPÔT
        </p>
        <p className="mt-3 text-[13px] text-zinc-500">
          Paris. Archive. One feed.
        </p>
      </div>
      <div id="newsletter" className="w-full max-w-sm scroll-mt-[80px]">
        <NewsletterForm />
      </div>
    </div>
    <div className="mt-16 border-t border-zinc-800 pt-8 flex flex-col gap-2 md:flex-row md:justify-between text-[11px] text-zinc-600 uppercase tracking-widest">
      <span>© 2026 Dépôt</span>
      <span>Paris</span>
    </div>
  </div>
</footer>
```

Delete the entire `<footer>...</footer>` block (including the leading `{/* Footer / Newsletter */}` comment).

Also remove the now-unused import at the top:

```jsx
import NewsletterForm from "./components/NewsletterForm";
```

The closing `</div>` and `}` of the component remain unchanged.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: build completes without errors.

- [ ] **Step 4: Run the linter**

Run: `npm run lint`
Expected: no warnings about unused imports.

- [ ] **Step 5: Commit**

```bash
git add app/layout.js app/page.js
git commit -m "feat(footer): mount global Footer; drop inline homepage footer"
```

---

## Task 5: Create the SaveShareRow component

**Files:**
- Create: `app/components/SaveShareRow.js`

- [ ] **Step 1: Write the component**

Create `app/components/SaveShareRow.js` with this exact content:

```jsx
"use client";

import { useState } from "react";

function BookmarkIcon({ filled }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
    >
      <path d="M3.5 2h9v12l-4.5-3-4.5 3V2z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden="true"
    >
      <path d="M8 2v8M5 5l3-3 3 3M3 9v4a1 1 0 001 1h8a1 1 0 001-1V9" />
    </svg>
  );
}

export default function SaveShareRow({ productUrl, title }) {
  // v1: visual-only toggle. No persistence — see spec for rationale.
  const [saved, setSaved] = useState(false);
  const [shareLabel, setShareLabel] = useState("Share");

  async function handleShare() {
    if (!productUrl) return;
    const data = { title: title ?? "Dépôt", url: productUrl };
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share(data);
        return;
      } catch {
        // User cancelled or share failed — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(productUrl);
      setShareLabel("Copied");
      setTimeout(() => setShareLabel("Share"), 2000);
    } catch {
      // Clipboard unavailable (e.g. http) — silent failure is acceptable.
    }
  }

  return (
    <div className="mt-5 px-6 flex gap-6">
      <button
        type="button"
        onClick={() => setSaved((v) => !v)}
        aria-pressed={saved}
        className="flex-1 inline-flex items-center justify-center gap-2.5 py-2.5 font-mono text-[11px] text-zinc-900 hover:text-zinc-600 transition-colors"
      >
        <BookmarkIcon filled={saved} />
        <span>{saved ? "Saved" : "Save"}</span>
      </button>
      <button
        type="button"
        onClick={handleShare}
        className="flex-1 inline-flex items-center justify-center gap-2.5 py-2.5 font-mono text-[11px] text-zinc-900 hover:text-zinc-600 transition-colors"
      >
        <ShareIcon />
        <span>{shareLabel}</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: build completes without errors.

- [ ] **Step 3: Run the linter**

Run: `npm run lint`
Expected: no errors related to `app/components/SaveShareRow.js`.

- [ ] **Step 4: Commit**

```bash
git add app/components/SaveShareRow.js
git commit -m "feat(pdp): add SaveShareRow component (visual-only Save, real Share)"
```

---

## Task 6: Create the MoreFromStore component

**Files:**
- Create: `app/components/MoreFromStore.js`

- [ ] **Step 1: Write the component**

Create `app/components/MoreFromStore.js` with this exact content:

```jsx
import Link from "next/link";

async function fetchMore(storeDomain) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  try {
    const res = await fetch(
      `${baseUrl}/api/products?store=${encodeURIComponent(storeDomain)}&sort=newest&limit=5`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.products) ? data.products : [];
  } catch {
    return [];
  }
}

export default async function MoreFromStore({ storeDomain, currentHandle, storeName }) {
  if (!storeDomain) return null;

  const products = (await fetchMore(storeDomain))
    .filter((p) => p.handle !== currentHandle)
    .slice(0, 4);

  if (products.length === 0) return null;

  const heading = storeName ? `More from ${storeName}` : "More from this store";

  return (
    <section className="mt-16 px-6 pb-14">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-900">
        {heading}
      </p>
      <div className="mt-6 grid grid-cols-2 gap-5">
        {products.map((p) => {
          const href = p.handle && p.storeDomain
            ? `/product/${p.handle}?store=${p.storeDomain}&available=${p.available !== false}`
            : null;
          const card = (
            <div className="block">
              <div className="aspect-[3/4] w-full overflow-hidden bg-zinc-100">
                {p.imageUrl ? (
                  <img
                    src={p.imageUrl}
                    alt={p.title ?? p.name ?? ""}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : null}
              </div>
              {p.brand ? (
                <p className="mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-900">
                  {p.brand}
                </p>
              ) : null}
              <p className="mt-1 font-sans text-[13px] leading-[1.3] text-zinc-600 line-clamp-2">
                {p.title ?? p.name ?? "Untitled"}
              </p>
              {p.price ? (
                <p className="mt-1.5 font-mono text-[11px] text-zinc-700">
                  {p.price}
                </p>
              ) : null}
            </div>
          );
          if (!href) return <div key={`${p.storeDomain}-${p.handle}`}>{card}</div>;
          return (
            <Link
              key={`${p.storeDomain}-${p.handle}`}
              href={href}
              className="block focus:outline-none"
            >
              {card}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: build completes without errors.

- [ ] **Step 3: Run the linter**

Run: `npm run lint`
Expected: no errors related to `app/components/MoreFromStore.js`.

- [ ] **Step 4: Commit**

```bash
git add app/components/MoreFromStore.js
git commit -m "feat(pdp): add MoreFromStore 2x2 grid component"
```

---

## Task 7: Refactor mobile PDP layout

This is the largest task. The mobile branch of the PDP is rebuilt; the desktop branch is preserved unchanged.

**Files:**
- Modify: `app/product/[handle]/page.js`

- [ ] **Step 1: Replace the file**

Open `app/product/[handle]/page.js` and replace the entire file contents with:

```jsx
import { Inter } from "next/font/google";
import BackToFeedLink from "../../components/BackToFeedLink";
import ProductGallery from "../../components/ProductGallery";
import Accordion from "../../components/Accordion";
import SaveShareRow from "../../components/SaveShareRow";
import MoreFromStore from "../../components/MoreFromStore";
import { generateDescription } from "../../lib/generateDescription";
import { supabase, supabaseAdmin } from "../../lib/supabase.js";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

async function getProduct(handle, storeDomain) {
  try {
    const res = await fetch(
      `https://${storeDomain}/products/${handle}.json?country=FR`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.product ?? null;
  } catch {
    return null;
  }
}

function stripHtml(html) {
  if (!html) return null;
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function nonEmpty(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatSizes(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const labels = variants
    .map((v) => nonEmpty(v?.title))
    .filter(Boolean)
    .filter((label) => label.toLowerCase() !== "default title");
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0];
  return labels.join(", ");
}

export default async function ProductPage({ params, searchParams }) {
  const { handle } = await params;
  const { store: storeDomain, available: availableParam } = await searchParams;
  const available = availableParam !== "false";

  if (!handle || !storeDomain) {
    return <div className="min-h-screen bg-white text-zinc-900 flex items-center justify-center">Product not found.</div>;
  }

  const product = await getProduct(handle, storeDomain);

  if (!product) {
    return <div className="min-h-screen bg-white text-zinc-900 flex items-center justify-center">Product not found.</div>;
  }

  const images = Array.isArray(product.images)
    ? product.images.map((img) => img?.src).filter(Boolean)
    : [];

  const variants = Array.isArray(product.variants) ? product.variants : [];

  const minPrice = variants.reduce((min, v) => {
    const n = parseFloat(v?.price ?? "");
    if (!isFinite(n)) return min;
    return min === null ? n : Math.min(min, n);
  }, null);
  const price = minPrice !== null ? `€${minPrice.toFixed(2)}` : null;

  const sizes = formatSizes(variants);

  const rawDescription = stripHtml(product.body_html);
  const tags = Array.isArray(product.tags) ? product.tags :
    typeof product.tags === "string" ? product.tags.split(",").map(t => t.trim()) : [];

  const [{ data: dbRow }, { data: storeRow }] = await Promise.all([
    supabase
      .from("products")
      .select("brand, title, editorial_description")
      .eq("store_domain", storeDomain)
      .eq("handle", handle)
      .maybeSingle(),
    supabase
      .from("stores")
      .select("store_name, display_name, location")
      .eq("domain", storeDomain)
      .maybeSingle(),
  ]);

  const brand = nonEmpty(dbRow?.brand) ?? nonEmpty(product.vendor);
  const title = nonEmpty(dbRow?.title) ?? nonEmpty(product.title) ?? product.title;
  const storeName = nonEmpty(storeRow?.display_name) ?? nonEmpty(storeRow?.store_name) ?? storeDomain;

  const productData = {
    name: product.title,
    vendor: product.vendor ?? null,
    rawDescription,
    tags,
    price,
    storeName: storeDomain,
  };

  let description = dbRow?.editorial_description || null;

  if (!description) {
    const generated = await generateDescription(productData);
    description = generated;
    if (generated) {
      try {
        await supabaseAdmin
          .from("products")
          .update({ editorial_description: generated })
          .eq("store_domain", storeDomain)
          .eq("handle", handle);
      } catch {
        // Write failure: page still renders with the generated description
      }
    }
  }

  const productUrl = `https://${storeDomain}/products/${handle}`;
  const storeFeedHref = `/feed?store=${encodeURIComponent(storeDomain)}`;

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="mx-auto max-w-[1400px] px-0 lg:px-10 lg:pt-16 lg:pb-10">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[88px_1fr_340px] lg:gap-16">

          <ProductGallery images={images} alt={title} />

          {/* Mobile info layout — order-2 on mobile, hidden on desktop */}
          <div className="order-2 lg:hidden">
            {/* Brand + title */}
            <div className="mt-6 px-6">
              {brand && (
                <p className="font-mono text-[22px] font-semibold uppercase tracking-[0.06em] leading-[1.1] text-zinc-900">
                  {brand}
                </p>
              )}
              <h1 className={`${inter.className} mt-2.5 font-sans text-[14px] font-normal leading-[1.4] text-zinc-600`}>
                {title}
              </h1>
            </div>

            {/* Price + meta */}
            <div className="mt-8 px-6">
              {price && (
                <p className="font-mono text-[13px] text-zinc-700">{price}</p>
              )}
              {!available && (
                <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                  Sold
                </p>
              )}
              <Link
                href={storeFeedHref}
                className="mt-3.5 block font-mono text-[11px] text-zinc-600 hover:text-zinc-900 transition-colors"
              >
                {storeName} ›
              </Link>
              {sizes && (
                <p className="mt-2 font-mono text-[11px] text-zinc-600">
                  Size: {sizes}
                </p>
              )}
            </div>

            {/* CTA */}
            <div className="mt-9 px-6">
              <a
                href={`${productUrl}?utm_source=depot`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full bg-black text-white text-center py-[18px] font-mono text-[12px] tracking-[0.05em] hover:bg-zinc-800 transition-colors"
              >
                View at retailer ↗
              </a>
            </div>

            {/* Save / Share */}
            <SaveShareRow productUrl={productUrl} title={title} />

            {/* Accordions */}
            <div className="mt-10 px-6">
              <Accordion label="Description">
                {description ? (
                  <p>{description}</p>
                ) : (
                  <p className="text-zinc-400">No description available.</p>
                )}
              </Accordion>
              <Accordion label="Store Profile" isLast>
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-900">
                    {storeName}
                  </p>
                  {storeRow?.location && (
                    <p className="mt-2">{storeRow.location}</p>
                  )}
                  <Link
                    href={storeFeedHref}
                    className="mt-3 inline-block font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-900 underline underline-offset-[6px] decoration-[0.5px] hover:text-zinc-500"
                  >
                    Browse store →
                  </Link>
                </div>
              </Accordion>
            </div>

            {/* More from this store */}
            <MoreFromStore
              storeDomain={storeDomain}
              currentHandle={handle}
              storeName={storeName}
            />
          </div>

          {/* Desktop info column — preserved from previous design */}
          <div className="hidden lg:block lg:order-none lg:sticky lg:top-[calc(var(--nav-height)+2rem)] lg:self-start lg:pt-6">
            {brand && (
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                {brand}
              </p>
            )}
            <h1
              className={`${inter.className} mt-2 text-[clamp(22px,2.2vw,28px)] font-medium leading-[1.25] tracking-tight text-zinc-900`}
            >
              {title}
            </h1>
            {price && (
              <p className="mt-8 font-mono text-[13px] text-zinc-700">
                {price}
              </p>
            )}
            {!available && (
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                Sold
              </p>
            )}
            {description && (
              <p
                className={`${inter.className} mt-10 text-[13px] leading-[1.7] text-zinc-600`}
              >
                {description}
              </p>
            )}
            <div className="mt-12">
              <a
                href={`${productUrl}?utm_source=depot`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-900 underline underline-offset-[6px] decoration-[0.5px] hover:text-zinc-500 hover:decoration-zinc-500 transition-colors"
              >
                Shop &rarr;
              </a>
            </div>
            <div className="mt-5">
              <BackToFeedLink
                className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500 underline underline-offset-[6px] decoration-[0.5px] hover:text-zinc-900 hover:decoration-zinc-900 transition-colors"
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
```

The key changes from the old file:

- **Imports added:** `Accordion`, `SaveShareRow`, `MoreFromStore`, `Link`.
- **`formatSizes` helper added** — derives a comma-joined size string from variants, filtering out the default `"Default Title"` placeholder Shopify emits when there's only one variant.
- **`storeRow` query added** — runs in parallel with the existing `dbRow` query (single round trip). Reads `store_name`, `display_name`, `location` for use in Store Profile.
- **`storeName` resolution** — prefers `display_name` → `store_name` → bare `storeDomain`.
- **Mobile branch (`order-2 lg:hidden`)** — completely rewritten with the new spacing rhythm, Accordions, SaveShareRow, MoreFromStore.
- **Desktop branch (`hidden lg:block`)** — preserves the existing brand/title/price/description/Shop/back layout exactly.
- **`BackToFeedLink` is desktop-only** — on mobile, the global Footer's "Feed" link covers the back-navigation use case. The mobile design no longer shows a back link.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: build completes without errors.

- [ ] **Step 3: Run the linter**

Run: `npm run lint`
Expected: no errors related to `app/product/[handle]/page.js`.

- [ ] **Step 4: Commit**

```bash
git add app/product/[handle]/page.js
git commit -m "feat(pdp): rebuild mobile layout with new components"
```

---

## Task 8: Push branch and verify on Vercel preview

Per CLAUDE.md, behavioral verification happens on Vercel, not localhost. Push and walk through the changes in the preview environment.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin claude/determined-meitner-926c14
```

- [ ] **Step 2: Open the Vercel preview URL**

Wait for Vercel to build and produce the preview URL. The deployment is typically ready within 1–2 minutes.

- [ ] **Step 3: Verify on a mobile viewport (or DevTools mobile emulation)**

Open a real product page on the preview, e.g. by clicking a product card from the feed. Check:

- The new layout renders: image carousel with side arrows, brand label dominant in mono caps, title beneath, price/store/size, full-width black CTA, Save / Share row with no borders, two accordions (Description, Store Profile), 2×2 "More from {Store Name}" grid.
- Side arrows on the image work; dot indicators reflect the active image; swipe still works.
- "View at retailer ↗" opens the retailer in a new tab.
- Save toggles fill state when tapped (visual only — no persistence).
- Share opens the OS share sheet (on iOS Safari / Android Chrome). On desktop, copies to clipboard and shows "Copied" briefly.
- Both accordions toggle open/closed; default state is closed; the description text matches the previous inline description.
- Store Profile shows the store display name + location (if present) + a "Browse store →" link to `/feed?store={domain}`.
- "More from {Store Name}" shows up to 4 cards from the same store, never including the current product, linking to other product pages.
- Global footer renders at the very bottom with DÉPÔT logo, "Paris. Archive. One feed.", newsletter, Explore (Feed/Stores/Saved), Connect (Contact), copyright row.

- [ ] **Step 4: Verify on a desktop viewport**

Resize the browser to ≥1024px or open the preview on desktop. Check:

- The desktop PDP renders the previous layout: thumbnail rail, large hero image, sticky right-side info column with brand label, title, price, description, "Shop →", "Back to feed".
- The mobile-only block (CTA button, Save/Share, accordions, MoreFromStore) is not visible on desktop.
- The global Footer renders below the PDP body content.

- [ ] **Step 5: Verify the global Footer on every other route**

Visit, on the Vercel preview:
- `/` (homepage) — old inline footer is gone, only the new global Footer is present, no doubled footers.
- `/feed`
- `/stores`
- `/saved`
- `/about`

Each should render the new global Footer at the bottom.

- [ ] **Step 6: Verify the newsletter form still works**

Submit an email address through the global Footer's newsletter form. The same `/api/subscribe` endpoint is used, so behavior should be identical to before. Look for the success state on submit.

- [ ] **Step 7: Sanity-check console**

Open the browser DevTools console on the PDP. Expected: no React hydration warnings, no 404s on assets, no unhandled promise rejections.

- [ ] **Step 8: Report back**

If everything passes, report success and the preview URL. If anything fails, capture the failure and we'll patch it in a follow-up task before merging.

---

## Self-review checklist

Before handing off the plan, the agent who wrote this confirmed:

- **Spec coverage:**
  - Goals → Tasks 2–7 cover the mobile redesign; Tasks 3–4 cover the global footer. ✓
  - Out-of-scope items respected: no schema changes, no shipping/returns accordion, desktop preserved, Save persistence deferred. ✓
  - Architecture overview implemented as described. ✓
  - PDP layout (top-to-bottom) → all 8 sections rendered in Task 7. ✓
  - Typography decisions → applied verbatim in Task 7. ✓
  - Components → all 4 created (Accordion, SaveShareRow, MoreFromStore, Footer). ✓
  - Data flow → no source changes; new size derivation + parallel store query added. ✓
  - Global footer → Task 3 component, Task 4 mount + homepage cleanup. ✓
  - Save behavior → visual-only toggle in SaveShareRow (matches the Option B amendment in Task 1). ✓
  - Share behavior → Web Share API + clipboard fallback with "Copied" confirmation. ✓
  - Spacing system → Tailwind margin/padding values match the spec table. ✓
  - Verification → Task 8 covers PDP mobile, PDP desktop, footer on every route, newsletter form, console sanity. ✓

- **Placeholder scan:** No "TBD", "TODO", or vague "implement appropriately" instructions. The Instagram link is intentionally absent (decision: omit for v1) rather than placeheld. ✓

- **Type/method consistency:**
  - `Accordion` props (`label`, `children`, `isLast`) used consistently in Task 2 (definition) and Task 7 (consumer). ✓
  - `SaveShareRow` props (`productUrl`, `title`) used consistently in Task 5 (definition) and Task 7 (consumer). ✓
  - `MoreFromStore` props (`storeDomain`, `currentHandle`, `storeName`) used consistently in Task 6 and Task 7. ✓
  - `Footer` takes no props; consumed via `<Footer />` in Task 4. ✓
