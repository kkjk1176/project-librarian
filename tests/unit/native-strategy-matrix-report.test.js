"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { auditNativeStrategyMatrixReport } = require("../../benchmarks/tools/assert-native-strategy-matrix-report.js");

function reportFixture(overrides = {}) {
  const directRun = { median_ms: 10, timings: { total_ms: 10 } };
  return {
    native_strategy_requirements: [
      { strategy: "sqlite-bridge", status: "available", requirements: [{ type: "command", name: "sqlite3", status: "available" }] },
      { strategy: "sqlite-direct", status: "available", requirements: [] },
      { strategy: "row-stream", status: "available", requirements: [] },
    ],
    results: [
      {
        repo: "sample",
        rust_full: directRun,
        native_strategy_matrix: [
          { strategy: "sqlite-bridge", rust_full: { median_ms: 11 }, max_abs_row_delta_ts_vs_rust_full: { files: 0, symbols: 0 } },
          { strategy: "sqlite-direct", rust_full: directRun, max_abs_row_delta_ts_vs_rust_full: { files: 0, symbols: 0 } },
          { strategy: "row-stream", rust_full: { median_ms: 9 }, max_abs_row_delta_ts_vs_rust_full: { files: 0, symbols: 0 } },
        ],
      },
    ],
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
