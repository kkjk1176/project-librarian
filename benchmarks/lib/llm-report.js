"use strict";

const metricFields = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
  "wall_ms",
  "tokens_per_second",
  "codex_turn_count",
  "jsonl_event_count",
  "command_event_count",
  "command_invocation_count",
  "tool_event_count",
  "tool_invocation_count",
  "mcp_event_count",
  "mcp_invocation_count",
  "file_change_event_count",
  "error_event_count",
];

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return ((sorted[middle - 1] || 0) + (sorted[middle] || 0)) / 2;
}

function medianMetrics(runs) {
  return Object.fromEntries(metricFields.map((field) => [field, median(runs.map((run) => run.metrics[field] || 0))]));
}

function passedRuns(runs) {
  return runs.filter((run) => run.correctness.status === "passed");
}

function measurementChecks(run) {
  const metrics = run.metrics || {};
  const unavailable = Array.isArray(metrics.unavailable_event_fields) ? metrics.unavailable_event_fields : [];
  const models = Array.isArray(metrics.models) ? metrics.models : [];
  const requestedModel = typeof run.requested_model === "string" ? run.requested_model : "";
  const hasObservedModel = !unavailable.includes("model") && models.length > 0;
  const hasSingleObservedModel = !unavailable.includes("single_model") && models.length === 1 && metrics.model === models[0];
  const hasRequestedModel = requestedModel.length > 0;
  return [
    {
      name: "correctness passed",
      passed: run.correctness?.status === "passed",
    },
    {
      name: "usage available",
      passed: !unavailable.includes("usage") && metrics.codex_turn_count > 0,
    },
    {
      name: "input tokens positive",
      passed: metrics.input_tokens > 0,
    },
    {
      name: "output tokens positive",
      passed: metrics.output_tokens > 0,
    },
    {
      name: "total tokens positive",
      passed: metrics.total_tokens > 0,
    },
    {
      name: "wall time positive",
      passed: metrics.wall_ms > 0,
    },
    {
      name: "model available",
      passed: hasObservedModel || hasRequestedModel,
    },
    {
      name: "single model available",
      passed: hasSingleObservedModel || (hasRequestedModel && models.length === 0),
    },
    {
      name: "final text available",
      passed: !unavailable.includes("final_text") && typeof metrics.final_text === "string" && metrics.final_text.length > 0,
    },
  ];
}

function measurementStatus(run) {
  const checks = measurementChecks(run);
  const failed = checks.filter((check) => !check.passed);
  return {
    status: failed.length === 0 ? "claimable" : "unclaimable",
    reason: failed.map((check) => check.name).join("; "),
    checks,
  };
}

function claimableRuns(runs) {
  return runs.filter((run) => measurementStatus(run).status === "claimable");
}

function scenarioPairKey(scenario) {
  return `${scenario.scale}\0${scenario.task_family}`;
}

function selectPairedScenarios(scenarios, maxScenarios, conditions) {
  const selected = [];
  const groups = new Map();
  for (const scenario of scenarios) {
    const key = scenarioPairKey(scenario);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(scenario);
  }

  for (const group of groups.values()) {
    const pair = conditions.map((condition) => group.find((scenario) => scenario.condition === condition));
    if (pair.some((scenario) => !scenario)) continue;
    if (selected.length + pair.length > maxScenarios) break;
    selected.push(...pair);
  }
  return selected;
}

function completePairCount(scenarios, conditions) {
  const groups = new Map();
  for (const scenario of scenarios) {
    const key = scenarioPairKey(scenario);
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(scenario.condition);
  }
  return [...groups.values()].filter((groupConditions) => conditions.every((condition) => groupConditions.has(condition))).length;
}

module.exports = {
  claimableRuns,
  completePairCount,
  measurementStatus,
  medianMetrics,
  metricFields,
  passedRuns,
  selectPairedScenarios,
};
