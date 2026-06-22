"use strict";

const fs = require("node:fs");
const path = require("node:path");

function includesInsensitive(text, term) {
  return text.toLowerCase().includes(String(term).toLowerCase());
}

function toStringArray(value, field, { allowEmpty = true } = {}) {
  if (value === undefined && allowEmpty) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const result = value.map((item) => {
    if (typeof item !== "string" || !item.trim()) throw new Error(`${field} must contain non-empty strings`);
    return item.trim();
  });
  if (!allowEmpty && result.length === 0) throw new Error(`${field} must not be empty`);
  return result;
}

function normalizeProbe(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("guidance probe must be an object");
  if (!raw.probe_id || typeof raw.probe_id !== "string") throw new Error("guidance probe requires probe_id");
  if (!/^[a-z0-9_.-]+$/.test(raw.probe_id)) throw new Error(`invalid guidance probe_id: ${raw.probe_id}`);
  if (!raw.prompt || typeof raw.prompt !== "string" || !raw.prompt.trim()) {
    throw new Error(`guidance probe ${raw.probe_id} requires prompt`);
  }
  const readOnly = raw.read_only !== false;
  return {
    probe_id: raw.probe_id,
    track: typeof raw.track === "string" && raw.track.trim() ? raw.track.trim() : "wiki",
    agent_surface: typeof raw.agent_surface === "string" && raw.agent_surface.trim() ? raw.agent_surface.trim() : "codex",
    task_family: typeof raw.task_family === "string" && raw.task_family.trim() ? raw.task_family.trim() : raw.probe_id,
    prompt: raw.prompt.trim(),
    required_terms: toStringArray(raw.required_terms, `${raw.probe_id}.required_terms`),
    any_terms: Array.isArray(raw.any_terms)
      ? raw.any_terms.map((group) => toStringArray(group, `${raw.probe_id}.any_terms group`, { allowEmpty: false }))
      : [],
    forbidden_terms: toStringArray(raw.forbidden_terms, `${raw.probe_id}.forbidden_terms`),
    expected_sources: toStringArray(raw.expected_sources, `${raw.probe_id}.expected_sources`),
    target_sources: toStringArray(raw.target_sources, `${raw.probe_id}.target_sources`),
    route_expectations: toStringArray(raw.route_expectations, `${raw.probe_id}.route_expectations`),
    coverage_terms: toStringArray(raw.coverage_terms, `${raw.probe_id}.coverage_terms`),
    read_only: readOnly,
    max_action_invocations: Number.isSafeInteger(raw.max_action_invocations) ? raw.max_action_invocations : null,
  };
}

function loadGuidanceProbeFile(filePath) {
  const absolute = path.resolve(filePath);
  const raw = JSON.parse(fs.readFileSync(absolute, "utf8"));
  if (!raw || typeof raw !== "object") throw new Error(`invalid guidance probe file: ${absolute}`);
  if (raw.schema_version !== 1) throw new Error(`unsupported guidance probe schema_version in ${absolute}: ${raw.schema_version}`);
  if (!Array.isArray(raw.probes) || raw.probes.length === 0) throw new Error(`guidance probe file has no probes: ${absolute}`);
  const probes = raw.probes.map(normalizeProbe);
  const seen = new Set();
  for (const probe of probes) {
    if (seen.has(probe.probe_id)) throw new Error(`duplicate guidance probe_id: ${probe.probe_id}`);
    seen.add(probe.probe_id);
  }
  return {
    schema_version: raw.schema_version,
    path: absolute,
    probes,
  };
}

function listArgSet(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return new Set(values.map(String));
}

function selectGuidanceProbes(probes, { probeIds = [], taskFamilies = [], agentSurfaces = [] } = {}) {
  const ids = listArgSet(probeIds);
  const families = listArgSet(taskFamilies);
  const surfaces = listArgSet(agentSurfaces);
  const selected = probes.filter((probe) => {
    if (ids && !ids.has(probe.probe_id)) return false;
    if (families && !families.has(probe.task_family)) return false;
    if (surfaces && !surfaces.has(probe.agent_surface)) return false;
    return true;
  });
  if (ids) {
    const found = new Set(selected.map((probe) => probe.probe_id));
    for (const id of ids) {
      if (!found.has(id)) throw new Error(`unknown guidance probe: ${id}`);
    }
  }
  return selected;
}

function buildGuidancePrompt({ probe, variant }) {
  return [
    "You are running a Project Librarian guidance probe.",
    "Use the guidance excerpt as the project-specific startup and routing contract.",
    "Answer the task concisely, cite the local files you used, and do not modify files.",
    "",
    "## Guidance Variant",
    `Variant: ${variant.variant_id}`,
    `Digest: ${variant.digest.value}`,
    "",
    "## Guidance Excerpt",
    variant.guidance_text.trimEnd(),
    "",
    "## Probe Task",
    probe.prompt,
    "",
  ].join("\n");
}

