"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const {
  buildSessionHandoffResumePreview,
  costWeightedTokens,
  estimateTokens,
} = require("../../benchmarks/tools/session-handoff-resume-preview.js");

test("session handoff resume preview separates pointer and full injection conditions", () => {
  const report = buildSessionHandoffResumePreview();
  assert.equal(report.kind, "project-librarian-session-handoff-resume-preview");
  assert.equal(report.claim_status, "diagnostic_fixture_only");
  assert.equal(report.default_full_injection, false);
  assert.deepEqual(report.conditions.map((condition) => condition.name), [
    "project_librarian_only",
    "project_librarian_plus_handoff_pointer",
    "project_librarian_plus_full_handoff_injection",
  ]);
  assert(report.conditions[1].estimated_cost_weighted_tokens > report.conditions[0].estimated_cost_weighted_tokens);
  assert(report.conditions[2].estimated_cost_weighted_tokens > report.conditions[1].estimated_cost_weighted_tokens);
});

test("session handoff resume preview CLI prints JSON", () => {
  const script = path.resolve(__dirname, "..", "..", "benchmarks", "tools", "session-handoff-resume-preview.js");
  const stdout = childProcess.execFileSync(process.execPath, [script], { encoding: "utf8" });
  const report = JSON.parse(stdout);
  assert.equal(report.schema_version, 1);
  assert.equal(report.conditions.length, 3);
});

test("session handoff token estimator follows local cost policy", () => {
  assert.equal(estimateTokens("12345"), 2);
  assert.equal(costWeightedTokens({ cachedInput: 10, uncachedInput: 5 }), 6);
});
