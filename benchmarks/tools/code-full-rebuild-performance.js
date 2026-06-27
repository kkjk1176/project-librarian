#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const previousEmitWarning = process.emitWarning;
process.emitWarning = ((warning, ...options) => {
  const message = warning instanceof Error ? warning.message : typeof warning === "string" ? warning : "";
  const type = warning instanceof Error
    ? warning.name
    : typeof options[0] === "string"
      ? options[0]
      : typeof options[0]?.type === "string"
        ? options[0].type
        : "";
  if (type === "ExperimentalWarning" && message.includes("SQLite")) return;
  previousEmitWarning.call(process, warning, ...options);
});

const { DatabaseSync } = require("node:sqlite");
const {
  diffCounts,
  maxAbsRowDeltas,
  medianRun,
  pairedRowDeltas,
  parseCodeIndexPhaseTimingsOrThrow,
} = require("../lib/code-benchmark-claim-evidence.js");
const { copyActualRepoFiltered } = require("../lib/actual-repo-materialization.js");
const {
  assertNativeStrategyRequirements,
  defaultNativeStrategy,
  parseNativeStrategies,
} = require("../lib/native-indexer-strategies.js");
const { renderFullRebuildMarkdownReport } = require("../lib/code-benchmark-markdown.js");

function usage() {
  console.error(`Usage: node benchmarks/tools/code-full-rebuild-performance.js --source-root <dir> [options]

Options:
  --repos <a,b,c>        Source-root child directories to benchmark. Defaults to every directory.
  --runs <n>             Repetitions per repo/engine. Default: 3.
  --out <file>           JSON output path. Default: stdout only.
  --markdown <file>      Markdown summary output path. Default: disabled.
  --helper <file>        Native helper path. Default: PROJECT_LIBRARIAN_NATIVE_INDEXER.
  --native-strategies <list>
                         Native helper strategies to measure. Default: sqlite-direct.
  --tmp-root <dir>       Workspace root. Default: system temp dir.
  --cli <file>           Project Librarian CLI. Default: dist/init-project-wiki.js.
`);
  process.exit(2);
}

function parseArgs(argv, options = {}) {
  const args = {
    cli: path.resolve("dist/init-project-wiki.js"),
    helper: process.env.PROJECT_LIBRARIAN_NATIVE_INDEXER || "",
    markdown: "",
    nativeStrategies: [defaultNativeStrategy],
    out: "",
    repos: [],
    runs: 3,
    sourceRoot: "",
    tmpRoot: path.join(os.tmpdir(), `project-librarian-full-rebuild-${process.pid}-${Date.now()}`),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--help" || key === "-h") usage();
    if (!key.startsWith("--") || value === undefined) usage();
    index += 1;
    if (key === "--source-root") args.sourceRoot = path.resolve(value);
    else if (key === "--repos") args.repos = value.split(",").map((item) => item.trim()).filter(Boolean);
    else if (key === "--runs") args.runs = Number(value);
    else if (key === "--out") args.out = path.resolve(value);
    else if (key === "--markdown") args.markdown = path.resolve(value);
    else if (key === "--helper") args.helper = path.resolve(value);
    else if (key === "--native-strategies") args.nativeStrategies = parseNativeStrategies(value);
    else if (key === "--tmp-root") args.tmpRoot = path.resolve(value);
    else if (key === "--cli") args.cli = path.resolve(value);
    else usage();
  }
  if (!args.sourceRoot) usage();
  if (!fs.existsSync(args.sourceRoot)) throw new Error(`source root does not exist: ${args.sourceRoot}`);
  if (!args.helper) throw new Error("--helper or PROJECT_LIBRARIAN_NATIVE_INDEXER is required");
  if (!fs.existsSync(args.helper)) throw new Error(`native helper does not exist: ${args.helper}`);
  if (!fs.existsSync(args.cli)) throw new Error(`CLI does not exist: ${args.cli}`);
  if (!Number.isInteger(args.runs) || args.runs < 1) throw new Error("--runs must be a positive integer");
  args.nativeStrategyRequirements = assertNativeStrategyRequirements(args.nativeStrategies, options);
  if (args.repos.length === 0) {
    args.repos = fs.readdirSync(args.sourceRoot)
      .filter((entry) => fs.statSync(path.join(args.sourceRoot, entry)).isDirectory())
      .sort();
  }
  return args;
}

function removePath(target) {
  fs.rmSync(target, { force: true, recursive: true });
}

function copyRepo(source, target) {
  copyActualRepoFiltered(source, target);
}

function parseKeyValueLines(stdout) {
  const parsed = {};
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const raw = match[2];
    parsed[match[1]] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  }
  return parsed;
}

function parseTimings(stderr) {
  return parseCodeIndexPhaseTimingsOrThrow(stderr);
}

