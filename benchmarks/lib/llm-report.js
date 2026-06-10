"use strict";

const metricFields = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
  "wall_ms",
  "first_response_ms",
  "tokens_per_second",
  "codex_turn_count",
  "jsonl_event_count",
  "command_event_count",
  "command_invocation_count",
  "tool_event_count",
  "tool_invocation_count",
  "mcp_event_count",
  "mcp_invocation_count",
  "plan_event_count",
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

function metricStats(runs) {
  const stats = {};
  for (const field of metricFields) {
    const values = runs.map((run) => run.metrics[field] || 0).filter(Number.isFinite);
    if (values.length === 0) {
      stats[field] = null;
      continue;
    }
    const med = median(values);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
    const standardDeviation = Math.sqrt(variance);
    stats[field] = {
      min,
      median: med,
      max,
      range: max - min,
      cv_percent: mean === 0 ? 0 : (standardDeviation / mean) * 100,
      sample_count: values.length,
    };
  }
  return stats;
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
      name: "execution completed",
      passed: !run.execution || run.execution.status === "completed",
    },
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

function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return "n/a";
  return Number(value.toFixed(digits)).toLocaleString("en-US");
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 2)}%`;
}

function percentDelta(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return NaN;
  return ((current - baseline) / baseline) * 100;
}

function scenarioPairKey(scenario) {
  return `${scenario.scale}\0${scenario.task_family}`;
}

function pairedScenarioGroups(scenarios) {
  const groups = new Map();
  for (const scenario of scenarios) {
    const key = scenarioPairKey(scenario);
    if (!groups.has(key)) groups.set(key, {});
    groups.get(key)[scenario.condition] = scenario;
  }
  return [...groups.entries()].map(([key, group]) => {
    const [scale, taskFamily] = key.split("\0");
    return { scale, task_family: taskFamily, ...group };
  });
}

function selectPairedScenarios(scenarios, maxScenarios, conditions) {
  const selected = [];
  const groups = new Map();
  for (const scenario of scenarios) {
    const key = scenarioPairKey(scenario);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(scenario);
  }

  let pairIndex = 0;
  for (const group of groups.values()) {
    const pair = conditions.map((condition) => group.find((scenario) => scenario.condition === condition));
    if (pair.some((scenario) => !scenario)) continue;
    if (selected.length + pair.length > maxScenarios) break;
    selected.push(...(pairIndex % 2 === 0 ? pair : [...pair].reverse()));
    pairIndex += 1;
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

function evaluateClaimGate(report, { conditions = [], expectedScales = [], expectedTasks = [], fullMatrix = false, minRunsForClaim = 1 } = {}) {
  const issues = [];
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  const expectedScenarioCount = expectedScales.length * expectedTasks.length * conditions.length;

  if (!Array.isArray(conditions) || conditions.length === 0) issues.push("missing condition set");
  if (scenarios.length === 0) issues.push("no measured scenarios");
  if (fullMatrix && scenarios.length !== expectedScenarioCount) {
    issues.push(`expected full matrix scenario count ${expectedScenarioCount}, got ${scenarios.length}`);
  }
  if (completePairCount(scenarios, conditions) * conditions.length !== scenarios.length) {
    issues.push("scenarios do not form complete with/without pairs");
  }
  if (Number.isInteger(report.summary?.comparison_pair_count) && report.summary.comparison_pair_count !== completePairCount(scenarios, conditions)) {
    issues.push("summary comparison_pair_count does not match scenarios");
  }

  const scales = new Set(scenarios.map((scenario) => scenario.scale));
  for (const scale of expectedScales) {
    if (!scales.has(scale)) issues.push(`missing expected scale: ${scale}`);
  }
  const tasks = new Set(scenarios.map((scenario) => scenario.task_family));
  for (const task of expectedTasks) {
    if (!tasks.has(task)) issues.push(`missing expected task: ${task}`);
  }

  if (report.configuration?.runs < minRunsForClaim) {
    issues.push(`runs ${report.configuration.runs} below claim minimum ${minRunsForClaim}`);
  }
  if (report.configuration?.require_clean && (!report.source_control?.available || report.source_control?.dirty)) {
    issues.push("require_clean report does not have clean source-control provenance");
  }

  for (const scenario of scenarios) {
    const runs = Array.isArray(scenario.runs) ? scenario.runs : [];
    if (runs.length === 0) {
      issues.push(`${scenario.prompt_id || "scenario"} has no measured runs`);
      continue;
    }
    if (runs.some((run) => run.execution?.status && run.execution.status !== "completed")) {
      issues.push(`${scenario.prompt_id} has execution failures`);
    }
    if (scenario.correctness?.some((item) => item.status !== "passed")) {
      issues.push(`${scenario.prompt_id} has non-passing correctness`);
    }
    if (scenario.claimable_run_count !== runs.length) {
      issues.push(`${scenario.prompt_id} has ${scenario.claimable_run_count}/${runs.length} claimable runs`);
    }
    if (!scenario.median) issues.push(`${scenario.prompt_id} has no claimable median`);
  }

  return {
    status: issues.length === 0 ? "passed" : "failed",
    issues,
    expected_scenarios: fullMatrix ? expectedScenarioCount : null,
    min_runs_for_claim: minRunsForClaim,
  };
}

function markdownCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function tableRow(values) {
  return `| ${values.map(markdownCell).join(" | ")} |`;
}

function renderLlmMarkdownReport(report) {
  const lines = [
    "# Codex Actual LLM Benchmark Report",
    "",
    `Generated: ${report.generated_at}`,
    "",
    `Auth mode: \`${report.auth_mode}\``,
    `Model: \`${report.configuration.requested_model || "not requested"}\``,
    `Runs: ${report.configuration.runs} measured, ${report.configuration.warmup_runs} warmup`,
    `Scenarios: ${report.summary.scenario_count}, complete pairs: ${report.summary.comparison_pair_count}, claimable scenarios: ${report.summary.claimable_scenario_count}`,
    "",
    "Claim boundary: values below are real Codex JSONL usage and local wall-clock measurements for claimable runs only. `model_source=requested` means the run used an explicit `--model` request because Codex JSONL did not expose a model field.",
    "",
    "## Scenario Metrics",
    "",
    `Claim gate: ${report.claim_gate?.status || "not evaluated"}`,
    "",
    "| Scale | Task | Condition | Status | Total Tokens | Input Tokens | Output Tokens | Wall Time | First Response | Output tok/s | Command Invocations | Wall CV | Model | Model Source |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
  ];

  for (const scenario of report.scenarios) {
    const median = scenario.median;
    const status = scenario.claimable_run_count > 0 ? "claimable" : "unclaimable";
    lines.push(tableRow([
      scenario.scale,
      scenario.task_family,
      scenario.condition,
      status,
      median ? formatNumber(median.total_tokens, 0) : "n/a",
      median ? formatNumber(median.input_tokens, 0) : "n/a",
      median ? formatNumber(median.output_tokens, 0) : "n/a",
      median ? `${formatNumber(median.wall_ms / 1000, 2)}s` : "n/a",
      median && median.first_response_ms > 0 ? `${formatNumber(median.first_response_ms / 1000, 2)}s` : "n/a",
      median ? formatNumber(median.tokens_per_second, 3) : "n/a",
      median ? formatNumber(median.command_invocation_count, 0) : "n/a",
      scenario.dispersion?.wall_ms ? formatPercent(scenario.dispersion.wall_ms.cv_percent) : "n/a",
      scenario.model || "n/a",
      scenario.model_source || "n/a",
    ]));
  }

  lines.push(
    "",
    "## With vs Without Delta",
    "",
    "Negative token/time deltas mean the Project Librarian condition used fewer tokens or less wall-clock time than the control condition.",
    "",
    "| Scale | Task | Token Delta | Wall-Time Delta | Command Delta | With Tokens | Without Tokens | With Time | Without Time |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );

  for (const pair of pairedScenarioGroups(report.scenarios)) {
    const withMedian = pair.with_project_librarian?.median;
    const withoutMedian = pair.without_project_librarian?.median;
    if (!withMedian || !withoutMedian) {
      lines.push(tableRow([pair.scale, pair.task_family, "n/a", "n/a", "n/a", "n/a", "n/a", "n/a", "n/a"]));
      continue;
    }
    lines.push(tableRow([
      pair.scale,
      pair.task_family,
      formatPercent(percentDelta(withMedian.total_tokens, withoutMedian.total_tokens)),
      formatPercent(percentDelta(withMedian.wall_ms, withoutMedian.wall_ms)),
      formatPercent(percentDelta(withMedian.command_invocation_count, withoutMedian.command_invocation_count)),
      formatNumber(withMedian.total_tokens, 0),
      formatNumber(withoutMedian.total_tokens, 0),
      `${formatNumber(withMedian.wall_ms / 1000, 2)}s`,
      `${formatNumber(withoutMedian.wall_ms / 1000, 2)}s`,
    ]));
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  claimableRuns,
  completePairCount,
  evaluateClaimGate,
  measurementStatus,
  medianMetrics,
  metricStats,
  metricFields,
  pairedScenarioGroups,
  passedRuns,
  renderLlmMarkdownReport,
  selectPairedScenarios,
};
