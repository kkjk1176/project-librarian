"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const repoRoot = path.resolve(__dirname, "..", "..");
const cliPath = path.join(repoRoot, "dist", "init-project-wiki.js");
const reportDir = path.join(repoRoot, "benchmarks", "reports", "code-performance-efficiency");
const { searchFiles, searchSymbols } = require(path.join(repoRoot, "dist", "code-index", "search.js"));
const defaultScales = process.argv.includes("--full") ? [3000, 10000, 50000] : [3000, 10000];
const runsPerCommand = process.argv.includes("--quick") ? 1 : 3;

function sampleCorpusDefinitions() {
  return [
    {
      name: "mixed-monorepo",
      corpus_kind: "mixed",
      source: path.join(repoRoot, "benchmarks", "samples", "mixed-monorepo"),
      terms: {
        file: "summary",
        symbol: "getBillingSummary",
        route: "admin",
        import: "billing",
        edge: "getBillingSummary",
      },
    },
    {
      name: "web-service",
      corpus_kind: "service",
      source: path.join(repoRoot, "benchmarks", "samples", "web-service"),
      terms: {
        file: "server",
        symbol: "sampleHealthHandler",
        route: "sample",
        import: "express",
        edge: "sampleHealthHandler",
      },
    },
    {
      name: "python-cli",
      corpus_kind: "single-language",
      source: path.join(repoRoot, "benchmarks", "samples", "python-cli"),
      terms: {
        file: "cli",
        symbol: "SampleCli",
        route: "cli",
        import: "argparse",
        edge: "SampleCli",
      },
    },
    {
      name: "docs-heavy",
      corpus_kind: "docs-heavy",
      source: path.join(repoRoot, "benchmarks", "samples", "docs-heavy"),
      terms: {
        file: "manifest",
        symbol: "docsSearchIndex",
        route: "docs",
        import: "navigation",
        edge: "docsSearchIndex",
      },
    },
  ];
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function run(command, args, options = {}) {
  const started = process.hrtime.bigint();
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return { elapsedMs, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarizeTimings(samples) {
  return {
    runs: samples.length,
    min_ms: Math.min(...samples),
    median_ms: percentile(samples, 50),
    p95_ms: percentile(samples, 95),
    max_ms: Math.max(...samples),
  };
}

function writeFixture(root, fileCount) {
  mkdirp(path.join(root, "src"));
  run("git", ["init", "-q"], { cwd: root });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "code-performance-fixture", dependencies: {} }, null, 2));
  fs.writeFileSync(path.join(root, "src", "shared.js"), [
    "export function shared(value) {",
    "  return String(value);",
    "}",
    "",
  ].join("\n"));
  const width = String(fileCount).length;
  for (let index = 0; index < fileCount; index += 1) {
    const shard = String(Math.floor(index / 500)).padStart(3, "0");
    const name = String(index).padStart(width, "0");
    const dir = path.join(root, "src", `shard-${shard}`);
    mkdirp(dir);
    const routeLine = index % 200 === 0
      ? `export const route${name} = "/api/items/${name}";`
      : `export const route${name} = "";`;
    fs.writeFileSync(path.join(dir, `handler-${name}.js`), [
      "import { shared } from \"../shared.js\";",
      `export function handler${name}(input) {`,
      `  return shared("${name}") + String(input ?? "");`,
      "}",
      routeLine,
      "",
    ].join("\n"));
  }
}

function openDatabase(dbPath) {
  return new DatabaseSync(dbPath);
}

function scalar(db, sql) {
  const row = db.prepare(sql).get();
  const values = Object.values(row ?? {});
  return Number(values[0] ?? 0);
}

function databaseStats(dbPath) {
  const db = openDatabase(dbPath);
  try {
    const pageCount = scalar(db, "PRAGMA page_count");
    const pageSize = scalar(db, "PRAGMA page_size");
    const counts = Object.fromEntries(db.prepare(`
      SELECT 'files' AS table_name, count(*) AS rows FROM files
      UNION ALL SELECT 'symbols', count(*) FROM symbols
      UNION ALL SELECT 'imports', count(*) FROM imports
      UNION ALL SELECT 'routes', count(*) FROM routes
      UNION ALL SELECT 'edges', count(*) FROM edges
    `).all().map((row) => [String(row.table_name), Number(row.rows)]));
    return {
      file_bytes: fs.statSync(dbPath).size,
      page_count: pageCount,
      page_size: pageSize,
      page_bytes: pageCount * pageSize,
      rows: counts,
    };
  } finally {
    db.close();
  }
}

