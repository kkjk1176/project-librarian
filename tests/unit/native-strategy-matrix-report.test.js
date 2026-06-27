"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  auditNativeStrategyMatrixReport,
  parseAuditArgs,
} = require("../../benchmarks/tools/assert-native-strategy-matrix-report.js");

function reportFixture(overrides = {}) {
  const tsRun = { median_ms: 12, samples_ms: [12, 13, 11], timings: { total_ms: 12 } };
  const directRun = { median_ms: 10, samples_ms: [10, 11, 9], timings: { total_ms: 10 } };
  const rowDeltaRuns = [
    { run_index: 0, row_delta: { files: 0, symbols: 0 } },
    { run_index: 1, row_delta: { files: 0, symbols: 0 } },
    { run_index: 2, row_delta: { files: 0, symbols: 0 } },
  ];
  return {
    native_strategy_requirements: [
      { strategy: "sqlite-bridge", status: "available", requirements: [{ type: "command", name: "sqlite3", status: "available" }] },
      { strategy: "sqlite-direct", status: "available", requirements: [] },
      { strategy: "row-stream", status: "available", requirements: [] },
    ],
    repos: ["sample"],
    results: [
      {
        repo: "sample",
        ts_full: tsRun,
        rust_full: directRun,
        rust_full_delta_pct_vs_ts_full: -16.7,
        native_strategy_matrix: [
          {
            strategy: "sqlite-bridge",
            rust_full: { median_ms: 11, samples_ms: [11, 12, 10] },
            max_abs_row_delta_ts_vs_rust_full: { files: 0, symbols: 0 },
            row_delta_runs_ts_vs_rust_full: rowDeltaRuns,
          },
          {
            strategy: "sqlite-direct",
            rust_full: directRun,
            max_abs_row_delta_ts_vs_rust_full: { files: 0, symbols: 0 },
            row_delta_runs_ts_vs_rust_full: rowDeltaRuns,
          },
          {
            strategy: "row-stream",
            rust_full: { median_ms: 9, samples_ms: [9, 10, 8] },
            max_abs_row_delta_ts_vs_rust_full: { files: 0, symbols: 0 },
            row_delta_runs_ts_vs_rust_full: rowDeltaRuns,
          },
        ],
      },
    ],
    runs: 3,
    ...overrides,
  };
}

test("native strategy matrix audit accepts available all-strategy zero-delta reports", () => {
  const audit = auditNativeStrategyMatrixReport(reportFixture());
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.repo_count, 1);
});

test("native strategy matrix audit rejects missing availability and baseline drift", () => {
  const report = reportFixture({
    native_strategy_requirements: [
      { strategy: "sqlite-bridge", status: "missing", requirements: [{ type: "command", name: "sqlite3", status: "missing" }] },
      { strategy: "sqlite-direct", status: "available", requirements: [] },
      { strategy: "row-stream", status: "available", requirements: [] },
    ],
  });
  report.results[0].rust_full = { median_ms: 12 };
  report.results[0].native_strategy_matrix[2].max_abs_row_delta_ts_vs_rust_full = { files: 0, symbols: 1 };

  const audit = auditNativeStrategyMatrixReport(report);
  assert.equal(audit.ok, false);
  assert(audit.errors.includes("native strategy requirement is not available: sqlite-bridge"));
  assert(audit.errors.includes("sample: top-level rust_full does not match sqlite-direct matrix entry"));
  assert(audit.errors.includes("sample: non-zero max row delta for row-stream"));
});

test("native strategy matrix audit accepts claim-grade constraints", () => {
  const audit = auditNativeStrategyMatrixReport(reportFixture(), {
    expectedRepos: ["sample"],
    minRepos: 1,
    minRuns: 3,
    requireSqliteDirectFaster: true,
  });

  assert.equal(audit.ok, true);
  assert.deepEqual(audit.errors, []);
});

test("native strategy matrix audit rejects incomplete claim-grade evidence", () => {
  const report = reportFixture({
    repos: ["sample", "extra"],
    runs: 2,
  });
  report.results[0].rust_full_delta_pct_vs_ts_full = 0;
  report.results[0].ts_full.samples_ms = [12, 13];
  report.results[0].native_strategy_matrix[1].row_delta_runs_ts_vs_rust_full = [
    { run_index: 0, row_delta: { files: 0, symbols: 0 } },
    { run_index: 1, row_delta: { files: 0, symbols: 0 } },
  ];

  const audit = auditNativeStrategyMatrixReport(report, {
    expectedRepos: ["sample", "missing"],
    minRepos: 2,
    minRuns: 3,
    requireSqliteDirectFaster: true,
  });

  assert.equal(audit.ok, false);
  assert(audit.errors.includes("report has 1 repos; expected at least 2"));
  assert(audit.errors.includes("missing expected repo: missing"));
  assert(audit.errors.includes("unexpected repo in report.repos: extra"));
  assert(audit.errors.includes("report runs 2 below required 3"));
  assert(audit.errors.includes("sample: TypeScript full samples below required 3"));
  assert(audit.errors.includes("sample: sqlite-direct row-delta runs below required 3"));
  assert(audit.errors.includes("sample: sqlite-direct is not faster than TypeScript"));
});

test("native strategy matrix audit CLI parses stricter options", () => {
  assert.deepEqual(parseAuditArgs([
    "report.json",
    "--repos", "a,b",
    "--min-repos", "2",
    "--min-runs", "5",
    "--require-sqlite-direct-faster",
  ]), {
    expectedRepos: ["a", "b"],
    expectedStrategies: ["sqlite-bridge", "sqlite-direct", "row-stream"],
    minRepos: 2,
    minRuns: 5,
    reportPath: "report.json",
    requireSqliteDirectFaster: true,
  });
});
