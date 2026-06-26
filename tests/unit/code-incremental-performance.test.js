"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { parseTimings } = require("../../benchmarks/tools/code-incremental-performance.js");
const {
  pairedRowDeltas,
  parseCodeIndexPhaseTimingsOrThrow,
} = require("../../benchmarks/lib/code-benchmark-claim-evidence.js");

test("incremental benchmark rejects malformed phase timing evidence", () => {
  assert.throws(
    () => parseTimings("code_index_phase_timings []\n"),
    /phase timing payload must be an object/,
  );
  assert.deepEqual(
    parseCodeIndexPhaseTimingsOrThrow("noise\ncode_index_phase_timings {\"total_ms\":12.5}\n"),
    { total_ms: 12.5 },
  );
});

test("incremental benchmark row-delta evidence requires aligned paired runs", () => {
  assert.throws(
    () => pairedRowDeltas(
      [{ run_index: 0, counts: { files: 1 } }],
      [{ run_index: 1, counts: { files: 1 } }],
    ),
    /run index mismatch/,
  );
  assert.throws(
    () => pairedRowDeltas(
      [{ run_index: 0, counts: { files: 1 } }],
      [],
    ),
    /equal sample counts/,
  );
});
