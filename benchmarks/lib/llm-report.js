"use strict";

const DEFAULT_CACHE_DISCOUNT = 0.1;

const metricFields = [
  "input_tokens",
  "cached_input_tokens",
  "uncached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
  "tool_output_bytes",
  "request_count_estimate",
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
  const hasObservedModel = !unavailable.includes("model") && models.length > 0;
  const hasSingleObservedModel = !unavailable.includes("single_model") && models.length === 1 && metrics.model === models[0];

  // multi_session: ALL sessions must have completed execution, available usage,
  // and a non-empty final text. A familiarization-session failure (session 1 down,
  // session 2 healthy) still voids claimability. The reason names the offending
  // session index so diagnostics are actionable.
  let allSessionsCompleted = { passed: true, reason: "" };
  if (Array.isArray(run.session_metrics) && run.session_metrics.length > 0) {
    for (const session of run.session_metrics) {
      const sessionIdx = session.session_index;
      const sExec = session.execution || {};
      const sMetrics = session.metrics || {};
      const sUnavail = Array.isArray(sMetrics.unavailable_event_fields) ? sMetrics.unavailable_event_fields : [];
      if (sExec.status !== "completed") {
        allSessionsCompleted = { passed: false, reason: `session ${sessionIdx} execution not completed` };
        break;
      }
      if (sUnavail.includes("usage") || !(sMetrics.codex_turn_count > 0)) {
        allSessionsCompleted = { passed: false, reason: `session ${sessionIdx} usage unavailable` };
        break;
      }
      if (sUnavail.includes("final_text") || typeof sMetrics.final_text !== "string" || sMetrics.final_text.length === 0) {
        allSessionsCompleted = { passed: false, reason: `session ${sessionIdx} final text empty` };
        break;
      }
    }
  }

  return [
    {
      name: "execution completed",
      passed: !run.execution || run.execution.status === "completed",
    },
    {
      name: "all sessions completed",
      passed: allSessionsCompleted.passed,
      reason: allSessionsCompleted.reason,
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
      name: "observed JSONL model available",
      passed: hasObservedModel,
    },
    {
      name: "single observed JSONL model available",
      passed: hasSingleObservedModel,
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
    // For checks that carry a sub-reason (e.g. "all sessions completed" names the
    // offending session index), use that sub-reason in preference to the check name
    // so the top-level reason string is actionable.
    reason: failed.map((check) => (check.reason ? check.reason : check.name)).join("; "),
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

// Cost-weighted tokens (A4): uncached input is paid at full weight, cached input
// at the configurable cache discount (default 0.1 — cached resends must not count
// at full weight), and output plus reasoning output at full weight. This is the
// per-track HEADLINE metric; merged total_tokens (which counts cached resends at
// full weight and penalizes turn-adding tools) is demoted to a secondary row.
// Derived from the claimable median's component fields with the report-level
// discount, never stored on a run, so it cannot drift from its inputs.
function costWeightedTokens(metrics, cacheDiscount) {
  if (!metrics) return NaN;
  const uncached = Number(metrics.uncached_input_tokens) || 0;
  const cached = Number(metrics.cached_input_tokens) || 0;
  const output = Number(metrics.output_tokens) || 0;
  const reasoning = Number(metrics.reasoning_output_tokens) || 0;
  return uncached + (cacheDiscount * cached) + output + reasoning;
}

function resolveCacheDiscount(report) {
  const fromConfig = report?.configuration?.cache_discount;
  if (Number.isFinite(fromConfig)) return fromConfig;
  const top = report?.cache_discount;
  if (Number.isFinite(top)) return top;
  return DEFAULT_CACHE_DISCOUNT;
}

function benchmarkTrackOf(scenario) {
  return typeof scenario.benchmark_track === "string" && scenario.benchmark_track ? scenario.benchmark_track : "wiki";
}

// Corpus dimension (real-repository track). A scenario without an explicit corpus
// defaults to "synthetic" so every existing synthetic scenario and report stays on
// the synthetic corpus exactly as before. Real-corpus scenarios carry corpus:
// "real" and are aggregated/rendered SEPARATELY within their track (per the
// decision-log discipline: never merge real and synthetic into one number).
function corpusOf(scenario) {
  return typeof scenario.corpus === "string" && scenario.corpus ? scenario.corpus : "synthetic";
}

function corporaPresent(scenarios) {
  const order = ["synthetic", "real"];
  const seen = new Set(scenarios.map(corpusOf));
  const ordered = order.filter((corpus) => seen.has(corpus));
  for (const corpus of seen) {
    if (!ordered.includes(corpus)) ordered.push(corpus);
  }
  return ordered;
}

function scenariosForCorpus(scenarios, corpus) {
  return scenarios.filter((scenario) => corpusOf(scenario) === corpus);
}

function tracksPresent(scenarios) {
  const order = ["wiki", "code_graph"];
  const seen = new Set(scenarios.map(benchmarkTrackOf));
  const ordered = order.filter((track) => seen.has(track));
  for (const track of seen) {
    if (!ordered.includes(track)) ordered.push(track);
  }
  return ordered;
}

function scenariosForTrack(scenarios, track) {
  return scenarios.filter((scenario) => benchmarkTrackOf(scenario) === track);
}

function scenariosForTrackCorpus(scenarios, track, corpus) {
  return scenarios.filter((scenario) => benchmarkTrackOf(scenario) === track && corpusOf(scenario) === corpus);
}

// Real-corpus scenarios share scale "real" and may share task_family across
// multiple questions for the same repo, so the scale+task_family key used for
// synthetic scenarios is not unique enough. For real-corpus scenarios, include
// repo and question_id so each question forms its own distinct pair group.
// Synthetic scenarios have no question_id and continue to use the original key.
function scenarioPairKey(scenario) {
  if (scenario.repo && scenario.question_id) {
    return `${scenario.scale}\0${scenario.task_family}\0${scenario.repo}\0${scenario.question_id}`;
  }
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

function evaluateClaimGate(report, { conditions = [], expectedScales = [], expectedTasks = [], fullMatrix = false, minRunsForClaim = 1, scenarios: scenariosOverride = null, comparisonPairCount = null, expectedRealCoverage = [] } = {}) {
  const issues = [];
  const scenarios = Array.isArray(scenariosOverride) ? scenariosOverride : (Array.isArray(report.scenarios) ? report.scenarios : []);
  const expectedScenarioCount = expectedScales.length * expectedTasks.length * conditions.length;

  if (!Array.isArray(conditions) || conditions.length === 0) issues.push("missing condition set");
  if (scenarios.length === 0) issues.push("no measured scenarios");
  if (fullMatrix && scenarios.length !== expectedScenarioCount) {
    issues.push(`expected full matrix scenario count ${expectedScenarioCount}, got ${scenarios.length}`);
  }
  if (completePairCount(scenarios, conditions) * conditions.length !== scenarios.length) {
    issues.push("scenarios do not form complete with/without pairs");
  }
  // When a per-track comparison pair count is supplied, validate it against this
  // scenario subset; otherwise validate the report-level summary count.
  const expectedPairCount = Number.isInteger(comparisonPairCount) ? comparisonPairCount : report.summary?.comparison_pair_count;
  if (Number.isInteger(expectedPairCount) && expectedPairCount !== completePairCount(scenarios, conditions)) {
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

  // Real-corpus coverage completeness: every repo×question_id pair from the full
  // manifest must be present in the measured scenarios. Missing pairs are listed by
  // name so a partial run (e.g. due to an explicit --max-scenarios cap) never passes
  // the gate. This mirrors the synthetic "missing expected scale/task" issues.
  if (Array.isArray(expectedRealCoverage) && expectedRealCoverage.length > 0) {
    const measuredPairs = new Set(
      scenarios.filter((s) => s.repo && s.question_id).map((s) => `${s.repo}\0${s.question_id}`),
    );
    for (const { repo, question_id } of expectedRealCoverage) {
      if (!measuredPairs.has(`${repo}\0${question_id}`)) {
        issues.push(`missing real-corpus pair: ${repo}/${question_id}`);
      }
    }
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

// Per-track claim gates plus the overall gate. The overall gate passes only if
// every present track passes; a win on one track never substitutes for a claim
// on another (canonical Measurement Rules). expectedTasksByTrack maps each track
// to the task families expected for that track within the selected matrix.
//
// Corpus separation: within each track, the gate is evaluated PER CORPUS
// (synthetic vs real) and the track passes only if every present corpus in it
// passes. This keeps real-corpus claims from ever merging with synthetic ones — a
// real-corpus failure cannot be masked by a synthetic pass in the same track, and
// vice versa. When a track has only the synthetic corpus (every pre-real-corpus
// report), per_corpus has a single "synthetic" entry whose gate equals the track
// gate, so existing reports are unchanged. expectedScales/expectedTasks gates are
// applied to the synthetic corpus only (the real corpus has its own repo/question
// coverage enforced by expectedRealCoverage).
//
// expectedRealCoverage: array of { repo, question_id, benchmark_track } derived
// from the full manifest (before any --max-scenarios cap). Every expected
// repo×question_id pair that is absent from the measured scenarios produces a
// named issue ("missing real-corpus pair: <repo>/<question_id>") so a partial run
// can never present as gate-passed for claims. Defaults to [] (no real-corpus
// coverage check) for backward-compat with synthetic-only reports.
function evaluateTracksClaimGate(report, { conditions = [], expectedScales = [], expectedTasksByTrack = {}, fullMatrix = false, minRunsForClaim = 1, expectedRealCoverage = [] } = {}) {
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  const present = tracksPresent(scenarios);
  const perTrack = {};
  for (const track of present) {
    const trackScenarios = scenariosForTrack(scenarios, track);
    const corpora = corporaPresent(trackScenarios);
    const perCorpus = {};
    for (const corpus of corpora) {
      const corpusScenarios = scenariosForTrackCorpus(scenarios, track, corpus);
      // The synthetic corpus is gated against the configured scale×task matrix; the
      // real corpus is gated against expectedRealCoverage (every repo×question_id
      // that the full manifest contained must be present in the measured scenarios).
      const isSynthetic = corpus === "synthetic";
      // Filter expectedRealCoverage to this track only.
      const trackExpectedCoverage = isSynthetic
        ? []
        : expectedRealCoverage.filter((entry) => entry.benchmark_track === track);
      perCorpus[corpus] = evaluateClaimGate(report, {
        conditions,
        expectedScales: isSynthetic ? expectedScales : [],
        expectedTasks: isSynthetic ? (expectedTasksByTrack[track] || []) : [],
        fullMatrix: isSynthetic ? fullMatrix : false,
        minRunsForClaim,
        scenarios: corpusScenarios,
        comparisonPairCount: completePairCount(corpusScenarios, conditions),
        expectedRealCoverage: trackExpectedCoverage,
      });
    }
    const failedCorpora = corpora.filter((corpus) => perCorpus[corpus].status !== "passed");
    const trackIssues = failedCorpora.map((corpus) => `track ${track} ${corpus} corpus claim gate failed`);
    perTrack[track] = {
      status: corpora.length > 0 && failedCorpora.length === 0 ? "passed" : "failed",
      issues: trackIssues,
      corpora_present: corpora,
      per_corpus: perCorpus,
      min_runs_for_claim: minRunsForClaim,
    };
  }
  const failedTracks = present.filter((track) => perTrack[track].status !== "passed");
  const issues = [];
  if (present.length === 0) issues.push("no benchmark tracks present");
  for (const track of failedTracks) issues.push(`track ${track} claim gate failed`);
  return {
    status: present.length > 0 && failedTracks.length === 0 ? "passed" : "failed",
    issues,
    tracks_present: present,
    per_track: perTrack,
    min_runs_for_claim: minRunsForClaim,
  };
}

function markdownCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function tableRow(values) {
  return `| ${values.map(markdownCell).join(" | ")} |`;
}

const trackTitles = {
  wiki: "Wiki Track",
  code_graph: "Code Graph Track",
};

function trackTitle(track) {
  return trackTitles[track] || `${track} Track`;
}

function scenarioMetricsRows(scenarios, cacheDiscount) {
  return scenarios.map((scenario) => {
    const median = scenario.median;
    const status = scenario.claimable_run_count > 0 ? "claimable" : "unclaimable";
    const observedModels = Array.isArray(scenario.models) && scenario.models.length > 0
      ? scenario.models.join(", ")
      : "none";
    const runCount = Array.isArray(scenario.runs) ? scenario.runs.length : 0;
    return tableRow([
      scenario.scale,
      scenario.task_family,
      scenario.condition,
      status,
      `${scenario.claimable_run_count ?? 0}/${runCount}`,
      median ? formatNumber(costWeightedTokens(median, cacheDiscount), 0) : "n/a",
      median ? formatNumber(median.uncached_input_tokens, 0) : "n/a",
      median ? formatNumber(median.cached_input_tokens, 0) : "n/a",
      median ? formatNumber(median.tool_output_bytes, 0) : "n/a",
      median ? formatNumber(median.output_tokens, 0) : "n/a",
      median ? `${formatNumber(median.wall_ms / 1000, 2)}s` : "n/a",
      median ? formatNumber(median.command_invocation_count, 0) : "n/a",
      scenario.model_source || "n/a",
      observedModels,
      scenario.model || "n/a",
      median ? formatNumber(median.total_tokens, 0) : "n/a",
    ]);
  });
}

function modelProvenanceRows(scenarios) {
  return scenarios.map((scenario) => {
    const observedModels = Array.isArray(scenario.models) && scenario.models.length > 0
      ? scenario.models.join(", ")
      : "none";
    const runCount = Array.isArray(scenario.runs) ? scenario.runs.length : 0;
    const releaseEvidence = scenario.model_source === "jsonl" ? "eligible" : "diagnostic-only";
    return tableRow([
      scenario.prompt_id || `${scenario.scale}/${scenario.task_family}/${scenario.condition}`,
      benchmarkTrackOf(scenario),
      corpusOf(scenario),
      scenario.condition,
      scenario.model_source || "n/a",
      observedModels,
      `${scenario.claimable_run_count ?? 0}/${runCount}`,
      releaseEvidence,
    ]);
  });
}

// Cache-split delta table rows (A4): the cost-weighted delta is the HEADLINE
// (leftmost) column, followed by the decomposed cache-split fields (uncached input,
// cached input, tool-output bytes). Merged total_tokens is NOT in this table; it is
// rendered separately and labeled secondary so it never reads as a headline.
function cacheSplitDeltaRows(scenarios, cacheDiscount) {
  return pairedScenarioGroups(scenarios).map((pair) => {
    const withMedian = pair.with_project_librarian?.median;
    const withoutMedian = pair.without_project_librarian?.median;
    if (!withMedian || !withoutMedian) {
      return tableRow([pair.scale, pair.task_family, "n/a", "n/a", "n/a", "n/a", "n/a", "n/a"]);
    }
    const withCost = costWeightedTokens(withMedian, cacheDiscount);
    const withoutCost = costWeightedTokens(withoutMedian, cacheDiscount);
    return tableRow([
      pair.scale,
      pair.task_family,
      formatPercent(percentDelta(withCost, withoutCost)),
      formatNumber(withCost, 0),
      formatNumber(withoutCost, 0),
      formatPercent(percentDelta(withMedian.uncached_input_tokens, withoutMedian.uncached_input_tokens)),
      formatPercent(percentDelta(withMedian.cached_input_tokens, withoutMedian.cached_input_tokens)),
      formatPercent(percentDelta(withMedian.tool_output_bytes, withoutMedian.tool_output_bytes)),
    ]);
  });
}

// Secondary merged-total delta rows. Merged total_tokens is retained for audit but
// demoted: it counts cached resends at full weight and penalizes turn-adding tools,
// so it is never a headline (canonical Measurement Rules / decision A4).
function secondaryMergedDeltaRows(scenarios) {
  return pairedScenarioGroups(scenarios).map((pair) => {
    const withMedian = pair.with_project_librarian?.median;
    const withoutMedian = pair.without_project_librarian?.median;
    if (!withMedian || !withoutMedian) {
      return tableRow([pair.scale, pair.task_family, "n/a", "n/a", "n/a", "n/a", "n/a"]);
    }
    return tableRow([
      pair.scale,
      pair.task_family,
      formatPercent(percentDelta(withMedian.total_tokens, withoutMedian.total_tokens)),
      formatNumber(withMedian.total_tokens, 0),
      formatNumber(withoutMedian.total_tokens, 0),
      formatPercent(percentDelta(withMedian.wall_ms, withoutMedian.wall_ms)),
      formatPercent(percentDelta(withMedian.command_invocation_count, withoutMedian.command_invocation_count)),
    ]);
  });
}

const corpusTitles = {
  synthetic: "Synthetic Corpus",
  real: "Real Corpus",
};

function corpusTitle(corpus) {
  return corpusTitles[corpus] || `${corpus} Corpus`;
}

// Render a single (track, corpus) subsection: the scenario metrics, the
// cost-weighted headline delta, and the secondary merged-total table for exactly
// that corpus. Real and synthetic corpora are rendered as SEPARATE subsections
// under the track heading, each with its own claim-gate line, so a real-corpus
// number never appears merged with a synthetic one.
function renderTrackCorpusSubsection(report, track, corpus, cacheDiscount) {
  const scenarios = scenariosForTrackCorpus(report.scenarios, track, corpus);
  const corpusGate = report.claim_gate?.per_track?.[track]?.per_corpus?.[corpus]?.status
    || report.tracks?.[track]?.corpora?.[corpus]?.claim_gate?.status
    || "not evaluated";
  const heading = `${trackTitle(track)} — ${corpusTitle(corpus)}`;
  return [
    `### ${heading}`,
    "",
    `Scenarios: ${scenarios.length}, complete pairs: ${completePairCount(scenarios, conditionsForReport(report))}`,
    "",
    `Corpus claim gate: ${corpusGate}`,
    "",
    `#### ${heading} Scenario Metrics`,
    "",
    "| Scale | Task | Condition | Status | Claimable Runs | Cost-Weighted Tokens | Uncached Input | Cached Input | Tool Output Bytes | Output Tokens | Wall Time | Command Invocations | Model Source | Observed Models | Model | Total Tokens (secondary) |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |",
    ...scenarioMetricsRows(scenarios, cacheDiscount),
    "",
    `#### ${heading} With vs Without Delta (headline: cost-weighted)`,
    "",
    `Headline metric: cost-weighted tokens (uncached input + ${formatNumber(cacheDiscount, 3)} x cached input + output + reasoning output). Negative deltas mean the Project Librarian condition cost fewer cost-weighted tokens than the control. Cache-split fields decompose the cost.`,
    "",
    "| Scale | Task | Cost-Weighted Delta | With Cost-Weighted | Without Cost-Weighted | Uncached Input Delta | Cached Input Delta | Tool Output Bytes Delta |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...cacheSplitDeltaRows(scenarios, cacheDiscount),
    "",
    `#### ${heading} Merged Total Tokens (secondary, not a headline)`,
    "",
    "Secondary only: merged total tokens counts cached resends at full weight and penalizes turn-adding tools, so it is not a headline. Use the cost-weighted delta above for claims.",
    "",
    "| Scale | Task | Total Tokens Delta | With Total | Without Total | Wall-Time Delta | Command Delta |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...secondaryMergedDeltaRows(scenarios),
  ];
}

function conditionsForReport(report) {
  return Array.isArray(report.conditions) && report.conditions.length > 0
    ? report.conditions
    : ["with_project_librarian", "without_project_librarian"];
}

function renderTrackSection(report, track, cacheDiscount) {
  const scenarios = scenariosForTrack(report.scenarios, track);
  const trackReport = report.tracks?.[track];
  const trackGate = trackReport?.claim_gate?.status || report.claim_gate?.per_track?.[track]?.status || "not evaluated";
  const summary = trackReport?.summary;
  const corpora = corporaPresent(scenarios);
  const lines = [
    `## ${trackTitle(track)}`,
    "",
    summary
      ? `Scenarios: ${summary.scenario_count}, complete pairs: ${summary.comparison_pair_count}, claimable scenarios: ${summary.claimable_scenario_count}`
      : `Scenarios: ${scenarios.length}`,
    "",
    `Track claim gate: ${trackGate} (passes only if every corpus in the track passes).`,
    "",
    `This track separates corpora: ${corpora.map(corpusTitle).join(", ")}. Real-corpus and synthetic results are never merged into one number.`,
    "",
  ];
  for (const corpus of corpora) {
    lines.push(...renderTrackCorpusSubsection(report, track, corpus, cacheDiscount), "");
  }
  return lines;
}

function renderLlmMarkdownReport(report) {
  const present = tracksPresent(report.scenarios);
  const cacheDiscount = resolveCacheDiscount(report);
  const overallGate = report.claim_gate?.status || "not evaluated";
  const perTrackSummary = present
    .map((track) => `${trackTitle(track)}: ${report.claim_gate?.per_track?.[track]?.status || report.tracks?.[track]?.claim_gate?.status || "not evaluated"}`)
    .join(", ");
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
    "Claim boundary: values below are real Codex JSONL usage and local wall-clock measurements for claimable runs only. `model_source=requested` means Codex JSONL did not expose an observed model field; those runs are diagnostic-only and cannot support release claims.",
    "",
    "Tracks are reported separately. Wiki canonical routing and the code-graph code-evidence index are not merged into a single headline; a win on one track does not back a claim about the other.",
    "",
    `Headline metric per track: cost-weighted tokens (uncached input + ${formatNumber(cacheDiscount, 3)} x cached input + output + reasoning output; cache discount ${formatNumber(cacheDiscount, 3)}). Merged total tokens is retained as a secondary row only.`,
    "",
    `Overall claim gate: ${overallGate} (passes only if every track passes).`,
    perTrackSummary ? `Per-track claim gates: ${perTrackSummary}.` : "",
    "",
    "## Model Provenance And Claimability",
    "",
    "Release-claimable model evidence requires `model_source=jsonl` and exactly one observed JSONL model. Requested-only model metadata is diagnostic-only even when the requested model is present.",
    "",
    "| Scenario | Track | Corpus | Condition | Model Source | Observed Models | Claimable Runs | Release Evidence |",
    "| --- | --- | --- | --- | --- | --- | ---: | --- |",
    ...modelProvenanceRows(report.scenarios ?? []),
    "",
  ];
  for (const track of present) {
    lines.push(...renderTrackSection(report, track, cacheDiscount), "");
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  DEFAULT_CACHE_DISCOUNT,
  benchmarkTrackOf,
  claimableRuns,
  completePairCount,
  corpusOf,
  corporaPresent,
  costWeightedTokens,
  evaluateClaimGate,
  evaluateTracksClaimGate,
  measurementStatus,
  medianMetrics,
  metricStats,
  metricFields,
  pairedScenarioGroups,
  passedRuns,
  renderLlmMarkdownReport,
  resolveCacheDiscount,
  scenariosForCorpus,
  scenariosForTrack,
  scenariosForTrackCorpus,
  selectPairedScenarios,
  tracksPresent,
};