function queryPlans(dbPath, term) {
  const db = openDatabase(dbPath);
  const contains = `%${term}%`;
  const prefix = `${term}%`;
  try {
    const plans = {
      file_prefix_like: db.prepare("EXPLAIN QUERY PLAN SELECT path FROM files WHERE path LIKE ? ESCAPE '\\' ORDER BY path LIMIT 25").all(prefix),
      file_contains_like: db.prepare("EXPLAIN QUERY PLAN SELECT path FROM files WHERE path LIKE ? ESCAPE '\\' ORDER BY path LIMIT 25").all(contains),
      symbol_contains_like: db.prepare("EXPLAIN QUERY PLAN SELECT name, file_path FROM symbols WHERE name LIKE ? ESCAPE '\\' OR signature LIKE ? ESCAPE '\\' OR file_path LIKE ? ESCAPE '\\' ORDER BY file_path, line LIMIT 50").all(contains, contains, contains),
      route_contains_like: db.prepare("EXPLAIN QUERY PLAN SELECT method, route, file_path FROM routes WHERE route LIKE ? ESCAPE '\\' OR handler LIKE ? ESCAPE '\\' OR file_path LIKE ? ESCAPE '\\' ORDER BY file_path, line LIMIT 50").all(contains, contains, contains),
      import_contains_like: db.prepare("EXPLAIN QUERY PLAN SELECT from_file, to_ref FROM imports WHERE from_file LIKE ? ESCAPE '\\' OR to_ref LIKE ? ESCAPE '\\' OR imported LIKE ? ESCAPE '\\' ORDER BY from_file, line LIMIT 75").all(contains, contains, contains),
    };
    return Object.fromEntries(Object.entries(plans).map(([key, rows]) => [key, rows.map((row) => String(row.detail ?? JSON.stringify(row)))]));
  } finally {
    db.close();
  }
}

function createContentlessFtsExperiment(sourceDbPath, targetDbPath) {
  fs.rmSync(targetDbPath, { force: true });
  const source = openDatabase(sourceDbPath);
  const target = openDatabase(targetDbPath);
  try {
    target.exec(`
      PRAGMA journal_mode = OFF;
      CREATE TABLE files (
        path TEXT PRIMARY KEY,
        language TEXT NOT NULL,
        profile TEXT NOT NULL,
        kind TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        lines INTEGER NOT NULL,
        hash TEXT NOT NULL,
        mtime_ms REAL NOT NULL,
        size INTEGER NOT NULL
      );
      CREATE TABLE symbols (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        file_path TEXT NOT NULL,
        line INTEGER NOT NULL,
        signature TEXT NOT NULL
      );
      CREATE TABLE imports (
        id INTEGER PRIMARY KEY,
        from_file TEXT NOT NULL,
        to_ref TEXT NOT NULL,
        imported TEXT NOT NULL,
        line INTEGER NOT NULL,
        raw TEXT NOT NULL
      );
      CREATE TABLE routes (
        id INTEGER PRIMARY KEY,
        method TEXT NOT NULL,
        route TEXT NOT NULL,
        file_path TEXT NOT NULL,
        line INTEGER NOT NULL,
        handler TEXT NOT NULL
      );
      CREATE TABLE configs (
        id INTEGER PRIMARY KEY,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        file_path TEXT NOT NULL,
        line INTEGER NOT NULL
      );
      CREATE TABLE edges (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target TEXT NOT NULL,
        file_path TEXT NOT NULL,
        line INTEGER NOT NULL,
        evidence TEXT NOT NULL
      );
      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE files_fts USING fts5(path, language, profile, content, content='', contentless_delete=1);
      CREATE VIRTUAL TABLE symbols_fts USING fts5(name, kind, file_path, signature, content='', contentless_delete=1);
      CREATE INDEX idx_symbols_file ON symbols(file_path);
      CREATE INDEX idx_symbols_name ON symbols(name);
      CREATE INDEX idx_imports_from ON imports(from_file);
      CREATE INDEX idx_routes_path ON routes(route);
      CREATE INDEX idx_configs_file ON configs(file_path);
      CREATE INDEX idx_edges_source ON edges(source_kind, source);
      CREATE INDEX idx_edges_target ON edges(target_kind, target);
      CREATE INDEX idx_edges_kind ON edges(kind);
    `);
    const insertFile = target.prepare("INSERT INTO files (rowid, path, language, profile, kind, bytes, lines, hash, mtime_ms, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertFileFts = target.prepare("INSERT INTO files_fts (rowid, path, language, profile, content) VALUES (?, ?, ?, ?, ?)");
    const insertSymbol = target.prepare("INSERT INTO symbols (id, name, kind, file_path, line, signature) VALUES (?, ?, ?, ?, ?, ?)");
    const insertSymbolFts = target.prepare("INSERT INTO symbols_fts (rowid, name, kind, file_path, signature) VALUES (?, ?, ?, ?, ?)");
    target.exec("BEGIN");
    for (const row of source.prepare(`
      SELECT files.rowid AS rowid, files.path, files.language, files.profile, files.kind, files.bytes, files.lines, files.hash, files.mtime_ms, files.size, files_fts.content AS content
      FROM files
      JOIN files_fts ON files.path = files_fts.path
      ORDER BY files.rowid
    `).all()) {
      insertFile.run(row.rowid, row.path, row.language, row.profile, row.kind, row.bytes, row.lines, row.hash, row.mtime_ms, row.size);
      insertFileFts.run(row.rowid, row.path, row.language, row.profile, row.content);
    }
    for (const row of source.prepare("SELECT id, name, kind, file_path, line, signature FROM symbols ORDER BY id").all()) {
      insertSymbol.run(row.id, row.name, row.kind, row.file_path, row.line, row.signature);
      insertSymbolFts.run(row.id, row.name, row.kind, row.file_path, row.signature);
    }
    for (const table of ["imports", "routes", "configs", "edges", "meta"]) {
      const columns = source.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name));
      const quoted = columns.map((column) => `"${column}"`).join(", ");
      const placeholders = columns.map(() => "?").join(", ");
      const insert = target.prepare(`INSERT INTO ${table} (${quoted}) VALUES (${placeholders})`);
      for (const row of source.prepare(`SELECT ${quoted} FROM ${table}`).all()) {
        insert.run(...columns.map((column) => row[column]));
      }
    }
    target.exec("COMMIT");
    target.exec("VACUUM");
  } catch (error) {
    try {
      target.exec("ROLLBACK");
    } catch {
      // Ignore rollback failures after setup errors.
    }
    throw error;
  } finally {
    source.close();
    target.close();
  }
  return databaseStats(targetDbPath);
}

