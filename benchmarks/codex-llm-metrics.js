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
const { buildIsolatedCodexHome, buildSpawnEnv, checkPreRunFingerprint, injectMcpServerConfig, resolveRealCodexHome, snapshotFixturePaths, validateFixtureAfterRun } = require("./lib/hermetic");
const { buildRealCorpusManifest } = require("./lib/real-corpus-manifest");
const { checkRealRepoPreRun, snapshotRealRepoUntracked, validateRealRepoAfterRun } = require("./lib/real-corpus");
const { DEFAULT_AUTO_PRUNE_CODEX_HOME_AGE_DAYS, DEFAULT_AUTO_PRUNE_RAW_RUN_AGE_DAYS, applyCodexHomeRetention, pruneOldCodexHomes, pruneOldRawRuns } = require("./lib/llm-raw-retention");

// A real-corpus scenario is identified by its pinned-sha + git-clean fingerprint
// algorithm (the synthetic path uses a content-hash fingerprint). Real scenarios
// use git-clean pre/post checks and (with-arm) MCP injection rather than full-file
// fingerprinting.
function isRealScenario(scenario) {
  return scenario && scenario.fixture_fingerprint && scenario.fixture_fingerprint.algorithm === "pinned-sha-git-clean";
}
const { DEFAULT_CACHE_DISCOUNT, claimableRuns, completePairCount, corporaPresent, evaluateTracksClaimGate, measurementStatus, medianMetrics, metricStats, passedRuns, renderLlmMarkdownReport, scenariosForTrack, scenariosForTrackCorpus, selectPairedScenarios, tracksPresent } = require("./lib/llm-report");

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

