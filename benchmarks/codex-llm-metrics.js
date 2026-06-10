#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { summarizeJsonl } = require("./lib/codex-jsonl");
const { evaluateCorrectness } = require("./lib/llm-correctness");
const { buildManifest, conditions, scales, taskFamilies } = require("./lib/llm-fixtures");
const { medianMetrics, passedRuns, selectPairedScenarios } = require("./lib/llm-report");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "dist", "init-project-wiki.js");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name, defaultValue = "") {
  const index = process.argv.indexOf(name);
  if (index < 0) return defaultValue;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`missing value for ${name}`);
  return value;
}

function listArg(name, allowed, defaultValues) {
  const raw = argValue(name, "");
  if (!raw) return defaultValues;
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) fail(`empty ${name} value`);
  for (const value of values) {
    if (!allowed.includes(value)) fail(`invalid ${name} value: ${value}`);
  }
  return values;
}

function positiveIntegerArgValue(name, defaultValue) {
  const value = argValue(name, "");
  if (!value) return defaultValue;
  if (!/^\d+$/.test(value)) fail(`invalid integer for ${name}: ${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail(`invalid integer for ${name}: ${value}`);
  return parsed;
}

function nonNegativeIntegerArgValue(name, defaultValue) {
  const value = argValue(name, "");
  if (!value) return defaultValue;
  if (!/^\d+$/.test(value)) fail(`invalid integer for ${name}: ${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`invalid integer for ${name}: ${value}`);
  return parsed;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function defaultOutPath() {
  return path.join(root, "benchmarks", "reports", "llm", "dry-run-manifest.json");
}

function defaultMeasuredOutPath() {
  return path.join(root, "benchmarks", "reports", "llm", "current.json");
}

function environmentFingerprint() {
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    os_release: os.release(),
    cpu_model: cpus[0]?.model || "unknown",
    cpu_count: cpus.length,
    total_memory_mb: Math.round(os.totalmem() / 1024 / 1024),
  };
}

function commandOutput(command, args) {
  return childProcess.execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function requireMeasuredAuth(authMode) {
  if (authMode !== "api-key" && (process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY)) {
    fail("refusing subscription benchmark while CODEX_API_KEY or OPENAI_API_KEY is set; pass --auth-mode api-key for API-key runs");
  }
  try {
    commandOutput("codex", ["--version"]);
  } catch (error) {
    fail(`codex command is unavailable or failed: ${error.message}`);
  }
}

function authAudit() {
  return {
    auth_mode_source: "declared",
    code_api_key_present: Boolean(process.env.CODEX_API_KEY),
    openai_api_key_present: Boolean(process.env.OPENAI_API_KEY),
    codex_home_set: Boolean(process.env.CODEX_HOME),
  };
}

function safeName(value) {
  return value.replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "");
}

function runCodexScenario(scenario, { rawRoot, runIndex }) {
  const rawPath = path.join(rawRoot, `${safeName(scenario.prompt_id)}-run-${runIndex}.jsonl`);
  fs.mkdirSync(path.dirname(rawPath), { recursive: true });

  const command = scenario.command[0];
  const args = scenario.command.slice(1);
  const started = process.hrtime.bigint();
  const result = childProcess.spawnSync(command, args, {
    cwd: scenario.cwd,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const wallMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  fs.writeFileSync(rawPath, result.stdout || "");

  if (result.error) fail(`codex execution failed for ${scenario.prompt_id}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`codex execution failed for ${scenario.prompt_id} with exit ${result.status}: ${result.stderr || result.stdout}`);
  }

  const metrics = summarizeJsonl(result.stdout || "", { wall_ms: Math.round(wallMs * 1000) / 1000 });
  const correctness = evaluateCorrectness({
    taskFamily: scenario.task_family,
    condition: scenario.condition,
    finalText: metrics.final_text,
    fileChangeCount: metrics.file_change_event_count,
    readOnly: true,
  });

  return {
    run_index: runIndex,
    raw_jsonl_path: rawPath,
    metrics,
    correctness,
  };
}

function measuredReport({ manifest, authMode, runs, warmupRuns, maxScenarios }) {
  requireMeasuredAuth(authMode);
  const rawRoot = path.join(root, "benchmarks", "reports", "llm", "raw", new Date().toISOString().replace(/[:.]/g, "-"));
  if (maxScenarios < conditions.length) {
    fail(`measured Codex benchmark requires at least ${conditions.length} scenarios to compare conditions`);
  }
  const selectedScenarios = selectPairedScenarios(manifest.scenarios, maxScenarios, conditions);
  if (selectedScenarios.length === 0) fail("no complete with/without scenario pair selected");
  const scenarios = [];

  for (const scenario of selectedScenarios) {
    for (let index = 0; index < warmupRuns; index += 1) {
      runCodexScenario(scenario, { rawRoot, runIndex: `warmup-${index + 1}` });
    }
    const measuredRuns = [];
    for (let index = 0; index < runs; index += 1) {
      measuredRuns.push(runCodexScenario(scenario, { rawRoot, runIndex: index + 1 }));
    }
    const correctnessPassedRuns = passedRuns(measuredRuns);
    const scenarioModels = [...new Set(measuredRuns.flatMap((run) => run.metrics.models || []).filter(Boolean))];
    scenarios.push({
      scale: scenario.scale,
      condition: scenario.condition,
      task_family: scenario.task_family,
      prompt_id: scenario.prompt_id,
      cwd: scenario.cwd,
      model: scenarioModels.length === 1 ? scenarioModels[0] : null,
      models: scenarioModels,
      runs: measuredRuns,
      median: correctnessPassedRuns.length > 0 ? medianMetrics(correctnessPassedRuns) : null,
      median_all_runs: medianMetrics(measuredRuns),
      passed_run_count: correctnessPassedRuns.length,
      correctness: measuredRuns.map((run) => run.correctness),
      raw_jsonl_paths: measuredRuns.map((run) => run.raw_jsonl_path),
    });
  }

  return {
    schema_version: 1,
    benchmark_kind: "codex-actual-llm",
    auth_mode: authMode,
    auth: authAudit(),
    generated_at: new Date().toISOString(),
    environment: environmentFingerprint(),
    codex: {
      version: commandOutput("codex", ["--version"]),
    },
    configuration: {
      runs,
      warmup_runs: warmupRuns,
      max_scenarios: maxScenarios,
      selected_scenarios: selectedScenarios.length,
      total_manifest_scenarios: manifest.scenarios.length,
    },
    summary: {
      scenario_count: scenarios.length,
      passed_correctness_count: scenarios.filter((scenario) => scenario.correctness.every((item) => item.status === "passed")).length,
      needs_review_count: scenarios.filter((scenario) => scenario.correctness.some((item) => item.status === "needs_review")).length,
      failed_correctness_count: scenarios.filter((scenario) => scenario.correctness.some((item) => item.status === "failed")).length,
    },
    scenarios,
  };
}

function main() {
  const dryRun = hasFlag("--dry-run");
  const allowCodexRun = hasFlag("--allow-codex-run");
  const authMode = argValue("--auth-mode", "chatgpt_codex");
  if (!["chatgpt_codex", "api-key"].includes(authMode)) fail(`invalid --auth-mode value: ${authMode}`);
  const out = path.resolve(root, argValue("--out", dryRun ? defaultOutPath() : defaultMeasuredOutPath()));
  const selectedScales = listArg("--scales", Object.keys(scales), Object.keys(scales));
  const selectedTasks = listArg("--tasks", Object.keys(taskFamilies), Object.keys(taskFamilies));
  const runs = positiveIntegerArgValue("--runs", 1);
  const warmupRuns = nonNegativeIntegerArgValue("--warmup-runs", 1);
  const maxScenarios = positiveIntegerArgValue("--max-scenarios", conditions.length);
  const fixtureRoot = path.resolve(os.tmpdir(), `project-librarian-codex-llm-${Date.now()}`);

  if (!dryRun && !allowCodexRun) {
    fail("measured Codex benchmark requires --allow-codex-run; use --dry-run to create a fixture manifest without consuming subscription quota");
  }

  const manifest = buildManifest({ fixtureRoot, cliPath: cli, selectedScales, selectedTasks });
  if (!dryRun) {
    const report = measuredReport({ manifest, authMode, runs, warmupRuns, maxScenarios });
    writeJson(out, report);
    console.log(JSON.stringify({
      status: "ok",
      mode: "measured",
      out,
      fixture_root: fixtureRoot,
      scenario_count: report.scenarios.length,
    }, null, 2));
    return;
  }

  writeJson(out, manifest);
  console.log(JSON.stringify({
    status: "ok",
    mode: "dry-run",
    out,
    fixture_root: fixtureRoot,
    scenario_count: manifest.scenarios.length,
  }, null, 2));
}

main();
