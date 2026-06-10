#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { summarizeJsonl } = require("../../benchmarks/lib/codex-jsonl");
const { evaluateCorrectness } = require("../../benchmarks/lib/llm-correctness");

const root = path.resolve(__dirname, "..", "..");

function validateSampleJsonl() {
  const samplePath = path.join(root, "benchmarks", "llm", "samples", "codex-turn-completed.jsonl");
  const metrics = summarizeJsonl(fs.readFileSync(samplePath, "utf8"), { wall_ms: 2000 });
  assert.equal(metrics.input_tokens, 24763);
  assert.equal(metrics.cached_input_tokens, 24448);
  assert.equal(metrics.output_tokens, 122);
  assert.equal(metrics.reasoning_output_tokens, 0);
  assert.equal(metrics.total_tokens, 24885);
  assert.equal(metrics.codex_turn_count, 1);
  assert.equal(metrics.command_event_count, 2);
  assert.equal(metrics.final_text, "Project Librarian benchmark evidence is documented in wiki/canonical/benchmark-and-release-evidence.md.");
  assert.equal(metrics.error_event_count, 0);
}

function validateReasoningTokenTotal() {
  const metrics = summarizeJsonl([
    JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 100,
        output_tokens: 25,
        reasoning_output_tokens: 10,
      },
    }),
  ].join("\n"), { wall_ms: 1000 });
  assert.equal(metrics.total_tokens, 125);
}

function validateReport(reportPath) {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.schema_version, 1);
  if (report.benchmark_kind === "codex-actual-llm-manifest") {
    assert(Array.isArray(report.scenarios));
    assert(report.scenarios.length > 0);
    assert(report.scenarios.every((scenario) => scenario.cwd && scenario.prompt && Array.isArray(scenario.command)));
    return;
  }
  assert.equal(report.benchmark_kind, "codex-actual-llm");
  assert(report.configuration && Number.isInteger(report.configuration.runs));
  assert(Array.isArray(report.scenarios));
  assert(report.scenarios.every((scenario) => Array.isArray(scenario.runs) && Object.hasOwn(scenario, "median") && scenario.median_all_runs && Array.isArray(scenario.correctness)));
  assert(report.scenarios.every((scenario) => Number.isInteger(scenario.passed_run_count)));
}

function validateCorrectness() {
  const passed = evaluateCorrectness({
    taskFamily: "decision_lookup",
    condition: "with_project_librarian",
    finalText: "2026-06-10 metrics decision in wiki/canonical/benchmark-and-release-evidence.md explains benchmark evidence.",
    fileChangeCount: 0,
  });
  assert.equal(passed.status, "passed");

  const needsReview = evaluateCorrectness({
    taskFamily: "decision_lookup",
    condition: "with_project_librarian",
    finalText: "",
    fileChangeCount: 0,
  });
  assert.equal(needsReview.status, "needs_review");
}

const reportPath = process.argv[2];
validateSampleJsonl();
validateReasoningTokenTotal();
validateCorrectness();
if (reportPath) validateReport(path.resolve(reportPath));
console.log("codex llm benchmark smoke ok");
