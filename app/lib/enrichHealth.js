// Pure evaluation logic for /api/health/enrich, split out so the alarm
// condition is unit-testable without Supabase.
//
// Input: enrich_runs rows (run_type='enrich', openai_calls > 0) ordered
// created_at DESC, from a bounded lookback window. Rows with openai_calls = 0
// (fast-path-only batches) must already be filtered out by the caller — they
// say nothing about OpenAI health.

// Consecutive zero-success rows required before alarming. One batch can be a
// fluke (transient 5xx burst inside a single hop); three is the 2026-07-14
// incident signature within its first hours.
export const ALARM_CONSECUTIVE_RUNS = 3;

export function evaluateEnrichHealth(rows) {
  const qualifying = rows ?? [];
  if (qualifying.length === 0) {
    // No OpenAI activity at all in the lookback window. Not the zero-success
    // alarm — a separate staleness signal (queue drained, or cron dead, which
    // sync.yml already alarms on).
    return { status: "ok", alarm: false, stale: true, evaluated: 0 };
  }
  const window = qualifying.slice(0, ALARM_CONSECUTIVE_RUNS);
  const alarm =
    qualifying.length >= ALARM_CONSECUTIVE_RUNS &&
    window.every((r) => (r.openai_succeeded ?? 0) === 0);
  return {
    status: alarm ? "alarm" : "ok",
    alarm,
    stale: false,
    evaluated: window.length,
  };
}
