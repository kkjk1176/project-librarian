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

module.exports = {
  medianMetrics,
  metricFields,
  passedRuns,
  selectPairedScenarios,
};
