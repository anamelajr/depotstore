import { cache } from "react";
import { after } from "next/server";
import { generateDescription } from "./generateDescription";
import { supabase, supabaseAdmin } from "./supabase.js";
import { parseSizes } from "./parseSizes.js";

// Pure helpers — exported for unit tests; the page only consumes
// resolveProductDetail. Kept internal-by-convention; if anything outside the
// PDP starts importing them, consider that a smell that they belong in a
// shared formatter module.

export function stripHtml(html) {
  if (!html) return null;
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function nonEmpty(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Accessory-class keyword regex used by the bag/accessory ONE SIZE
// fallback. Tested against `product_type` and against each tag; one
// match is enough. Kept narrow enough that a "leather skirt" with stray
// "accessories" merchandising tags doesn't trigger — the regex requires
// a noun head, not the word "accessory" alone.
const ACCESSORY_KW =
  /\b(bag|handbag|tote|clutch|backpack|purse|wallet|cardholder|sunglasses|eyewear|glasses|hat|cap|beanie|beret|scarf|shawl|stole|belt|tie|gloves|jewel(?:lery|ry)?|necklace|bracelet|earrings?|brooch|pendant)s?\b/i;

function looksLikeAccessory(product) {
  const pt =
    typeof product?.product_type === "string" ? product.product_type : "";
  if (pt && ACCESSORY_KW.test(pt)) return true;
  const tags = Array.isArray(product?.tags)
    ? product.tags
    : typeof product?.tags === "string"
      ? product.tags.split(",").map((t) => t.trim())
      : [];
  for (const t of tags) {
    if (typeof t === "string" && ACCESSORY_KW.test(t)) return true;
  }
  return false;
}

// Render-ready sizes array for the PDP. Four layers, in order. First
// non-null wins.
//
//   L1 — Stored array: `dbRow.size` is a Postgres `text[]` (hydrated to
//        a JS array by supabase-js). Wins whenever non-empty. This is
//        the steady-state path — the cron sync writes it on every run.
//
//   L2 — Live parse: re-run `parseSizes(product)` on the live Shopify
//        payload. Covers (a) the cron-lag window when a product was
//        listed since the last hourly sync (dbRow exists but `size`
//        column is null because Step-1 wasn't yet aware of this product
//        when it last ran), and (b) any row whose sync somehow skipped
//        the column. Without this layer, brand-new products would
//        render with an empty SIZE block for up to 60 minutes — a
//        visible regression vs the pre-redesign PDP, which derived
//        sizes from variants on every load.
//
//   L3 — Accessory ONE SIZE fallback. Triggered when (a) DB category is
//        "Bags & Accessories", OR (b) the live Shopify `product_type`
//        or `tags` match the bag/accessory keyword list. Branch (b) is
//        what saves uncategorized bags (DB category=NULL because the
//        enrichment classifier hasn't run on the row yet) from
//        rendering with no SIZE block.
//
//   L4 — null (PDP hides the SIZE block — honest empty).
//
// Defensive against the pre-migration row shape: if `dbRow.size` is a
// scalar string (legacy), we ignore it rather than splitting — the
// next sync will overwrite with the correct array shape.
export function resolveSizes(dbRow, product) {
  // L1
  const raw = dbRow?.size;
  const arr = Array.isArray(raw) ? raw : [];
  const parts = arr
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);
  if (parts.length > 0) return parts;

  // L2
  const live = parseSizes(product);
  if (Array.isArray(live) && live.length > 0) return live;

  // L3
  if (dbRow?.category === "Bags & Accessories") return ["ONE SIZE"];
  if (looksLikeAccessory(product)) return ["ONE SIZE"];

  // L4
  return null;
}

// This is the widest tail-latency risk on the site: an unbounded fetch to a
// third-party merchant domain sitting on the critical path of every PDP
// render. 5s is generous for a JSON product read and still bounded.
const SHOPIFY_FETCH_TIMEOUT_MS = 5000;

// Returning `null` here means ONE thing: the merchant authoritatively says
// this product does not exist. The caller turns that into the "Product not
// found" page, so it must never stand in for "we couldn't reach the merchant".
// Everything else — timeout, DNS/reset/TLS (surfaced as TypeError by fetch),
// any non-404 status, malformed JSON — throws into the route's error boundary,
// which offers a retry. A Shopify 503 rendering as a permanent "not found" for
// a product that plainly exists is the failure this classification prevents.
async function fetchShopifyProduct(handle, storeDomain) {
  const res = await fetch(
    `https://${storeDomain}/products/${handle}.json?country=FR`,
    { next: { revalidate: 300 }, signal: AbortSignal.timeout(SHOPIFY_FETCH_TIMEOUT_MS) }
  );
  // 410 Gone is as authoritative as 404 — a delisted product.
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) {
    throw new Error(`Shopify responded ${res.status} for ${storeDomain}/${handle}`);
  }
  const data = await res.json();
  return data?.product ?? null;
}

