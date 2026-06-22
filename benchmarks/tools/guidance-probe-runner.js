#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { summarizeJsonl } = require("../lib/codex-jsonl");
const {
  buildGuidancePrompt,
  defaultGuidanceProbesPath,
  evaluateGuidanceClaimGate,
  evaluateGuidanceProbe,
  loadGuidanceProbeFile,
  selectGuidanceProbes,
  summarizeGuidanceRuns,
  variantSummary,
} = require("../lib/guidance-probes");
const {
  defaultGuidanceVariantsPath,
  resolveGuidanceVariants,
  sha256,
} = require("../lib/guidance-variants");
const {
  buildIsolatedCodexHome,
  buildSpawnEnv,
  resolveRealCodexHome,
} = require("../lib/hermetic");

const root = path.resolve(__dirname, "..", "..");

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

function optionalArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return "";
  return value;
}

function listArg(name, defaultValues = []) {
  const raw = argValue(name, "");
  if (!raw) return defaultValues;
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function positiveIntegerArg(name, defaultValue) {
  const raw = argValue(name, "");
  if (!raw) return defaultValue;
  if (!/^\d+$/.test(raw)) fail(`invalid integer for ${name}: ${raw}`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail(`invalid integer for ${name}: ${raw}`);
  return parsed;
}

function numberArg(name, defaultValue) {
  const raw = argValue(name, "");
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) fail(`invalid number for ${name}: ${raw}`);
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

function defaultOutPath(mode) {
  const name = mode === "dry-run" ? "dry-run-manifest.json" : "current.json";
  return path.join(root, "benchmarks", "reports", "guidance", name);
}

function defaultMarkdownPath(mode) {
  const name = mode === "dry-run" ? "dry-run-manifest.md" : "current.md";
  return path.join(root, "benchmarks", "reports", "guidance", name);
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "");
}

function commandOutput(command, args, cwd = root) {
  return childProcess.execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sourceControlFingerprint(cwd = root) {
  try {
    const commit = commandOutput("git", ["rev-parse", "HEAD"], cwd);
    const branch = commandOutput("git", ["branch", "--show-current"], cwd);
    const status = commandOutput("git", ["status", "--short"], cwd);
    return {
      available: true,
      commit,
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

function requireMeasuredAuth(authMode) {
  if (authMode !== "api-key" && (process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY)) {
    fail("refusing subscription guidance benchmark while CODEX_API_KEY or OPENAI_API_KEY is set; pass --auth-mode api-key for API-key runs");
  }
  try {
    commandOutput("codex", ["--version"]);
  } catch (error) {
    fail(`codex command is unavailable or failed: ${error.message}`);
  }
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

function codexCommand(prompt, requestedModel) {
  const command = ["codex", "exec", "--json", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check"];
  if (requestedModel) command.push("--model", requestedModel);
  command.push(prompt);
  return command;
}

function buildScenario({ probe, variant, requestedModel }) {
  const prompt = buildGuidancePrompt({ probe, variant });
  return {
    probe_id: probe.probe_id,
    prompt_id: `${probe.probe_id}-${variant.variant_id}`,
    task_family: probe.task_family,
    track: probe.track,
    agent_surface: probe.agent_surface,
    variant_id: variant.variant_id,
    variant_digest: variant.digest.value,
    requested_model: requestedModel,
    prompt,
    prompt_digest: {
      algorithm: "sha256",
      value: sha256(prompt),
      char_count: prompt.length,
    },
    command: codexCommand(prompt, requestedModel),
    expectation: {
      expected_sources: probe.expected_sources,
      target_sources: probe.target_sources,
      route_expectations: probe.route_expectations,
      required_terms: probe.required_terms,
      coverage_terms: probe.coverage_terms,
      read_only: probe.read_only,
    },
  };
}

function runGuidanceScenario({ scenario, probe, rawRoot, runIndex, spawnEnv }) {
  const rawPath = path.join(rawRoot, `${safeName(scenario.prompt_id)}-run-${runIndex}.jsonl`);
  const stderrPath = path.join(rawRoot, `${safeName(scenario.prompt_id)}-run-${runIndex}.stderr.txt`);
  fs.mkdirSync(path.dirname(rawPath), { recursive: true });
  const command = scenario.command[0];
  const args = scenario.command.slice(1);
  const started = process.hrtime.bigint();
  const result = childProcess.spawnSync(command, args, {
    cwd: root,
    env: spawnEnv,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const wallMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  fs.writeFileSync(rawPath, result.stdout || "");
  if (result.stderr) fs.writeFileSync(stderrPath, result.stderr);
  const metrics = summarizeJsonlSafely(result.stdout || "", { wall_ms: Math.round(wallMs * 1000) / 1000 });
  const guidanceEvaluation = evaluateGuidanceProbe({ probe, metrics, finalText: metrics.final_text });
  return {
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
    guidance_evaluation: guidanceEvaluation,
    measurement: {
      status: result.error || result.status !== 0 || guidanceEvaluation.status !== "passed" ? "unclaimable" : "claimable",
      reason: result.error ? result.error.message : (guidanceEvaluation.reason || ""),
    },
  };
}

function buildReportScenarios({ selectedProbes, selectedVariants, requestedModel }) {
  const scenarios = [];
  for (const probe of selectedProbes) {
    for (const variant of selectedVariants) {
      scenarios.push(buildScenario({ probe, variant, requestedModel }));
    }
  }
  return scenarios;
}

function runMeasuredScenarios({ scenarios, probeById, runs, rawRoot, authMode, keepCodexHomes }) {
  requireMeasuredAuth(authMode);
  const homeDir = os.homedir();
  const realCodexHome = resolveRealCodexHome(process.env, homeDir);
  const codexHomes = [];
  const measured = [];
  for (const scenario of scenarios) {
    const probe = probeById.get(scenario.probe_id);
    const scenarioRuns = [];
    for (let index = 1; index <= runs; index += 1) {
      const codexHome = path.join(rawRoot, `codex-home-${safeName(scenario.prompt_id)}-run-${index}`);
      const isolation = buildIsolatedCodexHome({ realCodexHome, destHome: codexHome });
      codexHomes.push(isolation.codex_home);
      const spawnEnv = buildSpawnEnv({ sourceEnv: process.env, codexHome, authMode, homeDir });
      scenarioRuns.push(runGuidanceScenario({
        scenario,
        probe,
        rawRoot,
        runIndex: index,
        spawnEnv,
      }));
    }
    measured.push({
      ...scenario,
      runs: scenarioRuns,
      summary: summarizeGuidanceRuns(scenarioRuns),
      raw_jsonl_paths: scenarioRuns.map((run) => run.raw_jsonl_path),
    });
  }
  if (!keepCodexHomes) {
    for (const home of codexHomes) {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
  return {
    scenarios: measured,
    hermetic: {
      isolated_codex_home_count: codexHomes.length,
      kept_codex_homes: keepCodexHomes,
      inherited_process_env: false,
    },
  };
}

function dryRunScenarios(scenarios) {
  return scenarios.map((scenario) => ({
    ...scenario,
    runs: [],
    summary: null,
    command: scenario.command.slice(0, -1).concat(["<prompt omitted>"]),
  }));
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function renderMarkdownReport(report) {
  const lines = [
    "# Guidance Probe Report",
    "",
    `- Mode: ${report.mode}`,
    `- Generated: ${report.generated_at}`,
    `- Scenarios: ${report.summary.scenario_count}`,
    `- Variants: ${report.configuration.variants.join(", ")}`,
    `- Baseline: ${report.configuration.baseline_variant}`,
    `- Candidate: ${report.configuration.candidate_variant}`,
    `- Claim gate: ${report.claim_gate.status}`,
    "",
  ];
  if (report.claim_gate.issues && report.claim_gate.issues.length > 0) {
    lines.push("## Claim Gate Issues", "");
    for (const issue of report.claim_gate.issues) lines.push(`- ${issue}`);
    lines.push("");
  }
  lines.push("## Variant Summary", "");
  lines.push("| Variant | Runs | Pass Rate | Coverage | Localization | Route | Unproductive Actions |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const variant of report.summary.variant_summaries) {
    lines.push(`| ${variant.variant_id} | ${variant.run_count} | ${formatPercent(variant.pass_rate)} | ${formatPercent(variant.guidance_coverage)} | ${formatPercent(variant.localization_hit_rate)} | ${formatPercent(variant.route_compliance)} | ${formatPercent(variant.unproductive_action_rate)} |`);
  }
  lines.push("", "## Scenarios", "");
  lines.push("| Probe | Variant | Runs | Pass | Coverage | Localization | Route |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: |");
  for (const scenario of report.scenarios) {
    const summary = scenario.summary || {};
    lines.push(`| ${scenario.probe_id} | ${scenario.variant_id} | ${summary.run_count || 0} | ${summary.passed_run_count || 0} | ${formatPercent(summary.guidance_coverage || 0)} | ${formatPercent(summary.localization_hit_rate || 0)} | ${formatPercent(summary.route_compliance || 0)} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderCandidateGuidance(report) {
  const failed = [];
  for (const scenario of report.scenarios || []) {
    for (const run of scenario.runs || []) {
      if (run.guidance_evaluation?.status !== "passed") {
        failed.push({
          probe_id: scenario.probe_id,
          variant_id: scenario.variant_id,
          reason: run.guidance_evaluation?.reason || run.execution?.error || "unknown",
          failed_checks: (run.guidance_evaluation?.checks || []).filter((check) => !check.passed).map((check) => check.name),
        });
      }
    }
  }
  const lines = [
    "# Candidate Guidance Refinement",
    "",
    `Run: ${report.run_id}`,
    `Generated: ${report.generated_at}`,
    `Baseline: ${report.configuration.baseline_variant}`,
    `Candidate: ${report.configuration.candidate_variant}`,
    `Claim gate: ${report.claim_gate.status}`,
    "",
    "## Failure Signals",
    "",
  ];
  if (failed.length === 0) {
    lines.push("- No failing measured probe runs were recorded.");
  } else {
    for (const item of failed) {
      lines.push(`- ${item.probe_id} / ${item.variant_id}: ${item.reason}`);
      for (const check of item.failed_checks.slice(0, 5)) lines.push(`  - ${check}`);
    }
  }
  lines.push(
    "",
    "## Candidate Text",
    "",
    "Record only guidance changes that are supported by the failure signals above. Keep model/surface scope explicit and avoid claiming transfer to unmeasured targets.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function buildSummary({ scenarios, variants }) {
  return {
    scenario_count: scenarios.length,
    measured_scenario_count: scenarios.filter((scenario) => Array.isArray(scenario.runs) && scenario.runs.length > 0).length,
    variant_summaries: variants.map((variant) => variantSummary(scenarios, variant.variant_id)),
  };
}

function printUsage() {
  console.log(`Usage:
  node benchmarks/tools/guidance-probe-runner.js --dry-run
  node benchmarks/tools/guidance-probe-runner.js --variants current,refined_candidate --runs 3 --model gpt-5.5

Options:
  --dry-run                      Build manifest/report without launching Codex.
  --probes <path>                Probe corpus JSON. Default: benchmarks/guidance-probes/default.json
  --variant-file <path>          Variant JSON. Default: benchmarks/guidance-variants/current.json
  --variants <ids>               Comma-separated variants. Default: current,refined_candidate
  --baseline <id>                Baseline variant. Default: first selected variant
  --candidate <id>               Candidate variant. Default: second selected variant
  --probe-ids <ids>              Comma-separated probe filter.
  --task-families <ids>          Comma-separated task-family filter.
  --agent-surfaces <ids>         Comma-separated surface filter.
  --runs <n>                     Measured runs per scenario. Default: 1
  --model <id>                   Codex model request.
  --auth-mode <chatgpt_codex|api-key>
  --out <path>                   JSON report path.
  --markdown [path]              Markdown report path.
  --candidate-out <path>         Write candidate refinement artifact.
  --keep-codex-homes             Keep isolated CODEX_HOME directories for debugging.`);
}

function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage();
    return;
  }
  const mode = hasFlag("--dry-run") ? "dry-run" : "measured";
  const probesPath = path.resolve(argValue("--probes", defaultGuidanceProbesPath(root)));
  const variantsPath = path.resolve(argValue("--variant-file", defaultGuidanceVariantsPath(root)));
  const variantIds = listArg("--variants", ["current", "refined_candidate"]);
  const baselineVariant = argValue("--baseline", variantIds[0]);
  const candidateVariant = argValue("--candidate", variantIds[1] || variantIds[0]);
  const selectedProbeIds = listArg("--probe-ids", []);
  const selectedTaskFamilies = listArg("--task-families", []);
  const selectedAgentSurfaces = listArg("--agent-surfaces", []);
  const runs = positiveIntegerArg("--runs", 1);
  const requestedModel = argValue("--model", "");
  const authMode = argValue("--auth-mode", "chatgpt_codex");
  if (!["chatgpt_codex", "api-key"].includes(authMode)) fail(`invalid --auth-mode value: ${authMode}`);
  const outPath = path.resolve(argValue("--out", defaultOutPath(mode)));
  const markdownArg = optionalArgValue("--markdown");
  const markdownPath = markdownArg === null ? "" : path.resolve(markdownArg || defaultMarkdownPath(mode));
  const candidateOut = argValue("--candidate-out", "");
  const keepCodexHomes = hasFlag("--keep-codex-homes");
  const minCompletePairs = positiveIntegerArg("--min-complete-pairs", 3);
  const minCoverageDelta = numberArg("--min-coverage-delta", 0.05);
  const maxCorrectnessRegression = numberArg("--max-correctness-regression", 0.01);
  const maxActionDeltaPercent = numberArg("--max-action-delta-percent", 20);

  const probeFile = loadGuidanceProbeFile(probesPath);
  const selectedProbes = selectGuidanceProbes(probeFile.probes, {
    probeIds: selectedProbeIds,
    taskFamilies: selectedTaskFamilies,
    agentSurfaces: selectedAgentSurfaces,
  });
  if (selectedProbes.length === 0) fail("no guidance probes selected");
  const variantFile = resolveGuidanceVariants({ root, variantsPath, variantIds });
  const variants = variantFile.variants;
  const variantSet = new Set(variants.map((variant) => variant.variant_id));
  if (!variantSet.has(baselineVariant)) fail(`baseline variant not selected: ${baselineVariant}`);
  if (!variantSet.has(candidateVariant)) fail(`candidate variant not selected: ${candidateVariant}`);

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const rawRoot = path.join(root, "benchmarks", "reports", "guidance", "raw", runId);
  const baseScenarios = buildReportScenarios({ selectedProbes, selectedVariants: variants, requestedModel });
  const probeById = new Map(selectedProbes.map((probe) => [probe.probe_id, probe]));
  const measured = mode === "dry-run"
    ? { scenarios: dryRunScenarios(baseScenarios), hermetic: null }
    : runMeasuredScenarios({ scenarios: baseScenarios, probeById, runs, rawRoot, authMode, keepCodexHomes });
  const report = {
    schema_version: 1,
    kind: "project-librarian-guidance-probe-report",
    mode,
    run_id: runId,
    generated_at: new Date().toISOString(),
    source_control: sourceControlFingerprint(root),
    configuration: {
      probes_path: path.relative(root, probesPath).split(path.sep).join("/"),
      variants_path: path.relative(root, variantsPath).split(path.sep).join("/"),
      variants: variants.map((variant) => variant.variant_id),
      baseline_variant: baselineVariant,
      candidate_variant: candidateVariant,
      probe_ids: selectedProbes.map((probe) => probe.probe_id),
      runs,
      model: requestedModel || "codex-default",
      auth_mode: authMode,
      thresholds: {
        min_complete_pairs: minCompletePairs,
        min_coverage_delta: minCoverageDelta,
        max_correctness_regression: maxCorrectnessRegression,
        max_action_delta_percent: maxActionDeltaPercent,
      },
    },
    variants: variants.map(({ guidance_text, ...variant }) => variant),
    hermetic: measured.hermetic,
    scenarios: measured.scenarios,
  };
  report.summary = buildSummary({ scenarios: report.scenarios, variants });
  report.claim_gate = evaluateGuidanceClaimGate(report, {
    minCompletePairs,
    minCoverageDelta,
    maxCorrectnessRegression,
    maxActionDeltaPercent,
  });
  writeJson(outPath, report);
  if (markdownPath) writeText(markdownPath, renderMarkdownReport(report));
  if (candidateOut) writeText(path.resolve(candidateOut), renderCandidateGuidance(report));
  console.log(`wrote ${outPath}`);
  if (markdownPath) console.log(`wrote ${markdownPath}`);
  if (candidateOut) console.log(`wrote ${path.resolve(candidateOut)}`);
  if (mode !== "dry-run" && report.claim_gate.status !== "passed" && hasFlag("--require-claimable")) {
    fail(`guidance claim gate failed: ${report.claim_gate.issues.join("; ")}`);
  }
}

main();
