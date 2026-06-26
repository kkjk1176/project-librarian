"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { parseTimings } = require("../../benchmarks/tools/code-full-rebuild-performance.js");
const {
  maxAbsRowDeltas,
  pairedRowDeltas,
} = require("../../benchmarks/lib/code-benchmark-claim-evidence.js");

test("full rebuild benchmark fails closed when phase timings are missing", () => {
  assert.throws(
    () => parseTimings("ordinary stderr\n"),
    /missing code_index_phase_timings stderr evidence/,
  );
});

test("full rebuild benchmark records row deltas for every paired run", () => {
  const rowDeltas = pairedRowDeltas(
    [
      { run_index: 0, elapsed_ms: 12, counts: { files: 10, symbols: 7 } },
      { run_index: 1, elapsed_ms: 9, counts: { files: 10, symbols: 7 } },
    ],
    [
      { run_index: 0, elapsed_ms: 11, counts: { files: 10, symbols: 7 } },
      { run_index: 1, elapsed_ms: 8, counts: { files: 9, symbols: 5 } },
    ],
  );

  assert.deepEqual(rowDeltas, [
    { run_index: 0, row_delta: { files: 0, symbols: 0 } },
    { run_index: 1, row_delta: { files: 1, symbols: 2 } },
  ]);
  assert.deepEqual(maxAbsRowDeltas(rowDeltas), { files: 1, symbols: 2 });
});
