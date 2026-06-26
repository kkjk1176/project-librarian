"use strict";

function markdownCell(value) {
  return String(value ?? "n/a").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function tableRow(values) {
  return `| ${values.map(markdownCell).join(" | ")} |`;
}

function formatMs(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} ms` : "n/a";
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatPhaseTimings(phaseTimings) {
  const labels = {
    discover_files_ms: "discover",
    compatibility_ms: "compat",
    prepare_output_ms: "prepare",
    fingerprints_ms: "fingerprints",
    read_files_ms: "read",
    sqlite_write_ms: "sqlite",
    native_helper_ms: "native",
    total_ms: "total",
  };
  const entries = Object.entries(labels)
    .filter(([key]) => typeof phaseTimings?.[key] === "number")
    .map(([key, label]) => `${label} ${formatMs(phaseTimings[key])}`);
  return entries.length > 0 ? entries.join(", ") : "n/a";
}

function formatRowDeltas(rowDeltas) {
  const entries = Object.entries(rowDeltas ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([table, delta]) => `${table} ${delta >= 0 ? "+" : ""}${delta}`);
  return entries.length > 0 ? entries.join(", ") : "n/a";
}

function formatRunRowDeltas(rowDeltaRuns) {
  if (!Array.isArray(rowDeltaRuns) || rowDeltaRuns.length === 0) return "n/a";
  return rowDeltaRuns
    .map((run) => `run ${run.run_index}: ${formatRowDeltas(run.row_delta)}`)
    .join("; ");
}

function renderFullRebuildMarkdownReport(report) {
  const lines = [
    "# Code Full Rebuild Performance Report",
    "",
    `Generated: ${report.generated_at}`,
    `Runs: ${report.runs}`,
    `Source root: ${report.sourceRoot}`,
    `Native strategies: ${(report.native_strategies ?? ["sqlite-direct"]).join(", ")}`,
    "",
    "Claim boundary: top-level `rust_full` fields are the sqlite-direct release-path comparison. Other native strategies are diagnostic matrix evidence and must not silently replace the release baseline.",
    "",
  ];

  for (const result of report.results ?? []) {
    lines.push(`## ${result.repo}`, "");
    lines.push(`- Files: ${result.files}`);
    lines.push(`- Top-level release comparison: sqlite-direct (\`rust_full\`)`);
    lines.push(`- TypeScript full median: ${formatMs(result.ts_full?.median_ms)}`);
    lines.push(`- TypeScript phases: ${formatPhaseTimings(result.ts_full?.timings)}`);
    lines.push(`- sqlite-direct rust full median: ${formatMs(result.rust_full?.median_ms)} (${formatPercent(result.rust_full_delta_pct_vs_ts_full)} vs TypeScript)`);
    lines.push(`- sqlite-direct rust phases: ${formatPhaseTimings(result.rust_full?.timings)}`);
    lines.push(`- sqlite-direct max row deltas: ${formatRowDeltas(result.max_abs_row_delta_ts_vs_rust_full)}`);
    lines.push(`- sqlite-direct per-run row deltas: ${formatRunRowDeltas(result.row_delta_runs_ts_vs_rust_full)}`);
    lines.push("");
    lines.push("### Native Strategy Matrix");
    lines.push("");
    lines.push("| Strategy | Rust Median | Delta vs TypeScript | Rust Phases | Max Row Deltas | Per-Run Row Deltas |");
    lines.push("| --- | ---: | ---: | --- | --- | --- |");
    for (const entry of result.native_strategy_matrix ?? []) {
      lines.push(tableRow([
        entry.strategy,
        formatMs(entry.rust_full?.median_ms),
        formatPercent(entry.rust_full_delta_pct_vs_ts_full),
        formatPhaseTimings(entry.rust_full?.timings),
        formatRowDeltas(entry.max_abs_row_delta_ts_vs_rust_full),
        formatRunRowDeltas(entry.row_delta_runs_ts_vs_rust_full),
      ]));
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderIncrementalMarkdownReport(report) {
  const lines = [
    "# Code Incremental Performance Report",
    "",
    `Generated: ${report.generated_at}`,
    `Runs: ${report.runs}`,
    `Rust mode: ${report.rust_mode}`,
    `Source root: ${report.sourceRoot}`,
    `Native strategies: ${(report.native_strategies ?? ["sqlite-direct"]).join(", ")}`,
    "",
    "Claim boundary: top-level `rust_incremental` or `rust_full` fields are the sqlite-direct release-path comparison. Default native incremental mode is sqlite-direct-only; non-sqlite-direct strategies are full-rebuild diagnostics only.",
    "",
  ];

  for (const result of report.results ?? []) {
    const rustKey = result.rust_incremental ? "rust_incremental" : "rust_full";
    const deltaKey = `${rustKey}_delta_pct_vs_ts_incremental`;
    const maxDeltaKey = `max_abs_row_delta_ts_vs_${rustKey}`;
    const runDeltaKey = `row_delta_runs_ts_vs_${rustKey}`;
    lines.push(`## ${result.repo} changed ${result.changed_count}`);
    lines.push("");
    lines.push(`- Baseline files: ${result.baseline_files}`);
    lines.push(`- Top-level release comparison: sqlite-direct (\`${rustKey}\`)`);
    lines.push(`- TypeScript incremental median: ${formatMs(result.ts_incremental?.median_ms)}`);
    lines.push(`- TypeScript phases: ${formatPhaseTimings(result.ts_incremental?.timings)}`);
    lines.push(`- sqlite-direct ${rustKey} median: ${formatMs(result[rustKey]?.median_ms)} (${formatPercent(result[deltaKey])} vs TypeScript incremental)`);
    lines.push(`- sqlite-direct ${rustKey} phases: ${formatPhaseTimings(result[rustKey]?.timings)}`);
    lines.push(`- sqlite-direct max row deltas: ${formatRowDeltas(result[maxDeltaKey])}`);
    lines.push(`- sqlite-direct per-run row deltas: ${formatRunRowDeltas(result[runDeltaKey])}`);
    lines.push("");
    lines.push("### Native Strategy Matrix");
    lines.push("");
    lines.push("| Strategy | Rust Median | Delta vs TypeScript Incremental | Rust Phases | Max Row Deltas | Per-Run Row Deltas |");
    lines.push("| --- | ---: | ---: | --- | --- | --- |");
    for (const entry of result.native_strategy_matrix ?? []) {
      lines.push(tableRow([
        entry.strategy,
        formatMs(entry[rustKey]?.median_ms),
        formatPercent(entry[deltaKey]),
        formatPhaseTimings(entry[rustKey]?.timings),
        formatRowDeltas(entry[maxDeltaKey]),
        formatRunRowDeltas(entry[runDeltaKey]),
      ]));
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  formatPhaseTimings,
  formatRowDeltas,
  renderFullRebuildMarkdownReport,
  renderIncrementalMarkdownReport,
};
