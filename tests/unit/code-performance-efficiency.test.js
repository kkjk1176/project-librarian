"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  bestVariantDecision,
  markdownReport,
  normalizeRows,
  parseCodeIndexOutput,
  parseCodeIndexPhaseTimings,
  sampleCorpusDefinitions,
} = require("../../benchmarks/tools/code-performance-efficiency.js");

function listFiles(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = `${root}/${entry.name}`;
    if (entry.isDirectory()) return listFiles(fullPath);
    return [fullPath];
  });
}

test("code performance harness includes diverse checked-in sample corpora", () => {
  const samples = sampleCorpusDefinitions();
  const mixed = samples.find((sample) => sample.name === "mixed-monorepo");
  const kinds = new Set(samples.map((sample) => sample.corpus_kind));

  assert(samples.length >= 4, "expected at least four checked-in sample corpora");
  assert(kinds.has("mixed"), "missing mixed corpus coverage");
  assert(kinds.has("service"), "missing service corpus coverage");
  assert(kinds.has("single-language"), "missing single-language corpus coverage");
  assert(kinds.has("docs-heavy"), "missing docs-heavy corpus coverage");
  assert(mixed, "missing mixed-monorepo sample corpus");
  assert.equal(mixed.corpus_kind, "mixed");
  assert.equal(mixed.terms.symbol, "getBillingSummary");

  let totalFiles = 0;
  for (const sample of samples) {
    assert(fs.existsSync(sample.source), `${sample.name} source path should exist`);
    const files = listFiles(sample.source);
    totalFiles += files.length;
    assert(files.length >= 7, `${sample.name} should include enough files for mixed-repo signal`);
    assert(sample.terms.file, `${sample.name} should define a representative file query`);
    assert(sample.terms.symbol, `${sample.name} should define a representative symbol query`);
    assert(sample.terms.route, `${sample.name} should define a representative route query`);
    assert(sample.terms.import, `${sample.name} should define a representative import query`);
    assert(sample.terms.edge, `${sample.name} should define a representative edge query`);
  }
  assert(totalFiles >= 40, "checked-in sample corpora should not shrink below mixed-corpus scale");
});

test("normalizes query rows with stable key order for parity hashing", () => {
  assert.deepEqual(
    normalizeRows([
      { z: "last", a: 1 },
      { b: null, a: "first" },
    ]),
    [
      { a: 1, z: "last" },
      { a: "first", b: null },
    ],
  );
});

test("variant decision requires parity before threshold adoption", () => {
  const quickDiagnostic = bestVariantDecision([
    { name: "current", search_parity: { status: "passed" }, size_delta_percent_vs_current: 0, query_group_deltas_vs_current: {} },
    { name: "contentless-delete-rowid", search_parity: { status: "passed" }, size_delta_percent_vs_current: -40, query_group_deltas_vs_current: {} },
  ], { runsPerCommand: 1 });
  assert.match(quickDiagnostic, /quick FTS variant diagnostic/);

  const failedParity = bestVariantDecision([
    { name: "current", search_parity: { status: "passed" }, size_delta_percent_vs_current: 0, query_group_deltas_vs_current: {} },
    { name: "contentless-delete-rowid", search_parity: { status: "failed" }, size_delta_percent_vs_current: -40, query_group_deltas_vs_current: {} },
  ], { runsPerCommand: 3 });
  assert.match(failedParity, /no candidate FTS variant preserved search parity/);

  const storageWin = bestVariantDecision([
    { name: "current", search_parity: { status: "passed" }, size_delta_percent_vs_current: 0, query_group_deltas_vs_current: {} },
    {
      name: "external-content-rowid",
      search_parity: { status: "passed" },
      size_delta_percent_vs_current: -35,
      query_group_deltas_vs_current: { file_search_path: { p95_delta_percent: -5 } },
    },
  ], { runsPerCommand: 3 });
  assert.match(storageWin, /crosses the DB-size adoption threshold/);

  const partialLatencyWin = bestVariantDecision([
    { name: "current", search_parity: { status: "passed" }, size_delta_percent_vs_current: 0, query_group_deltas_vs_current: {} },
    {
      name: "contentless-delete-rowid",
      search_parity: { status: "passed" },
      size_delta_percent_vs_current: -10,
      query_group_deltas_vs_current: {
        file_search_path: { p95_delta_percent: -30 },
        symbol_search_single_token: { p95_delta_percent: -5 },
        symbol_search_multi_token: { p95_delta_percent: -25 },
      },
    },
  ], { runsPerCommand: 3 });
  assert.match(partialLatencyWin, /do not cross storage or latency adoption thresholds/);

  const fullLatencyWin = bestVariantDecision([
    { name: "current", search_parity: { status: "passed" }, size_delta_percent_vs_current: 0, query_group_deltas_vs_current: {} },
    {
      name: "contentless-delete-rowid",
      search_parity: { status: "passed" },
      size_delta_percent_vs_current: 1,
      query_group_deltas_vs_current: {
        file_search_path: { p95_delta_percent: -30 },
        symbol_search_single_token: { p95_delta_percent: -25 },
        symbol_search_multi_token: { p95_delta_percent: -20 },
      },
    },
  ], { runsPerCommand: 3 });
  assert.match(fullLatencyWin, /crosses the p95 query-latency threshold/);
});