function runCli(repoDir, cli, args, env) {
  const started = process.hrtime.bigint();
  const result = childProcess.spawnSync(process.execPath, [cli, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    env: {
      ...process.env,
      PROJECT_LIBRARIAN_CODE_INDEX_TIMINGS: "1",
      PROJECT_LIBRARIAN_NATIVE_INDEXER_STRATEGY: "sqlite-direct",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  if (result.status !== 0) {
    throw new Error([
      `project-librarian failed in ${repoDir}`,
      `args: ${args.join(" ")}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join("\n"));
  }
  return {
    elapsed_ms: Number(elapsedMs.toFixed(1)),
    parsed: parseKeyValueLines(result.stdout),
    timings: parseTimings(result.stderr),
  };
}

function rowCounts(repoDir) {
  const db = new DatabaseSync(path.join(repoDir, ".project-wiki", "code-evidence.sqlite"));
  try {
    const counts = {};
    for (const table of ["files", "symbols", "imports", "routes", "configs", "edges"]) {
      counts[table] = db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count;
    }
    return counts;
  } finally {
    db.close();
  }
}

function measureEngine(args, sourceRepo, repoName, runIndex, engine, nativeStrategy = defaultNativeStrategy) {
  const strategySuffix = engine === "native-rust" ? `-${nativeStrategy}` : "";
  const repoDir = path.join(args.tmpRoot, `${repoName}-${engine}${strategySuffix}-${runIndex}`);
  try {
    copyRepo(sourceRepo, repoDir);
    const cliArgs = [
      "--code-index",
      "--acknowledge-small-repo",
      "--code-index-full",
      "--code-index-engine",
      engine === "typescript" ? "typescript" : "native-rust",
    ];
    const measured = runCli(repoDir, args.cli, cliArgs, engine === "native-rust"
      ? {
        PROJECT_LIBRARIAN_NATIVE_INDEXER: args.helper,
        PROJECT_LIBRARIAN_NATIVE_INDEXER_STRATEGY: nativeStrategy,
      }
      : {});
    return {
      ...measured,
      counts: rowCounts(repoDir),
      ...(engine === "native-rust" ? { native_strategy: measured.parsed.native_strategy ?? nativeStrategy } : {}),
      run_index: runIndex,
    };
  } finally {
    removePath(repoDir);
  }
}

function runBenchmark(args) {
  fs.mkdirSync(args.tmpRoot, { recursive: true });
  const results = [];
  for (const repoName of args.repos) {
    const sourceRepo = path.join(args.sourceRoot, repoName);
    if (!fs.existsSync(sourceRepo)) throw new Error(`repo does not exist under source root: ${repoName}`);
    const tsSamples = [];
    const rustSamplesByStrategy = new Map(args.nativeStrategies.map((strategy) => [strategy, []]));
    for (let runIndex = 0; runIndex < args.runs; runIndex += 1) {
      tsSamples.push(measureEngine(args, sourceRepo, repoName, runIndex, "typescript"));
      for (const nativeStrategy of args.nativeStrategies) {
        rustSamplesByStrategy.get(nativeStrategy).push(measureEngine(args, sourceRepo, repoName, runIndex, "native-rust", nativeStrategy));
      }
    }
    const ts = medianRun(tsSamples);
    const tsMedian = tsSamples.find((sample) => sample.elapsed_ms === ts.median_ms) ?? tsSamples[0];
    const nativeStrategyMatrix = args.nativeStrategies.map((nativeStrategy) => {
      const rustSamples = rustSamplesByStrategy.get(nativeStrategy);
      const rust = medianRun(rustSamples);
      const rustMedian = rustSamples.find((sample) => sample.elapsed_ms === rust.median_ms) ?? rustSamples[0];
      const rowDeltaRuns = pairedRowDeltas(tsSamples, rustSamples);
      const delta = ((rust.median_ms - ts.median_ms) / ts.median_ms) * 100;
      return {
        strategy: nativeStrategy,
        rust_full: rust,
        rust_full_delta_pct_vs_ts_full: Number(delta.toFixed(1)),
        row_delta_ts_vs_rust_full: diffCounts(tsMedian.counts, rustMedian.counts),
        row_delta_runs_ts_vs_rust_full: rowDeltaRuns,
        max_abs_row_delta_ts_vs_rust_full: maxAbsRowDeltas(rowDeltaRuns),
      };
    });
    const defaultNativeEntry = nativeStrategyMatrix.find((entry) => entry.strategy === defaultNativeStrategy);
    results.push({
      repo: repoName,
      files: defaultNativeEntry.rust_full.parsed.files ?? ts.parsed.files ?? defaultNativeEntry.rust_full.counts?.files ?? ts.counts?.files ?? null,
      native_files: defaultNativeEntry.rust_full.parsed.native_files ?? null,
      typescript_files: defaultNativeEntry.rust_full.parsed.typescript_files ?? null,
      native_strategy_matrix: nativeStrategyMatrix,
      ts_full: ts,
      rust_full: defaultNativeEntry.rust_full,
      rust_full_delta_pct_vs_ts_full: defaultNativeEntry.rust_full_delta_pct_vs_ts_full,
      row_delta_ts_vs_rust_full: defaultNativeEntry.row_delta_ts_vs_rust_full,
      row_delta_runs_ts_vs_rust_full: defaultNativeEntry.row_delta_runs_ts_vs_rust_full,
      max_abs_row_delta_ts_vs_rust_full: defaultNativeEntry.max_abs_row_delta_ts_vs_rust_full,
    });
    const strategySummary = nativeStrategyMatrix
      .map((entry) => `${entry.strategy}=${entry.rust_full.median_ms.toFixed(1)}ms/${entry.rust_full_delta_pct_vs_ts_full.toFixed(1)}%`)
      .join(" ");
    console.error(`${repoName} ts=${ts.median_ms.toFixed(1)}ms ${strategySummary}`);
  }
  return {
    generated_at: new Date().toISOString(),
    native_strategy_requirements: args.nativeStrategyRequirements,
    native_strategies: args.nativeStrategies,
    repos: args.repos,
    results,
    runs: args.runs,
    sourceRoot: args.sourceRoot,
    tmpRoot: args.tmpRoot,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = runBenchmark(args);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, json);
  }
  if (args.markdown) {
    fs.mkdirSync(path.dirname(args.markdown), { recursive: true });
    fs.writeFileSync(args.markdown, renderFullRebuildMarkdownReport(report));
  }
  process.stdout.write(json);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  parseKeyValueLines,
  parseTimings,
  renderFullRebuildMarkdownReport,
  runBenchmark,
};
