import { describe, it, expect } from "vitest";
import { evaluateEnrichHealth, ALARM_CONSECUTIVE_RUNS } from "../enrichHealth.js";

// Rows arrive ordered created_at DESC (newest first), pre-filtered to
// run_type='enrich' AND openai_calls > 0.
const row = (openai_succeeded) => ({ openai_calls: 10, openai_succeeded });

describe("evaluateEnrichHealth", () => {
  it("alarms when the last 3 OpenAI-active runs all had zero successes", () => {
    const health = evaluateEnrichHealth([row(0), row(0), row(0), row(5)]);
    expect(health).toEqual({ status: "alarm", alarm: true, stale: false, evaluated: 3 });
  });

  it("stays ok when a recent run succeeded", () => {
    const health = evaluateEnrichHealth([row(0), row(3), row(0)]);
    expect(health.alarm).toBe(false);
    expect(health.status).toBe("ok");
  });

  it("stays ok when the newest run succeeded after older zeros", () => {
    expect(evaluateEnrichHealth([row(7), row(0), row(0), row(0)]).alarm).toBe(false);
  });

  it("does not alarm on fewer than the required consecutive runs", () => {
    expect(evaluateEnrichHealth([row(0), row(0)]).alarm).toBe(false);
    expect(ALARM_CONSECUTIVE_RUNS).toBe(3);
  });

  it("flags an empty window as stale, not alarm", () => {
    expect(evaluateEnrichHealth([])).toEqual({
      status: "ok",
      alarm: false,
      stale: true,
      evaluated: 0,
    });
    expect(evaluateEnrichHealth(null).stale).toBe(true);
  });

  it("treats missing openai_succeeded as zero", () => {
    const health = evaluateEnrichHealth([
      { openai_calls: 4 },
      { openai_calls: 4 },
      { openai_calls: 4 },
    ]);
    expect(health.alarm).toBe(true);
  });
});
