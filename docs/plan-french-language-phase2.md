# French Language — Phase 2 (Comfort Layer)

## Context

PR #75 shipped a currency/region selector plus an **inert French-language shell**:
the Region menu renders a Français row (`aria-disabled`, no-op) and
`CurrencyProvider` carries a fixed `language = "EN"`. The shell was deliberately
built "wired through for the later i18n project without changing the context shape
now" (`CurrencyProvider.js:21-24`).

This phase makes Français **actually work** as an **on-site comfort layer**: a
visitor toggles Français and the site's interface reads in French. It mirrors the
currency feature's plumbing exactly (cookie → server seed → context → persist,
no reload, no flash).

**Decisions locked (with the user):**
- **Routing = Option A (comfort).** URLs are unchanged (`/feed`, `/product/x`).
  A `depot_lang` cookie holds the choice. French is **not** separately indexable
  by Google — no `/fr` URLs, no hreflang. `/fr` routing stays possible as a later
  phase if product copy is ever translated.
- **Scope = chrome + short page copy.** Translate all fixed UI furniture plus the
  short hand-written marketing copy (homepage tagline, About paragraph,
  editorial-index tagline). **Deferred (stay English):** long-form editorial
  articles, and all product copy (AI-generated `title` + `editorial_description`;
  brands are proper nouns and never translate).
- **Authoring = Claude drafts, user reviews.** French delivered as an editable
  `en`/`fr` file; user vets tone before ship.
- **No new dependency.** Homegrown dictionary + a `t()` helper, not `next-intl`
  (which is built around `/fr` URL routing — overkill for a cookie-based, two-
  language comfort layer, and against the repo's "single source of truth file"
  convention).

## Approach

Four new units — the first three mirror how currency is organized (`currency.js`
pure + `fx.js` server-read + `CurrencyProvider.js` client); the fourth, `T.js`, is
the text analogue of `<Price>`:

1. **`app/lib/i18n/messages.js`** (pure, no React) — `MESSAGES = { en: {...},
   fr: {...} }` keyed by stable dotted keys (`nav.stores`, `filter.apply`,
   `region.pricesFromEur`, `home.tagline`, `about.body`, …), plus a pure
   `t(key, language)` with **English fallback**: `MESSAGES[lang][key] ??
   MESSAGES.en[key] ?? key` (a missing FR key degrades to English, never shows a
   raw key) — the runtime **safety net**, not a license for gaps; a build-time
   key-parity test is the gate (see "Translation completeness gate"). Usable in
   **both** server and client components.
2. **`app/lib/i18n/language.js`** (server) — `ALLOWED_LANGUAGES = ["en","fr"]`;
   `getLanguage()` reads + validates the `depot_lang` cookie (defaults `"en"`),
   for server components and `generateMetadata`. Mirrors the `depot_currency`
   read already in `layout.js`.