function measureCommands(cwd, scale) {
  const width = String(scale).length;
  const target = `handler${String(scale - 1).padStart(width, "0")}`;
  const commands = {
    code_status: ["--code-status"],
    code_context_pack: ["--code-context-pack", target],
    code_impact: ["--code-impact", "shared"],
    code_report_coverage: ["--code-report", "--code-report-section", "coverage"],
  };
  const measured = {};
  for (const [name, args] of Object.entries(commands)) {
    const samples = [];
    for (let runIndex = 0; runIndex < runsPerCommand; runIndex += 1) {
      samples.push(run(process.execPath, [cliPath, ...args], { cwd }).elapsedMs);
    }
    measured[name] = summarizeTimings(samples);
  }
  return measured;
}

function measureSampleCommands(cwd, sample) {
  const commands = {
    code_status: ["--code-status"],
    code_files: ["--code-files"],
    code_search_symbol: ["--code-search-symbol", sample.terms.symbol],
    code_context_pack: ["--code-context-pack", sample.terms.symbol],
  };
  const measured = {};
  for (const [name, args] of Object.entries(commands)) {
    const samples = [];
    for (let runIndex = 0; runIndex < runsPerCommand; runIndex += 1) {
      samples.push(run(process.execPath, [cliPath, ...args], { cwd }).elapsedMs);
    }
    measured[name] = summarizeTimings(samples);
  }
  return measured;
}

