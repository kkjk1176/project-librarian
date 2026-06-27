#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const expectedStrategies = ["sqlite-bridge", "sqlite-direct", "row-stream"];
const defaultNativeStrategy = "sqlite-direct";

function zeroRowDelta(rowDeltas) {
  return Object.values(rowDeltas ?? {}).every((value) => value === 0);
}

function parseList(value, optionName) {
  const items = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) throw new Error(`${optionName} must include at least one value`);
  return items;
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${optionName} must be a positive integer`);
  return parsed;
}

function strategiesByName(entries) {
  return new Map((entries ?? []).map((entry) => [entry.strategy, entry]));
}

function duplicateStrategies(entries) {
  const seen = new Set();
  const duplicates = new Set();
  for (const entry of entries ?? []) {
    if (!entry?.strategy) continue;
    if (seen.has(entry.strategy)) duplicates.add(entry.strategy);
    else seen.add(entry.strategy);
  }
  return Array.from(duplicates);
}

function hasSamples(run, minRuns) {
  return Array.isArray(run?.samples_ms) && run.samples_ms.length >= minRuns;
}

function auditNativeStrategyMatrixReport(report, options = {}) {
  const strategies = options.expectedStrategies ?? expectedStrategies;
  const expectedRepos = options.expectedRepos ?? [];
  const minRepos = options.minRepos ?? 1;
  const minRuns = options.minRuns ?? 0;
  const requireSqliteDirectFaster = options.requireSqliteDirectFaster ?? false;
  const errors = [];
  const resultRepos = Array.isArray(report.results) ? report.results.map((result) => result.repo) : [];

  if (!Array.isArray(report.results) || report.results.length === 0) errors.push("report has no results");
  else if (report.results.length < minRepos) errors.push(`report has ${report.results.length} repos; expected at least ${minRepos}`);

  if (expectedRepos.length > 0) {
    const reportRepoSet = new Set(resultRepos);
    for (const repo of expectedRepos) {
      if (!reportRepoSet.has(repo)) errors.push(`missing expected repo: ${repo}`);
    }
    for (const repo of resultRepos) {
      if (!expectedRepos.includes(repo)) errors.push(`unexpected repo: ${repo}`);
    }
    if (Array.isArray(report.repos)) {
      const declaredRepoSet = new Set(report.repos);
      for (const repo of expectedRepos) {
        if (!declaredRepoSet.has(repo)) errors.push(`missing expected repo in report.repos: ${repo}`);
      }
      for (const repo of report.repos) {
        if (!expectedRepos.includes(repo)) errors.push(`unexpected repo in report.repos: ${repo}`);
      }
    }
  }

  if (minRuns > 0) {
    if (!Number.isInteger(report.runs) || report.runs < minRuns) {
      errors.push(`report runs ${report.runs ?? "missing"} below required ${minRuns}`);
    }
  }

  for (const duplicate of duplicateStrategies(report.native_strategy_requirements)) {
    errors.push(`duplicate native_strategy_requirements entry: ${duplicate}`);
  }
  const requirementMap = strategiesByName(report.native_strategy_requirements);
  for (const strategy of strategies) {
    const requirement = requirementMap.get(strategy);
    if (!requirement) errors.push(`missing native_strategy_requirements entry: ${strategy}`);
    else if (requirement.status !== "available") errors.push(`native strategy requirement is not available: ${strategy}`);
  }

  for (const result of report.results ?? []) {
    for (const duplicate of duplicateStrategies(result.native_strategy_matrix)) {
      errors.push(`${result.repo}: duplicate native_strategy_matrix entry: ${duplicate}`);
    }
    if (minRuns > 0 && !hasSamples(result.ts_full, minRuns)) {
      errors.push(`${result.repo}: TypeScript full samples below required ${minRuns}`);
    }
    const matrix = strategiesByName(result.native_strategy_matrix);
    for (const strategy of strategies) {
      const entry = matrix.get(strategy);
      if (!entry) {
        errors.push(`${result.repo}: missing native_strategy_matrix entry: ${strategy}`);
        continue;
      }
      if (minRuns > 0) {
        if (!hasSamples(entry.rust_full, minRuns)) errors.push(`${result.repo}: ${strategy} rust full samples below required ${minRuns}`);
        if (!Array.isArray(entry.row_delta_runs_ts_vs_rust_full) || entry.row_delta_runs_ts_vs_rust_full.length < minRuns) {
          errors.push(`${result.repo}: ${strategy} row-delta runs below required ${minRuns}`);
        }
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
    } else if (requireSqliteDirectFaster && !(result.rust_full_delta_pct_vs_ts_full < 0)) {
      errors.push(`${result.repo}: ${defaultNativeStrategy} is not faster than TypeScript`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    repo_count: Array.isArray(report.results) ? report.results.length : 0,
    strategies,
  };
}

function parseAuditArgs(argv) {
  const args = {
    expectedRepos: [],
    expectedStrategies,
    minRepos: 1,
    minRuns: 0,
    reportPath: "",
    requireSqliteDirectFaster: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      args.help = true;
      return args;
    }
    if (value === "--repos") {
      args.expectedRepos = parseList(argv[++index], "--repos");
    } else if (value === "--expected-strategies") {
      const requested = argv[++index];
      args.expectedStrategies = requested === "all" ? expectedStrategies : parseList(requested, "--expected-strategies");
    } else if (value === "--min-repos") {
      args.minRepos = parsePositiveInteger(argv[++index], "--min-repos");
    } else if (value === "--min-runs") {
      args.minRuns = parsePositiveInteger(argv[++index], "--min-runs");
    } else if (value === "--require-sqlite-direct-faster") {
      args.requireSqliteDirectFaster = true;
    } else if (!value.startsWith("--") && !args.reportPath) {
      args.reportPath = value;
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  return args;
}

function usage() {
  console.error(`Usage: node benchmarks/tools/assert-native-strategy-matrix-report.js <report.json> [options]

Options:
  --repos <a,b,c>                   Require the exact expected repo set.
  --expected-strategies <list|all>   Required strategy entries. Default: all.
  --min-repos <n>                   Require at least n benchmarked repos. Default: 1.
  --min-runs <n>                    Require report and per-engine sample evidence for n runs.
  --require-sqlite-direct-faster    Require sqlite-direct median to beat TypeScript for every repo.
`);
}

function main() {
  let args;
  try {
    args = parseAuditArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    process.exit(2);
  }
  if (args.help || !args.reportPath) {
    usage();
    process.exit(args.help ? 0 : 2);
  }
  const absolutePath = path.resolve(args.reportPath);
  const report = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const audit = auditNativeStrategyMatrixReport(report, args);
  if (!audit.ok) {
    console.error(audit.errors.join("\n"));
    process.exit(1);
  }
  process.stdout.write(`native strategy matrix audit passed: ${audit.repo_count} repos, ${audit.strategies.join(", ")}\n`);
}

if (require.main === module) main();

module.exports = {
  auditNativeStrategyMatrixReport,
  parseAuditArgs,
};
