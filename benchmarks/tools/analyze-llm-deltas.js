#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  corporaPresent,
  costWeightedTokens,
  pairedScenarioGroups,
  resolveCacheDiscount,
  scenariosForTrackCorpus,
  tracksPresent,
} = require("../lib/llm-report");

const repoRoot = path.resolve(__dirname, "..", "..");

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

function numberArg(name, defaultValue) {
  const raw = argValue(name, String(defaultValue));
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) fail(`invalid number for ${name}: ${raw || "(missing)"}`);
  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node benchmarks/tools/analyze-llm-deltas.js [--report <path>] [--min-regression-percent <n>] [--format json|markdown] [--include-traces] [--out <path>]

Defaults:
  --report benchmarks/reports/llm/current.json
  --min-regression-percent 0
  --format markdown

This tool reads an existing measured report. It never launches Codex.
Use --include-traces to inspect representative raw JSONL command traces for each regression.`);
}

function percentDelta(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) return NaN;
  return ((current - baseline) / baseline) * 100;
}

function formatNumber(value, digits = 0) {
  if (!Number.isFinite(value)) return "n/a";
  return Number(value.toFixed(digits)).toLocaleString("en-US");
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 2)}%`;
}

function weightedDrivers(withMedian, withoutMedian, cacheDiscount) {
  const fields = [
    { key: "uncached_input_tokens", label: "uncached input", weight: 1 },
    { key: "cached_input_tokens", label: "cached input", weight: cacheDiscount },
    { key: "output_tokens", label: "output", weight: 1 },
    { key: "reasoning_output_tokens", label: "reasoning", weight: 1 },
  ];
  return fields.map((field) => {
    const withValue = Number(withMedian[field.key]) || 0;
    const withoutValue = Number(withoutMedian[field.key]) || 0;
    const rawDelta = withValue - withoutValue;
    return {
      label: field.label,
      raw_delta: rawDelta,
      weighted_delta: rawDelta * field.weight,
      percent_delta: percentDelta(withValue, withoutValue),
    };
  }).filter((driver) => driver.weighted_delta > 0).sort((left, right) => right.weighted_delta - left.weighted_delta);
}

function scenarioDeltaRows(report, { minRegressionPercent = 0 } = {}) {
  const cacheDiscount = resolveCacheDiscount(report);
  const rows = [];
  for (const track of tracksPresent(report.scenarios || [])) {
    const trackScenarios = (report.scenarios || []).filter((scenario) => scenario.benchmark_track === track || (!scenario.benchmark_track && track === "wiki"));
    for (const corpus of corporaPresent(trackScenarios)) {
      const scenarios = scenariosForTrackCorpus(report.scenarios || [], track, corpus);
      for (const pair of pairedScenarioGroups(scenarios)) {
        const withMedian = pair.with_project_librarian?.median;
        const withoutMedian = pair.without_project_librarian?.median;
        if (!withMedian || !withoutMedian) continue;
        const withCost = costWeightedTokens(withMedian, cacheDiscount);
        const withoutCost = costWeightedTokens(withoutMedian, cacheDiscount);
        const costDeltaPercent = percentDelta(withCost, withoutCost);
        const row = {
          track,
          corpus,
          scale: pair.scale,
          task_family: pair.task_family,
          cost_delta_percent: costDeltaPercent,
          with_cost_weighted: withCost,
          without_cost_weighted: withoutCost,
          uncached_input_delta_percent: percentDelta(withMedian.uncached_input_tokens, withoutMedian.uncached_input_tokens),
          cached_input_delta_percent: percentDelta(withMedian.cached_input_tokens, withoutMedian.cached_input_tokens),
          tool_output_bytes_delta_percent: percentDelta(withMedian.tool_output_bytes, withoutMedian.tool_output_bytes),
          wall_time_delta_percent: percentDelta(withMedian.wall_ms, withoutMedian.wall_ms),
          command_delta_percent: percentDelta(withMedian.command_invocation_count, withoutMedian.command_invocation_count),
          drivers: weightedDrivers(withMedian, withoutMedian, cacheDiscount),
        };
        if (row.cost_delta_percent >= minRegressionPercent) rows.push(row);
      }
    }
  }
  rows.sort((left, right) => right.cost_delta_percent - left.cost_delta_percent);
  return rows;
}