// A comma list argument with no fixed allowed set (e.g. --repos, whose values are
// repo names present in the corpus directory). Returns [] when absent so the
// caller fails with its own message.
function freeListArg(name) {
  const raw = argValue(name, "");
  if (!raw) return [];
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) fail(`empty ${name} value`);
  for (const value of values) {
    if (/[\\/]/.test(value) || value.includes("..")) fail(`invalid ${name} value: ${value}`);
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

function summarizePruneResult(result, enabled) {
  return {
    enabled: Boolean(enabled),
    raw_root: result.raw_root,
    older_than_days: result.older_than_days,
    cutoff: result.cutoff,
    dry_run: result.dry_run,
    candidate_count: result.candidate_count,
    candidate_bytes: result.candidate_bytes,
    pruned_count: result.pruned_count,
    pruned_bytes: result.pruned_bytes,
  };
}

function disabledPruneSummary({ rawRoot, olderThanDays }) {
  return {
    enabled: false,
    raw_root: rawRoot,
    older_than_days: olderThanDays,
    cutoff: null,
    dry_run: false,
    candidate_count: 0,
    candidate_bytes: 0,
    pruned_count: 0,
    pruned_bytes: 0,
  };
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

function defaultPayloadPreviewPath(baseRoot = root) {
  return path.join(baseRoot, "benchmarks", "reports", "llm", "payload-preview.json");
}

function defaultSanitizedPackRoot() {
  return path.join(os.tmpdir(), `project-librarian-sanitized-benchmark-pack-${Date.now()}`);
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

function sourceControlFingerprint(cwd = root) {
  try {
    const commit = commandOutput("git", ["rev-parse", "HEAD"], cwd);
    const shortCommit = commandOutput("git", ["rev-parse", "--short", "HEAD"], cwd);
    const branch = commandOutput("git", ["branch", "--show-current"], cwd);
    const status = commandOutput("git", ["status", "--short"], cwd);
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

function commandOutput(command, args, cwd = root) {
  return childProcess.execFileSync(command, args, {
    cwd,
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

function runCodexScenario(scenario, { rawRoot, runIndex, spawnEnv, progress }) {
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
  const real = isRealScenario(scenario);
  // Pre-run integrity check: synthetic uses the content-hash fingerprint; the real
  // corpus uses pinned-sha + git-clean (a content hash of a large repo is
  // impractical). Both fail before consuming quota on a stale/mutated working copy.
  let preRunSnapshot = null;
  let preRunUntracked = null;
  if (real) {
    checkRealRepoPreRun({
      cwd: scenario.cwd,
      expectedSha: scenario.fixture_fingerprint.repo_sha,
      materializationSha: scenario.materialization_sha || null,
    });
    preRunUntracked = snapshotRealRepoUntracked(scenario.cwd);
  } else {
    checkPreRunFingerprint({ cwd: scenario.cwd, expectedFingerprint: scenario.fixture_fingerprint });
    // Snapshot paths present BEFORE the spawn so post-run denylist scanning can
    // distinguish pre-existing bootstrap dot-dirs from paths written during the run.
    preRunSnapshot = snapshotFixturePaths(scenario.cwd);
  }
  const progressItem = progress ? progress.start({ scenario, runIndex }) : null;
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

  // Post-run fixture validation: synthetic re-fingerprints + denylist-scans new
  // paths; the real corpus checks pinned-sha + git-clean and a denylist over NEW
  // git-untracked paths. Any drift or any newly-appeared runtime-state path is a
  // hard failure (throws); isolation failures must fail the run.
  const fixtureValidation = real
    ? validateRealRepoAfterRun({
      cwd: scenario.cwd,
      // With-arm: use materialization_sha (HEAD after the materialization commit).
      // Control-arm: use the pinned corpus sha (no materialization commit on control).
      expectedSha: scenario.materialization_sha || scenario.fixture_fingerprint.repo_sha,
      preRunUntracked,
    })
    : validateFixtureAfterRun({
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
  if (progressItem) progress.complete(progressItem, run);
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
function runMultiSessionScenario(scenario, { rawRoot, runIndex, sessionSpawnEnvs, progress }) {
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
    const progressItem = progress ? progress.start({ scenario, runIndex, session }) : null;
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
    if (progressItem) {
      progress.complete(progressItem, {
        raw_jsonl_path: sessionRecord.raw_jsonl_path,
        execution: sessionRecord.execution,
      });
    }
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

function executionFailureReason(run) {
  if (run.execution?.status && run.execution.status !== "completed") {
    return `execution ${run.execution.status}`;
  }
  if (Array.isArray(run.session_metrics)) {
    for (const session of run.session_metrics) {
      if (session.execution?.status && session.execution.status !== "completed") {
        return `session ${session.session_index} execution ${session.execution.status}`;
      }
    }
  }
  return "";
}

function requireCompletedExecutionForClaimableRun(scenario, run) {
  const reason = executionFailureReason(run);
  if (!reason) return;
  const stderrPaths = [];
  if (run.execution?.stderr_path) stderrPaths.push(run.execution.stderr_path);
  if (Array.isArray(run.session_metrics)) {
    for (const session of run.session_metrics) {
      if (session.execution?.stderr_path) stderrPaths.push(session.execution.stderr_path);
    }
  }
  throw new Error([
    `measured Codex benchmark execution failed before claim evaluation: ${scenario.prompt_id} run ${run.run_index} (${reason})`,
    `raw: ${run.raw_jsonl_path}`,
    stderrPaths.length > 0 ? `stderr: ${stderrPaths.join(", ")}` : "stderr: n/a",
  ].join("\n"));
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

function copyRequiredFile(from, to) {
  if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
    throw new Error(`sanitized benchmark pack requires file: ${from}`);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyRequiredDirectory(from, to) {
  if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) {
    throw new Error(`sanitized benchmark pack requires directory: ${from}`);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function copyTypescriptDependency(packRoot) {
  let typescriptPackageJson;
  try {
    typescriptPackageJson = require.resolve("typescript/package.json", { paths: [root] });
  } catch (error) {
    throw new Error(`sanitized benchmark pack requires the installed typescript dependency: ${error.message}`);
  }
  const source = path.dirname(typescriptPackageJson);
  const target = path.join(packRoot, "node_modules", "typescript");
  copyRequiredDirectory(source, target);
  return path.relative(packRoot, target).split(path.sep).join("/");
}

function writeSanitizedPackManifest(packRoot, copiedEntries) {
  const manifest = {
    schema_version: 1,
    kind: "project-librarian-sanitized-benchmark-pack",
    generated_at: new Date().toISOString(),
    original_root: root,
    pack_root: packRoot,
    copied_entries: copiedEntries,
    excluded_workspace_roots: ["src", "tests", "wiki", "wiki_legacy", ".git", ".codex", ".claude", "README.md", "README.ko.md"],
    purpose: "Run Codex LLM benchmark scenarios from a minimized temporary harness instead of the live development checkout.",
  };
  const manifestPath = path.join(packRoot, "SANITIZED_BENCHMARK_PACK.json");
  writeJson(manifestPath, manifest);
  return { manifest, manifest_path: manifestPath };
}

function createSanitizedPack(packRoot) {
  if (!packRoot || typeof packRoot !== "string") {
    throw new Error("createSanitizedPack requires a packRoot path");
  }
  if (fs.existsSync(packRoot)) {
    throw new Error(`sanitized benchmark pack destination already exists: ${packRoot}`);
  }
  fs.mkdirSync(packRoot, { recursive: true });
  const copiedEntries = [];
  function copyFileEntry(relative) {
    copyRequiredFile(path.join(root, relative), path.join(packRoot, relative));
    copiedEntries.push(relative);
  }
  function copyDirectoryEntry(relative) {
    copyRequiredDirectory(path.join(root, relative), path.join(packRoot, relative));
    copiedEntries.push(`${relative}/`);
  }

  copyFileEntry("package.json");
  copyFileEntry(path.join("benchmarks", "codex-llm-metrics.js"));
  copyDirectoryEntry("dist");
  copyDirectoryEntry(path.join("benchmarks", "lib"));
  const realKeysDir = path.join(root, "benchmarks", "real-keys");
  if (fs.existsSync(realKeysDir)) copyDirectoryEntry(path.join("benchmarks", "real-keys"));
  copiedEntries.push(`${copyTypescriptDependency(packRoot)}/`);

  return writeSanitizedPackManifest(packRoot, copiedEntries);
}

function optionalPathFlagDefault(flag, originalRoot) {
  if (flag === "--markdown") return path.join(originalRoot, "benchmarks", "reports", "llm", "current.md");
  if (flag === "--payload-preview" || flag === "--preview-payload") return defaultPayloadPreviewPath(originalRoot);
  throw new Error(`internal error: no default for optional path flag ${flag}`);
}

function absolutizeAgainstOriginalRoot(value, originalRoot) {
  return path.isAbsolute(value) ? value : path.resolve(originalRoot, value);
}

function normalizeArgsForSanitizedPack(args, { originalRoot, packRoot }) {
  const normalized = [];
  const pathValueFlags = new Set(["--out", "--corpus-dir", "--keys-dir", "--raw-report-root"]);
  const optionalPathValueFlags = new Set(["--markdown", "--payload-preview", "--preview-payload"]);
  let sawOut = false;
  let dryRun = args.includes("--dry-run");
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--sanitized-pack") continue;
    if (arg === "--sanitized-pack-dir") {
      index += 1;
      continue;
    }
    if (["--sanitized-pack-active", "--sanitized-original-root", "--sanitized-pack-root"].includes(arg)) {
      if (arg !== "--sanitized-pack-active") index += 1;
      continue;
    }
    if (pathValueFlags.has(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) fail(`missing value for ${arg}`);
      normalized.push(arg, absolutizeAgainstOriginalRoot(value, originalRoot));
      if (arg === "--out") sawOut = true;
      index += 1;
      continue;
    }
    if (optionalPathValueFlags.has(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        normalized.push(arg, optionalPathFlagDefault(arg, originalRoot));
      } else {
        normalized.push(arg, absolutizeAgainstOriginalRoot(value, originalRoot));
        index += 1;
      }
      continue;
    }
    normalized.push(arg);
  }
  if (!sawOut) {
    normalized.push("--out", dryRun ? defaultOutPath() : defaultMeasuredOutPath());
  }
  normalized.push("--sanitized-pack-active", "--sanitized-original-root", originalRoot, "--sanitized-pack-root", packRoot);
  return normalized;
}

function reexecFromSanitizedPack(packRoot) {
  createSanitizedPack(packRoot);
  const activeRunner = path.join(packRoot, "benchmarks", "codex-llm-metrics.js");
  const activeArgs = normalizeArgsForSanitizedPack(process.argv.slice(2), { originalRoot: root, packRoot });
  const result = childProcess.spawnSync(process.execPath, [activeRunner, ...activeArgs], {
    cwd: packRoot,
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.error) {
    fail(`sanitized benchmark pack execution failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status);
  }
}

function readSanitizedPackProvenance(packRoot) {
  if (!packRoot || typeof packRoot !== "string") {
    fail("--sanitized-pack-active requires --sanitized-pack-root <path>");
  }
  const manifestPath = path.join(packRoot, "SANITIZED_BENCHMARK_PACK.json");
  if (!fs.existsSync(manifestPath)) {
    fail(`sanitized benchmark pack manifest missing: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return {
    enabled: true,
    pack_root: packRoot,
    manifest_path: manifestPath,
    original_root: manifest.original_root,
    copied_entries: manifest.copied_entries,
    excluded_workspace_roots: manifest.excluded_workspace_roots,
  };
}

function promptDigest(prompt) {
  return {
    sha256: sha256(prompt),
    char_count: prompt.length,
  };
}

function scenarioCodexExecCount(scenario, runs, warmupRuns) {
  const sessionCount = Array.isArray(scenario.sessions) && scenario.sessions.length > 0 ? scenario.sessions.length : 1;
  return (runs + warmupRuns) * sessionCount;
}

function formatProgressSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function compactProgressFields(fields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, "_")}`)
    .join(" ");
}

function createBenchmarkProgress({ selectedScenarios, runs, warmupRuns, rawRoot, sanitizedPack }) {
  const total = selectedScenarios.reduce((sum, scenario) => sum + scenarioCodexExecCount(scenario, runs, warmupRuns), 0);
  const startedAt = Date.now();
  let startedCount = 0;
  let completedCount = 0;

  function log(event, fields) {
    process.stderr.write(`[benchmark:progress] ${event} ${compactProgressFields(fields)}\n`);
  }

  log("plan", {
    scenarios: selectedScenarios.length,
    codex_exec_total: total,
    measured_runs: runs,
    warmup_runs: warmupRuns,
    raw_root: rawRoot,
    sanitized_pack: sanitizedPack && sanitizedPack.pack_root,
  });

  return {
    start({ scenario, runIndex, session }) {
      startedCount += 1;
      const item = {
        ordinal: startedCount,
        scenario,
        runIndex,
        session,
        startedAt: Date.now(),
      };
      log("start", {
        current: `${startedCount}/${total}`,
        prompt_id: scenario.prompt_id,
        phase: String(runIndex).startsWith("warmup-") ? "warmup" : "measured",
        run: runIndex,
        session: session ? session.session_index : undefined,
        role: session ? session.role : undefined,
        track: scenario.benchmark_track,
        corpus: scenario.corpus || "synthetic",
        scale: scenario.scale,
        task: scenario.task_family,
        condition: scenario.condition,
      });
      return item;
    },
    complete(item, run) {
      completedCount += 1;
      const elapsedMs = Date.now() - startedAt;
      const itemMs = Date.now() - item.startedAt;
      log("done", {
        current: `${completedCount}/${total}`,
        prompt_id: item.scenario.prompt_id,
        phase: String(item.runIndex).startsWith("warmup-") ? "warmup" : "measured",
        run: item.runIndex,
        session: item.session ? item.session.session_index : undefined,
        role: item.session ? item.session.role : undefined,
        status: run.execution && run.execution.status,
        exit: run.execution && run.execution.exit_code,
        elapsed: formatProgressSeconds(elapsedMs),
        duration: formatProgressSeconds(itemMs),
        raw: run.raw_jsonl_path,
        stderr: run.execution && run.execution.stderr_path,
      });
    },
  };
}

function excerpt(value, maxLength = 360) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function failedCheckNames(checks) {
  if (!Array.isArray(checks)) return [];
  return checks
    .filter((check) => !check.passed)
    .map((check) => check.reason ? `${check.name} (${check.reason})` : check.name);
}

function scenarioHasClaimGateFailure(scenario, minRunsForClaim) {
  const runs = Array.isArray(scenario.runs) ? scenario.runs : [];
  if (runs.length === 0) return true;
  if (scenario.claimable_run_count !== runs.length) return true;
  if (scenario.claimable_run_count < minRunsForClaim) return true;
  if (!scenario.median) return true;
  return runs.some((run) => {
    if (run.execution?.status && run.execution.status !== "completed") return true;
    if (run.measurement?.status && run.measurement.status !== "claimable") return true;
    if (run.correctness?.status && run.correctness.status !== "passed") return true;
    return false;
  });
}

function renderClaimGateFailureDiagnostics(report) {
  const lines = [];
  const configuration = report.configuration || {};
  const minRunsForClaim = configuration.min_runs_for_claim || 1;
  lines.push("claim gate failure diagnostics:");
  lines.push(`  report: scenarios=${report.summary?.scenario_count ?? "n/a"} claimable=${report.summary?.claimable_scenario_count ?? "n/a"} unclaimable=${report.summary?.unclaimable_scenario_count ?? "n/a"} min_runs_for_claim=${minRunsForClaim}`);
  lines.push(`  source: branch=${report.source_control?.branch || "n/a"} commit=${report.source_control?.short_commit || "n/a"} dirty=${report.source_control?.dirty === true ? "true" : "false"}`);
  for (const issue of report.claim_gate?.issues || []) {
    lines.push(`  gate-issue: ${issue}`);
  }

  const failingScenarios = (report.scenarios || [])
    .filter((scenario) => scenarioHasClaimGateFailure(scenario, minRunsForClaim));
  const scenarioLimit = 12;
  for (const scenario of failingScenarios.slice(0, scenarioLimit)) {
    const runs = Array.isArray(scenario.runs) ? scenario.runs : [];
    lines.push([
      `  scenario: ${scenario.prompt_id || "unknown"}`,
      `track=${scenario.benchmark_track || "wiki"}`,
      `corpus=${scenario.corpus || "synthetic"}`,
      `scale=${scenario.scale || "n/a"}`,
      `task=${scenario.task_family || "n/a"}`,
      `condition=${scenario.condition || "n/a"}`,
      `claimable=${scenario.claimable_run_count ?? 0}/${runs.length}`,
      `passed=${scenario.passed_run_count ?? 0}/${runs.length}`,
    ].join(" "));

    for (const run of runs) {
      const executionFailed = run.execution?.status && run.execution.status !== "completed";
      const measurementFailed = run.measurement?.status && run.measurement.status !== "claimable";
      const correctnessFailed = run.correctness?.status && run.correctness.status !== "passed";
      if (!executionFailed && !measurementFailed && !correctnessFailed) continue;
      lines.push(`    run ${run.run_index}: execution=${run.execution?.status || "unknown"} claim=${run.measurement?.status || "unknown"} correctness=${run.correctness?.status || "unknown"}`);
      if (run.execution?.exit_code !== undefined && run.execution?.exit_code !== null) {
        lines.push(`      exit_code: ${run.execution.exit_code}`);
      }
      if (run.raw_jsonl_path) lines.push(`      raw: ${run.raw_jsonl_path}`);
      if (run.execution?.stderr_path) lines.push(`      stderr: ${run.execution.stderr_path}`);
      const failedMeasurement = failedCheckNames(run.measurement?.checks);
      if (failedMeasurement.length > 0) lines.push(`      failed measurement checks: ${failedMeasurement.join("; ")}`);
      const failedCorrectness = failedCheckNames(run.correctness?.checks);
      if (failedCorrectness.length > 0) lines.push(`      failed correctness checks: ${failedCorrectness.join("; ")}`);
      if (run.correctness?.reason) lines.push(`      correctness reason: ${run.correctness.reason}`);
      const finalText = excerpt(run.metrics?.final_text);
      if (finalText) lines.push(`      final text excerpt: ${finalText}`);
    }
  }
  if (failingScenarios.length > scenarioLimit) {
    lines.push(`  ... ${failingScenarios.length - scenarioLimit} more failing scenario(s) omitted`);
  }
  lines.push("  note: non-passing correctness is a valid benchmark miss, not a runner execution error.");
  return lines.join("\n");
}

function scenarioPayloadPreview(scenario, runs, warmupRuns) {
  const promptInfo = promptDigest(scenario.prompt);
  const commandPrefix = Array.isArray(scenario.command) && scenario.command.length > 0
    ? scenario.command.slice(0, Math.max(0, scenario.command.length - 1))
    : [];
  const preview = {
    prompt_id: scenario.prompt_id,
    scale: scenario.scale,
    condition: scenario.condition,
    corpus: scenario.corpus || "synthetic",
    repo: scenario.repo || null,
    question_id: scenario.question_id || null,
    benchmark_track: scenario.benchmark_track,
    task_family: scenario.task_family,
    cwd: scenario.cwd,
    prompt: scenario.prompt,
    prompt_sha256: promptInfo.sha256,
    prompt_char_count: promptInfo.char_count,
    command_prefix: commandPrefix,
    fixture_fingerprint: scenario.fixture_fingerprint,
    expected_codex_exec_count: scenarioCodexExecCount(scenario, runs, warmupRuns),
    mcp_injected: Boolean(scenario.mcp),
    mcp_runner_path: scenario.mcp_runner_path || null,
  };
  if (Array.isArray(scenario.sessions) && scenario.sessions.length > 0) {
    preview.sessions = scenario.sessions.map((session) => ({
      session_index: session.session_index,
      role: session.role,
      prompt: session.prompt,
      prompt_sha256: promptDigest(session.prompt).sha256,
      prompt_char_count: session.prompt.length,
      command_prefix: Array.isArray(session.command) ? session.command.slice(0, Math.max(0, session.command.length - 1)) : [],
    }));
  }
  return preview;
}

function buildPayloadPreview({ manifest, selectedScenarios, dryRun, runs, warmupRuns, maxScenarios, fullMatrix, minRunsForClaim, requireClaimable, requireClean, selectedScales, selectedTasks, cacheDiscount, sourceRoot, sanitizedPack, keepCodexHomes, autoPruneCodexHomes, autoPruneCodexHomesOlderThanDays, autoPruneRawRuns, autoPruneRawRunsOlderThanDays, droppedScenarios }) {
  const codexExecCount = selectedScenarios.reduce((total, scenario) => total + scenarioCodexExecCount(scenario, runs, warmupRuns), 0);
  const readableRoots = [...new Set(selectedScenarios.map((scenario) => scenario.cwd))].sort();
  return {
    schema_version: 1,
    benchmark_kind: "codex-actual-llm-payload-preview",
    generated_at: new Date().toISOString(),
    mode: dryRun ? "dry-run-preview" : "measured-preview",
    corpus: manifest.corpus || "synthetic",
    control_profile: manifest.control_profile,
    source_control: sourceControlFingerprint(sourceRoot),
    sanitized_pack: sanitizedPack || { enabled: false },
    disclosure_boundary: {
      codex_network_run: false,
      measured_run_requires_allow_codex_run: true,
      prompt_payload_included: true,
      codex_readable_roots: readableRoots,
      source_workspace_root: sourceRoot,
      source_workspace_is_codex_cwd: readableRoots.includes(sourceRoot),
      note: "This preview is local-only. A measured run sends each listed prompt to Codex and Codex may read files only from the scenario cwd under its read-only sandbox.",
    },
    configuration: {
      runs,
      warmup_runs: warmupRuns,
      max_scenarios: maxScenarios,
      full_matrix: fullMatrix,
      min_runs_for_claim: minRunsForClaim,
      require_claimable: requireClaimable,
      require_clean: requireClean,
      requested_model: manifest.requested_model,
      cache_discount: cacheDiscount,
      keep_codex_homes: Boolean(keepCodexHomes),
      auto_prune_codex_homes: Boolean(autoPruneCodexHomes),
      auto_prune_codex_homes_older_than_days: autoPruneCodexHomesOlderThanDays,
      auto_prune_raw_runs: Boolean(autoPruneRawRuns),
      auto_prune_raw_runs_older_than_days: autoPruneRawRunsOlderThanDays,
      selected_scales: selectedScales,
      selected_tasks: selectedTasks,
      selected_scenarios: selectedScenarios.length,
      total_manifest_scenarios: manifest.scenarios.length,
      expected_codex_exec_count: codexExecCount,
      dropped_scenarios: droppedScenarios.length > 0 ? droppedScenarios.map((scenario) => scenario.prompt_id) : [],
      manifest_fingerprint: sha256(JSON.stringify(selectedScenarios.map((scenario) => ({
        scale: scenario.scale,
        condition: scenario.condition,
        task_family: scenario.task_family,
        prompt: scenario.prompt,
        fixture_fingerprint: scenario.fixture_fingerprint,
        requested_model: scenario.requested_model,
      })))),
    },
    scenarios: selectedScenarios.map((scenario) => scenarioPayloadPreview(scenario, runs, warmupRuns)),
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

function measuredReport({ manifest, authMode, runs, warmupRuns, maxScenarios, fullMatrix, minRunsForClaim, requireClaimable, requireClean, selectedScales, selectedTasks, cacheDiscount, sourceRoot = root, sanitizedPack = null, droppedScenarios = [], keepCodexHomes = false, autoPruneCodexHomes = true, autoPruneCodexHomesOlderThanDays = DEFAULT_AUTO_PRUNE_CODEX_HOME_AGE_DAYS, autoPruneRawRuns = true, autoPruneRawRunsOlderThanDays = DEFAULT_AUTO_PRUNE_RAW_RUN_AGE_DAYS, rawReportRoot = "" }) {
  requireMeasuredAuth(authMode);
  const resolvedRawReportRoot = rawReportRoot
    ? path.resolve(rawReportRoot)
    : (sanitizedPack && sanitizedPack.original_root ? sanitizedPack.original_root : root);
  const rawParent = path.join(resolvedRawReportRoot, "benchmarks", "reports", "llm", "raw");
  fs.mkdirSync(rawParent, { recursive: true });
  const priorRawRunCleanup = autoPruneRawRuns
    ? summarizePruneResult(pruneOldRawRuns({
      rawRoot: rawParent,
      olderThanDays: autoPruneRawRunsOlderThanDays,
      dryRun: false,
    }), true)
    : disabledPruneSummary({ rawRoot: rawParent, olderThanDays: autoPruneRawRunsOlderThanDays });
  const priorCodexHomeCleanup = autoPruneCodexHomes
    ? summarizePruneResult(pruneOldCodexHomes({
      rawRoot: rawParent,
      olderThanDays: autoPruneCodexHomesOlderThanDays,
      dryRun: false,
    }), true)
    : disabledPruneSummary({ rawRoot: rawParent, olderThanDays: autoPruneCodexHomesOlderThanDays });
  const rawRoot = path.join(rawParent, new Date().toISOString().replace(/[:.]/g, "-"));
  if (maxScenarios < conditions.length) {
    fail(`measured Codex benchmark requires at least ${conditions.length} scenarios to compare conditions`);
  }
  const selectedScenarios = selectPairedScenarios(manifest.scenarios, maxScenarios, conditions);
  if (selectedScenarios.length === 0) fail("no complete with/without scenario pair selected");
  const progress = createBenchmarkProgress({
    selectedScenarios,
    runs,
    warmupRuns,
    rawRoot,
    sanitizedPack,
  });

  // Hermetic measurement (A5), always on for measured runs (not flag-gated): copy
  // only the auth material from the real Codex home into a fresh isolated
  // CODEX_HOME, and build the child env from an explicit allowlist (no inherited
  // user plugins/config). Both fail loudly (throw) if auth is absent or PATH is
  // missing, rather than falling back to the unisolated user home.
  const homeDir = os.homedir();
  const realCodexHome = resolveRealCodexHome(process.env, homeDir);
  const codexHomePaths = new Set();
  function trackCodexHome(homePath) {
    codexHomePaths.add(homePath);
    return homePath;
  }
  let codexHomeRetention = null;
  function applyCurrentCodexHomeRetention() {
    if (codexHomeRetention) return codexHomeRetention;
    codexHomeRetention = applyCodexHomeRetention({
      rawRoot,
      homePaths: [...codexHomePaths],
      keepCodexHomes,
    });
    return codexHomeRetention;
  }
  function failAfterCurrentCodexHomeRetention(message) {
    try {
      applyCurrentCodexHomeRetention();
    } catch (error) {
      fail(`${message}\ncodex home retention cleanup failed: ${error.message}`);
    }
    fail(message);
  }
  const isolatedCodexHome = trackCodexHome(path.join(rawRoot, "codex-home"));
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
      const sessionHome = trackCodexHome(path.join(rawRoot, `codex-home-${safeName(scenario.prompt_id)}-run-${runIndex}-s${session.session_index}`));
      buildIsolatedCodexHome({ realCodexHome, destHome: sessionHome });
      return buildSpawnEnv({ sourceEnv: process.env, codexHome: sessionHome, authMode, homeDir });
    });
  }

  // Real-corpus MCP injection (with-arm only). Each real scenario gets its OWN
  // fresh isolated CODEX_HOME (so the with-arm home can carry the MCP entry while
  // the control-arm home does not). For a with-arm (`mcp: true`) scenario, the
  // project-librarian MCP server is injected into that home's config.toml WITHOUT
  // clobbering the copied auth material (auth lives in auth.json, not config.toml).
  // Control-arm homes get NO MCP entry — a usage-faithful with/without contrast.
  function buildRealScenarioSpawnEnv(scenario, runIndex) {
    const scenarioHome = trackCodexHome(path.join(rawRoot, `codex-home-${safeName(scenario.prompt_id)}-run-${runIndex}`));
    buildIsolatedCodexHome({ realCodexHome, destHome: scenarioHome });
    if (scenario.mcp) {
      if (!scenario.mcp_runner_path) {
        fail(`internal error: real with-arm scenario ${scenario.prompt_id} marked mcp:true without an mcp_runner_path`);
      }
      injectMcpServerConfig({ codexHome: scenarioHome, runnerPath: scenario.mcp_runner_path });
    }
    return buildSpawnEnv({ sourceEnv: process.env, codexHome: scenarioHome, authMode, homeDir });
  }

  function runScenarioOnce(scenario, runIndex) {
    if (Array.isArray(scenario.sessions) && scenario.sessions.length > 0) {
      return runMultiSessionScenario(scenario, { rawRoot, runIndex, sessionSpawnEnvs: buildSessionSpawnEnvs(scenario, runIndex), progress });
    }
    // Real-corpus scenarios use a per-scenario isolated home (with conditional MCP
    // injection); synthetic scenarios share the single auth-only isolated home.
    const scenarioSpawnEnv = isRealScenario(scenario) ? buildRealScenarioSpawnEnv(scenario, runIndex) : spawnEnv;
    return runCodexScenario(scenario, { rawRoot, runIndex, spawnEnv: scenarioSpawnEnv, progress });
  }

  const scenarios = [];

  try {
    for (const scenario of selectedScenarios) {
      for (let index = 0; index < warmupRuns; index += 1) {
        const warmupRun = runScenarioOnce(scenario, `warmup-${index + 1}`);
        if (requireClaimable) requireCompletedExecutionForClaimableRun(scenario, warmupRun);
      }
      const measuredRuns = [];
      for (let index = 0; index < runs; index += 1) {
        const measuredRun = runScenarioOnce(scenario, index + 1);
        if (requireClaimable) requireCompletedExecutionForClaimableRun(scenario, measuredRun);
        measuredRuns.push(measuredRun);
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
        // Corpus dimension (schema 7): carried through from the manifest so reports
        // separate real-corpus from synthetic results. Synthetic scenarios carry
        // "synthetic" + null repo fields; real-corpus scenarios carry "real" + the
        // repo/repo_sha/question_id they were built from.
        corpus: scenario.corpus || "synthetic",
        repo: scenario.repo || null,
        repo_sha: scenario.repo_sha || null,
        question_id: scenario.question_id || null,
        // MCP provenance: with-arm real scenarios inject the project-librarian MCP
        // server into the isolated CODEX_HOME; recorded so the report shows which
        // condition carried the MCP entry. Synthetic and control scenarios are false.
        mcp_injected: Boolean(scenario.mcp),
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
  } catch (error) {
    failAfterCurrentCodexHomeRetention(error.message || String(error));
  }

  const retainedCodexHomes = applyCurrentCodexHomeRetention();

  const presentTracks = tracksPresent(scenarios);
  const expectedByTrack = expectedTasksByTrack(selectedTasks);

  const report = {
    // schema_version 7 adds the corpus dimension: every scenario carries
    // `corpus`/`repo`/`repo_sha`/`question_id`, claim gates and report.tracks carry
    // a per-corpus breakdown (real vs synthetic), and the Markdown renders separate
    // per-corpus subsections within each track (real and synthetic are never merged
    // into one number). schema_version 6 (A4) added the cost decomposition: per-run
    // derived uncached_input_tokens/tool_output_bytes/request_count_estimate (in
    // metrics), the report-level cache_discount, and a cost-weighted per-track
    // headline (merged total_tokens demoted to a secondary row in JSON medians and
    // Markdown). schema_version 5 (A3) added multi_session run/scenario fields:
    // per-run session_metrics + measured_session_index on multi_session runs, and
    // session_count/sessions/session_metrics on multi_session scenarios (session-2
    // metrics are the scenario primary; session-1 lives only in session_metrics).
    // schema_version 4 added the A5 hermetic provenance block at the report top
    // level and a per-run fixture_validation record. schema_version 3 added
    // control_profile (A2) at the report top level, in configuration, and on
    // every scenario.
    schema_version: 7,
    benchmark_kind: "codex-actual-llm",
    auth_mode: authMode,
    auth: authAudit(),
    generated_at: new Date().toISOString(),
    environment: environmentFingerprint(),
    source_control: sourceControlFingerprint(sourceRoot),
    control_profile: manifest.control_profile,
    // Top-level corpus label: the manifest the measured run consumed. Synthetic
    // fixtures report "synthetic"; the real-repository track reports "real".
    // Scenario-level corpus fields carry the per-scenario corpus regardless.
    corpus: manifest.corpus || "synthetic",
    cache_discount: cacheDiscount,
    sanitized_pack: sanitizedPack || { enabled: false },
    hermetic: {
      ...hermetic,
      prior_raw_run_cleanup: priorRawRunCleanup,
      prior_codex_home_cleanup: priorCodexHomeCleanup,
      codex_home_retention: {
        manifest_path: retainedCodexHomes.manifest_path,
        keep_codex_homes: retainedCodexHomes.keep_codex_homes,
        home_count: retainedCodexHomes.home_count,
        retained_home_count: retainedCodexHomes.retained_home_count,
        pruned_home_count: retainedCodexHomes.pruned_home_count,
        retained_bytes: retainedCodexHomes.retained_bytes,
        pruned_bytes: retainedCodexHomes.pruned_bytes,
      },
    },
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
      sanitized_pack: Boolean(sanitizedPack && sanitizedPack.enabled),
      keep_codex_homes: Boolean(keepCodexHomes),
      auto_prune_codex_homes: Boolean(autoPruneCodexHomes),
      auto_prune_codex_homes_older_than_days: autoPruneCodexHomesOlderThanDays,
      auto_prune_raw_runs: Boolean(autoPruneRawRuns),
      auto_prune_raw_runs_older_than_days: autoPruneRawRunsOlderThanDays,
      scenario_order: "deterministic-alternating-pairs",
      requested_model: manifest.requested_model,
      selected_scales: selectedScales,
      selected_tasks: selectedTasks,
      selected_scenarios: selectedScenarios.length,
      total_manifest_scenarios: manifest.scenarios.length,
      // For real-corpus runs with an explicit --max-scenarios cap, records which
      // prompt_ids were dropped so the partial run is transparent in the report.
      dropped_scenarios: droppedScenarios.length > 0 ? droppedScenarios.map((s) => s.prompt_id) : undefined,
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
  //
  // For real-corpus runs, the claim gate enforces COVERAGE COMPLETENESS: every
  // repo×question_id pair in the full manifest must be present in the measured
  // scenarios (issues list any missing pairs by name). expectedRealCoverage is
  // derived from the FULL manifest (before any --max-scenarios cap) so a partial
  // run produces named missing-pair issues rather than silently passing.
  const expectedRealCoverage = manifest.corpus === "real"
    ? [...new Map(manifest.scenarios.filter((s) => s.corpus === "real").map((s) => [`${s.repo}\0${s.question_id}`, { repo: s.repo, question_id: s.question_id, benchmark_track: s.benchmark_track }])).values()]
    : [];
  const overallGate = evaluateTracksClaimGate(report, {
    conditions,
    expectedScales: selectedScales,
    expectedTasksByTrack: expectedByTrack,
    fullMatrix,
    minRunsForClaim,
    expectedRealCoverage,
  });
  report.tracks = {};
  for (const track of presentTracks) {
    const trackScenarios = scenariosForTrack(scenarios, track);
    const trackCorpora = corporaPresent(trackScenarios);
    // Per-corpus breakdown within the track: each corpus carries its own scenario
    // summary, prompt ids, and claim gate so real-corpus results are reported
    // SEPARATELY from synthetic (never merged into one number).
    const corpora = {};
    for (const corpus of trackCorpora) {
      const corpusScenarios = scenariosForTrackCorpus(scenarios, track, corpus);
      corpora[corpus] = {
        corpus,
        summary: summarizeScenarios(corpusScenarios),
        prompt_ids: corpusScenarios.map((scenario) => scenario.prompt_id),
        claim_gate: overallGate.per_track[track].per_corpus[corpus],
      };
    }
    report.tracks[track] = {
      benchmark_track: track,
      expected_tasks: expectedByTrack[track] || [],
      summary: summarizeScenarios(trackScenarios),
      prompt_ids: trackScenarios.map((scenario) => scenario.prompt_id),
      corpora_present: trackCorpora,
      corpora,
      claim_gate: overallGate.per_track[track],
    };
  }
  report.claim_gate = overallGate;
  return report;
}

// Rescore an existing measured report by re-reading each run's raw JSONL and
// re-running evaluateCorrectness with the current evaluator.  No codex execution.
// The original report file is never modified; a new file with a "-rescored" suffix
// is written alongside it.  This implements the recompute-from-raw policy:
//   - final_text is re-extracted from the raw JSONL (not taken from the stored report)
//   - correctness is fully recomputed from the re-extracted text + stored expectation
//   - measurement status, passed/claimable counts, summaries, and the claim gate are
//     all recomputed from the fresh correctness verdicts
//   - all other fields (metrics, commands, prompts, provenance) are carried verbatim
function rescoreReport(reportPath) {
  if (!fs.existsSync(reportPath)) {
    fail(`--rescore: report file not found: ${reportPath}`);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (!report.scenarios || !Array.isArray(report.scenarios)) {
    fail(`--rescore: report has no scenarios array: ${reportPath}`);
  }

  const rescoredScenarios = report.scenarios.map((scenario) => {
    if (!Array.isArray(scenario.runs)) return scenario;
    const rescoredRuns = scenario.runs.map((run) => {
      // Re-extract final_text from the raw JSONL and merge it into the stored
      // metrics record.  Only final_text is re-extracted: all other metric fields
      // (tokens, timing, model, unavailable_event_fields) are carried verbatim from
      // the stored run so that claimability checks that depend on usage/model
      // availability continue to reflect the original measurement.  final_text alone
      // was absent from the stored record (the report strips it to save space) and
      // must be read back from the JSONL to re-run the evaluator.
      const rawPath = run.raw_jsonl_path;
      let finalText = (run.metrics && run.metrics.final_text) || "";
      let fileChangeCount = (run.metrics && run.metrics.file_change_event_count) || 0;
      if (rawPath && fs.existsSync(rawPath)) {
        const content = fs.readFileSync(rawPath, "utf8");
        const freshMetrics = summarizeJsonlSafely(content, { wall_ms: run.metrics ? run.metrics.wall_ms : 0 });
        finalText = freshMetrics.final_text || finalText;
        fileChangeCount = freshMetrics.file_change_event_count || fileChangeCount;
      }
      // Re-run the evaluator with the current (fixed) logic.
      const correctness = evaluateCorrectness({
        taskFamily: scenario.task_family,
        condition: scenario.condition,
        finalText,
        fileChangeCount,
        readOnly: true,
        expectation: scenario.expectation || null,
        controlProfile: scenario.control_profile || "organic",
        benchmarkTrack: scenario.benchmark_track,
      });
      // Merge the re-extracted final_text back into stored metrics so the rescored
      // run record is self-contained (the Markdown renderer reads run.metrics.final_text
      // for display).  All other metric fields are unchanged.
      const metrics = run.metrics ? { ...run.metrics, final_text: finalText } : run.metrics;
      const rescoredRun = { ...run, metrics, correctness };
      rescoredRun.measurement = measurementStatus(rescoredRun);
      return rescoredRun;
    });

    const correctnessPassedRuns = passedRuns(rescoredRuns);
    const actualClaimableRuns = claimableRuns(rescoredRuns);
    return {
      ...scenario,
      runs: rescoredRuns,
      passed_run_count: correctnessPassedRuns.length,
      claimable_run_count: actualClaimableRuns.length,
      correctness: rescoredRuns.map((run) => run.correctness),
      median: actualClaimableRuns.length > 0 ? medianMetrics(actualClaimableRuns) : null,
      median_all_runs: medianMetrics(rescoredRuns),
      dispersion: actualClaimableRuns.length > 0 ? metricStats(actualClaimableRuns) : null,
      dispersion_all_runs: metricStats(rescoredRuns),
    };
  });

  // Recompute report-level summary.
  const rescoredReport = {
    ...report,
    rescored_at: new Date().toISOString(),
    rescored_from: reportPath,
    scenarios: rescoredScenarios,
    summary: summarizeScenarios(rescoredScenarios),
  };

  // Recompute tracks and claim gate.
  const presentTracks = tracksPresent(rescoredScenarios);
  const selectedTasks = (report.configuration && report.configuration.selected_tasks) || Object.keys(taskFamilies);
  const selectedScales = (report.configuration && report.configuration.selected_scales) || Object.keys(scales);
  const fullMatrix = Boolean(report.configuration && report.configuration.full_matrix);
  const minRunsForClaim = (report.configuration && report.configuration.min_runs_for_claim) || 1;
  const expectedByTrack = expectedTasksByTrack(selectedTasks);

  const expectedRealCoverage = rescoredReport.corpus === "real"
    ? [...new Map(rescoredScenarios.filter((s) => s.corpus === "real").map((s) => [`${s.repo}\0${s.question_id}`, { repo: s.repo, question_id: s.question_id, benchmark_track: s.benchmark_track }])).values()]
    : [];

  const overallGate = evaluateTracksClaimGate(rescoredReport, {
    conditions,
    expectedScales: selectedScales,
    expectedTasksByTrack: expectedByTrack,
    fullMatrix,
    minRunsForClaim,
    expectedRealCoverage,
  });

  rescoredReport.tracks = {};
  for (const track of presentTracks) {
    const trackScenarios = scenariosForTrack(rescoredScenarios, track);
    const trackCorpora = corporaPresent(trackScenarios);
    const corpora = {};
    for (const corpus of trackCorpora) {
      const corpusScenarios = scenariosForTrackCorpus(rescoredScenarios, track, corpus);
      corpora[corpus] = {
        corpus,
        summary: summarizeScenarios(corpusScenarios),
        prompt_ids: corpusScenarios.map((s) => s.prompt_id),
        claim_gate: overallGate.per_track[track].per_corpus[corpus],
      };
    }
    rescoredReport.tracks[track] = {
      benchmark_track: track,
      expected_tasks: expectedByTrack[track] || [],
      summary: summarizeScenarios(trackScenarios),
      prompt_ids: trackScenarios.map((s) => s.prompt_id),
      corpora_present: trackCorpora,
      corpora,
      claim_gate: overallGate.per_track[track],
    };
  }
  rescoredReport.claim_gate = overallGate;

  // Write alongside the original with a "-rescored" suffix (immutability: original untouched).
  const ext = path.extname(reportPath);
  const base = reportPath.slice(0, -ext.length || undefined);
  const outPath = `${base}-rescored${ext}`;
  writeJson(outPath, rescoredReport);

  const mdBase = `${base}-rescored.md`;
  writeText(mdBase, renderLlmMarkdownReport(rescoredReport));

  console.log(JSON.stringify({
    status: "ok",
    mode: "rescore",
    original: reportPath,
    out: outPath,
    markdown: mdBase,
    scenario_count: rescoredScenarios.length,
    passed_correctness_count: rescoredReport.summary.passed_correctness_count,
    failed_correctness_count: rescoredReport.summary.failed_correctness_count,
    claim_gate: overallGate.status,
    claim_gate_issues: overallGate.issues,
  }, null, 2));
}

function main() {
  // --rescore <report.json>: recompute correctness/gates from raw JSONL without any
  // codex execution.  Must be the first flag check so it short-circuits main().
  const rescoreArg = optionalArgValue("--rescore");
  if (rescoreArg !== null) {
    if (!rescoreArg) fail("--rescore requires a path to an existing report JSON file");
    rescoreReport(path.resolve(rescoreArg));
    return;
  }

  if (hasFlag("--sanitized-pack") && !hasFlag("--sanitized-pack-active")) {
    const packDir = optionalStringArgValue("--sanitized-pack-dir") || defaultSanitizedPackRoot();
    reexecFromSanitizedPack(path.resolve(packDir));
    return;
  }

  const dryRun = hasFlag("--dry-run");
  const allowCodexRun = hasFlag("--allow-codex-run");
  const sanitizedPackActive = hasFlag("--sanitized-pack-active");
  const sanitizedOriginalRootArg = optionalStringArgValue("--sanitized-original-root");
  const sanitizedPackRootArg = optionalStringArgValue("--sanitized-pack-root");
  const sourceRoot = sanitizedOriginalRootArg ? path.resolve(sanitizedOriginalRootArg) : root;
  const sanitizedPack = sanitizedPackActive ? readSanitizedPackProvenance(path.resolve(sanitizedPackRootArg)) : null;
  const payloadPreviewArg = optionalArgValue("--payload-preview");
  const legacyPayloadPreviewArg = optionalArgValue("--preview-payload");
  if (payloadPreviewArg !== null && legacyPayloadPreviewArg !== null) {
    fail("use only one of --payload-preview or --preview-payload");
  }
  const payloadPreviewPath = payloadPreviewArg !== null
    ? path.resolve(root, payloadPreviewArg || defaultPayloadPreviewPath(root))
    : (legacyPayloadPreviewArg !== null ? path.resolve(root, legacyPayloadPreviewArg || defaultPayloadPreviewPath(root)) : "");
  const fullMatrix = hasFlag("--full-matrix");
  const requireClaimable = hasFlag("--require-claimable");
  const requireClean = hasFlag("--require-clean");
  const keepCodexHomes = hasFlag("--keep-codex-homes");
  const autoPruneCodexHomes = !hasFlag("--no-auto-prune-codex-homes");
  const autoPruneCodexHomesOlderThanDays = positiveIntegerArgValue("--auto-prune-codex-homes-older-than-days", DEFAULT_AUTO_PRUNE_CODEX_HOME_AGE_DAYS);
  const autoPruneRawRuns = !hasFlag("--no-auto-prune-raw-runs");
  const autoPruneRawRunsOlderThanDays = positiveIntegerArgValue("--auto-prune-raw-runs-older-than-days", DEFAULT_AUTO_PRUNE_RAW_RUN_AGE_DAYS);
  const rawReportRootArg = optionalStringArgValue("--raw-report-root");
  const rawReportRoot = rawReportRootArg ? path.resolve(root, rawReportRootArg) : "";
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
  // For --corpus real, --max-scenarios defaults to Infinity (full key coverage) and
  // is resolved to the actual manifest size after building the manifest. The explicit
  // flag is still accepted (for probe/debug runs) but logs the dropped scenarios by
  // name so no cap is ever silent. For --corpus synthetic, the default is conditions.length
  // (unchanged behaviour).
  const maxScenariosExplicit = hasArg("--max-scenarios");
  const requestedModel = optionalStringArgValue("--model");
  if (requireClaimable && !requestedModel) {
    fail("--require-claimable requires --model <model> so claimable reports can record a single requested model when Codex JSONL omits model metadata");
  }
  const corpus = argValue("--corpus", "synthetic");
  if (!["synthetic", "real"].includes(corpus)) fail(`invalid --corpus value: ${corpus} (expected synthetic or real)`);
  const syntheticDefaultMax = fullMatrix ? fullMatrixScenarioCount : conditions.length;
  // For real corpus we compute the effective maxScenarios after building the manifest;
  // for synthetic we compute it now.
  let maxScenarios = corpus === "real"
    ? positiveIntegerArgValue("--max-scenarios", Number.MAX_SAFE_INTEGER)
    : positiveIntegerArgValue("--max-scenarios", syntheticDefaultMax);
  const corpusDir = optionalStringArgValue("--corpus-dir");
  const scratchRoot = sanitizedPack ? path.join(sanitizedPack.pack_root, "scratch") : os.tmpdir();
  const fixtureRoot = path.resolve(scratchRoot, `project-librarian-codex-llm-${Date.now()}`);

  if (fullMatrix && hasArg("--max-scenarios") && maxScenarios !== fullMatrixScenarioCount) {
    fail(`--full-matrix requires --max-scenarios ${fullMatrixScenarioCount} for selected scales/tasks`);
  }
  if (corpus === "real" && !corpusDir) {
    fail("--corpus real requires --corpus-dir <path> pointing at the materialized corpus directory");
  }
  if (corpus === "real" && fullMatrix) {
    fail("--full-matrix applies to the synthetic scale×task matrix; the real corpus uses its own repo/question coverage");
  }

  if (!dryRun && !payloadPreviewPath && !allowCodexRun) {
    fail("measured Codex benchmark requires --allow-codex-run; use --dry-run to create a fixture manifest without consuming subscription quota");
  }
  if (!dryRun && requireClean) {
    const sourceControl = sourceControlFingerprint(sourceRoot);
    if (!sourceControl.available || sourceControl.dirty) {
      fail("measured Codex benchmark requires a clean git checkout when --require-clean is set");
    }
  }

  // Corpus dispatch: the synthetic path (default) builds the synthetic fixture
  // matrix exactly as before. The real path builds a manifest from pristine repo
  // clones plus per-repo answer keys (offline; clones must already exist under
  // --corpus-dir, fetched behind --allow-corpus-fetch by benchmarks/lib/real-corpus.js).
  let manifest;
  if (corpus === "real") {
    const reposArg = freeListArg("--repos");
    if (reposArg.length === 0) {
      fail("--corpus real requires --repos <name[,name...]> selecting repos present in --corpus-dir");
    }
    const keysDir = path.resolve(root, optionalStringArgValue("--keys-dir") || path.join("benchmarks", "real-keys"));
    manifest = buildRealCorpusManifest({
      corpusDir: path.resolve(root, corpusDir),
      keysDir,
      workDir: fixtureRoot,
      cliPath: cli,
      repos: reposArg,
      requestedModel,
    });
  } else {
    manifest = buildManifest({ fixtureRoot, cliPath: cli, selectedScales, selectedTasks, requestedModel, controlProfile });
  }

  // For real-corpus runs, resolve the effective maxScenarios NOW that we have the
  // manifest. Default (no --max-scenarios flag) = full key coverage = all manifest
  // scenarios. Explicit --max-scenarios N is a probe/debug cap: it MUST log every
  // dropped scenario by prompt_id so no cap is ever silent.
  let droppedScenarios = [];
  if (corpus === "real") {
    const fullManifestCount = manifest.scenarios.length;
    if (!maxScenariosExplicit) {
      // No cap: run every question-pair in the key. Override the sentinel value.
      maxScenarios = fullManifestCount;
    } else if (maxScenarios < fullManifestCount) {
      // Explicit cap: compute which scenarios would NOT be selected so we can log them.
      const selectedPairKeys = new Set(
        selectPairedScenarios(manifest.scenarios, maxScenarios, conditions).map((s) => s.prompt_id),
      );
      droppedScenarios = manifest.scenarios.filter((s) => !selectedPairKeys.has(s.prompt_id));
      console.error(
        `[real-corpus] --max-scenarios ${maxScenarios} caps ${fullManifestCount} manifest scenarios; ` +
        `dropping ${droppedScenarios.length} scenario(s): ${droppedScenarios.map((s) => s.prompt_id).join(", ")}`,
      );
    }
  }

  const selectedScenarios = selectPairedScenarios(manifest.scenarios, maxScenarios, conditions);
  if (payloadPreviewPath) {
    if (selectedScenarios.length === 0) fail("no complete with/without scenario pair selected");
    const preview = buildPayloadPreview({
      manifest,
      selectedScenarios,
      dryRun,
      runs,
      warmupRuns,
      maxScenarios,
      fullMatrix,
      minRunsForClaim,
      requireClaimable,
      requireClean,
      selectedScales,
      selectedTasks,
      cacheDiscount,
      sourceRoot,
      sanitizedPack,
      keepCodexHomes,
      autoPruneCodexHomes,
      autoPruneCodexHomesOlderThanDays,
      autoPruneRawRuns,
      autoPruneRawRunsOlderThanDays,
      droppedScenarios,
    });
    writeJson(payloadPreviewPath, preview);
    console.log(JSON.stringify({
      status: "ok",
      mode: "payload-preview",
      out: payloadPreviewPath,
      fixture_root: fixtureRoot,
      sanitized_pack: sanitizedPack ? sanitizedPack.pack_root : null,
      scenario_count: selectedScenarios.length,
      expected_codex_exec_count: preview.configuration.expected_codex_exec_count,
    }, null, 2));
    return;
  }

  if (!dryRun) {
    const report = measuredReport({ manifest, authMode, runs, warmupRuns, maxScenarios, fullMatrix, minRunsForClaim, requireClaimable, requireClean, selectedScales, selectedTasks, cacheDiscount, sourceRoot, sanitizedPack, droppedScenarios, keepCodexHomes, autoPruneCodexHomes, autoPruneCodexHomesOlderThanDays, autoPruneRawRuns, autoPruneRawRunsOlderThanDays, rawReportRoot });
    writeJson(out, report);
    const markdownOut = markdown ? path.resolve(root, markdown) : "";
    if (markdownOut) writeText(markdownOut, renderLlmMarkdownReport(report));
    if (requireClaimable && report.claim_gate.status !== "passed") {
      console.error(`claim gate failed: ${report.claim_gate.issues.join("; ")}`);
      console.error(renderClaimGateFailureDiagnostics(report));
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
      prior_raw_run_cleanup: report.hermetic.prior_raw_run_cleanup,
      prior_codex_home_cleanup: report.hermetic.prior_codex_home_cleanup,
      codex_home_retention: report.hermetic.codex_home_retention,
      allowlisted_env_key_count: report.hermetic.allowlisted_env_key_count,
      sanitized_pack: sanitizedPack ? sanitizedPack.pack_root : null,
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
    sanitized_pack: sanitizedPack ? sanitizedPack.pack_root : null,
    control_profile: manifest.control_profile,
    scenario_count: manifest.scenarios.length,
  }, null, 2));
}

main();