function countHits(text, terms) {
  return terms.filter((term) => includesInsensitive(text, term)).length;
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

function evaluateGuidanceProbe({ probe, metrics = {}, finalText = "" }) {
  const text = finalText || metrics.final_text || "";
  const checks = [];
  for (const term of probe.required_terms) {
    checks.push({ name: `required term: ${term}`, passed: includesInsensitive(text, term) });
  }
  for (const terms of probe.any_terms) {
    checks.push({ name: `any term: ${terms.join(" | ")}`, passed: terms.some((term) => includesInsensitive(text, term)) });
  }
  for (const term of probe.forbidden_terms) {
    checks.push({ name: `forbidden term absent: ${term}`, passed: !includesInsensitive(text, term) });
  }
  for (const source of probe.expected_sources) {
    checks.push({ name: `expected source: ${source}`, passed: includesInsensitive(text, source) });
  }
  for (const source of probe.route_expectations) {
    checks.push({ name: `route expectation: ${source}`, passed: includesInsensitive(text, source) });
  }
  if (probe.read_only) {
    checks.push({
      name: "read-only zero file changes",
      passed: (Number(metrics.file_change_event_count) || 0) === 0,
    });
  }
  if (Number.isSafeInteger(probe.max_action_invocations)) {
    const actionInvocations = (Number(metrics.command_invocation_count) || 0) + (Number(metrics.tool_invocation_count) || 0) + (Number(metrics.mcp_invocation_count) || 0);
    checks.push({
      name: `action invocations <= ${probe.max_action_invocations}`,
      passed: actionInvocations <= probe.max_action_invocations,
    });
  }

  const expectedSourceHits = countHits(text, probe.expected_sources);
  const targetSources = probe.target_sources.length > 0 ? probe.target_sources : probe.expected_sources;
  const targetSourceHits = countHits(text, targetSources);
  const routeHits = countHits(text, probe.route_expectations);
  const coverageTerms = [
    ...probe.required_terms,
    ...probe.coverage_terms,
    ...probe.expected_sources,
  ];
  const coverageHits = countHits(text, coverageTerms);
  const coverageDenominator = coverageTerms.length;
  const actionInvocations = (Number(metrics.command_invocation_count) || 0) + (Number(metrics.tool_invocation_count) || 0) + (Number(metrics.mcp_invocation_count) || 0);
  const finalTextMissing = text.trim().length === 0;
  const sourceMiss = probe.expected_sources.length > 0 && expectedSourceHits === 0;
  const forbiddenHit = probe.forbidden_terms.some((term) => includesInsensitive(text, term));
  const stallSignal = finalTextMissing || sourceMiss || forbiddenHit;
  const unproductiveActionCount = stallSignal ? actionInvocations : 0;

  const failed = checks.filter((check) => !check.passed);
  return {
    status: failed.length === 0 ? "passed" : "failed",
    reason: failed.length === 0 ? "" : `${failed.length} guidance checks failed`,
    checks,
    metrics: {
      expected_source_hit_rate: ratio(expectedSourceHits, probe.expected_sources.length),
      localization_hit_rate: ratio(targetSourceHits, targetSources.length),
      route_compliance: probe.route_expectations.length === 0 ? 1 : ratio(routeHits, probe.route_expectations.length),
      guidance_coverage: ratio(coverageHits, coverageDenominator),
      action_invocation_count: actionInvocations,
      unproductive_action_rate: ratio(unproductiveActionCount, actionInvocations),
      stall_signal: stallSignal,
      read_only_file_change_count: Number(metrics.file_change_event_count) || 0,
    },
  };
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return 0;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function summarizeGuidanceRuns(runs) {
  const evaluations = runs.map((run) => run.guidance_evaluation).filter(Boolean);
  return {
    run_count: runs.length,
    passed_run_count: evaluations.filter((evaluation) => evaluation.status === "passed").length,
    guidance_coverage: mean(evaluations.map((evaluation) => evaluation.metrics.guidance_coverage)),
    localization_hit_rate: mean(evaluations.map((evaluation) => evaluation.metrics.localization_hit_rate)),
    route_compliance: mean(evaluations.map((evaluation) => evaluation.metrics.route_compliance)),
    unproductive_action_rate: mean(evaluations.map((evaluation) => evaluation.metrics.unproductive_action_rate)),
    read_only_file_change_count: evaluations.reduce((sum, evaluation) => sum + evaluation.metrics.read_only_file_change_count, 0),
    action_invocation_count: mean(evaluations.map((evaluation) => evaluation.metrics.action_invocation_count)),
  };
}

function variantSummary(scenarios, variantId) {
  const selected = scenarios.filter((scenario) => scenario.variant_id === variantId);
  const summaries = selected.map((scenario) => scenario.summary).filter(Boolean);
  return {
    variant_id: variantId,
    scenario_count: selected.length,
    run_count: summaries.reduce((sum, summary) => sum + summary.run_count, 0),
    pass_rate: ratio(summaries.reduce((sum, summary) => sum + summary.passed_run_count, 0), summaries.reduce((sum, summary) => sum + summary.run_count, 0)),
    guidance_coverage: mean(summaries.map((summary) => summary.guidance_coverage)),
    localization_hit_rate: mean(summaries.map((summary) => summary.localization_hit_rate)),
    route_compliance: mean(summaries.map((summary) => summary.route_compliance)),
    unproductive_action_rate: mean(summaries.map((summary) => summary.unproductive_action_rate)),
    read_only_file_change_count: summaries.reduce((sum, summary) => sum + summary.read_only_file_change_count, 0),
    action_invocation_count: mean(summaries.map((summary) => summary.action_invocation_count)),
  };
}

function completeVariantProbePairCount(scenarios, baselineVariant, candidateVariant) {
  const byProbe = new Map();
  for (const scenario of scenarios) {
    if (!byProbe.has(scenario.probe_id)) byProbe.set(scenario.probe_id, new Set());
    byProbe.get(scenario.probe_id).add(scenario.variant_id);
  }
  return [...byProbe.values()].filter((variants) => variants.has(baselineVariant) && variants.has(candidateVariant)).length;
}

function percentDelta(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return NaN;
  return ((current - baseline) / baseline) * 100;
}

function evaluateGuidanceClaimGate(report, { minCompletePairs = 3, minCoverageDelta = 0.05, maxCorrectnessRegression = 0.01, maxActionDeltaPercent = 20 } = {}) {
  if (report.mode === "dry-run") {
    return {
      status: "dry_run",
      issues: [],
      complete_pair_count: completeVariantProbePairCount(report.scenarios || [], report.configuration?.baseline_variant, report.configuration?.candidate_variant),
    };
  }
  const scenarios = report.scenarios || [];
  const baselineVariant = report.configuration?.baseline_variant;
  const candidateVariant = report.configuration?.candidate_variant;
  const issues = [];
  if (!baselineVariant || !candidateVariant) issues.push("baseline_variant and candidate_variant are required");
  const completePairs = completeVariantProbePairCount(scenarios, baselineVariant, candidateVariant);
  if (completePairs < minCompletePairs) issues.push(`complete probe pairs ${completePairs} below minimum ${minCompletePairs}`);
  const baseline = variantSummary(scenarios, baselineVariant);
  const candidate = variantSummary(scenarios, candidateVariant);
  if (baseline.run_count === 0) issues.push(`baseline variant has no runs: ${baselineVariant}`);
  if (candidate.run_count === 0) issues.push(`candidate variant has no runs: ${candidateVariant}`);
  if (candidate.pass_rate < baseline.pass_rate - maxCorrectnessRegression) {
    issues.push(`candidate pass rate regressed by more than ${maxCorrectnessRegression * 100}pp`);
  }
  const coverageDelta = candidate.guidance_coverage - baseline.guidance_coverage;
  if (coverageDelta < minCoverageDelta) {
    issues.push(`candidate guidance coverage delta ${coverageDelta.toFixed(4)} below minimum ${minCoverageDelta}`);
  }
  const actionDelta = percentDelta(candidate.action_invocation_count, baseline.action_invocation_count);
  if (Number.isFinite(actionDelta) && actionDelta > maxActionDeltaPercent) {
    issues.push(`candidate action invocation delta ${actionDelta.toFixed(2)}% above maximum ${maxActionDeltaPercent}%`);
  }
  if (candidate.read_only_file_change_count !== 0 || baseline.read_only_file_change_count !== 0) {
    issues.push("read-only probes recorded file changes");
  }
  return {
    status: issues.length === 0 ? "passed" : "failed",
    issues,
    complete_pair_count: completePairs,
    baseline,
    candidate,
    thresholds: {
      min_complete_pairs: minCompletePairs,
      min_coverage_delta: minCoverageDelta,
      max_correctness_regression: maxCorrectnessRegression,
      max_action_delta_percent: maxActionDeltaPercent,
    },
  };
}

function defaultGuidanceProbesPath(root) {
  return path.join(root, "benchmarks", "guidance-probes", "default.json");
}

module.exports = {
  buildGuidancePrompt,
  defaultGuidanceProbesPath,
  evaluateGuidanceClaimGate,
  evaluateGuidanceProbe,
  loadGuidanceProbeFile,
  selectGuidanceProbes,
  summarizeGuidanceRuns,
  variantSummary,
};