function driverText(row) {
  if (row.drivers.length === 0) return "none";
  return row.drivers.slice(0, 3).map((driver) => {
    return `${driver.label} ${formatNumber(driver.weighted_delta)} weighted (${formatPercent(driver.percent_delta)})`;
  }).join("; ");
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return 0;
  const middle = Math.floor(finite.length / 2);
  if (finite.length % 2 === 1) return finite[middle];
  return ((finite[middle - 1] || 0) + (finite[middle] || 0)) / 2;
}

function commandCategory(command) {
  if (/rg\b.*\bwiki\b|\bwiki\b.*rg\b/.test(command)) return "broad_wiki_search";
  if (/wiki\/startup\.md|wiki\/index\.md/.test(command)) return "wiki_router_read";
  if (/wiki\/canonical\/dated-decision-|docs\/history\/dated-decision-|docs\/decisions-history\/dated-decision-/.test(command)) return "dated_decision_read";
  if (/wiki\/decisions|wiki\/meta/.test(command)) return "wiki_decision_meta_read";
  if (/rg --files|find docs/.test(command)) return "file_inventory";
  if (/rg\b.*\bdocs\b|\bdocs\b.*rg\b/.test(command)) return "control_docs_search";
  if (/docs\/notes|docs\/decisions|README\.md/.test(command)) return "control_docs_read";
  return "other";
}

function readCompletedCommands(rawJsonlPath) {
  if (!rawJsonlPath || !fs.existsSync(rawJsonlPath)) {
    return { status: "missing", path: rawJsonlPath || "", commands: [] };
  }
  const commands = [];
  const lines = fs.readFileSync(rawJsonlPath, "utf8").split(/\n/).filter(Boolean);
  for (const line of lines) {
    const event = JSON.parse(line);
    if (event.type !== "item.completed" || event.item?.type !== "command_execution") continue;
    const output = event.item.aggregated_output || "";
    commands.push({
      command: event.item.command || "",
      output_bytes: Buffer.byteLength(output),
      category: commandCategory(event.item.command || ""),
    });
  }
  return { status: "ok", path: rawJsonlPath, commands };
}

function categoryBytes(commands) {
  const totals = {};
  for (const command of commands) {
    totals[command.category] = (totals[command.category] || 0) + command.output_bytes;
  }
  return Object.fromEntries(Object.entries(totals).sort((left, right) => right[1] - left[1]));
}

function topCommands(commands, limit = 5) {
  return [...commands]
    .sort((left, right) => right.output_bytes - left.output_bytes)
    .slice(0, limit)
    .map((command) => ({
      ...command,
      command: command.command.replace(/\s+/g, " ").slice(0, 180),
    }));
}

function representativeRunIndex(scenario) {
  const rawPaths = scenario.raw_jsonl_paths || [];
  const runs = scenario.runs || [];
  if (rawPaths.length === 0) return -1;
  const targetToolBytes = Number(scenario.median?.tool_output_bytes) || 0;
  const targetCommands = Number(scenario.median?.command_invocation_count) || 0;
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < rawPaths.length; index += 1) {
    const metrics = runs[index]?.metrics || {};
    const toolDelta = Math.abs((Number(metrics.tool_output_bytes) || 0) - targetToolBytes);
    const commandDelta = Math.abs((Number(metrics.command_invocation_count) || 0) - targetCommands) * 500;
    const score = toolDelta + commandDelta;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}

