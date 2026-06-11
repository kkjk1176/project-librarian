#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const { summarizeJsonl } = require("./lib/codex-jsonl");
const { evaluateCorrectness } = require("./lib/llm-correctness");
const { buildManifest, conditions, controlProfiles, scales, taskFamilies, taskTracks } = require("./lib/llm-fixtures");
const { buildIsolatedCodexHome, buildSpawnEnv, checkPreRunFingerprint, resolveRealCodexHome, snapshotFixturePaths, validateFixtureAfterRun } = require("./lib/hermetic");
const { DEFAULT_CACHE_DISCOUNT, claimableRuns, completePairCount, evaluateTracksClaimGate, measurementStatus, medianMetrics, metricStats, passedRuns, renderLlmMarkdownReport, scenariosForTrack, selectPairedScenarios, tracksPresent } = require("./lib/llm-report");

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

// A4 cache discount: a non-negative finite multiplier applied to cached input
// tokens in the cost-weighted headline. Default 0.1 (cached resends must not count
// at full weight). Accepts 0 (count cached at zero) up to 1 (count cached at full
// weight, collapsing cost-weighted toward merged total). Rejects negatives,
// non-numeric, and > 1 values loudly rather than clamping.
function cacheDiscountArgValue(name, defaultValue) {
  const value = argValue(name, "");
  if (!value) return defaultValue;
  if (!/^\d+(\.\d+)?$/.test(value)) fail(`invalid number for ${name}: ${value}`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) fail(`invalid ${name}: ${value} (expected 0..1)`);
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

function runCodexScenario(scenario, { rawRoot, runIndex, spawnEnv }) {
  const rawPath = path.join(rawRoot, `${safeName(scenario.prompt_id)}-run-${runIndex}.jsonl`);
  const stderrPath = path.join(rawRoot, `${safeName(scenario.prompt_id)}-run-${runIndex}.stderr.txt`);
  fs.mkdirSync(path.dirname(rawPath), { recursive: true });

  const command = scenario.command[0];
  const args = scenario.command.slice(1);
  // Hermetic spawn (A5): the child env is the explicit allowlist built once for
  // the measured run (isolated CODEX_HOME, no inherited user plugins/config). The
  // env is always provided for measured runs; failing to pass it is a programming
  // error rather than a reason to inherit process.env.
  if (!spawnEnv || typeof spawnEnv !== "object") {
    fail("internal error: measured Codex scenario invoked without a hermetic spawn env");
  }
  // Pre-run fixture integrity check: verify fingerprint matches the manifest
  // before consuming quota. Catches stale or previously-mutated fixtures early.
  checkPreRunFingerprint({ cwd: scenario.cwd, expectedFingerprint: scenario.fixture_fingerprint });
  // Snapshot paths present BEFORE the spawn so post-run denylist scanning can
  // distinguish pre-existing bootstrap dot-dirs from paths written during the run.
  const preRunSnapshot = snapshotFixturePaths(scenario.cwd);
  const started = process.hrtime.bigint();
  const result = childProcess.spawnSync(command, args, {
    cwd: scenario.cwd,
    env: spawnEnv,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const wallMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  fs.writeFileSync(rawPath, result.stdout || "");
  if (result.stderr) fs.writeFileSync(stderrPath, result.stderr);

  // Post-run fixture validation (A5): re-fingerprint the fixture and run the
  // runtime-state denylist scan (only for NEW paths, not pre-existing bootstrap
  // dot-dirs). Any drift or any newly-appeared runtime-state path is a hard
  // failure (throws); isolation failures must fail the run.
  const fixtureValidation = validateFixtureAfterRun({
    cwd: scenario.cwd,
    expectedFingerprint: scenario.fixture_fingerprint,
    preRunSnapshot,
  });

  const metrics = summarizeJsonlSafely(result.stdout || "", { wall_ms: Math.round(wallMs * 1000) / 1000 });
  const correctness = evaluateCorrectness({
    taskFamily: scenario.task_family,
    condition: scenario.condition,
    finalText: metrics.final_text,
    fileChangeCount: metrics.file_change_event_count,
    readOnly: true,
    expectation: scenario.expectation || null,
    controlProfile: scenario.control_profile || "organic",
    benchmarkTrack: scenario.benchmark_track,
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
    fixture_validation: fixtureValidation,
  };
  run.measurement = measurementStatus(run);
  return run;
}

// A3 multi_session: run the two sequential codex execs in the SAME fixture cwd,
// each with its OWN isolated CODEX_HOME (Phase 2 machinery, supplied per session),
// then re-fingerprint the fixture ONCE after BOTH sessions. The measured session
// (role "measured", session 2) supplies the run's primary metrics, correctness,
// and final text; the familiarization session only needs to complete. Per-session
// metrics and raw JSONL paths are recorded in session_metrics so the session-2
// metrics are reported separately from session 1. Both sessions are ephemeral with
// no shared codex state, so the only amortization surface is the repo itself.
function runMultiSessionScenario(scenario, { rawRoot, runIndex, sessionSpawnEnvs }) {
  if (!Array.isArray(scenario.sessions) || scenario.sessions.length === 0) {
    fail(`internal error: multi_session scenario ${scenario.prompt_id} has no sessions`);
  }
  if (!Array.isArray(sessionSpawnEnvs) || sessionSpawnEnvs.length !== scenario.sessions.length) {
    fail(`internal error: multi_session scenario ${scenario.prompt_id} requires one isolated spawn env per session`);
  }

  // Pre-run fixture integrity check before first session (fails before consuming
  // any quota if the fixture is stale or mutated).
  checkPreRunFingerprint({ cwd: scenario.cwd, expectedFingerprint: scenario.fixture_fingerprint });
  // Snapshot paths present BEFORE session 1 so the post-run denylist scan can
  // distinguish pre-existing bootstrap dot-dirs from paths written during either
  // session (both sessions share the same fixture cwd).
  const preRunSnapshot = snapshotFixturePaths(scenario.cwd);

  const sessionMetrics = [];
  let measuredSession = null;
  for (const [index, session] of scenario.sessions.entries()) {
    const sessionTag = `${runIndex}-s${session.session_index}`;
    const rawPath = path.join(rawRoot, `${safeName(scenario.prompt_id)}-run-${sessionTag}.jsonl`);
    const stderrPath = path.join(rawRoot, `${safeName(scenario.prompt_id)}-run-${sessionTag}.stderr.txt`);
    fs.mkdirSync(path.dirname(rawPath), { recursive: true });
    const spawnEnv = sessionSpawnEnvs[index];
    if (!spawnEnv || typeof spawnEnv !== "object") {
      fail("internal error: multi_session session invoked without a hermetic spawn env");
    }
    const command = session.command[0];
    const args = session.command.slice(1);
    const started = process.hrtime.bigint();
    const result = childProcess.spawnSync(command, args, {
      cwd: scenario.cwd,
      env: spawnEnv,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const wallMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    fs.writeFileSync(rawPath, result.stdout || "");
    if (result.stderr) fs.writeFileSync(stderrPath, result.stderr);
    const metrics = summarizeJsonlSafely(result.stdout || "", { wall_ms: Math.round(wallMs * 1000) / 1000 });
    const sessionRecord = {
      session_index: session.session_index,
      role: session.role,
      raw_jsonl_path: rawPath,
      execution: {
        status: result.error || result.status !== 0 ? "failed" : "completed",
        exit_code: result.status,
        error: result.error ? result.error.message : "",
        stderr_path: result.stderr ? stderrPath : null,
      },
      metrics,
    };
    sessionMetrics.push(sessionRecord);
    if (session.role === "measured") measuredSession = sessionRecord;
  }
  if (!measuredSession) {
    fail(`internal error: multi_session scenario ${scenario.prompt_id} has no measured session`);
  }

  // Post-run fixture validation (A5) runs ONCE after BOTH sessions complete.
  // Pass the pre-run snapshot so only newly-appeared denylist paths (not
  // pre-existing bootstrap dot-dirs) are treated as isolation failures.
  const fixtureValidation = validateFixtureAfterRun({
    cwd: scenario.cwd,
    expectedFingerprint: scenario.fixture_fingerprint,
    preRunSnapshot,
  });

  // The run's primary metrics/correctness/final text come from the measured
  // session (session 2). Correctness evaluates session 2's final text only;
  // session 1 only needs to complete.
  const metrics = measuredSession.metrics;
  const correctness = evaluateCorrectness({
    taskFamily: scenario.task_family,
    condition: scenario.condition,
    finalText: metrics.final_text,
    fileChangeCount: metrics.file_change_event_count,
    readOnly: true,
    expectation: scenario.expectation || null,
    controlProfile: scenario.control_profile || "organic",
    benchmarkTrack: scenario.benchmark_track,
  });

  const run = {
    run_index: runIndex,
    // raw_jsonl_path mirrors the measured session so existing report code that
    // reads run.raw_jsonl_path resolves session 2; all sessions' raw paths are in
    // session_metrics and surfaced on the scenario.
    raw_jsonl_path: measuredSession.raw_jsonl_path,
    requested_model: scenario.requested_model,
    execution: measuredSession.execution,
    metrics,
    correctness,
    fixture_validation: fixtureValidation,
    session_metrics: sessionMetrics,
    measured_session_index: measuredSession.session_index,
  };
  run.measurement = measurementStatus(run);
  return run;
}

function summarizeScenarios(scenarioList) {
  return {
    scenario_count: scenarioList.length,
    comparison_pair_count: completePairCount(scenarioList, conditions),
    passed_correctness_count: scenarioList.filter((scenario) => scenario.correctness.every((item) => item.status === "passed")).length,
    needs_review_count: scenarioList.filter((scenario) => scenario.correctness.some((item) => item.status === "needs_review")).length,
    failed_correctness_count: scenarioList.filter((scenario) => scenario.correctness.some((item) => item.status === "failed")).length,
    claimable_scenario_count: scenarioList.filter((scenario) => scenario.claimable_run_count > 0).length,
    unclaimable_scenario_count: scenarioList.filter((scenario) => scenario.claimable_run_count === 0).length,
  };
}

// Expected task families per track within the selected matrix; used to gate each
// track against its own expected coverage.
function expectedTasksByTrack(selectedTasks) {
  const byTrack = {};
  for (const taskFamily of selectedTasks) {
    const track = taskTracks[taskFamily];
    if (!byTrack[track]) byTrack[track] = [];
    byTrack[track].push(taskFamily);
  }
  return byTrack;
}

function measuredReport({ manifest, authMode, runs, warmupRuns, maxScenarios, fullMatrix, minRunsForClaim, requireClaimable, requireClean, selectedScales, selectedTasks, cacheDiscount }) {
  requireMeasuredAuth(authMode);
  const rawRoot = path.join(root, "benchmarks", "reports", "llm", "raw", new Date().toISOString().replace(/[:.]/g, "-"));
  if (maxScenarios < conditions.length) {
    fail(`measured Codex benchmark requires at least ${conditions.length} scenarios to compare conditions`);
  }
  const selectedScenarios = selectPairedScenarios(manifest.scenarios, maxScenarios, conditions);
  if (selectedScenarios.length === 0) fail("no complete with/without scenario pair selected");

  // Hermetic measurement (A5), always on for measured runs (not flag-gated): copy
  // only the auth material from the real Codex home into a fresh isolated
  // CODEX_HOME, and build the child env from an explicit allowlist (no inherited
  // user plugins/config). Both fail loudly (throw) if auth is absent or PATH is
  // missing, rather than falling back to the unisolated user home.
  const homeDir = os.homedir();
  const realCodexHome = resolveRealCodexHome(process.env, homeDir);
  const isolatedCodexHome = path.join(rawRoot, "codex-home");
  const isolation = buildIsolatedCodexHome({ realCodexHome, destHome: isolatedCodexHome });
  const spawnEnv = buildSpawnEnv({ sourceEnv: process.env, codexHome: isolatedCodexHome, authMode, homeDir });
  const hermetic = {
    isolated_codex_home: isolation.codex_home,
    real_codex_home: isolation.real_codex_home,
    auth_source: isolation.auth_source,
    copied_files: isolation.copied_files,
    allowlisted_env_keys: Object.keys(spawnEnv).sort(),
    allowlisted_env_key_count: Object.keys(spawnEnv).length,
    inherited_process_env: false,
  };

  // A3 multi_session interplay with A5: each session of a multi_session run gets
  // its OWN fresh isolated CODEX_HOME (no shared codex state between the two
  // sessions; the only amortization surface under test is the repo). Build one
  // isolated home per session per run under rawRoot, each with a unique path
  // (buildIsolatedCodexHome refuses to overwrite an existing home). The auth-only
  // copy and allowlist-only env are identical to the single-session path.
  function buildSessionSpawnEnvs(scenario, runIndex) {
    return scenario.sessions.map((session) => {
      const sessionHome = path.join(rawRoot, `codex-home-${safeName(scenario.prompt_id)}-run-${runIndex}-s${session.session_index}`);
      buildIsolatedCodexHome({ realCodexHome, destHome: sessionHome });
      return buildSpawnEnv({ sourceEnv: process.env, codexHome: sessionHome, authMode, homeDir });
    });
  }

  function runScenarioOnce(scenario, runIndex) {
    if (Array.isArray(scenario.sessions) && scenario.sessions.length > 0) {
      return runMultiSessionScenario(scenario, { rawRoot, runIndex, sessionSpawnEnvs: buildSessionSpawnEnvs(scenario, runIndex) });
    }
    return runCodexScenario(scenario, { rawRoot, runIndex, spawnEnv });
  }

  const scenarios = [];

  for (const scenario of selectedScenarios) {
    for (let index = 0; index < warmupRuns; index += 1) {
      runScenarioOnce(scenario, `warmup-${index + 1}`);
    }
    const measuredRuns = [];
    for (let index = 0; index < runs; index += 1) {
      measuredRuns.push(runScenarioOnce(scenario, index + 1));
    }
    const correctnessPassedRuns = passedRuns(measuredRuns);
    const actualClaimableRuns = claimableRuns(measuredRuns);
    const observedModels = [...new Set(measuredRuns.flatMap((run) => run.metrics.models || []).filter(Boolean))];
    const scenarioModels = observedModels.length > 0 ? observedModels : (scenario.requested_model ? [scenario.requested_model] : []);
    const scenarioModel = scenarioModels.length === 1 ? scenarioModels[0] : null;
    const isMultiSession = Array.isArray(scenario.sessions) && scenario.sessions.length > 0;
    const scenarioRecord = {
      scale: scenario.scale,
      condition: scenario.condition,
      benchmark_track: scenario.benchmark_track,
      control_profile: scenario.control_profile,
      task_family: scenario.task_family,
      prompt_id: scenario.prompt_id,
      prompt: scenario.prompt,
      command: scenario.command,
      cwd: scenario.cwd,
      expectation: scenario.expectation || null,
      fixture_fingerprint: scenario.fixture_fingerprint,
      requested_model: scenario.requested_model,
      model: scenarioModel,
      model_source: observedModels.length === 1 ? "jsonl" : (scenario.requested_model ? "requested" : null),
      models: scenarioModels,
      runs: measuredRuns,
      // Scenario medians/dispersion are sourced from each run's primary metrics. For
      // multi_session that primary is the MEASURED session (session 2), so the
      // scenario's headline metrics are session-2 metrics, reported separately from
      // session 1 (which lives only in each run's session_metrics array).
      median: actualClaimableRuns.length > 0 ? medianMetrics(actualClaimableRuns) : null,
      median_all_runs: medianMetrics(measuredRuns),
      dispersion: actualClaimableRuns.length > 0 ? metricStats(actualClaimableRuns) : null,
      dispersion_all_runs: metricStats(measuredRuns),
      passed_run_count: correctnessPassedRuns.length,
      claimable_run_count: actualClaimableRuns.length,
      correctness: measuredRuns.map((run) => run.correctness),
      raw_jsonl_paths: measuredRuns.map((run) => run.raw_jsonl_path),
    };
    if (isMultiSession) {
      // session_metrics surfaces per-session raw JSONL paths and metrics for every
      // measured run, plus session_count and the measured session index, so a
      // reader can audit session-1 (familiarization) separately from session-2
      // (measured) without conflating the two.
      scenarioRecord.session_count = scenario.session_count;
      scenarioRecord.sessions = scenario.sessions.map((session) => ({
        session_index: session.session_index,
        role: session.role,
        prompt: session.prompt,
        command: session.command,
      }));
      scenarioRecord.session_metrics = measuredRuns.map((run) => ({
        run_index: run.run_index,
        measured_session_index: run.measured_session_index,
        sessions: run.session_metrics,
      }));
    }
    scenarios.push(scenarioRecord);
  }

  const presentTracks = tracksPresent(scenarios);
  const expectedByTrack = expectedTasksByTrack(selectedTasks);

  const report = {
    // schema_version 6 (A4) adds the cost decomposition: per-run derived
    // uncached_input_tokens/tool_output_bytes/request_count_estimate (in metrics),
    // the report-level cache_discount, and a cost-weighted per-track headline
    // (merged total_tokens demoted to a secondary row in JSON medians and Markdown).
    // schema_version 5 (A3) adds multi_session run/scenario fields: per-run
    // session_metrics + measured_session_index on multi_session runs, and
    // session_count/sessions/session_metrics on multi_session scenarios (session-2
    // metrics are the scenario primary; session-1 lives only in session_metrics).
    // schema_version 4 added the A5 hermetic provenance block at the report top
    // level and a per-run fixture_validation record. schema_version 3 added
    // control_profile (A2) at the report top level, in configuration, and on
    // every scenario.
    schema_version: 6,
    benchmark_kind: "codex-actual-llm",
    auth_mode: authMode,
    auth: authAudit(),
    generated_at: new Date().toISOString(),
    environment: environmentFingerprint(),
    source_control: sourceControlFingerprint(),
    control_profile: manifest.control_profile,
    cache_discount: cacheDiscount,
    hermetic,
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
      control_profile: manifest.control_profile,
      cache_discount: cacheDiscount,
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
    benchmark_tracks: presentTracks,
    summary: summarizeScenarios(scenarios),
    scenarios,
  };

  // Per-track grouping: each track carries its own scenario subset summary plus
  // its own claim gate. The Markdown renderer reads report.tracks for separate
  // Wiki Track and Code Graph Track sections; no merged cross-track headline.
  const overallGate = evaluateTracksClaimGate(report, {
    conditions,
    expectedScales: selectedScales,
    expectedTasksByTrack: expectedByTrack,
    fullMatrix,
    minRunsForClaim,
  });
  report.tracks = {};
  for (const track of presentTracks) {
    const trackScenarios = scenariosForTrack(scenarios, track);
    report.tracks[track] = {
      benchmark_track: track,
      expected_tasks: expectedByTrack[track] || [],
      summary: summarizeScenarios(trackScenarios),
      prompt_ids: trackScenarios.map((scenario) => scenario.prompt_id),
      claim_gate: overallGate.per_track[track],
    };
  }
  report.claim_gate = overallGate;
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
  const controlProfile = argValue("--control-profile", "organic");
  if (!controlProfiles.includes(controlProfile)) fail(`invalid --control-profile value: ${controlProfile}`);
  const out = path.resolve(root, argValue("--out", dryRun ? defaultOutPath() : defaultMeasuredOutPath()));
  const markdownArg = optionalArgValue("--markdown");
  const markdown = markdownArg === null ? "" : (markdownArg || defaultMeasuredMarkdownPath());
  const selectedScales = listArg("--scales", Object.keys(scales), Object.keys(scales));
  const selectedTasks = listArg("--tasks", Object.keys(taskFamilies), Object.keys(taskFamilies));
  const runs = positiveIntegerArgValue("--runs", 1);
  const warmupRuns = nonNegativeIntegerArgValue("--warmup-runs", 1);
  const minRunsForClaim = positiveIntegerArgValue("--min-runs-for-claim", 1);
  const cacheDiscount = cacheDiscountArgValue("--cache-discount", DEFAULT_CACHE_DISCOUNT);
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

  const manifest = buildManifest({ fixtureRoot, cliPath: cli, selectedScales, selectedTasks, requestedModel, controlProfile });
  if (!dryRun) {
    const report = measuredReport({ manifest, authMode, runs, warmupRuns, maxScenarios, fullMatrix, minRunsForClaim, requireClaimable, requireClean, selectedScales, selectedTasks, cacheDiscount });
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
      control_profile: manifest.control_profile,
      isolated_codex_home: report.hermetic.isolated_codex_home,
      allowlisted_env_key_count: report.hermetic.allowlisted_env_key_count,
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
    control_profile: manifest.control_profile,
    scenario_count: manifest.scenarios.length,
  }, null, 2));
}

main();
