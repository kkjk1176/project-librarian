"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { parseArgs, parseTimings } = require("../../benchmarks/tools/code-full-rebuild-performance.js");
const {
  maxAbsRowDeltas,
  pairedRowDeltas,
} = require("../../benchmarks/lib/code-benchmark-claim-evidence.js");

function parseArgsFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "full-rebuild-args-"));
  const sourceRoot = path.join(root, "sources");
  const repo = path.join(sourceRoot, "sample");
  const helper = path.join(root, "helper");
  const cli = path.join(root, "cli.js");
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(helper, "");
  fs.writeFileSync(cli, "");
  return { cli, helper, root, sourceRoot };
}

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

test("full rebuild benchmark parses unique native strategy matrix requests", () => {
  const fixture = parseArgsFixture();
  try {
    const args = parseArgs([
      "--source-root", fixture.sourceRoot,
      "--repos", "sample",
      "--runs", "1",
      "--helper", fixture.helper,
      "--cli", fixture.cli,
      "--native-strategies", "sqlite-direct,row-stream,sqlite-direct",
    ]);

    assert.deepEqual(args.nativeStrategies, ["sqlite-direct", "row-stream"]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("full rebuild benchmark requires sqlite-direct in native strategy requests", () => {
  const fixture = parseArgsFixture();
  try {
    assert.throws(
      () => parseArgs([
        "--source-root", fixture.sourceRoot,
        "--repos", "sample",
        "--helper", fixture.helper,
        "--cli", fixture.cli,
        "--native-strategies", "row-stream",
      ]),
      /must include sqlite-direct/,
    );
    assert.throws(
      () => parseArgs([
        "--source-root", fixture.sourceRoot,
        "--repos", "sample",
        "--helper", fixture.helper,
        "--cli", fixture.cli,
        "--native-strategies", "unknown",
      ]),
      /invalid --native-strategies unknown/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
