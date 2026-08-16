import { describe, it, expect } from "vitest";
import {
  validateReport,
  renderIssueBody,
  extractFingerprint,
} from "../formattingReport.js";
import { evaluateFormattingHealth } from "../formattingHealth.js";

const ok = {
  status: "ok",
  violations: {},
  review: {},
  silent: { queued_null: 0 },
  scanned: 8013,
  fingerprint: "abc123",
  checked_at: "2026-08-16T07:20:00.000Z",
};

describe("validateReport — fail closed", () => {
  it("accepts a complete response", () => {
    expect(validateReport(ok)).toBe(ok);
  });

  it("rejects a 200 body of {}", () => {
    // Valid JSON, no violations — would read as all-clear and overwrite the
    // living report with a false clean status.
    expect(() => validateReport({})).toThrow(/missing status/);
  });

  it("rejects a body missing scanned", () => {
    const { scanned, ...rest } = ok;
    expect(() => validateReport(rest)).toThrow(/scanned/);
  });

  it("rejects wrong-typed or empty required fields", () => {
    expect(() => validateReport({ ...ok, scanned: "8013" })).toThrow(/scanned/);
    expect(() => validateReport({ ...ok, violations: [] })).toThrow(/violations/);
    expect(() => validateReport({ ...ok, review: null })).toThrow(/review/);
    expect(() => validateReport({ ...ok, fingerprint: "" })).toThrow(/fingerprint/);
    expect(() => validateReport({ ...ok, checked_at: 0 })).toThrow(/checked_at/);
    expect(() => validateReport(null)).toThrow(/not an object/);
  });
});

describe("renderIssueBody", () => {
  it("says so, and carries the fingerprint, at zero violations", () => {
    const body = renderIssueBody(ok);
    expect(body).toContain("No formatting violations");
    expect(extractFingerprint(body)).toBe("abc123");
  });

  it("renders the Worth a glance section even at zero violations", () => {
    // With close-on-clean the review tier would be orphaned — a review-only
    // finding after a clean state would have nowhere to land.
    const payload = {
      ...evaluateFormattingHealth([
        ...["PRADA", "GUCCI", "MARNI"].map((brand, i) => ({
          id: i + 1,
          store_domain: "a.com",
          brand,
          title: "Zip-up Leather Boots",
          category: "Shoes",
          enrich_attempts: 0,
        })),
        {
          id: 14953917,
          store_domain: "b.com",
          brand: "MISC",
          title: "Calvin Klein Leather Boots",
          category: "Shoes",
          enrich_attempts: 0,
        },
      ]),
      checked_at: ok.checked_at,
    };
    expect(payload.status).toBe("ok");
    const body = renderIssueBody(validateReport(payload));
    expect(body).toContain("No formatting violations");
    expect(body).toContain("## Worth a glance");
    expect(body).toContain("14953917");
  });

  it("groups violations by key with store, id and current value", () => {
    const payload = {
      ...ok,
      status: "violations",
      violations: {
        trailing_by: {
          count: 1,
          items: [
            {
              id: 14953917,
              store_domain: "chezsnowbunny.fr",
              brand: "MISC",
              title: "Leather Boots By",
            },
          ],
          truncated: false,
        },
      },
    };
    const body = renderIssueBody(payload);
    expect(body).toContain("1 formatting violation.");
    expect(body).toContain("`14953917` [chezsnowbunny.fr] MISC | Leather Boots By");
    expect(body).toContain("`trailing_by`");
  });

  it("notes truncation without misreporting the total", () => {
    const payload = {
      ...ok,
      status: "violations",
      violations: {
        enrichment_failed: {
          count: 76,
          items: [{ id: 1, store_domain: "a.com", brand: null, title: null }],
          truncated: true,
        },
      },
    };
    expect(renderIssueBody(payload)).toContain("_Showing 1 of 76._");
  });
});