// ── Authorization gate cache ────────────────────────────────────────────
//
// The allowlist check used to be a serial Supabase round-trip on every PDP
// render, before anything else could start. It is cached — but deliberately
// NOT with `unstable_cache`, and deliberately NOT through the
// FALLBACK_STORES-catching wrapper in stores.js. This is an authorization
// decision, so it has to fail closed:
//
//   • `unstable_cache`'s stale-while-revalidate serves the old entry
//     indefinitely when refreshes keep failing — it cannot bound the window
//     in which a deactivated store stays resolvable.
//   • `getActiveStores` degrades to a hardcoded fallback list on DB failure,
//     which for a render is graceful and for an allowlist is a bypass.
//
// So: a plain module-scope `{ data, fetchedAt }` entry. Fresh under 600s.
// Expired → refetch. Refetch failure → serve stale only while under the 1h
// hard cap, then return null (→ 404).
//
// Accepted residual: a store deactivated in the DB stays resolvable for up to
// 600s normally, up to 1h during a sustained Supabase outage.
const STORE_GATE_TTL_MS = 600_000;
const STORE_GATE_HARD_CAP_MS = 3_600_000;
// `?store=` is a public query param, and unknown domains are cached (data:
// null) like real ones so probes can't hammer Supabase — which means the map
// grows with every unique garbage domain a scanner throws at it. Cap it well
// above the real store count (~15) and evict oldest-inserted past the cap;
// legit domains get re-fetched on their next hit, probe garbage never returns.
const STORE_GATE_MAX_ENTRIES = 500;

// domain → { data, fetchedAt }. Exported for tests only — nothing outside
// this module (or its test) should touch it.
export const storeGateCache = new Map();

function setGateEntry(domain, entry) {
  // Delete-then-set refreshes insertion order, making eviction oldest-first.
  storeGateCache.delete(domain);
  storeGateCache.set(domain, entry);
  for (const key of storeGateCache.keys()) {
    if (storeGateCache.size <= STORE_GATE_MAX_ENTRIES) break;
    storeGateCache.delete(key);
  }
}

async function readStoreRow(storeDomain) {
  const { data, error } = await supabase
    .from("stores")
    .select("store_name, display_name, location")
    .eq("domain", storeDomain)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`store gate read failed: ${error.message}`);
  // `data === null` is a real answer (unknown or inactive domain), cached like
  // any other so a scripted probe of bad domains can't hammer Supabase.
  return data ?? null;
}

async function resolveStoreGate(storeDomain) {
  const entry = storeGateCache.get(storeDomain);
  const age = entry ? Date.now() - entry.fetchedAt : Infinity;

  if (entry && age < STORE_GATE_TTL_MS) return entry.data;

  try {
    const data = await readStoreRow(storeDomain);
    setGateEntry(storeDomain, { data, fetchedAt: Date.now() });
    return data;
  } catch (e) {
    if (entry && age < STORE_GATE_HARD_CAP_MS) {
      console.warn(
        JSON.stringify({
          event: "store_gate_stale_serve",
          domain: storeDomain,
          ageMs: age,
          reason: e?.message ?? String(e),
        }),
      );
      return entry.data;
    }
    // Beyond the hard cap (or with nothing cached) the gate fails closed.
    console.error(
      JSON.stringify({
        event: "store_gate_fail_closed",
        domain: storeDomain,
        reason: e?.message ?? String(e),
      }),
    );
    return null;
  }
}