function likePattern(term) {
  return `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function measureDatabaseQueryGroupsForTerms(dbPath, terms) {
  const groups = {
    file_search_path: (db) => searchFiles(db, terms.file, 25),
    symbol_search_single_token: (db) => searchSymbols(db, terms.symbol, 50),
    symbol_search_multi_token: (db) => searchSymbols(db, `${terms.symbol} ${terms.file}`, 50),
    route_contains: (db) => {
      const like = likePattern(terms.route);
      return db.prepare("SELECT method, route, file_path FROM routes WHERE route LIKE ? ESCAPE '\\' OR handler LIKE ? ESCAPE '\\' OR file_path LIKE ? ESCAPE '\\' ORDER BY file_path, line LIMIT 50").all(like, like, like);
    },
    import_contains: (db) => {
      const like = likePattern(terms.import);
      return db.prepare("SELECT from_file, to_ref FROM imports WHERE from_file LIKE ? ESCAPE '\\' OR to_ref LIKE ? ESCAPE '\\' OR imported LIKE ? ESCAPE '\\' ORDER BY from_file, line LIMIT 75").all(like, like, like);
    },
    edge_contains: (db) => {
      const like = likePattern(terms.edge);
      return db.prepare("SELECT kind, source, target, file_path FROM edges WHERE file_path LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\' OR evidence LIKE ? ESCAPE '\\' ORDER BY file_path, line LIMIT 100").all(like, like, like, like);
    },
  };
  const measured = {};
  for (const [name, query] of Object.entries(groups)) {
    const samples = [];
    let rows = 0;
    for (let runIndex = 0; runIndex < runsPerCommand; runIndex += 1) {
      const db = openDatabase(dbPath);
      const started = process.hrtime.bigint();
      try {
        rows = query(db).length;
      } finally {
        samples.push(Number(process.hrtime.bigint() - started) / 1_000_000);
        db.close();
      }
    }
    measured[name] = { ...summarizeTimings(samples), rows };
  }
  return measured;
}

function measureDatabaseQueryGroups(dbPath, scale) {
  const width = String(scale).length;
  const target = `handler${String(scale - 1).padStart(width, "0")}`;
  return measureDatabaseQueryGroupsForTerms(dbPath, {
    file: `handler-${String(scale - 1).padStart(width, "0")}`,
    symbol: target,
    route: "api/items",
    import: "shared",
    edge: "handler",
  });
}

function materializeSampleCorpus(sample, tmpRoot) {
  const cwd = path.join(tmpRoot, `sample-${sample.name}`);
  fs.cpSync(sample.source, cwd, { recursive: true });
  return cwd;
}

function measureBuildCommands() {
  const commands = {
    build: ["npm", ["run", "build"]],
    typecheck: ["npm", ["run", "typecheck"]],
  };
  const measured = {};
  for (const [name, [command, args]] of Object.entries(commands)) {
    measured[name] = summarizeTimings([run(command, args).elapsedMs]);
  }
  return measured;
}

function markdownReport(result) {
  const lines = [
    "# Code Performance Efficiency Report",
    "",
    `Generated: ${result.generated_at}`,
    `Node: ${result.node}`,
    "",
    "## Summary",
    "",
    `- FTS decision: ${result.decisions.fts}`,
    `- Build decision: ${result.decisions.build}`,
    "",
    "## Scales",
    "",
  ];
  for (const scale of result.scales) {
    lines.push(`### ${scale.file_count} files`);
    lines.push("");
    lines.push(`- Index time: ${scale.index_time_ms.toFixed(1)} ms`);
    lines.push(`- Current DB size: ${scale.current_db.file_bytes} bytes`);
    lines.push(`- Contentless FTS experiment size: ${scale.contentless_fts_db.file_bytes} bytes (${scale.contentless_fts_size_delta_percent.toFixed(1)}%)`);
    for (const [command, timing] of Object.entries(scale.commands)) {
      lines.push(`- ${command}: median ${timing.median_ms.toFixed(1)} ms, p95 ${timing.p95_ms.toFixed(1)} ms (${timing.runs} runs)`);
    }
    lines.push("");
  }
  lines.push("## Query Plans");
  for (const scale of result.scales) {
    lines.push("");
    lines.push(`### ${scale.file_count} files`);
    for (const [name, rows] of Object.entries(scale.query_plans)) {
      lines.push(`- ${name}: ${rows.join(" | ")}`);
    }
  }
  lines.push("");
  lines.push("## Query Groups");
  lines.push("");
  lines.push("Direct DB query timings exclude CLI startup and staleness checks.");
  for (const scale of result.scales) {
    lines.push("");
    lines.push(`### ${scale.file_count} files`);
    for (const [name, timing] of Object.entries(scale.query_groups)) {
      lines.push(`- ${name}: median ${timing.median_ms.toFixed(1)} ms, p95 ${timing.p95_ms.toFixed(1)} ms, rows ${timing.rows} (${timing.runs} runs)`);
    }
  }
  lines.push("");
  lines.push("## Sample Corpora");
  lines.push("");
  lines.push("Checked-in sample corpora are measured separately from synthetic scale fixtures.");
  for (const sample of result.sample_corpora) {
    lines.push("");
    lines.push(`### ${sample.name} (${sample.corpus_kind})`);
    lines.push(`- Indexed files: ${sample.current_db.rows.files}`);
    lines.push(`- Index time: ${sample.index_time_ms.toFixed(1)} ms`);
    lines.push(`- Current DB size: ${sample.current_db.file_bytes} bytes`);
    for (const [command, timing] of Object.entries(sample.commands)) {
      lines.push(`- ${command}: median ${timing.median_ms.toFixed(1)} ms, p95 ${timing.p95_ms.toFixed(1)} ms (${timing.runs} runs)`);
    }
    for (const [name, timing] of Object.entries(sample.query_groups)) {
      lines.push(`- query ${name}: median ${timing.median_ms.toFixed(1)} ms, rows ${timing.rows} (${timing.runs} runs)`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  if (!fs.existsSync(cliPath)) {
    throw new Error(`missing built CLI at ${cliPath}; run npm run build first`);
  }
  mkdirp(reportDir);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "code-perf-efficiency-"));
  const result = {
    generated_at: new Date().toISOString(),
    node: process.version,
    runs_per_command: runsPerCommand,
    scales: [],
    sample_corpora: [],
    build_commands: {},
    decisions: {},
  };
  try {
    for (const scale of defaultScales) {
      const cwd = path.join(tmpRoot, `repo-${scale}`);
      mkdirp(cwd);
      writeFixture(cwd, scale);
      const indexRun = run(process.execPath, [cliPath, "--code-index", "--acknowledge-small-repo", "--code-scope", "src", "--code-scope", "package.json"], { cwd });
      const dbPath = path.join(cwd, ".project-wiki", "code-evidence.sqlite");
      const altDbPath = path.join(cwd, ".project-wiki", "code-evidence-contentless-fts.sqlite");
      const currentDb = databaseStats(dbPath);
      const contentlessFtsDb = createContentlessFtsExperiment(dbPath, altDbPath);
      result.scales.push({
        file_count: scale,
        index_time_ms: indexRun.elapsedMs,
        current_db: currentDb,
        contentless_fts_db: contentlessFtsDb,
        contentless_fts_size_delta_percent: ((contentlessFtsDb.file_bytes - currentDb.file_bytes) / currentDb.file_bytes) * 100,
        commands: measureCommands(cwd, scale),
        query_groups: measureDatabaseQueryGroups(dbPath, scale),
        query_plans: queryPlans(dbPath, "handler"),
      });
    }
    for (const sample of sampleCorpusDefinitions()) {
      const cwd = materializeSampleCorpus(sample, tmpRoot);
      const indexRun = run(process.execPath, [cliPath, "--code-index", "--acknowledge-small-repo", "--code-scope", "."], { cwd });
      const dbPath = path.join(cwd, ".project-wiki", "code-evidence.sqlite");
      result.sample_corpora.push({
        name: sample.name,
        corpus_kind: sample.corpus_kind,
        index_time_ms: indexRun.elapsedMs,
        current_db: databaseStats(dbPath),
        commands: measureSampleCommands(cwd, sample),
        query_groups: measureDatabaseQueryGroupsForTerms(dbPath, sample.terms),
      });
    }
    result.build_commands = measureBuildCommands();
    const largest = result.scales[result.scales.length - 1];
    const ftsDelta = largest.contentless_fts_size_delta_percent;
    result.decisions.fts = ftsDelta <= -30
      ? "contentless FTS experiment crosses the DB-size adoption threshold; production schema still requires search parity tests before adoption"
      : "contentless FTS experiment does not cross the DB-size adoption threshold in this run; keep current schema and revisit with stronger latency evidence";
    result.decisions.build = "build/typecheck measured for tracking; keep clean build/typecheck commands until duplicate compiler work is a measured bottleneck";

    const jsonPath = path.join(reportDir, "current.json");
    const markdownPath = path.join(reportDir, "current.md");
    fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(markdownPath, markdownReport(result));
    console.log(`wrote ${path.relative(repoRoot, jsonPath)}`);
    console.log(`wrote ${path.relative(repoRoot, markdownPath)}`);
  } finally {
    if (!process.argv.includes("--keep-tmp")) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  markdownReport,
  measureDatabaseQueryGroupsForTerms,
  sampleCorpusDefinitions,
  summarizeTimings,
};
