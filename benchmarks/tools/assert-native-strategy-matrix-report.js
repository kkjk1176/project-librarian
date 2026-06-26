#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const expectedStrategies = ["sqlite-bridge", "sqlite-direct", "row-stream"];
const defaultNativeStrategy = "sqlite-direct";

function zeroRowDelta(rowDeltas) {
  return Object.values(rowDeltas ?? {}).every((value) => value === 0);
}

function strategiesByName(entries) {
  return new Map((entries ?? []).map((entry) => [entry.strategy, entry]));
}

function auditNativeStrategyMatrixReport(report, options = {}) {
  const strategies = options.expectedStrategies ?? expectedStrategies;
  const errors = [];
  const requirementMap = strategiesByName(report.native_strategy_requirements);
  for (const strategy of strategies) {
    const requirement = requirementMap.get(strategy);
    if (!requirement) errors.push(`missing native_strategy_requirements entry: ${strategy}`);
    else if (requirement.status !== "available") errors.push(`native strategy requirement is not available: ${strategy}`);
  }

  for (const result of report.results ?? []) {
    const matrix = strategiesByName(result.native_strategy_matrix);
    for (const strategy of strategies) {
      const entry = matrix.get(strategy);
      if (!entry) {
        errors.push(`${result.repo}: missing native_strategy_matrix entry: ${strategy}`);
        continue;
      }
      if (!zeroRowDelta(entry.max_abs_row_delta_ts_vs_rust_full)) {
        errors.push(`${result.repo}: non-zero max row delta for ${strategy}`);
      }
    }
    const direct = matrix.get(defaultNativeStrategy);
    if (!direct) {
      errors.push(`${result.repo}: missing ${defaultNativeStrategy} release baseline matrix entry`);
    } else if (JSON.stringify(result.rust_full) !== JSON.stringify(direct.rust_full)) {
      errors.push(`${result.repo}: top-level rust_full does not match ${defaultNativeStrategy} matrix entry`);
    }
  }
  if (!Array.isArray(report.results) || report.results.length === 0) errors.push("report has no results");
  return {
    ok: errors.length === 0,
    errors,
    repo_count: Array.isArray(report.results) ? report.results.length : 0,
    strategies,
  };
}

function main() {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error("Usage: node benchmarks/tools/assert-native-strategy-matrix-report.js <report.json>");
    process.exit(2);
  }
  const absolutePath = path.resolve(reportPath);
  const report = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const audit = auditNativeStrategyMatrixReport(report);
  if (!audit.ok) {
    console.error(audit.errors.join("\n"));
    process.exit(1);
  }
  process.stdout.write(`native strategy matrix audit passed: ${audit.repo_count} repos, ${audit.strategies.join(", ")}\n`);
}

if (require.main === module) main();

module.exports = {
  auditNativeStrategyMatrixReport,
};
