// SEARCH_ALIASES — lower-cased single-word search token → replacement token.
// The replacement must substring-match the intended brand inside DB
// (title || ' ' || brand || ' ' || name), case-insensitive — this is the
// shape the get_interleaved_products RPC and applySearchFilter both query.
//
// Ship: CDG only. "comme" hits all 8 in-DB Comme des Garçons brand variants
// (verified 2026-05-27: 140 brand-pure hits + 3 collab rows where "Comme des
// Garçons" appears in the product name — net positive). Future entries
// (mmm, jpg, …) follow the same shape: pick a replacement substring that's
// present in every target brand variant and not in unrelated brands.
//
// Out of scope here: multi-word aliases (e.g. "ann d" → "demeulemeester")
// would need a phrase-matching pass; file a separate spec when there's a
// second data point.
const SEARCH_ALIASES = {
  cdg: "comme",
};

export function expandSearchAliases(query) {
  if (!query || typeof query !== "string") return query;
  let changed = false;
  const expanded = query
    .trim()
    .split(/\s+/)
    .map((token) => {
      const replacement = SEARCH_ALIASES[token.toLowerCase()];
      if (replacement) {
        changed = true;
        return replacement;
      }
      return token;
    });
  return changed ? expanded.join(" ") : query;
}

// checkCdgAliasDrift — structural false-positive probe for the cdg→comme
// expansion. Returns rows whose search corpus (title || brand || name)
// contains "comme" but whose brand isn't a Comme des Garçons variant AND
// whose name doesn't carry the documented collab marker ("comme des"). As
// of 2026-05-27 the expected count is 0: the 3 known collab rows
// (CHROME HEARTS, JUNYA WATANABE, NOIR KEI NINOMIYA × CDG) all have
// "comme des" in their name. Anything > 0 means an unrelated row has
// joined the catalog and is being silently surfaced as a CDG search hit.
//
// Run from /api/cron post-sync (see cron/route.js). Never throws — the
// caller treats a non-empty result as a log signal, not a hard failure,
// mirroring the existing enrich_runs telemetry pattern at
// app/api/cron/route.js:284.
export async function checkCdgAliasDrift(supabase) {
  const { data, error } = await supabase
    .from("products")
    .select("brand,title,name,store_domain")
    .eq("available", true)
    .eq("hidden", false)
    .or("title.ilike.%comme%,brand.ilike.%comme%,name.ilike.%comme%")
    .not("brand", "ilike", "%comme%");
  if (error) return { error, count: 0, samples: [] };
  const unexpected = (data ?? []).filter(
    (row) => !(row.name ?? "").toLowerCase().includes("comme des"),
  );
  return {
    error: null,
    count: unexpected.length,
    samples: unexpected.slice(0, 10),
  };
}