// Returns a flat, render-ready detail object, or null when the PDP should
// fall back to the "Product not found." view (missing params, unknown/inactive
// store domain, or Shopify 404/network failure). Raw Shopify product is
// intentionally not in the return shape — every consumer field is pre-derived
// here so the page stays pure rendering.
//
// "Core" = everything the page shell needs, up to and including the *stored*
// description. It never calls OpenAI: generation is split into
// `resolveDescription` below so a missing `editorial_description` streams in
// behind Suspense instead of blocking the whole document (99% of visible rows
// are missing one today).
//
// React.cache'd on primitive args so the page and both description slots
// share a single execution per request. The exported wrappers take an object
// for readability; the memoized inner takes positionals because React.cache
// keys on argument identity and a fresh object literal would miss every time.
const resolveCore = cache(async (handle, storeDomain) => {
  if (!handle || !storeDomain) return null;

  // Allowlist check — reject unknown or inactive domains before fetching
  // Shopify, preventing an attacker-controlled domain from being fetched and
  // rendered inside Dépôt's chrome.
  const storeRow = await resolveStoreGate(storeDomain);
  if (!storeRow) return null;

  const [product, { data: dbRow }] = await Promise.all([
    fetchShopifyProduct(handle, storeDomain),
    supabase
      .from("products")
      .select("brand, title, editorial_description, available, size, category")
      .eq("store_domain", storeDomain)
      .eq("handle", handle)
      .maybeSingle(),
  ]);

  if (!product) return null;

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

  // Zero-priced pieces are the stores' "not for sale" / rental archive; the
  // feed excludes them, so a direct link must 404 rather than render a €0
  // product page. Keyed off the live Shopify price (the value that would be
  // displayed), so it stays correct even if the DB row is stale between
  // hourly syncs. Placed before generateDescription so no OpenAI spend goes
  // to a page that will never render.
  if (minPrice === 0) return null;

  const sizes = resolveSizes(dbRow, product);
  // Source product-level availability from the cron-maintained
  // `products.available` column, not from the Shopify single-product fetch.
  // The single-product endpoint omits `variant.available`; the cron derives
  // availability from `/products.json` (the listing endpoint) where the
  // field IS populated, and writes the result to Supabase. Fall back to
  // `true` for rows that haven't been synced yet — matches the implicit
  // pre-redesign behavior of treating unknown availability as available.
  const available = dbRow?.available ?? true;

  const rawDescription = stripHtml(product.body_html);
  const tags = Array.isArray(product.tags)
    ? product.tags
    : typeof product.tags === "string"
      ? product.tags.split(",").map((t) => t.trim())
      : [];

  const brand = nonEmpty(dbRow?.brand) ?? nonEmpty(product.vendor);
  const title = nonEmpty(dbRow?.title) ?? nonEmpty(product.title) ?? product.title;
  const storeName =
    nonEmpty(storeRow?.display_name) ?? nonEmpty(storeRow?.store_name) ?? storeDomain;

  return {
    images,
    sizes,
    price,
    brand,
    title,
    storeName,
    storeLocation: storeRow?.location ?? null,
    // The STORED description, or null. Null means "must be generated" —
    // see resolveDescription.
    description: dbRow?.editorial_description || null,
    available,
    // Everything generateDescription needs, pre-derived here so the
    // description resolver never re-fetches Shopify.
    descriptionInput: {
      name: product.title,
      vendor: product.vendor ?? null,
      rawDescription,
      tags,
      price,
      storeName,
    },
  };
});

export async function resolveProductDetailCore({ handle, storeDomain }) {
  return resolveCore(handle, storeDomain);
}

// `after()` is only available inside a Next.js request scope. Tests and any
// non-request caller fall through to a detached promise — same fire-and-forget
// semantics, just without the request-lifetime guarantee.
function scheduleCacheBack(work) {
  try {
    after(work);
  } catch {
    void work();
  }
}

// Resolves the description, generating one when the row has none. Awaited by
// the streamed description slots, never by the page shell.
//
// React.cache'd so the mobile Accordion slot and the desktop ProductInfoPanel
// slot — both present in one document — share ONE OpenAI call.
//
// The cache-back write is deferred with `after()` so the response is not held
// open for it, and guarded with `.is("editorial_description", null)` so it can
// never clobber a description a concurrent cron backfill just wrote (mirrors
// the editorial write-only-if-NULL invariant). Failures are swallowed: the
// page still renders with the generated text.
export const resolveDescription = cache(async (handle, storeDomain) => {
  const core = await resolveCore(handle, storeDomain);
  if (!core) return null;
  if (core.description) return core.description;

  // Bound the OpenAI call too: the description streams into an open Suspense
  // slot, so a hung request would pin that slot (and the response) open
  // indefinitely. Timeout → null → the existing no-description fallback.
  const generated = await generateDescription(core.descriptionInput, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!generated) return null;

  scheduleCacheBack(async () => {
    try {
      await supabaseAdmin
        .from("products")
        .update({ editorial_description: generated })
        .eq("store_domain", storeDomain)
        .eq("handle", handle)
        .is("editorial_description", null);
    } catch {
      // Write failure: page still renders with the generated description.
    }
  });

  return generated;
});
