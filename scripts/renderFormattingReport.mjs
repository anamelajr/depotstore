#!/usr/bin/env node
// Thin CLI for .github/workflows/formatting-audit.yml.
//
//   node scripts/renderFormattingReport.mjs <response.json> <body.md>
//
// Validates the /api/health/formatting response and writes the issue body,
// printing the fingerprint on stdout for the workflow to compare. Exits
// non-zero on a malformed response so the job fails and the living report is
// left untouched — a short or empty body must never be rendered as "clean".
import { readFileSync, writeFileSync } from "node:fs";
import { validateReport, renderIssueBody } from "../app/lib/formattingReport.js";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: renderFormattingReport.mjs <response.json> <body.md>");
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(readFileSync(input, "utf8"));
} catch (err) {
  console.error(`unparseable response: ${err.message}`);
  process.exit(1);
}

try {
  validateReport(payload);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

writeFileSync(output, renderIssueBody(payload));
process.stdout.write(payload.fingerprint);
