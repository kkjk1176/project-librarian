#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const { summarizeJsonl } = require("./lib/codex-jsonl");
const { evaluateCorrectness } = require("./lib/llm-correctness");
const { buildManifest, conditions, scales, taskFamilies } = require("./lib/llm-fixtures");
const { claimableRuns, completePairCount, evaluateClaimGate, measurementStatus, medianMetrics, metricStats, passedRuns, renderLlmMarkdownReport, selectPairedScenarios } = require("./lib/llm-report");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "dist", "init-project-wiki.js");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name, defaultValue = "") {
  const index = process.argv.indexOf(name);
  if (index < 0) return defaultValue;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`missing value for ${name}`);
  return value;
}

function optionalArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return "";
  if (value.includes("\n") || value.includes("\r")) fail(`invalid ${name} value`);
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

function optionalStringArgValue(name) {
  const value = argValue(name, "");
  if (!value) return "";
  if (value.includes("\n") || value.includes("\r")) fail(`invalid ${name} value`);
  return value;
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

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function defaultOutPath() {
  return path.join(root, "benchmarks", "reports", "llm", "dry-run-manifest.json");
}

function defaultMeasuredOutPath() {
  return path.join(root, "benchmarks", "reports", "llm", "current.json");
}

function defaultMeasuredMarkdownPath() {
  return path.join(root, "benchmarks", "reports", "llm", "current.md");
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

function sourceControlFingerprint() {
  try {
    const commit = commandOutput("git", ["rev-parse", "HEAD"]);
    const shortCommit = commandOutput("git", ["rev-parse", "--short", "HEAD"]);
    const branch = commandOutput("git", ["branch", "--show-current"]);
    const status = commandOutput("git", ["status", "--short"]);
    return {
      available: true,
      commit,
      short_commit: shortCommit,
      branch,
      dirty: status.length > 0,
      status_entry_count: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
    };
  }
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

function summarizeJsonlSafely(content, timing) {
  try {
    return summarizeJsonl(content, timing);
  } catch (error) {
    const metrics = summarizeJsonl("", timing);
    metrics.unavailable_event_fields.push("jsonl_parse");
    metrics.parse_error = error.message;
    return metrics;
  }
}

function runCodexScenario(scenario, { rawRoot, runIndex }) {
  const rawPath = path.join(rawRoot, `${safeName(scenario.prompt_id)}-run-${runIndex}.jsonl`);
  const stderrPath = path.join(rawRoot, `${safeName(scenario.prompt_id)}-run-${runIndex}.stderr.txt`);
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
  if (result.stderr) fs.writeFileSync(stderrPath, result.stderr);

  const metrics = summarizeJsonlSafely(result.stdout || "", { wall_ms: Math.round(wallMs * 1000) / 1000 });
  const correctness = evaluateCorrectness({
    taskFamily: scenario.task_family,
    condition: scenario.condition,
    finalText: metrics.final_text,
    fileChangeCount: metrics.file_change_event_count,
    readOnly: true,
  });

  const run = {
    run_index: runIndex,
    raw_jsonl_path: rawPath,
    requested_model: scenario.requested_model,
    execution: {
      status: result.error || result.status !== 0 ? "failed" : "completed",
      exit_code: result.status,
      error: result.error ? result.error.message : "",
      stderr_path: result.stderr ? stderrPath : null,
    },
    metrics,
    correctness,
  };
  run.measurement = measurementStatus(run);
  return run;
}

function measuredReport({ manifest, authMode, runs, warmupRuns, maxScenarios, fullMatrix, minRunsForClaim, requireClaimable, requireClean, selectedScales, selectedTasks }) {
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
    const actualClaimableRuns = claimableRuns(measuredRuns);
    const observedModels = [...new Set(measuredRuns.flatMap((run) => run.metrics.models || []).filter(Boolean))];
    const scenarioModels = observedModels.length > 0 ? observedModels : (scenario.requested_model ? [scenario.requested_model] : []);
    const scenarioModel = scenarioModels.length === 1 ? scenarioModels[0] : null;
    scenarios.push({
      scale: scenario.scale,
      condition: scenario.condition,
      task_family: scenario.task_family,
      prompt_id: scenario.prompt_id,
      prompt: scenario.prompt,
      command: scenario.command,
      cwd: scenario.cwd,
      fixture_fingerprint: scenario.fixture_fingerprint,
      requested_model: scenario.requested_model,
      model: scenarioModel,
      model_source: observedModels.length === 1 ? "jsonl" : (scenario.requested_model ? "requested" : null),
      models: scenarioModels,
      runs: measuredRuns,
      median: actualClaimableRuns.length > 0 ? medianMetrics(actualClaimableRuns) : null,
      median_all_runs: medianMetrics(measuredRuns),
      dispersion: actualClaimableRuns.length > 0 ? metricStats(actualClaimableRuns) : null,
      dispersion_all_runs: metricStats(measuredRuns),
      passed_run_count: correctnessPassedRuns.length,
      claimable_run_count: actualClaimableRuns.length,
      correctness: measuredRuns.map((run) => run.correctness),
      raw_jsonl_paths: measuredRuns.map((run) => run.raw_jsonl_path),
    });
  }

  const report = {
    schema_version: 1,
    benchmark_kind: "codex-actual-llm",
    auth_mode: authMode,
    auth: authAudit(),
    generated_at: new Date().toISOString(),
    environment: environmentFingerprint(),
    source_control: sourceControlFingerprint(),
    codex: {
      version: commandOutput("codex", ["--version"]),
    },
    configuration: {
      runs,
      warmup_runs: warmupRuns,
      max_scenarios: maxScenarios,
      full_matrix: fullMatrix,
      min_runs_for_claim: minRunsForClaim,
      require_claimable: requireClaimable,
      require_clean: requireClean,
      scenario_order: "deterministic-alternating-pairs",
      requested_model: manifest.requested_model,
      selected_scales: selectedScales,
      selected_tasks: selectedTasks,
      selected_scenarios: selectedScenarios.length,
      total_manifest_scenarios: manifest.scenarios.length,
      full_manifest_fingerprint: manifest.manifest_fingerprint,
      manifest_fingerprint: sha256(JSON.stringify(selectedScenarios.map((scenario) => ({
        scale: scenario.scale,
        condition: scenario.condition,
        task_family: scenario.task_family,
        prompt: scenario.prompt,
        fixture_fingerprint: scenario.fixture_fingerprint,
        requested_model: scenario.requested_model,
      })))),
      scenario_matrix_fingerprint: sha256(JSON.stringify(selectedScenarios.map((scenario) => ({
        scale: scenario.scale,
        condition: scenario.condition,
        task_family: scenario.task_family,
        fixture_fingerprint: scenario.fixture_fingerprint,
        requested_model: scenario.requested_model,
      })))),
    },
    summary: {
      scenario_count: scenarios.length,
      comparison_pair_count: completePairCount(scenarios, conditions),
      passed_correctness_count: scenarios.filter((scenario) => scenario.correctness.every((item) => item.status === "passed")).length,
      needs_review_count: scenarios.filter((scenario) => scenario.correctness.some((item) => item.status === "needs_review")).length,
      failed_correctness_count: scenarios.filter((scenario) => scenario.correctness.some((item) => item.status === "failed")).length,
      claimable_scenario_count: scenarios.filter((scenario) => scenario.claimable_run_count > 0).length,
      unclaimable_scenario_count: scenarios.filter((scenario) => scenario.claimable_run_count === 0).length,
    },
    scenarios,
  };
  report.claim_gate = evaluateClaimGate(report, {
    conditions,
    expectedScales: selectedScales,
    expectedTasks: selectedTasks,
    fullMatrix,
    minRunsForClaim,
  });
  return report;
}

function main() {
  const dryRun = hasFlag("--dry-run");
  const allowCodexRun = hasFlag("--allow-codex-run");
  const fullMatrix = hasFlag("--full-matrix");
  const requireClaimable = hasFlag("--require-claimable");
  const requireClean = hasFlag("--require-clean");
  const authMode = argValue("--auth-mode", "chatgpt_codex");
  if (!["chatgpt_codex", "api-key"].includes(authMode)) fail(`invalid --auth-mode value: ${authMode}`);
  const out = path.resolve(root, argValue("--out", dryRun ? defaultOutPath() : defaultMeasuredOutPath()));
  const markdownArg = optionalArgValue("--markdown");
  const markdown = markdownArg === null ? "" : (markdownArg || defaultMeasuredMarkdownPath());
  const selectedScales = listArg("--scales", Object.keys(scales), Object.keys(scales));
  const selectedTasks = listArg("--tasks", Object.keys(taskFamilies), Object.keys(taskFamilies));
  const runs = positiveIntegerArgValue("--runs", 1);
  const warmupRuns = nonNegativeIntegerArgValue("--warmup-runs", 1);
  const minRunsForClaim = positiveIntegerArgValue("--min-runs-for-claim", 1);
  const fullMatrixScenarioCount = selectedScales.length * selectedTasks.length * conditions.length;
  const maxScenarios = positiveIntegerArgValue("--max-scenarios", fullMatrix ? fullMatrixScenarioCount : conditions.length);
  const requestedModel = optionalStringArgValue("--model");
  const fixtureRoot = path.resolve(os.tmpdir(), `project-librarian-codex-llm-${Date.now()}`);

  if (fullMatrix && hasArg("--max-scenarios") && maxScenarios !== fullMatrixScenarioCount) {
    fail(`--full-matrix requires --max-scenarios ${fullMatrixScenarioCount} for selected scales/tasks`);
  }

  if (!dryRun && !allowCodexRun) {
    fail("measured Codex benchmark requires --allow-codex-run; use --dry-run to create a fixture manifest without consuming subscription quota");
  }
  if (!dryRun && requireClean) {
    const sourceControl = sourceControlFingerprint();
    if (!sourceControl.available || sourceControl.dirty) {
      fail("measured Codex benchmark requires a clean git checkout when --require-clean is set");
    }
  }

  const manifest = buildManifest({ fixtureRoot, cliPath: cli, selectedScales, selectedTasks, requestedModel });
  if (!dryRun) {
    const report = measuredReport({ manifest, authMode, runs, warmupRuns, maxScenarios, fullMatrix, minRunsForClaim, requireClaimable, requireClean, selectedScales, selectedTasks });
    writeJson(out, report);
    const markdownOut = markdown ? path.resolve(root, markdown) : "";
    if (markdownOut) writeText(markdownOut, renderLlmMarkdownReport(report));
    if (requireClaimable && report.claim_gate.status !== "passed") {
      console.error(`claim gate failed: ${report.claim_gate.issues.join("; ")}`);
      process.exit(1);
    }
    console.log(JSON.stringify({
      status: "ok",
      mode: "measured",
      out,
      markdown: markdownOut || null,
      fixture_root: fixtureRoot,
      scenario_count: report.scenarios.length,
      claim_gate: report.claim_gate.status,
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
