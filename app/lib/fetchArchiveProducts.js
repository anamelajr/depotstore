// Membership query for a featured archive (app/lib/archives.js).
//
// Server-side only. Reads `products` directly rather than through the
// interleaved RPCs: archive membership is a union of brand/era/attribution
// rules, which the RPCs' store/category/search parameter surface can't express,
// and the result set is small enough (tens of rows) that store interleaving
// would be noise.
//
// Throws on any Supabase error — see the fail-closed note on runRuleQuery.

import { chunkArray } from "./chunk.js";
import { escapePostgrestValue } from "./fetchProductsPage.js";
import {
  withVisibility,
  PRODUCT_ROW_SELECT,
  mapProductRow,
} from "./productQueries.js";

// Same rationale as productQueries.js:5-8 — supabase.js throws at import time
// when NEXT_PUBLIC_SUPABASE_URL is unset, so the default client is resolved
// lazily and tests can inject a stub instead.
async function getDefaultClient() {
  const { supabase } = await import("./supabase.js");
  return supabase;
}

const ROW_SELECT = `${PRODUCT_ROW_SELECT}, synced_at`;

function rowKey(row) {
  return `${row.store_domain}::${row.handle}`;
}

function pairKey(pair) {
  return `${pair.storeDomain}::${pair.handle}`;
}

// Attribution is matched against `name` and `description` only, never `title`:
// enrichment deliberately strips brand/designer tokens out of titles
// (titleLeaksAllowedBrandStrict + the cleanTitle prompt), so a title cannot
// carry a signal its source `name` lacks — a full-table check confirmed zero
// rows with title-only attribution.
function attributionFilter(tokens) {
  return tokens
    .flatMap((token) => {
      const value = escapePostgrestValue(`%${token}%`);
      return [`name.ilike.${value}`, `description.ilike.${value}`];
    })
    .join(",");
}

// Fail closed. supabase-js query builders resolve to { data, error } and never
// reject, so Promise.all offers no protection here: a swallowed error would
// quietly drop one rule's rows and the page would render a partial archive as
// an authoritative "N ITEMS". Worse, unstable_cache does not cache a thrown
// error but WOULD cache that partial result for an hour. Throwing is therefore
// load-bearing, and matches fetchProductsPage's convention ("throws on Supabase
// error; callers decide how to degrade") — the archive page lets it surface to
// Next's error boundary.
async function runRuleQuery(client, rule, index) {
  let q = withVisibility(
    client.from("products").select(ROW_SELECT).eq("brand", rule.brand),
  );

  if (rule.eraStart != null) {
    q = q.gte("era_year", rule.eraStart).lte("era_year", rule.eraEnd);
  }
  if (rule.eraYearNull) q = q.is("era_year", null);
  if (rule.attribution?.length) q = q.or(attributionFilter(rule.attribution));

  const { data, error } = await q;
  if (error) {
    console.error(
      `[fetchArchiveProducts] rule ${index} (${rule.brand}) failed:`,
      error.message,
    );
    throw new Error(`Archive rule query failed: ${error.message}`);
  }
  return data ?? [];
}

// Curated includes, fetched the same way as editorial's fetchCurated: grouped
// by domain, handles chunked at 100 for PostgREST's URL limit, and still under
// withVisibility — a manual include can add a piece the rules miss, never a
// sold or hidden one.
async function fetchIncluded(client, include) {
  if (!include?.length) return [];
  const wanted = new Set(include.map(pairKey));
  const byDomain = new Map();
  for (const pair of include) {
    if (!byDomain.has(pair.storeDomain)) byDomain.set(pair.storeDomain, []);
    byDomain.get(pair.storeDomain).push(pair.handle);
  }

  const rows = [];
  for (const [domain, handles] of byDomain.entries()) {
    for (const chunk of chunkArray(handles, 100)) {
      const { data, error } = await withVisibility(
        client.from("products").select(ROW_SELECT).eq("store_domain", domain),
      ).in("handle", chunk);
      if (error) {
        console.error(
          `[fetchArchiveProducts] include fetch failed for ${domain}:`,
          error.message,
        );
        throw new Error(`Archive include query failed: ${error.message}`);
      }
      // The .in() is per-domain, so a handle that exists under a different
      // store can't sneak in; the wanted-set check pins that explicitly.
      for (const row of data ?? []) if (wanted.has(rowKey(row))) rows.push(row);
    }
  }
  return rows;
}

/**
 * Every available product belonging to `archive`, newest-synced first.
 *
 * Rules run concurrently (three for Hedi, each an eq/indexed predicate over a
 * few hundred rows — far inside the 8s REST statement timeout), are unioned and
 * deduped, then adjusted by the archive's manual overrides.
 */
export async function fetchArchiveProducts(archive, { client = null } = {}) {
  if (!archive?.rules?.length) return [];
  const c = client || (await getDefaultClient());

  const perRule = await Promise.all(
    archive.rules.map((rule, i) => runRuleQuery(c, rule, i)),
  );

  const byKey = new Map();
  for (const rows of perRule) {
    for (const row of rows) {
      if (!byKey.has(rowKey(row))) byKey.set(rowKey(row), row);
    }
  }

  for (const pair of archive.exclude ?? []) byKey.delete(pairKey(pair));

  for (const row of await fetchIncluded(c, archive.include)) {
    if (!byKey.has(rowKey(row))) byKey.set(rowKey(row), row);
  }

  return [...byKey.values()]
    .sort((a, b) => String(b.synced_at ?? "").localeCompare(String(a.synced_at ?? "")))
    .map(mapProductRow);
}
