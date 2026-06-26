"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { parseArgs, parseTimings } = require("../../benchmarks/tools/code-incremental-performance.js");
const { renderIncrementalMarkdownReport } = require("../../benchmarks/lib/code-benchmark-markdown.js");
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

test("incremental markdown exposes sqlite-direct release comparison and row-delta evidence", () => {
  const markdown = renderIncrementalMarkdownReport({
    changeCounts: [1],
    generated_at: "2026-06-26T00:00:00.000Z",
    native_strategies: ["sqlite-direct"],
    results: [
      {
        repo: "sample",
        baseline_files: 2,
        changed_count: 1,
        ts_incremental: { median_ms: 50, timings: { discover_files_ms: 1, read_files_ms: 2, sqlite_write_ms: 3, total_ms: 6 } },
        rust_incremental: { median_ms: 40, timings: { discover_files_ms: 1, native_helper_ms: 2, total_ms: 3 } },
        rust_incremental_delta_pct_vs_ts_incremental: -20,
        max_abs_row_delta_ts_vs_rust_incremental: { files: 0, symbols: 0 },
        row_delta_runs_ts_vs_rust_incremental: [{ run_index: 0, row_delta: { files: 0, symbols: 0 } }],
        native_strategy_matrix: [
          {
            strategy: "sqlite-direct",
            rust_incremental: { median_ms: 40, timings: { native_helper_ms: 2, total_ms: 3 } },
            rust_incremental_delta_pct_vs_ts_incremental: -20,
            max_abs_row_delta_ts_vs_rust_incremental: { files: 0, symbols: 0 },
            row_delta_runs_ts_vs_rust_incremental: [{ run_index: 0, row_delta: { files: 0, symbols: 0 } }],
          },
        ],
      },
    ],
    rust_mode: "incremental",
    runs: 1,
    sourceRoot: "/tmp/samples",
  });

  assert.match(markdown, /Top-level release comparison: sqlite-direct \(`rust_incremental`\)/);
  assert.match(markdown, /Default native incremental mode is sqlite-direct-only/);
  assert.match(markdown, /Native Strategy Matrix/);
  assert.match(markdown, /TypeScript phases: discover 1\.0 ms/);
  assert.match(markdown, /sqlite-direct per-run row deltas: run 0: files \+0, symbols \+0/);
});
