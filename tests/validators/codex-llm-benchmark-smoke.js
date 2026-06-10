#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { summarizeJsonl } = require("../../benchmarks/lib/codex-jsonl");
const { evaluateCorrectness } = require("../../benchmarks/lib/llm-correctness");
const { conditions } = require("../../benchmarks/lib/llm-fixtures");
const { claimableRuns, completePairCount, evaluateClaimGate, measurementStatus, medianMetrics, metricStats, renderLlmMarkdownReport, selectPairedScenarios } = require("../../benchmarks/lib/llm-report");

const root = path.resolve(__dirname, "..", "..");
const sampleFinalText = "2026-06-10 metrics decision in wiki/decisions/log.md documents Project Librarian benchmark evidence.";
const controlSampleFinalText = "2026-06-10 metrics decision in docs/decisions.md documents benchmark evidence from README.md control docs.";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fingerprintDirectory(directory) {
  const entries = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if ([".git", "node_modules"].includes(entry.name)) continue;
        visit(absolute);
      } else if (entry.isFile()) {
        entries.push(`${relative}\0${sha256(fs.readFileSync(absolute))}`);
      }
    }
  }
  visit(directory);
  return {
    algorithm: "sha256-relative-path-content",
    value: sha256(entries.join("\n")),
    file_count: entries.length,
  };
}

function validateSampleJsonl() {
  const samplePath = path.join(root, "benchmarks", "llm", "samples", "codex-turn-completed.jsonl");
  const metrics = summarizeJsonl(fs.readFileSync(samplePath, "utf8"), { wall_ms: 2000 });
  assert.equal(metrics.input_tokens, 24763);
  assert.equal(metrics.cached_input_tokens, 24448);
  assert.equal(metrics.output_tokens, 122);
  assert.equal(metrics.reasoning_output_tokens, 0);
  assert.equal(metrics.total_tokens, 24885);
  assert.equal(metrics.first_response_ms, 0);
  assert.equal(metrics.codex_turn_count, 1);
  assert.equal(metrics.command_event_count, 2);
  assert.equal(metrics.command_invocation_count, 1);
  assert.equal(metrics.tool_event_count, 2);
  assert.equal(metrics.tool_invocation_count, 1);
  assert.equal(metrics.plan_event_count, 0);
  assert.equal(metrics.model, "gpt-5.5");
  assert.deepEqual(metrics.models, ["gpt-5.5"]);
  assert.equal(metrics.final_text, sampleFinalText);
  assert.equal(metrics.error_event_count, 0);
  assert(metrics.unavailable_event_fields.includes("first_response_latency"));
}

