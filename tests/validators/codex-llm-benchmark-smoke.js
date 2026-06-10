#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const assert = require("node:assert/strict");
const { summarizeJsonl } = require("../../benchmarks/lib/codex-jsonl");
const { evaluateCorrectness } = require("../../benchmarks/lib/llm-correctness");
const { medianMetrics, passedRuns } = require("../../benchmarks/lib/llm-report");

const root = path.resolve(__dirname, "..", "..");
const sampleFinalText = "2026-06-10 metrics decision in wiki/decisions/log.md documents Project Librarian benchmark evidence.";

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
  assert.equal(metrics.command_invocation_count, 1);
  assert.equal(metrics.tool_event_count, 2);
  assert.equal(metrics.tool_invocation_count, 1);
  assert.equal(metrics.model, "gpt-5.5");
  assert.deepEqual(metrics.models, ["gpt-5.5"]);
  assert.equal(metrics.final_text, sampleFinalText);
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

function validateInvocationCounts() {
  const functionCallMetrics = summarizeJsonl([
    JSON.stringify({ type: "function_call", name: "read_file" }),
    JSON.stringify({ type: "function_call_output", name: "read_file" }),
  ].join("\n"));
  assert.equal(functionCallMetrics.tool_event_count, 2);
  assert.equal(functionCallMetrics.tool_invocation_count, 1);

  const completedOnlyMetrics = summarizeJsonl(JSON.stringify({
    type: "tool.command.completed",
    command: "rg benchmark wiki",
    exit_code: 0,
  }));
  assert.equal(completedOnlyMetrics.command_event_count, 1);
  assert.equal(completedOnlyMetrics.command_invocation_count, 1);
  assert.equal(completedOnlyMetrics.tool_event_count, 1);
  assert.equal(completedOnlyMetrics.tool_invocation_count, 1);
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
  assert(report.auth && report.auth.auth_mode_source === "declared");
  assert(report.configuration && Number.isInteger(report.configuration.runs));
  assert(Array.isArray(report.scenarios));
  assert(report.scenarios.length > 0);
  assert.equal(report.configuration.selected_scenarios, report.scenarios.length);

  let passedCorrectnessCount = 0;
  let needsReviewCount = 0;
  let failedCorrectnessCount = 0;

  for (const scenario of report.scenarios) {
    assert(Array.isArray(scenario.runs));
    assert(scenario.runs.length > 0);
    assert(Object.hasOwn(scenario, "median"));
    assert(scenario.median_all_runs);
    assert(Array.isArray(scenario.correctness));
    assert.equal(scenario.correctness.length, scenario.runs.length);
    assert.deepEqual(scenario.raw_jsonl_paths, scenario.runs.map((run) => run.raw_jsonl_path));
    assert(Number.isInteger(scenario.passed_run_count));
    assert(Array.isArray(scenario.models));
    if (scenario.models.length === 1) assert.equal(scenario.model, scenario.models[0]);
    if (scenario.models.length !== 1) assert.equal(scenario.model, null);

    let passedRunCount = 0;
    const runModels = new Set();
    for (const [index, run] of scenario.runs.entries()) {
      assert(run.metrics);
      const rawPath = path.resolve(root, run.raw_jsonl_path);
      assert(fs.existsSync(rawPath), `missing raw JSONL: ${run.raw_jsonl_path}`);
      const rawMetrics = summarizeJsonl(fs.readFileSync(rawPath, "utf8"), { wall_ms: run.metrics.wall_ms });
      assert.deepEqual(run.metrics, rawMetrics);
      assert(Number.isInteger(run.metrics.command_invocation_count));
      assert(Number.isInteger(run.metrics.tool_invocation_count));
      assert(Array.isArray(run.metrics.models));
      for (const model of run.metrics.models) runModels.add(model);
      if (run.metrics.models.length === 0) assert(run.metrics.unavailable_event_fields.includes("model"));
      if (run.metrics.models.length === 1) assert.equal(run.metrics.model, run.metrics.models[0]);
      if (run.metrics.models.length > 1) assert(run.metrics.unavailable_event_fields.includes("single_model"));
      const expectedCorrectness = evaluateCorrectness({
        taskFamily: scenario.task_family,
        condition: scenario.condition,
        finalText: run.metrics.final_text,
        fileChangeCount: run.metrics.file_change_event_count,
        readOnly: true,
      });
      assert.deepEqual(scenario.correctness[index], expectedCorrectness);
      assert.deepEqual(run.correctness, expectedCorrectness);
      if (expectedCorrectness.status === "passed") {
        passedRunCount += 1;
        assert(expectedCorrectness.checks.length > 0);
      }
    }

    assert.deepEqual(scenario.models, [...runModels]);
    assert.equal(scenario.passed_run_count, passedRunCount);
    assert.deepEqual(scenario.median_all_runs, medianMetrics(scenario.runs));
    assert.deepEqual(scenario.median, passedRunCount > 0 ? medianMetrics(passedRuns(scenario.runs)) : null);
    if (passedRunCount === 0) assert.equal(scenario.median, null);
    if (scenario.correctness.every((item) => item.status === "passed")) passedCorrectnessCount += 1;
    if (scenario.correctness.some((item) => item.status === "needs_review")) needsReviewCount += 1;
    if (scenario.correctness.some((item) => item.status === "failed")) failedCorrectnessCount += 1;
  }

  assert.equal(report.summary.scenario_count, report.scenarios.length);
  assert.equal(report.summary.passed_correctness_count, passedCorrectnessCount);
  assert.equal(report.summary.needs_review_count, needsReviewCount);
  assert.equal(report.summary.failed_correctness_count, failedCorrectnessCount);
}

function validateCorrectness() {
  const passed = evaluateCorrectness({
    taskFamily: "decision_lookup",
    condition: "with_project_librarian",
    finalText: sampleFinalText,
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

function validateCliArgumentFailures() {
  for (const args of [
    ["benchmarks/codex-llm-metrics.js", "--dry-run", "--scales", ","],
    ["benchmarks/codex-llm-metrics.js", "--dry-run", "--tasks", ","],
    ["benchmarks/codex-llm-metrics.js"],
  ]) {
    const result = childProcess.spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.notEqual(result.status, 0);
  }
}

const reportPath = process.argv[2];
validateSampleJsonl();
validateReasoningTokenTotal();
validateInvocationCounts();
validateCorrectness();
validateCliArgumentFailures();
if (reportPath) validateReport(path.resolve(reportPath));
console.log("codex llm benchmark smoke ok");