test("parses opt-in code index phase timings", () => {
  assert.deepEqual(
    parseCodeIndexPhaseTimings("notice\ncode_index_phase_timings {\"discover_files_ms\":1.25,\"total_ms\":9}\n"),
    { discover_files_ms: 1.25, total_ms: 9 },
  );
  assert.equal(parseCodeIndexPhaseTimings("no timings\n"), null);
});

test("parses code index stdout summary fields", () => {
  assert.deepEqual(
    parseCodeIndexOutput("Code index: .project-wiki/code-evidence.sqlite\nengine: mixed-native-rust\nnative_strategy: sqlite-direct\nnative_files: 12\ntypescript_files: 1\ntypescript_profiles: config\n"),
    {
      engine: "mixed-native-rust",
      native_strategy: "sqlite-direct",
      native_files: 12,
      typescript_files: 1,
      typescript_profiles: "config",
    },
  );
});

test("markdown report renders FTS variants and parity status", () => {
  const report = markdownReport({
    generated_at: "2026-06-21T00:00:00.000Z",
    node: "v22.19.0",
    native_comparison: { requested: true, enabled: true, mode: "auto", helper_path: "native/indexer-rs/target/debug/project-librarian-indexer", strategies: ["sqlite-direct", "row-stream"] },
    decisions: { fts: "candidate FTS variants preserve parity", build: "build tracked" },
    scales: [
      {
        file_count: 10000,
        index_time_ms: 100,
        phase_timings: { discover_files_ms: 1, read_files_ms: 2, sqlite_write_ms: 3, total_ms: 10 },
        native_index: {
          engine: "mixed-native-rust",
          index_time_ms: 80,
          index_time_delta_percent_vs_typescript: -20,
          phase_timings: { native_helper_ms: 70, total_ms: 82 },
          native_files: 10000,
          typescript_files: 1,
          typescript_profiles: "config",
          row_deltas_vs_typescript: { files: 0, symbols: 0 },
          strategy: "sqlite-direct",
        },
        native_indexes: [
          {
            engine: "mixed-native-rust",
            index_time_ms: 90,
            index_time_delta_percent_vs_typescript: -10,
            strategy: "row-stream",
            row_deltas_vs_typescript: { files: 0, symbols: 0 },
          },
          {
            engine: "mixed-native-rust",
            index_time_ms: 80,
            index_time_delta_percent_vs_typescript: -20,
            strategy: "sqlite-direct",
            row_deltas_vs_typescript: { files: 0, symbols: 0 },
          },
        ],
        current_db: { file_bytes: 1000 },
        contentless_fts_db: { file_bytes: 750 },
        contentless_fts_size_delta_percent: -25,
        commands: { code_status: { median_ms: 10, p95_ms: 12, runs: 1 } },
        query_plans: { file_prefix_like: ["SCAN files"], file_fts_match: ["SCAN files_fts"] },
        query_groups: { file_search_path: { median_ms: 1, p95_ms: 2, rows: 1, runs: 1 } },
        fts_variants: [
          {
            name: "current",
            db: { file_bytes: 1000 },
            size_delta_percent_vs_current: 0,
            search_parity: { status: "passed" },
            query_group_deltas_vs_current: {},
            query_plans: { file_fts_match: ["SCAN files_fts"], symbol_fts_match: ["SCAN symbols_fts"] },
          },
          {
            name: "contentless-delete-rowid",
            db: { file_bytes: 750 },
            size_delta_percent_vs_current: -25,
            search_parity: { status: "passed" },
            query_group_deltas_vs_current: { file_search_path: { p95_delta_percent: -10 } },
            query_plans: { file_fts_match: ["SCAN files_fts"], symbol_fts_match: ["SCAN symbols_fts"] },
          },
        ],
      },
    ],
    sample_corpora: [],
  });

  assert.match(report, /FTS variant contentless-delete-rowid: 750 bytes \(-25\.0% vs current\), parity passed/);
  assert.match(report, /Index phases: discover 1\.0 ms, read 2\.0 ms, sqlite 3\.0 ms, total 10\.0 ms/);
  assert.match(report, /Native comparison: enabled \(auto, native\/indexer-rs\/target\/debug\/project-librarian-indexer\)/);
  assert.match(report, /Fastest native strategy: sqlite-direct \(80\.0 ms\)/);
  assert.match(report, /Native index sqlite-direct \(mixed-native-rust\): 80\.0 ms \(-20\.0% vs TypeScript\)/);
  assert.match(report, /Fastest native partition: native_files 10000, typescript_files 1, typescript_profiles config/);
  assert.match(report, /Fastest native row deltas vs TypeScript: files \+0, symbols \+0/);
  assert.match(report, /Variant direct DB deltas vs current/);
  assert.match(report, /file_search_path p95 -10\.0%/);
});