function validateControlSampleJsonl() {
  const samplePath = path.join(root, "benchmarks", "llm", "samples", "codex-turn-completed-control.jsonl");
  const metrics = summarizeJsonl(fs.readFileSync(samplePath, "utf8"), { wall_ms: 2000 });
  assert.equal(metrics.input_tokens, 24763);
  assert.equal(metrics.output_tokens, 122);
  assert.equal(metrics.total_tokens, 24885);
  assert.equal(metrics.first_response_ms, 0);
  assert.equal(metrics.model, "gpt-5.5");
  assert.deepEqual(metrics.models, ["gpt-5.5"]);
  assert.equal(metrics.final_text, controlSampleFinalText);
  assert(metrics.unavailable_event_fields.includes("first_response_latency"));
  const correctness = evaluateCorrectness({
    taskFamily: "decision_lookup",
    condition: "without_project_librarian",
    finalText: metrics.final_text,
    fileChangeCount: metrics.file_change_event_count,
  });
  assert.equal(correctness.status, "passed");
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

function validatePairSelectionOrder() {
  const scenarios = [];
  for (const task of ["a", "b", "c"]) {
    for (const condition of conditions) {
      scenarios.push({ scale: "small", task_family: task, condition, prompt_id: `${task}-${condition}` });
    }
  }
  assert.deepEqual(selectPairedScenarios(scenarios, 6, conditions).map((scenario) => scenario.prompt_id), [
    "a-with_project_librarian",
    "a-without_project_librarian",
    "b-without_project_librarian",
    "b-with_project_librarian",
    "c-with_project_librarian",
    "c-without_project_librarian",
  ]);
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
  assert(report.source_control && typeof report.source_control.available === "boolean");
  assert(report.configuration && Number.isInteger(report.configuration.runs));
  assert(typeof report.configuration.manifest_fingerprint === "string" && report.configuration.manifest_fingerprint.length === 64);
  if (Object.hasOwn(report.configuration, "full_manifest_fingerprint")) {
    assert(typeof report.configuration.full_manifest_fingerprint === "string" && report.configuration.full_manifest_fingerprint.length === 64);
  }
  assert(typeof report.configuration.scenario_matrix_fingerprint === "string" && report.configuration.scenario_matrix_fingerprint.length === 64);
  assert(Array.isArray(report.configuration.selected_scales));
  assert(Array.isArray(report.configuration.selected_tasks));
  assert.equal(report.configuration.scenario_order, "deterministic-alternating-pairs");
  assert(Array.isArray(report.scenarios));
  assert(report.scenarios.length > 0);
  assert.equal(report.configuration.selected_scenarios, report.scenarios.length);
  assert(report.configuration.total_manifest_scenarios >= report.configuration.selected_scenarios);
  assert(report.configuration.max_scenarios >= conditions.length);

  let passedCorrectnessCount = 0;
  let needsReviewCount = 0;
  let failedCorrectnessCount = 0;
  let claimableScenarioCount = 0;
  let unclaimableScenarioCount = 0;

  for (const scenario of report.scenarios) {
    assert(Array.isArray(scenario.runs));
    assert(scenario.runs.length > 0);
    assert(typeof scenario.prompt === "string" && scenario.prompt.length > 0);
    assert(Array.isArray(scenario.command) && scenario.command.length > 0);
    assert(Object.hasOwn(scenario, "median"));
    assert(scenario.median_all_runs);
    assert(Array.isArray(scenario.correctness));
    assert.equal(scenario.correctness.length, scenario.runs.length);
    assert.deepEqual(scenario.raw_jsonl_paths, scenario.runs.map((run) => run.raw_jsonl_path));
    assert(Number.isInteger(scenario.passed_run_count));
    assert(Number.isInteger(scenario.claimable_run_count));
    assert(Array.isArray(scenario.models));
    assert(scenario.fixture_fingerprint && scenario.fixture_fingerprint.algorithm === "sha256-relative-path-content" && scenario.fixture_fingerprint.value);
    if (scenario.cwd && fs.existsSync(scenario.cwd)) {
      assert.deepEqual(scenario.fixture_fingerprint, fingerprintDirectory(scenario.cwd));
    }
    assert(Object.hasOwn(scenario, "requested_model"));
    assert(Object.hasOwn(scenario, "model_source"));
    assert(scenario.dispersion_all_runs);

    let passedRunCount = 0;
    const runModels = new Set();
    for (const [index, run] of scenario.runs.entries()) {
      assert(run.metrics);
      assert(run.execution && ["completed", "failed"].includes(run.execution.status));
      assert.equal(run.requested_model, scenario.requested_model);
      const rawPath = path.resolve(root, run.raw_jsonl_path);
      assert(fs.existsSync(rawPath), `missing raw JSONL: ${run.raw_jsonl_path}`);
      const rawMetrics = summarizeJsonl(fs.readFileSync(rawPath, "utf8"), { wall_ms: run.metrics.wall_ms });
      assert.deepEqual(run.metrics, rawMetrics);
      assert(Number.isInteger(run.metrics.command_invocation_count));
      assert(Number.isInteger(run.metrics.tool_invocation_count));
      assert(Number.isInteger(run.metrics.plan_event_count));
      assert(typeof run.metrics.first_response_ms === "number");
      assert(Array.isArray(run.metrics.models));
      if (run.metrics.first_response_ms === 0) assert(run.metrics.unavailable_event_fields.includes("first_response_latency"));
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
      assert.deepEqual(run.measurement, measurementStatus(run));
      if (expectedCorrectness.status === "passed") {
        passedRunCount += 1;
        assert(expectedCorrectness.checks.length > 0);
      }
    }

    const actualClaimableRuns = claimableRuns(scenario.runs);
    const observedModels = [...runModels];
    const expectedScenarioModels = observedModels.length > 0 ? observedModels : (scenario.requested_model ? [scenario.requested_model] : []);
    assert.deepEqual(scenario.models, expectedScenarioModels);
    if (scenario.models.length === 1) assert.equal(scenario.model, scenario.models[0]);
    if (scenario.models.length !== 1) assert.equal(scenario.model, null);
    assert.equal(scenario.model_source, observedModels.length === 1 ? "jsonl" : (scenario.requested_model ? "requested" : null));
    assert.equal(scenario.passed_run_count, passedRunCount);
    assert.equal(scenario.claimable_run_count, actualClaimableRuns.length);
    assert.deepEqual(scenario.median_all_runs, medianMetrics(scenario.runs));
    assert.deepEqual(scenario.median, actualClaimableRuns.length > 0 ? medianMetrics(actualClaimableRuns) : null);
    assert.deepEqual(scenario.dispersion_all_runs, metricStats(scenario.runs));
    assert.deepEqual(scenario.dispersion, actualClaimableRuns.length > 0 ? metricStats(actualClaimableRuns) : null);
    if (actualClaimableRuns.length === 0) assert.equal(scenario.median, null);
    if (scenario.correctness.every((item) => item.status === "passed")) passedCorrectnessCount += 1;
    if (scenario.correctness.some((item) => item.status === "needs_review")) needsReviewCount += 1;
    if (scenario.correctness.some((item) => item.status === "failed")) failedCorrectnessCount += 1;
    if (actualClaimableRuns.length > 0) claimableScenarioCount += 1;
    if (actualClaimableRuns.length === 0) unclaimableScenarioCount += 1;
  }

  assert.equal(report.summary.scenario_count, report.scenarios.length);
  assert.equal(report.summary.comparison_pair_count, completePairCount(report.scenarios, conditions));
  assert.equal(report.summary.comparison_pair_count * conditions.length, report.scenarios.length);
  assert.equal(report.summary.passed_correctness_count, passedCorrectnessCount);
  assert.equal(report.summary.needs_review_count, needsReviewCount);
  assert.equal(report.summary.failed_correctness_count, failedCorrectnessCount);
  assert.equal(report.summary.claimable_scenario_count, claimableScenarioCount);
  assert.equal(report.summary.unclaimable_scenario_count, unclaimableScenarioCount);
  assert.equal(report.configuration.scenario_matrix_fingerprint, sha256(JSON.stringify(report.scenarios.map((scenario) => ({
    scale: scenario.scale,
    condition: scenario.condition,
    task_family: scenario.task_family,
    fixture_fingerprint: scenario.fixture_fingerprint,
    requested_model: scenario.requested_model,
  })))));
  assert.equal(report.configuration.manifest_fingerprint, sha256(JSON.stringify(report.scenarios.map((scenario) => ({
    scale: scenario.scale,
    condition: scenario.condition,
    task_family: scenario.task_family,
    prompt: scenario.prompt,
    fixture_fingerprint: scenario.fixture_fingerprint,
    requested_model: scenario.requested_model,
  })))));
  assert.deepEqual(report.claim_gate, evaluateClaimGate(report, {
    conditions,
    expectedScales: report.configuration.selected_scales,
    expectedTasks: report.configuration.selected_tasks,
    fullMatrix: report.configuration.full_matrix,
    minRunsForClaim: report.configuration.min_runs_for_claim,
  }));

  const markdown = renderLlmMarkdownReport(report);
  assert(markdown.includes("# Codex Actual LLM Benchmark Report"));
  assert(markdown.includes("Claim gate: passed"));
  assert(markdown.includes("## Scenario Metrics"));
  assert(markdown.includes("## With vs Without Delta"));
  assert(markdown.includes("| small | decision_lookup | with_project_librarian | claimable |"));
  assert(markdown.includes("| small | decision_lookup | 0% | 0% | 0% |"));
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

function validateMeasurementClaimability() {
  const correctness = {
    status: "passed",
    reason: "",
    checks: [{ name: "synthetic correctness", passed: true }],
  };
  const unclaimable = measurementStatus({
    correctness,
    metrics: summarizeJsonl(JSON.stringify({
      type: "assistant.message",
      message: sampleFinalText,
    }), { wall_ms: 1000 }),
  });
  assert.equal(unclaimable.status, "unclaimable");
  assert(unclaimable.reason.includes("usage available"));
  assert(unclaimable.reason.includes("model available"));

  const claimable = measurementStatus({
    correctness,
    metrics: summarizeJsonl(JSON.stringify({
      type: "turn.completed",
      model: "gpt-5.5",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
      message: sampleFinalText,
    }), { wall_ms: 1000 }),
  });
  assert.equal(claimable.status, "claimable");

  const claimableWithRequestedModel = measurementStatus({
    correctness,
    requested_model: "gpt-test",
    metrics: summarizeJsonl(JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
      message: sampleFinalText,
    }), { wall_ms: 1000 }),
  });
  assert.equal(claimableWithRequestedModel.status, "claimable");
}

function validateCliArgumentFailures() {
  for (const args of [
    ["benchmarks/codex-llm-metrics.js", "--dry-run", "--scales", ","],
    ["benchmarks/codex-llm-metrics.js", "--dry-run", "--tasks", ","],
    ["benchmarks/codex-llm-metrics.js", "--dry-run", "--scales", "small,medium,large", "--tasks", "decision_lookup", "--full-matrix", "--max-scenarios", "2"],
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
validateControlSampleJsonl();
validateReasoningTokenTotal();
validateInvocationCounts();
validatePairSelectionOrder();
validateCorrectness();
validateMeasurementClaimability();
validateCliArgumentFailures();
if (reportPath) validateReport(path.resolve(reportPath));
console.log("codex llm benchmark smoke ok");