function summarizeScenarioTrace(scenario) {
  const index = representativeRunIndex(scenario);
  if (index < 0) {
    return {
      status: "missing",
      run_index: null,
      raw_jsonl_path: "",
      command_count: 0,
      command_output_bytes: 0,
      category_bytes: {},
      top_commands: [],
    };
  }
  const rawPath = scenario.raw_jsonl_paths[index];
  const trace = readCompletedCommands(rawPath);
  const commandOutputBytes = trace.commands.reduce((sum, command) => sum + command.output_bytes, 0);
  return {
    status: trace.status,
    run_index: index + 1,
    raw_jsonl_path: rawPath ? path.relative(repoRoot, rawPath) : "",
    command_count: trace.commands.length,
    command_output_bytes: commandOutputBytes,
    median_distance: {
      tool_output_bytes: Math.abs(commandOutputBytes - (Number(scenario.median?.tool_output_bytes) || 0)),
      command_invocation_count: Math.abs(trace.commands.length - (Number(scenario.median?.command_invocation_count) || 0)),
    },
    category_bytes: categoryBytes(trace.commands),
    top_commands: topCommands(trace.commands),
  };
}

function matchingScenario(report, row, condition) {
  return (report.scenarios || []).find((scenario) => {
    return scenario.scale === row.scale
      && scenario.task_family === row.task_family
      && (scenario.benchmark_track || "wiki") === row.track
      && (scenario.corpus || "synthetic") === row.corpus
      && scenario.condition === condition;
  });
}

function traceDiagnosis(trace) {
  if (!trace?.with_project_librarian || !trace?.without_project_librarian) return [];
  const withBytes = trace.with_project_librarian.category_bytes || {};
  const withoutBytes = trace.without_project_librarian.category_bytes || {};
  const notes = [];
  const broadWikiDelta = (withBytes.broad_wiki_search || 0) - (withoutBytes.broad_wiki_search || 0);
  if (broadWikiDelta > 0) {
    notes.push(`broad wiki search adds ${formatNumber(broadWikiDelta)} representative command-output bytes`);
  }
  const routerDelta = ((withBytes.wiki_router_read || 0) + (withBytes.wiki_decision_meta_read || 0))
    - ((withoutBytes.wiki_router_read || 0) + (withoutBytes.wiki_decision_meta_read || 0));
  if (routerDelta > 0) {
    notes.push(`wiki router/meta reads add ${formatNumber(routerDelta)} representative command-output bytes`);
  }
  const commandDelta = trace.with_project_librarian.command_count - trace.without_project_librarian.command_count;
  if (commandDelta !== 0) {
    notes.push(`representative command count delta ${commandDelta > 0 ? "+" : ""}${commandDelta}`);
  }
  return notes;
}

function attachTraceDrilldowns(report, rows) {
  return rows.map((row) => {
    const withScenario = matchingScenario(report, row, "with_project_librarian");
    const withoutScenario = matchingScenario(report, row, "without_project_librarian");
    if (!withScenario || !withoutScenario) return row;
    const trace = {
      with_project_librarian: summarizeScenarioTrace(withScenario),
      without_project_librarian: summarizeScenarioTrace(withoutScenario),
    };
    trace.diagnosis = traceDiagnosis(trace);
    return { ...row, trace };
  });
}

function focusNotes(rows) {
  const notes = [];
  const smallAggregation = rows.find((row) => row.scale === "small" && row.task_family === "aggregation");
  if (smallAggregation) {
    notes.push(`Small aggregation is the highest-risk product gap when present: ${formatPercent(smallAggregation.cost_delta_percent)} cost-weighted delta, with drivers ${driverText(smallAggregation)}. Inspect whether the with-condition wiki routing causes broad startup/index reads before the dated-decision pages are isolated.`);
  }
  const smallRows = rows.filter((row) => row.scale === "small");
  if (smallRows.length > 0) {
    notes.push("Small-repo regressions should be fixed before expanding public claims because the project already positions code evidence as scale-gated and wiki routing as lightweight.");
  }
  if (rows.length === 0) {
    notes.push("No cost-weighted regressions crossed the configured threshold.");
  }
  return notes;
}

