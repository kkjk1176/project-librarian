"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { parseArgs, parseTimings } = require("../../benchmarks/tools/code-incremental-performance.js");
const {
  pairedRowDeltas,
  parseCodeIndexPhaseTimingsOrThrow,
} = require("../../benchmarks/lib/code-benchmark-claim-evidence.js");

function parseArgsFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "incremental-args-"));
  const sourceRoot = path.join(root, "sources");
  const repo = path.join(sourceRoot, "sample");
  const helper = path.join(root, "helper");
  const cli = path.join(root, "cli.js");
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(helper, "");
  fs.writeFileSync(cli, "");
  return { cli, helper, root, sourceRoot };
}

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

test("incremental benchmark records sqlite-direct as the only native incremental strategy", () => {
  const fixture = parseArgsFixture();
  try {
    const args = parseArgs([
      "--source-root", fixture.sourceRoot,
      "--repos", "sample",
      "--changes", "1",
      "--runs", "1",
      "--helper", fixture.helper,
      "--cli", fixture.cli,
      "--native-strategies", "sqlite-direct,sqlite-direct",
    ]);

    assert.equal(args.rustMode, "incremental");
    assert.deepEqual(args.nativeStrategies, ["sqlite-direct"]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("incremental benchmark rejects non-sqlite-direct strategies for native incremental mode", () => {
  const fixture = parseArgsFixture();
  try {
    assert.throws(
      () => parseArgs([
        "--source-root", fixture.sourceRoot,
        "--repos", "sample",
        "--changes", "1",
        "--helper", fixture.helper,
        "--cli", fixture.cli,
        "--native-strategies", "sqlite-direct,row-stream",
      ]),
      /incremental rust mode must be sqlite-direct/,
    );

    const fullModeArgs = parseArgs([
      "--source-root", fixture.sourceRoot,
      "--repos", "sample",
      "--changes", "1",
      "--helper", fixture.helper,
      "--cli", fixture.cli,
      "--rust-mode", "full",
      "--native-strategies", "sqlite-direct,row-stream",
    ]);
    assert.deepEqual(fullModeArgs.nativeStrategies, ["sqlite-direct", "row-stream"]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
