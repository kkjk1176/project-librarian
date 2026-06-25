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

function usage() {
  console.error(`Usage: node benchmarks/tools/code-incremental-performance.js --source-root <dir> [options]

Options:
  --repos <a,b,c>        Source-root child directories to benchmark. Defaults to every directory.
  --changes <n,n>        Changed-file counts. Default: 1,5,10,50,100,500.
  --runs <n>             Repetitions per repo/count/engine. Default: 3.
  --out <file>           JSON output path. Default: stdout only.
  --helper <file>        Native helper path. Default: PROJECT_LIBRARIAN_NATIVE_INDEXER.
  --rust-mode <mode>     Rust comparison mode: incremental or full. Default: incremental.
  --tmp-root <dir>       Workspace root. Default: system temp dir.
  --cli <file>           Project Librarian CLI. Default: dist/init-project-wiki.js.
`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    changes: [1, 5, 10, 50, 100, 500],
    cli: path.resolve("dist/init-project-wiki.js"),
    helper: process.env.PROJECT_LIBRARIAN_NATIVE_INDEXER || "",
    out: "",
    repos: [],
    runs: 3,
    rustMode: "incremental",
    sourceRoot: "",
    tmpRoot: path.join(os.tmpdir(), `project-librarian-incremental-${process.pid}-${Date.now()}`),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--help" || key === "-h") usage();
    if (!key.startsWith("--") || value === undefined) usage();
    index += 1;
    if (key === "--source-root") args.sourceRoot = path.resolve(value);
    else if (key === "--repos") args.repos = value.split(",").map((item) => item.trim()).filter(Boolean);
    else if (key === "--changes") args.changes = value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0);
    else if (key === "--runs") args.runs = Number(value);
    else if (key === "--out") args.out = path.resolve(value);
    else if (key === "--helper") args.helper = path.resolve(value);
    else if (key === "--rust-mode") args.rustMode = value;
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
  if (args.changes.length === 0) throw new Error("--changes must include at least one positive integer");
  if (!["incremental", "full"].includes(args.rustMode)) throw new Error("--rust-mode must be incremental or full");
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
  removePath(target);
  fs.cpSync(source, target, {
    dereference: false,
    errorOnExist: false,
    filter: (sourcePath) => {
      const base = path.basename(sourcePath);
      return base !== ".git" && base !== "node_modules" && base !== ".project-wiki";
    },
    force: true,
    recursive: true,
    verbatimSymlinks: true,
  });
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
  const match = /code_index_phase_timings (\{[^\n]+\})/.exec(stderr);
  if (!match) return {};
  return JSON.parse(match[1]);
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

function openIndex(repoDir) {
  return new DatabaseSync(path.join(repoDir, ".project-wiki", "code-evidence.sqlite"));
}

function rowCounts(repoDir) {
  const db = openIndex(repoDir);
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

function indexedFiles(repoDir) {
  const db = openIndex(repoDir);
  try {
    return db.prepare("SELECT path, profile FROM files WHERE kind = 'source' ORDER BY bytes DESC, path").all();
  } finally {
    db.close();
  }
}

function mutationLine(file, salt) {
  const suffix = `project-librarian incremental benchmark mutation ${salt}`;
  if (file.profile === "python-light") return `\n# ${suffix}\n`;
  if (file.profile === "ruby-light") return `\n# ${suffix}\n`;
  return `\n// ${suffix}\n`;
}

function mutateFiles(repoDir, files, count, salt) {
  const selected = files.slice(0, count);
  for (const file of selected) {
    const absolute = path.join(repoDir, file.path);
    fs.appendFileSync(absolute, mutationLine(file, salt));
  }
  return selected;
}

function medianRun(samples) {
  const selected = samples.slice().sort((left, right) => left.elapsed_ms - right.elapsed_ms)[Math.floor(samples.length / 2)];
  return {
    median_ms: selected.elapsed_ms,
    parsed: selected.parsed,
    samples_ms: samples.map((sample) => sample.elapsed_ms),
    timings: selected.timings,
  };
}

function diffCounts(left, right) {
  const diff = {};
  for (const key of Object.keys(left)) diff[key] = left[key] - right[key];
  return diff;
}

function prepareMutatedRepo(args, sourceRepo, workName, changedCount, salt) {
  const repoDir = path.join(args.tmpRoot, workName);
  copyRepo(sourceRepo, repoDir);
  runCli(repoDir, args.cli, ["--code-index", "--acknowledge-small-repo", "--code-index-full", "--code-index-engine", "native-rust"], {
    PROJECT_LIBRARIAN_NATIVE_INDEXER: args.helper,
  });
  const files = indexedFiles(repoDir);
  mutateFiles(repoDir, files, Math.min(changedCount, files.length), salt);
  return { files, repoDir };
}

function countBenchmarkableFiles(args, sourceRepo, repoName) {
  const repoDir = path.join(args.tmpRoot, `${repoName}-inventory`);
  copyRepo(sourceRepo, repoDir);
  runCli(repoDir, args.cli, ["--code-index", "--acknowledge-small-repo", "--code-index-full", "--code-index-engine", "native-rust"], {
    PROJECT_LIBRARIAN_NATIVE_INDEXER: args.helper,
  });
  const count = indexedFiles(repoDir).length;
  removePath(repoDir);
  return count;
}

function measureEngine(args, sourceRepo, repoName, changedCount, runIndex, engine) {
  let repoDir = "";
  try {
    const prepared = prepareMutatedRepo(args, sourceRepo, `${repoName}-${engine}-${changedCount}-${runIndex}`, changedCount, `${engine}-${runIndex}`);
    repoDir = prepared.repoDir;
    const effectiveChangedCount = Math.min(changedCount, prepared.files.length);
    const cliArgs = engine === "ts-incremental"
      ? ["--code-index", "--acknowledge-small-repo", "--incremental", "--code-index-engine", "typescript"]
      : engine === "rust-incremental"
        ? ["--code-index", "--acknowledge-small-repo", "--incremental", "--code-index-engine", "native-rust"]
        : ["--code-index", "--acknowledge-small-repo", "--code-index-full", "--code-index-engine", "native-rust"];
    const measured = runCli(repoDir, args.cli, cliArgs, {
      PROJECT_LIBRARIAN_NATIVE_INDEXER: args.helper,
    });
    return {
      ...measured,
      counts: rowCounts(repoDir),
      effective_changed_count: effectiveChangedCount,
    };
  } finally {
    if (repoDir) removePath(repoDir);
  }
}

function runBenchmark(args) {
  fs.mkdirSync(args.tmpRoot, { recursive: true });
  const results = [];
  for (const repoName of args.repos) {
    const sourceRepo = path.join(args.sourceRoot, repoName);
    if (!fs.existsSync(sourceRepo)) throw new Error(`repo does not exist under source root: ${repoName}`);
    const benchmarkableFileCount = countBenchmarkableFiles(args, sourceRepo, repoName);
    const effectiveChangeCounts = [...new Set(args.changes.map((count) => Math.min(count, benchmarkableFileCount)).filter((count) => count > 0))];
    for (const changedCount of effectiveChangeCounts) {
      const tsSamples = [];
      const rustSamples = [];
      const rustEngine = args.rustMode === "incremental" ? "rust-incremental" : "rust-full";
      for (let runIndex = 0; runIndex < args.runs; runIndex += 1) {
        tsSamples.push(measureEngine(args, sourceRepo, repoName, changedCount, runIndex, "ts-incremental"));
        rustSamples.push(measureEngine(args, sourceRepo, repoName, changedCount, runIndex, rustEngine));
      }
      const ts = medianRun(tsSamples);
      const rust = medianRun(rustSamples);
      const effectiveChangedCount = Math.min(ts.parsed.reindexed_files ?? changedCount, rust.parsed.reindexed_files ?? changedCount);
      const delta = ((rust.median_ms - ts.median_ms) / ts.median_ms) * 100;
      const rustKey = args.rustMode === "incremental" ? "rust_incremental" : "rust_full";
      results.push({
        repo: repoName,
        baseline_files: rust.parsed.files,
        changed_count: effectiveChangedCount,
        ts_incremental: ts,
        [rustKey]: rust,
        [`${rustKey}_delta_pct_vs_ts_incremental`]: Number(delta.toFixed(1)),
        [`row_delta_ts_vs_${rustKey}`]: diffCounts(tsSamples.find((sample) => sample.elapsed_ms === ts.median_ms)?.counts ?? tsSamples[0].counts, rustSamples.find((sample) => sample.elapsed_ms === rust.median_ms)?.counts ?? rustSamples[0].counts),
      });
      console.error(`${repoName} changed=${effectiveChangedCount} ts=${ts.median_ms.toFixed(1)}ms ${rustKey}=${rust.median_ms.toFixed(1)}ms delta=${delta.toFixed(1)}%`);
    }
  }
  return {
    changeCounts: args.changes,
    generated_at: new Date().toISOString(),
    repos: args.repos,
    results,
    rust_mode: args.rustMode,
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
  process.stdout.write(json);
}

main();
