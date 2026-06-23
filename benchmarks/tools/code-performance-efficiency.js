"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const repoRoot = path.resolve(__dirname, "..", "..");
const cliPath = path.join(repoRoot, "dist", "init-project-wiki.js");
function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${name}`);
  }
  return value;
}

const reportDir = path.resolve(repoRoot, optionValue("--report-dir", path.join("benchmarks", "reports", "code-performance-efficiency")));
const { searchFiles, searchSymbols } = require(path.join(repoRoot, "dist", "code-index", "search.js"));
const { SMALL_REPO_FILE_THRESHOLD } = require(path.join(repoRoot, "dist", "code-index-file-policy.js"));
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
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: options.stdio ?? "pipe",
  });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return { elapsedMs, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function parseCodeIndexPhaseTimings(stderr) {
  const marker = "code_index_phase_timings ";
  const line = stderr.split(/\r?\n/).reverse().find((entry) => entry.startsWith(marker));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(marker.length));
  } catch (error) {
    throw new Error(`invalid code index phase timings JSON: ${error.message}`);
  }
}

function runCodeIndexCommand(cwd, args) {
  const result = run(process.execPath, [cliPath, ...args], {
    cwd,
    env: { PROJECT_LIBRARIAN_CODE_INDEX_TIMINGS: "1" },
  });
  return { ...result, phase_timings: parseCodeIndexPhaseTimings(result.stderr) };
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

function queryPlans(dbPath, term, searchMode = "current") {
  const db = openDatabase(dbPath);
  const contains = `%${term}%`;
  const prefix = `${term}%`;
  const ftsQuery = ftsPrefixQuery(term);
  const fileFtsJoin = searchMode === "rowid_fts"
    ? "files.rowid = files_fts.rowid"
    : "files.path = files_fts.path";
  const symbolFtsJoin = searchMode === "rowid_fts"
    ? "symbols.id = symbols_fts.rowid"
    : "symbols.name = symbols_fts.name AND symbols.kind = symbols_fts.kind AND symbols.file_path = symbols_fts.file_path AND symbols.signature = symbols_fts.signature";
  try {
    const plans = {
      file_prefix_like: db.prepare("EXPLAIN QUERY PLAN SELECT path FROM files WHERE path LIKE ? ESCAPE '\\' ORDER BY path LIMIT 25").all(prefix),
      file_contains_like: db.prepare("EXPLAIN QUERY PLAN SELECT path FROM files WHERE path LIKE ? ESCAPE '\\' ORDER BY path LIMIT 25").all(contains),
      file_fts_match: db.prepare(`
        EXPLAIN QUERY PLAN
        SELECT files.path
        FROM files_fts
        JOIN files ON ${fileFtsJoin}
        WHERE files_fts MATCH ?
        ORDER BY bm25(files_fts, 8.0, 1.0, 1.0, 0.25), files.path
        LIMIT 25
      `).all(ftsQuery),
      symbol_contains_like: db.prepare("EXPLAIN QUERY PLAN SELECT name, file_path FROM symbols WHERE name LIKE ? ESCAPE '\\' OR signature LIKE ? ESCAPE '\\' OR file_path LIKE ? ESCAPE '\\' ORDER BY file_path, line LIMIT 50").all(contains, contains, contains),
      symbol_fts_match: db.prepare(`
        EXPLAIN QUERY PLAN
        SELECT symbols.name, symbols.file_path
        FROM symbols_fts
        JOIN symbols ON ${symbolFtsJoin}
        WHERE symbols_fts MATCH ?
        ORDER BY bm25(symbols_fts, 8.0, 1.0, 4.0, 2.0), symbols.file_path, symbols.line
        LIMIT 50
      `).all(ftsQuery),
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

function createExternalContentFtsExperiment(sourceDbPath, targetDbPath) {
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
      CREATE TABLE file_search_content (
        rowid INTEGER PRIMARY KEY,
        path TEXT NOT NULL,
        language TEXT NOT NULL,
        profile TEXT NOT NULL,
        content TEXT NOT NULL
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
      CREATE VIRTUAL TABLE files_fts USING fts5(path, language, profile, content, content='file_search_content', content_rowid='rowid');
      CREATE VIRTUAL TABLE symbols_fts USING fts5(name, kind, file_path, signature, content='symbols', content_rowid='id');
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
    const insertFileSearchContent = target.prepare("INSERT INTO file_search_content (rowid, path, language, profile, content) VALUES (?, ?, ?, ?, ?)");
    const insertSymbol = target.prepare("INSERT INTO symbols (id, name, kind, file_path, line, signature) VALUES (?, ?, ?, ?, ?, ?)");
    target.exec("BEGIN");
    for (const row of source.prepare(`
      SELECT files.rowid AS rowid, files.path, files.language, files.profile, files.kind, files.bytes, files.lines, files.hash, files.mtime_ms, files.size, files_fts.content AS content
      FROM files
      JOIN files_fts ON files.path = files_fts.path
      ORDER BY files.rowid
    `).all()) {
      insertFile.run(row.rowid, row.path, row.language, row.profile, row.kind, row.bytes, row.lines, row.hash, row.mtime_ms, row.size);
      insertFileSearchContent.run(row.rowid, row.path, row.language, row.profile, row.content);
    }
    for (const row of source.prepare("SELECT id, name, kind, file_path, line, signature FROM symbols ORDER BY id").all()) {
      insertSymbol.run(row.id, row.name, row.kind, row.file_path, row.line, row.signature);
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
    target.prepare("INSERT INTO files_fts(files_fts) VALUES ('rebuild')").run();
    target.prepare("INSERT INTO symbols_fts(symbols_fts) VALUES ('rebuild')").run();
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

function prefixLikePattern(term) {
  return `${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function ftsTokens(term) {
  return Array.from(new Set(term.match(/[\p{L}\p{N}_]+/gu) ?? []));
}

function ftsPrefixQuery(term) {
  const tokens = ftsTokens(term);
  return tokens.slice(0, 8).map((token) => `"${token.replace(/"/g, "\"\"")}"*`).join(" AND ");
}

function indexedFileCount(db) {
  return scalar(db, "SELECT count(*) FROM files");
}

function shouldUseFtsSearch(db, term) {
  const tokens = ftsTokens(term);
  if (tokens.length === 0) return false;
  if (tokens.length > 1) return true;
  return indexedFileCount(db) >= SMALL_REPO_FILE_THRESHOLD;
}

function stringValue(row, key) {
  const value = row[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function addRankedRow(rowsByKey, row, key, score) {
  const current = rowsByKey.get(key);
  if (!current || score > current.score) rowsByKey.set(key, { row, score });
}

function rankedRows(rowsByKey, limit, stableKeys) {
  return Array.from(rowsByKey.values())
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      for (const key of stableKeys) {
        const compared = stringValue(left.row, key).localeCompare(stringValue(right.row, key));
        if (compared !== 0) return compared;
      }
      return 0;
    })
    .slice(0, limit)
    .map((ranked) => ranked.row);
}

function symbolKey(row) {
  return [
    stringValue(row, "file_path"),
    stringValue(row, "line"),
    stringValue(row, "kind"),
    stringValue(row, "name"),
    stringValue(row, "signature"),
  ].join("\u0000");
}

function searchFilesRowidFts(db, term, limit = 25) {
  const normalized = term.trim();
  if (!normalized) return [];
  const contains = likePattern(normalized);
  const prefix = prefixLikePattern(normalized);
  const rowsByKey = new Map();
  const exactRows = db.prepare("SELECT path, language, profile, lines, bytes FROM files WHERE path = ? ORDER BY path LIMIT ?").all(normalized, limit);
  exactRows.forEach((row) => addRankedRow(rowsByKey, row, stringValue(row, "path"), 900));
  const prefixRows = db.prepare("SELECT path, language, profile, lines, bytes FROM files WHERE path LIKE ? ESCAPE '\\' ORDER BY path LIMIT ?").all(prefix, limit);
  prefixRows.forEach((row) => addRankedRow(rowsByKey, row, stringValue(row, "path"), 750));

  const ftsQuery = shouldUseFtsSearch(db, normalized) ? ftsPrefixQuery(normalized) : "";
  if (ftsQuery) {
    const ftsRows = db.prepare(`
      SELECT files.path, files.language, files.profile, files.lines, files.bytes
      FROM files_fts
      JOIN files ON files.rowid = files_fts.rowid
      WHERE files_fts MATCH ?
      ORDER BY bm25(files_fts, 8.0, 1.0, 1.0, 0.25), files.path
      LIMIT ?
    `).all(ftsQuery, limit);
    ftsRows.forEach((row, index) => addRankedRow(rowsByKey, row, stringValue(row, "path"), 650 - index));
  }

  const containsRows = db.prepare("SELECT path, language, profile, lines, bytes FROM files WHERE path LIKE ? ESCAPE '\\' ORDER BY path LIMIT ?").all(contains, limit);
  containsRows.forEach((row) => addRankedRow(rowsByKey, row, stringValue(row, "path"), 500));
  return rankedRows(rowsByKey, limit, ["path"]);
}

function searchSymbolsRowidFts(db, term, limit = 50) {
  const normalized = term.trim();
  if (!normalized) return [];
  const contains = likePattern(normalized);
  const prefix = prefixLikePattern(normalized);
  const rowsByKey = new Map();
  const exactRows = db.prepare(`
    SELECT name, kind, file_path, line, signature
    FROM symbols
    WHERE name = ? OR signature = ?
    ORDER BY file_path, line
    LIMIT ?
  `).all(normalized, normalized, limit);
  exactRows.forEach((row) => addRankedRow(rowsByKey, row, symbolKey(row), 1000));

  const prefixRows = db.prepare(`
    SELECT name, kind, file_path, line, signature
    FROM symbols
    WHERE name LIKE ? ESCAPE '\\' OR signature LIKE ? ESCAPE '\\'
    ORDER BY file_path, line
    LIMIT ?
  `).all(prefix, prefix, limit);
  prefixRows.forEach((row) => addRankedRow(rowsByKey, row, symbolKey(row), 850));

  const ftsQuery = shouldUseFtsSearch(db, normalized) ? ftsPrefixQuery(normalized) : "";
  if (ftsQuery) {
    const ftsRows = db.prepare(`
      SELECT symbols.name, symbols.kind, symbols.file_path, symbols.line, symbols.signature
      FROM symbols_fts
      JOIN symbols ON symbols.id = symbols_fts.rowid
      WHERE symbols_fts MATCH ?
      ORDER BY bm25(symbols_fts, 8.0, 1.0, 4.0, 2.0), symbols.file_path, symbols.line
      LIMIT ?
    `).all(ftsQuery, limit);
    ftsRows.forEach((row, index) => addRankedRow(rowsByKey, row, symbolKey(row), 700 - index));
  }

  const containsRows = db.prepare(`
    SELECT name, kind, file_path, line, signature
    FROM symbols
    WHERE name LIKE ? ESCAPE '\\' OR signature LIKE ? ESCAPE '\\' OR file_path LIKE ? ESCAPE '\\'
    ORDER BY file_path, line
    LIMIT ?
  `).all(contains, contains, contains, limit);
  containsRows.forEach((row) => addRankedRow(rowsByKey, row, symbolKey(row), 500));
  return rankedRows(rowsByKey, limit, ["file_path", "line", "kind", "name", "signature"]);
}

function databaseQueryGroups(terms, searchMode = "current") {
  const groups = {
    file_search_path: (db) => searchMode === "rowid_fts" ? searchFilesRowidFts(db, terms.file, 25) : searchFiles(db, terms.file, 25),
    symbol_search_single_token: (db) => searchMode === "rowid_fts" ? searchSymbolsRowidFts(db, terms.symbol, 50) : searchSymbols(db, terms.symbol, 50),
    symbol_search_multi_token: (db) => searchMode === "rowid_fts" ? searchSymbolsRowidFts(db, `${terms.symbol} ${terms.file}`, 50) : searchSymbols(db, `${terms.symbol} ${terms.file}`, 50),
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
  return groups;
}

function measureDatabaseQueryGroupsForTerms(dbPath, terms, options = {}) {
  const groups = databaseQueryGroups(terms, options.searchMode);
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

function normalizeRows(rows) {
  return rows.map((row) => {
    const normalized = {};
    for (const key of Object.keys(row).sort()) {
      const value = row[key];
      normalized[key] = value === null || typeof value === "number" || typeof value === "string" ? value : String(value);
    }
    return normalized;
  });
}

function resultHash(rows) {
  return crypto.createHash("sha256").update(JSON.stringify(normalizeRows(rows))).digest("hex");
}

function collectQueryGroupRows(dbPath, terms, options = {}) {
  const groups = databaseQueryGroups(terms, options.searchMode);
  const db = openDatabase(dbPath);
  try {
    return Object.fromEntries(Object.entries(groups).map(([name, query]) => [name, normalizeRows(query(db))]));
  } finally {
    db.close();
  }
}

function compareSearchParity(baselineDbPath, candidateDbPath, terms, options = {}) {
  const baseline = collectQueryGroupRows(baselineDbPath, terms, { searchMode: "current" });
  const candidate = collectQueryGroupRows(candidateDbPath, terms, { searchMode: options.searchMode });
  const groups = {};
  for (const name of Object.keys(baseline)) {
    const baselineHash = resultHash(baseline[name]);
    const candidateHash = resultHash(candidate[name]);
    groups[name] = {
      status: baselineHash === candidateHash ? "passed" : "failed",
      baseline_rows: baseline[name].length,
      candidate_rows: candidate[name].length,
      baseline_hash: baselineHash,
      candidate_hash: candidateHash,
    };
  }
  const failed = Object.values(groups).filter((group) => group.status !== "passed").length;
  return { status: failed === 0 ? "passed" : "failed", failed_groups: failed, groups };
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

function timingDeltaPercent(baseline, candidate) {
  if (!baseline || baseline === 0) return null;
  return ((candidate - baseline) / baseline) * 100;
}

function queryGroupDeltas(baselineGroups, candidateGroups) {
  return Object.fromEntries(Object.keys(candidateGroups).map((name) => {
    const baseline = baselineGroups[name] ?? {};
    const candidate = candidateGroups[name] ?? {};
    return [name, {
      median_delta_percent: timingDeltaPercent(baseline.median_ms, candidate.median_ms),
      p95_delta_percent: timingDeltaPercent(baseline.p95_ms, candidate.p95_ms),
    }];
  }));
}

function buildFtsVariantSummaries(currentDbPath, variants, terms) {
  const currentGroups = measureDatabaseQueryGroupsForTerms(currentDbPath, terms, { searchMode: "current" });
  return variants.map((variant) => {
    const queryGroups = variant.name === "current"
      ? currentGroups
      : measureDatabaseQueryGroupsForTerms(variant.db_path, terms, { searchMode: variant.search_mode });
    return {
      name: variant.name,
      search_mode: variant.search_mode,
      db: variant.db,
      size_delta_percent_vs_current: ((variant.db.file_bytes - variants[0].db.file_bytes) / variants[0].db.file_bytes) * 100,
      query_groups: queryGroups,
      query_group_deltas_vs_current: queryGroupDeltas(currentGroups, queryGroups),
      query_plans: queryPlans(variant.db_path, terms.symbol, variant.search_mode),
      search_parity: variant.name === "current"
        ? compareSearchParity(currentDbPath, currentDbPath, terms, { searchMode: "current" })
        : compareSearchParity(currentDbPath, variant.db_path, terms, { searchMode: variant.search_mode }),
    };
  });
}

function bestVariantDecision(variants, options = {}) {
  if ((options.runsPerCommand ?? runsPerCommand) < 3) {
    return "quick FTS variant diagnostic completed; run the full benchmark before adoption decisions";
  }
  const eligible = variants.filter((variant) => variant.name !== "current" && variant.search_parity.status === "passed");
  if (eligible.length === 0) {
    return "no candidate FTS variant preserved search parity; keep current schema";
  }
  const ftsImpactedGroups = ["file_search_path", "symbol_search_single_token", "symbol_search_multi_token"];
  const bestSize = eligible.reduce((best, variant) =>
    variant.size_delta_percent_vs_current < best.size_delta_percent_vs_current ? variant : best
  );
  const worstImpactedP95Delta = (variant) => Math.max(...ftsImpactedGroups.map((name) =>
    variant.query_group_deltas_vs_current[name]?.p95_delta_percent ?? 0
  ));
  const bestLatency = eligible.reduce((best, variant) => {
    const bestWorstDelta = worstImpactedP95Delta(best);
    const variantWorstDelta = worstImpactedP95Delta(variant);
    return variantWorstDelta < bestWorstDelta ? variant : best;
  });
  if (bestSize.size_delta_percent_vs_current <= -30) {
    return `${bestSize.name} crosses the DB-size adoption threshold; production schema still requires incremental update/delete tests before adoption`;
  }
  const latencyImprovement = worstImpactedP95Delta(bestLatency);
  if (latencyImprovement <= -20 && bestLatency.size_delta_percent_vs_current <= 5) {
    return `${bestLatency.name} crosses the p95 query-latency threshold without material DB growth; production schema still requires incremental update/delete tests before adoption`;
  }
  return "candidate FTS variants preserve parity but do not cross storage or latency adoption thresholds; keep current schema";
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
    if (scale.phase_timings) {
      lines.push(`- Index phases: ${formatPhaseTimings(scale.phase_timings)}`);
    }
    lines.push(`- Current DB size: ${scale.current_db.file_bytes} bytes`);
    lines.push(`- Contentless FTS experiment size: ${scale.contentless_fts_db.file_bytes} bytes (${scale.contentless_fts_size_delta_percent.toFixed(1)}%)`);
    if (scale.fts_variants) {
      for (const variant of scale.fts_variants) {
        lines.push(`- FTS variant ${variant.name}: ${variant.db.file_bytes} bytes (${variant.size_delta_percent_vs_current.toFixed(1)}% vs current), parity ${variant.search_parity.status}`);
      }
    }
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
    if (scale.fts_variants) {
      for (const variant of scale.fts_variants.filter((item) => item.name !== "current")) {
        lines.push(`- ${variant.name} file_fts_match: ${variant.query_plans.file_fts_match.join(" | ")}`);
        lines.push(`- ${variant.name} symbol_fts_match: ${variant.query_plans.symbol_fts_match.join(" | ")}`);
      }
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
    if (scale.fts_variants) {
      lines.push("");
      lines.push("Variant direct DB deltas vs current:");
      for (const variant of scale.fts_variants.filter((item) => item.name !== "current")) {
        const deltas = Object.entries(variant.query_group_deltas_vs_current)
          .map(([name, delta]) => `${name} p95 ${delta.p95_delta_percent === null ? "n/a" : `${delta.p95_delta_percent.toFixed(1)}%`}`)
          .join("; ");
        lines.push(`- ${variant.name}: ${deltas}; parity ${variant.search_parity.status}`);
      }
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
    if (sample.phase_timings) {
      lines.push(`- Index phases: ${formatPhaseTimings(sample.phase_timings)}`);
    }
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

function formatPhaseTimings(phaseTimings) {
  const labels = {
    discover_files_ms: "discover",
    compatibility_ms: "compat",
    prepare_output_ms: "prepare",
    fingerprints_ms: "fingerprints",
    read_files_ms: "read",
    sqlite_write_ms: "sqlite",
    native_helper_ms: "native",
    total_ms: "total",
  };
  return Object.entries(labels)
    .filter(([key]) => typeof phaseTimings[key] === "number")
    .map(([key, label]) => `${label} ${phaseTimings[key].toFixed(1)} ms`)
    .join(", ");
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
      const indexRun = runCodeIndexCommand(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src", "--code-scope", "package.json"]);
      const width = String(scale).length;
      const target = `handler${String(scale - 1).padStart(width, "0")}`;
      const dbPath = path.join(cwd, ".project-wiki", "code-evidence.sqlite");
      const altDbPath = path.join(cwd, ".project-wiki", "code-evidence-contentless-fts.sqlite");
      const externalDbPath = path.join(cwd, ".project-wiki", "code-evidence-external-content-fts.sqlite");
      const currentDb = databaseStats(dbPath);
      const contentlessFtsDb = createContentlessFtsExperiment(dbPath, altDbPath);
      const externalContentFtsDb = createExternalContentFtsExperiment(dbPath, externalDbPath);
      const terms = {
        file: `handler-${String(scale - 1).padStart(width, "0")}`,
        symbol: target,
        route: "api/items",
        import: "shared",
        edge: "handler",
      };
      const ftsVariants = buildFtsVariantSummaries(dbPath, [
        { name: "current", search_mode: "current", db_path: dbPath, db: currentDb },
        { name: "contentless-delete-rowid", search_mode: "rowid_fts", db_path: altDbPath, db: contentlessFtsDb },
        { name: "external-content-rowid", search_mode: "rowid_fts", db_path: externalDbPath, db: externalContentFtsDb },
      ], terms);
      result.scales.push({
        file_count: scale,
        index_time_ms: indexRun.elapsedMs,
        phase_timings: indexRun.phase_timings,
        current_db: currentDb,
        contentless_fts_db: contentlessFtsDb,
        contentless_fts_size_delta_percent: ((contentlessFtsDb.file_bytes - currentDb.file_bytes) / currentDb.file_bytes) * 100,
        external_content_fts_db: externalContentFtsDb,
        external_content_fts_size_delta_percent: ((externalContentFtsDb.file_bytes - currentDb.file_bytes) / currentDb.file_bytes) * 100,
        commands: measureCommands(cwd, scale),
        query_groups: ftsVariants.find((variant) => variant.name === "current").query_groups,
        query_plans: ftsVariants.find((variant) => variant.name === "current").query_plans,
        fts_variants: ftsVariants,
      });
    }
    for (const sample of sampleCorpusDefinitions()) {
      const cwd = materializeSampleCorpus(sample, tmpRoot);
      const indexRun = runCodeIndexCommand(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "."]);
      const dbPath = path.join(cwd, ".project-wiki", "code-evidence.sqlite");
      result.sample_corpora.push({
        name: sample.name,
        corpus_kind: sample.corpus_kind,
        index_time_ms: indexRun.elapsedMs,
        phase_timings: indexRun.phase_timings,
        current_db: databaseStats(dbPath),
        commands: measureSampleCommands(cwd, sample),
        query_groups: measureDatabaseQueryGroupsForTerms(dbPath, sample.terms),
      });
    }
    result.build_commands = measureBuildCommands();
    const largest = result.scales[result.scales.length - 1];
    const ftsDelta = largest.contentless_fts_size_delta_percent;
    result.decisions.fts = bestVariantDecision(largest.fts_variants, { runsPerCommand });
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
  bestVariantDecision,
  compareSearchParity,
  markdownReport,
  measureDatabaseQueryGroupsForTerms,
  normalizeRows,
  parseCodeIndexPhaseTimings,
  sampleCorpusDefinitions,
  summarizeTimings,
};