function renderMarkdownAnalysis(report, rows, options = {}) {
  const source = options.source || "unknown";
  const generatedAt = options.generatedAt || new Date().toISOString();
  const threshold = Number.isFinite(options.minRegressionPercent) ? options.minRegressionPercent : 0;
  const lines = [
    "# LLM Benchmark Delta Analysis",
    "",
    `Generated: ${generatedAt}`,
    `Source: ${source}`,
    `Regression threshold: >= ${formatPercent(threshold)}`,
    "",
    "## Cost-Weighted Regressions",
    "",
    "| Rank | Track | Corpus | Scale | Task | Cost Delta | With Cost | Without Cost | Main Drivers | Tool Output Delta | Wall-Time Delta | Command Delta |",
    "| ---: | --- | --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |",
  ];
  rows.forEach((row, index) => {
    lines.push(`| ${index + 1} | ${row.track} | ${row.corpus} | ${row.scale} | ${row.task_family} | ${formatPercent(row.cost_delta_percent)} | ${formatNumber(row.with_cost_weighted)} | ${formatNumber(row.without_cost_weighted)} | ${driverText(row)} | ${formatPercent(row.tool_output_bytes_delta_percent)} | ${formatPercent(row.wall_time_delta_percent)} | ${formatPercent(row.command_delta_percent)} |`);
  });
  if (rows.length === 0) lines.push("| - | - | - | - | - | - | - | - | - | - | - | - |");
  lines.push("", "## Focus Notes", "");
  for (const note of focusNotes(rows)) lines.push(`- ${note}`);
  const tracedRows = rows.filter((row) => row.trace);
  if (tracedRows.length > 0) {
    lines.push("", "## Trace Drilldown", "");
    for (const [index, row] of tracedRows.entries()) {
      const withTrace = row.trace.with_project_librarian;
      const withoutTrace = row.trace.without_project_librarian;
      lines.push(`### ${index + 1}. ${row.scale} / ${row.task_family}`, "");
      lines.push(`- Representative runs: with=${withTrace.status} run ${withTrace.run_index || "n/a"} (${formatNumber(withTrace.command_output_bytes)} command-output bytes, ${withTrace.command_count} commands); without=${withoutTrace.status} run ${withoutTrace.run_index || "n/a"} (${formatNumber(withoutTrace.command_output_bytes)} command-output bytes, ${withoutTrace.command_count} commands).`);
      const diagnosis = row.trace.diagnosis.length > 0 ? row.trace.diagnosis.join("; ") : "no command-trace diagnosis available";
      lines.push(`- Diagnosis: ${diagnosis}.`);
      lines.push("- With top commands:");
      for (const command of withTrace.top_commands.slice(0, 3)) {
        lines.push(`  - ${formatNumber(command.output_bytes)} bytes, ${command.category}: \`${command.command}\``);
      }
      lines.push("- Without top commands:");
      for (const command of withoutTrace.top_commands.slice(0, 3)) {
        lines.push(`  - ${formatNumber(command.output_bytes)} bytes, ${command.category}: \`${command.command}\``);
      }
      lines.push("");
    }
  }
  lines.push("");
  return `${lines.join("\n")}`;
}

function loadReport(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage();
    return;
  }
  const reportPath = path.resolve(repoRoot, argValue("--report", "benchmarks/reports/llm/current.json"));
  const minRegressionPercent = numberArg("--min-regression-percent", 0);
  const format = argValue("--format", "markdown");
  const includeTraces = hasFlag("--include-traces");
  if (!["json", "markdown"].includes(format)) fail(`invalid --format: ${format}`);
  const report = loadReport(reportPath);
  let rows = scenarioDeltaRows(report, { minRegressionPercent });
  if (includeTraces) rows = attachTraceDrilldowns(report, rows);
  const output = format === "json"
    ? `${JSON.stringify({ schema_version: 1, source: reportPath, min_regression_percent: minRegressionPercent, trace_drilldowns: includeTraces, regressions: rows }, null, 2)}\n`
    : renderMarkdownAnalysis(report, rows, { source: path.relative(repoRoot, reportPath), minRegressionPercent });
  const outPath = argValue("--out", "");
  if (outPath) {
    fs.writeFileSync(path.resolve(repoRoot, outPath), output);
  } else {
    process.stdout.write(output);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

module.exports = {
  attachTraceDrilldowns,
  commandCategory,
  driverText,
  focusNotes,
  percentDelta,
  renderMarkdownAnalysis,
  scenarioDeltaRows,
  weightedDrivers,
};