3. **`app/components/LanguageProvider.js`** (`"use client"`) — context
   `{ language, setLanguage, t }` where `t(key)` is bound to the active
   `language`. `language` seeds from the server-passed `initialLanguage` prop
   (NEVER a client `document.cookie` read in the initializer — same SSR-flash rule
   as `CurrencyProvider`). `setLanguage(next)` updates state + writes the
   `depot_lang` cookie (mirror `setCurrency`'s `max-age=31536000; samesite=lax`) —
   **and nothing else: no `router.refresh()`** (see "Live switching" for why the
   blanket refresh was dropped). Adds
   `useEffect(() => { document.documentElement.lang = language }, [language])` so
   `<html lang>` tracks a **live** toggle (the server seed only covers first
   paint). Exports `useLanguage()`.
4. **`app/components/T.js`** (`"use client"`) — a tiny leaf
   `function T({ k }) { const { t } = useLanguage(); return t(k); }`, the text
   analogue of `<Price>`. Lets a **server** component emit a translatable string
   that still swaps live via context (e.g. `<T k="home.tagline" />`) — no server
   re-render, no refresh.

**Live switching — one model: client context everywhere (mirrors `<Price>`).**
A React context is client-only, and we deliberately keep the entire text-swap on
the client so a toggle never triggers a server round-trip:
- **All visible text swaps via the context.** Client components call
  `useLanguage()` → `t(key)` directly; **server** components (homepage tagline,
  About, editorial-index prose, `Footer`) emit `<T k="…" />` leaves. Both
  re-render **instantly** on toggle — exactly like `<Price>`. First paint is
  SSR-correct because the layout seeds `LanguageProvider` from the `depot_lang`
  cookie (the tree is already dynamic) — no EN→FR flash. **Every such component
  MUST sit inside `LanguageProvider`** — note `NewsletterForm` and the footer's
  `<T>` leaves live *outside* `LayoutClient` today (see "Provider placement").
- **`getLanguage()` runs server-side for *only two* things:** the page `metadata`
  (`generateMetadata`) and the **initial** `<html lang>` seed in `layout.js`.
  Neither needs to live-swap (metadata isn't visible chrome; the live `<html lang>`
  update is the provider effect above).
- **No `router.refresh()` anywhere.** *(Dropped per Codex adversarial review: a
  blanket refresh re-runs the current route's server fetches on every toggle — on
  a PDP that re-enters `resolveProductDetail`, which calls OpenAI
  `generateDescription` and writes `editorial_description` back to Supabase when
  it is NULL (`resolveProductDetail.js:180-203`). That would make a text toggle
  replay paid, out-of-scope product-copy work and depend on Shopify/Supabase/OpenAI
  uptime. Client-context swapping avoids the whole class — and is exactly what
  `setCurrency` already does.)*

## Work

### New files
- `app/lib/i18n/messages.js`, `app/lib/i18n/language.js`,
  `app/components/LanguageProvider.js`, `app/components/T.js` (above).
- `app/lib/i18n/__tests__/messages.test.js` — key-parity gate (see "Translation
  completeness gate").

### Activate the inert shell (intended completion, not a conflicting edit)
These shipped files were built to be wired up here:
- **`app/components/nav/RegionPanel.js`** — Français row: drop `aria-disabled`,
  add `onClick={() => { onSelectLanguage("fr"); onClose(); }}`; English row gets
  the `"en"` handler; active styling keys off `language`. Mirror the currency rows.
- **`app/components/MobileNavMenu.js`** (`RegionSection`, ~L58-73) — same wiring.
- **`app/components/nav/RegionMenu.js`** — **call both hooks (this is an addition,
  not a swap).** Keep `currency`/`setCurrency` from `useCurrency()` — the trigger
  symbol and `onSelectCurrency` depend on them (`RegionMenu.js:16,39,58-63`) — and
  *add* `language`/`setLanguage` from `useLanguage()`. Pass **both** handlers into
  `RegionPanel`: `onSelectCurrency={setCurrency}` **and**
  `onSelectLanguage={setLanguage}`. Replacing `useCurrency()` outright would
  regress the already-shipped currency selector (per Codex adversarial review).
- **`app/components/CurrencyProvider.js`** — remove the now-superseded dead
  `language = "EN"` constant so there is **one** source of language truth.
  *(Per the "keep extensions additive" preference: these four are edits to shipped
  code, but they are the deliberate activation of the inert shell + removing a
  dead constant — the shell has no other purpose. Flagging explicitly.)*

### Wire the provider + `<html lang>`
- **`app/layout.js`** — read `depot_lang` via `getLanguage()` (free; tree already
  dynamic from the currency cookie); set `<html lang={initialLanguage}>` from it
  (currently hardcoded `"en"`) — this is the **first-paint seed**; the live update
  on toggle comes from the `LanguageProvider` effect. Replace the root
  `"Create Next App"` metadata placeholder with a real, language-aware Dépôt
  title/description.
- **Provider placement (corrected per Codex adversarial review).** Mount
  `<LanguageProvider initialLanguage>` in **`layout.js`** so it wraps **both**
  `<LayoutClient>` **and** `<Footer />` — NOT inside `LayoutClient`. Today
  `Footer` is a sibling rendered *after* `</LayoutClient>` (`layout.js:71`), and
  it contains `NewsletterForm` (a `"use client"` component, in translation scope).
  A provider placed inside `LayoutClient` would leave `NewsletterForm` outside the
  context → `useLanguage()` throws. `LanguageProvider` is a client component
  wrapping the **server** `Footer` as children (a supported pattern); `Footer`
  stays server-rendered and emits `<T>` leaves for its own strings — which, like
  `NewsletterForm`, need the context in scope.
  *(The currency feature never hit this because the footer has no prices, so
  `CurrencyProvider` never needed to reach it — language is the first feature with
  translatable footer content.)*
  ```jsx
  // app/layout.js
  <LanguageProvider initialLanguage={initialLanguage}>
    <LayoutClient stores={stores} initialCurrency={initialCurrency} rates={rates}>
      {children}
    </LayoutClient>
    <Footer />
  </LanguageProvider>
  ```
- **`app/components/LayoutClient.js`** — no language wiring needed; it simply
  renders *inside* the hoisted `LanguageProvider`. `CurrencyProvider` stays nested
  here untouched (the footer needs no currency).

### Extract chrome strings → `t()`
The bulk of the work: **~100-120 inline English strings across ~20 components**,
none currently centralized. Replace each literal with `t("key", language)`,
adding the EN string + a drafted FR string to `messages.js`. Representative
clusters (not exhaustive):
- Nav/menus: `nav/TopBar.js`, `nav/Column1.js`, `MobileNavMenu.js`
- Filters/sort: `MobileFilterPanel.js`, `MobileSortPanel.js`,
  `feed/DesktopFilterPanel.js`
- Cards/panels: `ProductCard.js` ("SOLD", "No image"),
  `ProductInfoPanel.js` (status, "BUY AT …"), `MoreFromStore.js` ("More from …")
- Region: `nav/RegionPanel.js` ("Language", "Currency",
  "Prices are converted from EUR")
- Forms/states: `NewsletterForm.js`, `saved/page.js`, `editorial/page.js`,
  `designers/page.js`, `Footer.js`

### Translation completeness gate (per Codex adversarial review)
The runtime English fallback in `t()` stops the UI from ever showing a raw key,
but it also makes a **missing French key a silent, normal state** — a forgotten
translation ships as English and a manual preview can miss it, against the phase
goal that the interface reads in French. Close the blind spot with an automated
**key-parity test** at `app/lib/i18n/__tests__/messages.test.js`: assert
`Object.keys(MESSAGES.en)` and `Object.keys(MESSAGES.fr)` are **set-equal**, so CI
fails on drift — now, and on any future PR that adds an English string without its
French counterpart. Keep the runtime fallback as the safety net; the test is the
gate. *(Deferred content — brands, product copy, editorial articles — is never in
the dictionary, so parity is a clean equality check, not a partial allowlist.)*

### Taxonomy + sort labels (language-aware *accessors*, not just base entries)
CLAUDE.md makes `categories.js` and `sort-options.js` the single sources of truth
for those labels, so **co-locate the FR there** (`labelFr` on each entry) — not in
the dictionary. **But that alone is not enough** (caught by Codex adversarial
review): consumers don't read the raw entries — they import **precomputed exports
that bake the English label at module load**: `FILTER_GROUPS`
(`categories.js:118`, incl. `` `All ${c.label}` ``), `NAV_TOP_LEVEL` (`:131`),
`SUBCATEGORIES_BY_SHORTKEY` (`:148`, incl. `All …`), and `SORT_OPTIONS`
(`sort-options.js:9`). So:
- Add `labelFr` to every `CATEGORIES` parent/child and `SORT_OPTIONS` entry.
- **Convert the four baked constants to language-aware accessor functions** —
  `getFilterGroups(language)`, `getNavTopLevel(language)`,
  `getSubcategoriesByShortKey(language)`, `getSortOptions(language)` — each
  returning the same shape with the active language's label.
- **Switch *every* consumer import site** to call the accessor with the active
  language (from `useLanguage()` in the client panels). Find them all via
  `grep -rE 'FILTER_GROUPS|NAV_TOP_LEVEL|SUBCATEGORIES_BY_SHORTKEY|SORT_OPTIONS'`;
  missing one ships a half-English menu (the exact failure Codex flagged).
- The composed **`All ${label}`** strings need a deliberate French form (gender/
  grammar — not a mechanical "Tout " prefix); draft per-category or use a clean
  generic ("Tout afficher").
- **Guard the module-load assertion** at `categories.js:168` (it consumes
  `NAV_TOP_LEVEL`/`SUBCATEGORIES_BY_SHORTKEY`): keep it running against the raw
  `CATEGORIES` (or a default-language accessor call) once those become functions —
  otherwise it throws on import.

### Short page copy (server components → `<T>` leaves)
- `app/page.js` (homepage tagline, section labels), `app/about/page.js`
  (paragraph + CTAs), `app/editorial/page.js` (tagline, empty state) — these are
  server components; emit the copy via `<T k="…" />` leaves (**not** server
  `getLanguage()` + `t()`), so it swaps live on toggle with no refresh. Drafted FR
  added to `messages.js`.

### Language-aware metadata (Option A — no hreflang)
- Convert the static `metadata` exports that carry user-facing text
  (`about`, `saved`, `editorial`) to `generateMetadata` reading `getLanguage()` +
  `t()`. This is the **only** place visible text resolves server-side — metadata
  lives in `<head>`, not the rendered tree, so it can't use `<T>`; it updates on
  the next navigation, which is fine. Titles/descriptions return French when
  `depot_lang=fr`. No hreflang/alternate tags (cookie-based, single URL).
- **`editorial/[slug]` is a scope edge:** its title is
  `${entry.hero.title} · Editorial · Dépôt` — translate **only the
  `· Editorial · Dépôt` chrome suffix**; `entry.hero.title` is article content and
  **stays English** (out of scope).

## Deferred (explicitly out of scope for v1)
- **Product copy** — `title`, `editorial_description` stay English (the expensive
  ongoing MT/re-prompt machine; touches the enrich/cron invariants in CLAUDE.md).
- **Long-form editorial articles** — `content/editorial/*` prose stays English.
- **`/fr` URL routing + hreflang + French SEO** — revisit only if product copy is
  later translated.
- **Accept-Language auto-detection** — v1 defaults cookieless visitors to English
  + manual toggle (mirrors currency defaulting to EUR). Auto-detect is a later
  nicety.
- **French number/price formatting** (`1 234,56 €`) — keep the current minimal
  `€255` style in both languages; revisit later if desired.

## Verification (on a Vercel preview, not localhost)
1. **Toggle live-swaps:** open Region menu → click Français. Nav, filters, sort,
   "SOLD", footer, "Prices are converted from EUR", **and** the server-rendered
   prose (homepage tagline, About) all turn French **with no reload** — everything
   swaps via context/`<T>` (no `router.refresh`). Toggle back to English works.
2. **No flash / SSR seed:** set `depot_lang=fr` cookie, hard-reload (disable JS /
   view source) — French chrome must be in the **initial HTML**, no EN→FR flip,
   no hydration warning.
3. **`<html lang>` (both paths):** (a) **live** — toggle to Français *without*
   reloading and confirm `document.documentElement.lang` flips to `"fr"` (the
   provider effect); (b) **seed** — set `depot_lang=fr` and hard-reload, confirm
   the initial HTML carries `<html lang="fr">`.
4. **Persistence:** reload + navigate → French sticks; `depot_lang` cookie has a
   real ~1-year expiry in devtools (not Session).
5. **Fallback:** temporarily remove an FR key → that one string renders English
   (no raw key shown), everything else still French.
6. **Product copy unchanged:** a product card/page in French shows French chrome
   but the English `title`/description and brand — confirming scope held.
7. **Metadata:** with `depot_lang=fr`, About/editorial-index `<title>`/description
   are French (view source / inspect head). On an **editorial article**, only the
   `· Editorial · Dépôt` suffix is French — the article title stays English.
8. **Currency untouched:** £/$/€ selection + conversion still works exactly as
   before; the two toggles are independent.
9. **Mobile:** portal menu `RegionSection` toggles language; FR active state shows.
10. **Footer + newsletter (provider-boundary regression — Codex finding 1a):** the
    footer ("Newsletter", "Explore", "Connect", "Feed/Stores/Saved/Contact") and
    the `NewsletterForm` ("New drops…", "Sign up", success/error text) render in
    French and **do not throw** — confirms the footer's `<T>` leaves and
    `NewsletterForm` (client) sit inside the hoisted `LanguageProvider`. Toggle to
    Français with no full reload: both update live via context.
11. **PDP toggle has no product-copy side effect (Codex finding 2a):** open a
    product whose `editorial_description` is NULL, toggle EN↔FR several times, and
    confirm **no** `generateDescription`/OpenAI call and **no**
    `editorial_description` write fire (check server logs + the DB row is
    unchanged) — proves dropping `router.refresh()` removed the writeback replay.
12. **French taxonomy/sort labels (Codex finding 2b):** in French mode the desktop
    + mobile category filter, the nav sub-menus (incl. the "All …" entries), and
    the sort menu all render **French** labels — across every consumer of
    `FILTER_GROUPS`/`NAV_TOP_LEVEL`/`SUBCATEGORIES_BY_SHORTKEY`/`SORT_OPTIONS`.
13. **Translation completeness gate (Codex finding):** `messages.test.js` passes;
    temporarily deleting one in-scope `fr` key makes it **fail** (proving the gate
    works) — independent of the runtime English fallback.
14. **Currency selector intact after language wiring (Codex finding):** after
    `RegionMenu` reads both hooks, the trigger still shows the currency symbol and
    £/$/€ selection still works — confirms `useCurrency()` wasn't dropped.
