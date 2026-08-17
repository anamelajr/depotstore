import { supabaseAdmin } from "../../../lib/supabase.js";
import { withVisibility } from "../../../lib/productQueries.js";
import { evaluateFormattingHealth } from "../../../lib/formattingHealth.js";

export const dynamic = "force-dynamic";
// The scan is O(all live rows) — ~8 paged reads at current volume. 60 s is
// generous headroom; it is not the enrich drain's 300 s because nothing here
// calls OpenAI.
export const maxDuration = 60;

const PAGE_SIZE = 1000;
const SCAN_COLUMNS = "id, store_domain, brand, title, category, enrich_attempts";

// Read-only formatting audit, polled daily by formatting-audit.yml. Reports
// items whose editorial fields are missing past the retry cap or written in a
// non-house form. Writes nothing — the workflow's GitHub issue is the output.
// Auth mirrors /api/health/enrich (and /api/cron's bearer check); deliberately
// NOT under /admin, which middleware.js 404s in production.
export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  // Require a configured secret: with CRON_SECRET unset the template would
  // equal the literal "Bearer undefined", which any caller could send.
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rows;
  try {
    rows = await scanVisibleRows(supabaseAdmin);
  } catch (err) {
    // Fail closed. A partial scan under-reports, and the workflow would read
    // the shrunken result as items having been fixed.
    return Response.json({ error: err.message }, { status: 500 });
  }

  return Response.json({
    ...evaluateFormattingHealth(rows),
    checked_at: new Date().toISOString(),
  });
}

/**
 * Page the visible product set with a KEYSET cursor.
 *
 * Not `.range(from, to)`. captureInventorySnapshot.js pages by ordered offset,
 * which is adequate there because it applies no visibility filter — a `hidden`
 * flip cannot move a row in or out of its set. This scan filters, and
 * /api/enrich sets `hidden = true` in five places. A row hidden between page 3
 * and page 4 shrinks the filtered set, shifts every later offset down by one,
 * and silently drops a row. A keyset cursor is immune: it is a row value, not a
 * position.
 *
 * The consequence of a dropped row is worse than one missing finding — it
 * changes the fingerprint, mailing "something changed", then mailing again when
 * the row reappears. That is exactly the false alarm this design exists to
 * prevent.
 *
 * Exported for the paging unit test, which drives it with a fake client.
 */
export async function scanVisibleRows(db) {
  const rows = [];
  const seen = new Set();
  let lastId = 0;

  for (;;) {
    const { data, error } = await withVisibility(
      db.from("products").select(SCAN_COLUMNS)
    )
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);

    if (error) {
      throw new Error(`product scan failed after id ${lastId}: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      // A duplicate means the cursor logic is wrong. Fail rather than
      // double-count: a doubled violation would move the fingerprint too.
      if (seen.has(row.id)) {
        throw new Error(`duplicate row id ${row.id} in paged scan`);
      }
      seen.add(row.id);
      rows.push(row);
    }
    lastId = data[data.length - 1].id;
    if (data.length < PAGE_SIZE) break;
  }

  return rows;
}
