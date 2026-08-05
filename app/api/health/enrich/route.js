import { supabaseAdmin } from "../../../lib/supabase.js";
import { evaluateEnrichHealth } from "../../../lib/enrichHealth.js";

export const dynamic = "force-dynamic";

const LOOKBACK_HOURS = 72;

// Read-only health probe for the enrich pipeline, polled by the
// enrich-health.yml GitHub Actions workflow. Alarms when the last N
// OpenAI-active enrich batches all recorded zero successes — the 2026-07-14
// silent-outage signature. Deliberately NOT under /admin (middleware 404s
// that in production); auth mirrors /api/cron's bearer check.
export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const since = new Date(
    Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from("enrich_runs")
    .select("created_at,openai_calls,openai_succeeded")
    .eq("run_type", "enrich")
    .gt("openai_calls", 0)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const health = evaluateEnrichHealth(rows);
  return Response.json({
    ...health,
    latest: rows ?? [],
    checked_at: new Date().toISOString(),
  });
}
