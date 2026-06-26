"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { parseArgs, parseTimings } = require("../../benchmarks/tools/code-full-rebuild-performance.js");
const { renderFullRebuildMarkdownReport } = require("../../benchmarks/lib/code-benchmark-markdown.js");
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

test("full rebuild benchmark records native strategy availability before measurement", () => {
  const fixture = parseArgsFixture();
  try {
    assert.throws(
      () => parseArgs([
        "--source-root", fixture.sourceRoot,
        "--repos", "sample",
        "--helper", fixture.helper,
        "--cli", fixture.cli,
        "--native-strategies", "sqlite-direct,sqlite-bridge",
      ], { commandAvailable: () => false }),
      /sqlite-bridge requires command sqlite3/,
    );

    const args = parseArgs([
      "--source-root", fixture.sourceRoot,
      "--repos", "sample",
      "--helper", fixture.helper,
      "--cli", fixture.cli,
      "--native-strategies", "sqlite-direct,sqlite-bridge",
    ], { commandAvailable: (command) => command === "sqlite3" });

    assert.deepEqual(args.nativeStrategies, ["sqlite-direct", "sqlite-bridge"]);
    assert.deepEqual(args.nativeStrategyRequirements.map((entry) => ({
      requirements: entry.requirements,
      status: entry.status,
      strategy: entry.strategy,
    })), [
      { requirements: [], status: "available", strategy: "sqlite-direct" },
      {
        requirements: [{ type: "command", name: "sqlite3", status: "available" }],
        status: "available",
        strategy: "sqlite-bridge",
      },
    ]);
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

test("full rebuild markdown exposes strategy matrix and row-delta evidence", () => {
  const markdown = renderFullRebuildMarkdownReport({
    generated_at: "2026-06-26T00:00:00.000Z",
    native_strategy_requirements: [
      {
        provenance: "native/indexer-rs/src/main.rs sqlite3-direct-ffi output mode",
        requirements: [],
        status: "available",
        strategy: "sqlite-direct",
      },
      {
        provenance: "native/indexer-rs/src/main.rs row-stream output, consumed by src/code-index/native-helper.ts",
        requirements: [],
        status: "available",
        strategy: "row-stream",
      },
    ],
    native_strategies: ["sqlite-direct", "row-stream"],
    results: [
      {
        repo: "sample",
        files: 2,
        ts_full: { median_ms: 100, timings: { discover_files_ms: 1, read_files_ms: 2, sqlite_write_ms: 3, total_ms: 6 } },
        rust_full: { median_ms: 80, timings: { discover_files_ms: 1, native_helper_ms: 2, total_ms: 3 } },
        rust_full_delta_pct_vs_ts_full: -20,
        max_abs_row_delta_ts_vs_rust_full: { files: 0, symbols: 0 },
        row_delta_runs_ts_vs_rust_full: [{ run_index: 0, row_delta: { files: 0, symbols: 0 } }],
        native_strategy_matrix: [
          {
            strategy: "sqlite-direct",
            rust_full: { median_ms: 80, timings: { native_helper_ms: 2, total_ms: 3 } },
            rust_full_delta_pct_vs_ts_full: -20,
            max_abs_row_delta_ts_vs_rust_full: { files: 0, symbols: 0 },
            row_delta_runs_ts_vs_rust_full: [{ run_index: 0, row_delta: { files: 0, symbols: 0 } }],
          },
          {
            strategy: "row-stream",
            rust_full: { median_ms: 70, timings: { native_helper_ms: 1, total_ms: 2 } },
            rust_full_delta_pct_vs_ts_full: -30,
            max_abs_row_delta_ts_vs_rust_full: { files: 0, symbols: 0 },
            row_delta_runs_ts_vs_rust_full: [{ run_index: 0, row_delta: { files: 0, symbols: 0 } }],
          },
        ],
      },
    ],
    runs: 1,
    sourceRoot: "/tmp/samples",
  });

  assert.match(markdown, /Top-level release comparison: sqlite-direct/);
  assert.match(markdown, /Native Strategy Availability/);
  assert.match(markdown, /sqlite-direct \| available \| helper binary only/);
  assert.match(markdown, /Native Strategy Matrix/);
  assert.match(markdown, /row-stream/);
  assert.match(markdown, /TypeScript phases: discover 1\.0 ms/);
  assert.match(markdown, /sqlite-direct per-run row deltas: run 0: files \+0, symbols \+0/);
});
