const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { codeContextPack, codeImpact, codeIndexSnapshot, isCodeEvidenceModeFor, nativeCodeIndexAutoFileThreshold, searchSymbols } = require("../../dist/code-index.js");
const { openDatabase } = require("../../dist/code-index-db.js");
const { fileLanguage, ignoredDirectories, isIgnoredCodePath, shouldIndexFile, SMALL_REPO_FILE_THRESHOLD } = require("../../dist/code-index-file-policy.js");
const { isReadOnlySql } = require("../../dist/code-index-sql.js");
const { searchFiles, shouldUseFtsSearchForScale } = require("../../dist/code-index/search.js");
const { treeSitterBackends } = require("../../dist/code-index/extractors/tree-sitter.js");
const { buildNativeCodeIndexJob, runNativeCodeIndexHelper } = require("../../dist/code-index/native-helper.js");
const { ignoredDirs } = require("../../dist/wiki-files.js");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");

const inactiveFlags = {
  codeContextPackTarget: "",
  codeFilesMode: false,
  codeImpactMode: false,
  codeIndexHealthMode: false,
  codeIndexMode: false,
  codeQuerySql: "",
  codeReportMode: false,
  codeSearchSymbol: "",
  codeStatusMode: false,
};

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function symlinkOrSkip(t, target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath);
    return true;
  } catch (error) {
    if (["EACCES", "EPERM"].includes(error.code)) {
      t.skip(`symlink unavailable: ${error.message}`);
      return false;
    }
    throw error;
  }
}

function runCli(cwd, args) {
  const result = childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `CLI ${args.join(" ")} failed (${result.status}): ${result.stderr}`);
  return result.stdout;
}

function runCliResult(cwd, args, options = {}) {
  return childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

function assertNoSqliteExperimentalWarning(result, label) {
  assert.doesNotMatch(result.stderr, /ExperimentalWarning: SQLite|SQLite is an experimental feature/i, label);
}

function openSnapshotDatabase(databasePath) {
  return openDatabase(databasePath, (message) => {
    throw new Error(message);
  });
}

function normalizedNativeParitySnapshot(snapshot) {
  return {
    ...snapshot,
    edges: snapshot.edges.map(({ evidence, ...row }) => row),
    symbols: snapshot.symbols.map(({ signature, ...row }) => row),
  };
}

function initGitRepository(cwd) {
  const result = childProcess.spawnSync("git", ["init", "-q"], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `git init failed (${result.status}): ${result.stderr}`);
}

function writeExecutableHelper(filePath, content) {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

function commandAvailable(command) {
  const result = childProcess.spawnSync(command, ["--version"], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function nativeIndexerBinaryPath() {
  const binary = process.platform === "win32" ? "project-librarian-indexer.exe" : "project-librarian-indexer";
  return path.resolve(__dirname, "..", "..", "native", "indexer-rs", "target", "debug", binary);
}

function buildNativeIndexerOrSkip(t) {
  if (!commandAvailable("cargo")) {
    t.skip("cargo unavailable");
    return "";
  }
  if (!commandAvailable("sqlite3")) {
    t.skip("sqlite3 unavailable");
    return "";
  }
  const manifestPath = path.resolve(__dirname, "..", "..", "native", "indexer-rs", "Cargo.toml");
  const result = childProcess.spawnSync("cargo", ["build", "--quiet", "--manifest-path", manifestPath], {
    cwd: path.resolve(__dirname, "..", ".."),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return nativeIndexerBinaryPath();
}

function assertTopFile(rows, expectedPath, label, topN = 1) {
  const topRows = rows.slice(0, topN);
  assert.ok(
    topRows.some((row) => row.path === expectedPath),
    `${label}: expected ${expectedPath} in top ${topN}, got ${JSON.stringify(topRows)}`,
  );
}

function assertTopSymbol(rows, expected, label, topN = 1) {
  const topRows = rows.slice(0, topN);
  assert.ok(
    topRows.some((row) => Object.entries(expected).every(([key, value]) => row[key] === value)),
    `${label}: expected ${JSON.stringify(expected)} in top ${topN}, got ${JSON.stringify(topRows)}`,
  );
}

test("isCodeEvidenceModeFor includes every code evidence mode", () => {
  assert.equal(isCodeEvidenceModeFor(inactiveFlags), false);
  assert.equal(isCodeEvidenceModeFor({ ...inactiveFlags, codeIndexMode: true }), true);
  assert.equal(isCodeEvidenceModeFor({ ...inactiveFlags, codeIndexHealthMode: true }), true);
  assert.equal(isCodeEvidenceModeFor({ ...inactiveFlags, codeQuerySql: "select * from files" }), true);
  assert.equal(isCodeEvidenceModeFor({ ...inactiveFlags, codeReportMode: true }), true);
  assert.equal(isCodeEvidenceModeFor({ ...inactiveFlags, codeStatusMode: true }), true);
  assert.equal(isCodeEvidenceModeFor({ ...inactiveFlags, codeFilesMode: true }), true);
  assert.equal(isCodeEvidenceModeFor({ ...inactiveFlags, codeImpactMode: true }), true);
  assert.equal(isCodeEvidenceModeFor({ ...inactiveFlags, codeContextPackTarget: "Auth" }), true);
  assert.equal(isCodeEvidenceModeFor({ ...inactiveFlags, codeSearchSymbol: "Auth" }), true);
});

test("isReadOnlySql allows bounded read queries", () => {
  assert.equal(isReadOnlySql("select path from files"), true);
  assert.equal(isReadOnlySql("WITH recent AS (select path from files) select * from recent"), true);
});

test("isReadOnlySql rejects writes, pragmas, and extra statements", () => {
  assert.equal(isReadOnlySql("delete from files"), false);
  assert.equal(isReadOnlySql("select path from files; drop table files"), false);
  assert.equal(isReadOnlySql("pragma table_info(files)"), false);
  assert.equal(isReadOnlySql("with deleted as (delete from files returning *) select * from deleted"), false);
});

test("code index file policy excludes ignored and sensitive paths", () => {
  assert.equal(fileLanguage("src/app.ts"), "typescript");
  assert.equal(fileLanguage(".env.example"), "config");
  assert.equal(shouldIndexFile(".env.example"), true);
  assert.equal(shouldIndexFile(".env.local"), false);
  assert.equal(shouldIndexFile(".mcp.json"), false);
  assert.equal(shouldIndexFile(".tooling/secrets.json"), false);
  assert.equal(shouldIndexFile("config/service-token.yaml"), false);
  assert.equal(shouldIndexFile("config/service.yaml"), true);
  assert.equal(ignoredDirectories.has("dist"), true);
  assert.equal(ignoredDirectories.has(".project-wiki"), true);
  assert.equal(ignoredDirs.has("dist"), true);
  assert.equal(ignoredDirs.has(".project-wiki"), false);
  assert.equal(isIgnoredCodePath("dist/init-project-wiki.js"), true);
});

test("code index skips symlinked git paths and hidden MCP config before FTS persistence", (t) => {
  const cwd = makeTmpDir("code-index-symlink-secret-");
  const outside = path.join(os.tmpdir(), `project-librarian-code-index-outside-${Date.now()}.js`);
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    initGitRepository(cwd);
    fs.writeFileSync(outside, "export const leakedSecret = 'outside';\n");
    if (!symlinkOrSkip(t, outside, path.join(cwd, "src", "external.js"))) return;
    fs.writeFileSync(path.join(cwd, "src", "keep.js"), "export const keep = true;\n");
    fs.writeFileSync(path.join(cwd, ".mcp.json"), JSON.stringify({ token: "mcp-secret-value" }, null, 2));
    childProcess.spawnSync("git", ["add", "src/external.js"], { cwd });

    runCli(cwd, ["--code-index", "--acknowledge-small-repo"]);

    const database = openSnapshotDatabase(path.join(cwd, ".project-wiki", "code-evidence.sqlite"));
    try {
      const files = database.prepare("select path from files order by path").all().map((row) => row.path);
      assert.deepEqual(files, ["src/keep.js"]);
      const contents = database.prepare("select content from files_fts").all().map((row) => row.content).join("\n");
      assert.doesNotMatch(contents, /outside|mcp-secret-value/);
    } finally {
      database.close();
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});

test("code index discovery skips ignored, oversized, non-indexable, and disappeared git paths", () => {
  const cwd = makeTmpDir("code-index-discovery-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.mkdirSync(path.join(cwd, "dist"), { recursive: true });
    initGitRepository(cwd);
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "discovery-fixture" }, null, 2));
    fs.writeFileSync(path.join(cwd, "src", "keep.js"), "export const keep = true;\n");
    fs.writeFileSync(path.join(cwd, "src", "notes.txt"), "not indexed\n");
    fs.writeFileSync(path.join(cwd, "src", "too-big.js"), `${"x".repeat(1024 * 1024 + 1)}\n`);
    fs.writeFileSync(path.join(cwd, "dist", "ignored.js"), "export const ignored = true;\n");
    fs.writeFileSync(path.join(cwd, "src", "deleted.js"), "export const deleted = true;\n");
    childProcess.spawnSync("git", ["add", "src/deleted.js"], { cwd });
    fs.unlinkSync(path.join(cwd, "src", "deleted.js"));

    const stdout = runCli(cwd, ["--code-index", "--acknowledge-small-repo"]);
    assert.match(stdout, /files: 2\b/);
    assert.match(stdout, /reindexed_files: 2\b/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("codeIndexSnapshot returns stable normalized evidence rows", () => {
  const cwd = makeTmpDir("code-index-snapshot-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    initGitRepository(cwd);
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ dependencies: { express: "^4.18.0" } }, null, 2));
    fs.writeFileSync(path.join(cwd, "src", "app.js"), [
      "const express = require(\"express\");",
      "const app = express();",
      "function healthHandler(req, res) { res.json({ ok: true }); }",
      "app.get(\"/health\", healthHandler);",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(cwd, "src", "service.ts"), [
      "export interface UserRecord { id: string; }",
      "export function fetchUser(): Promise<UserRecord> {",
      "  return Promise.resolve({ id: \"1\" });",
      "}",
      "export function literalPercentToken() {",
      "  return true;",
      "}",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(cwd, "src", "jobs.py"), [
      "import json",
      "from pathlib import Path",
      "",
      "class PythonJob:",
      "    pass",
      "",
      "def run_job(payload):",
      "    return json.dumps({\"path\": str(Path(payload))})",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(cwd, "src", "worker.go"), [
      "package main",
      "",
      "import (",
      "  \"net/http\"",
      "  alias \"strings\"",
      ")",
      "",
      "type GoWorker struct{}",
      "",
      "func (worker GoWorker) ServeHTTP(w http.ResponseWriter, r *http.Request) {}",
      "",
      "func LaunchWorker() {}",
      "",
    ].join("\n"));
    runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src", "--code-scope", "package.json"]);

    const databasePath = path.join(cwd, ".project-wiki", "code-evidence.sqlite");
    const firstDatabase = openSnapshotDatabase(databasePath);
    const secondDatabase = openSnapshotDatabase(databasePath);
    try {
      const first = codeIndexSnapshot(firstDatabase);
      const second = codeIndexSnapshot(secondDatabase);
      assert.deepEqual(first, second);
      assert.ok(first.files.some((row) => row.path === "src/app.js" && row.profile === "typescript-ast"));
      assert.ok(first.files.some((row) => row.path === "src/jobs.py" && row.profile === "python-light"));
      assert.ok(first.files.some((row) => row.path === "src/worker.go" && row.profile === "go-light"));
      assert.ok(first.symbols.some((row) => row.name === "healthHandler" && row.kind === "function" && row.file_path === "src/app.js"));
      assert.ok(first.symbols.some((row) => row.name === "PythonJob" && row.kind === "class" && row.file_path === "src/jobs.py"));
      assert.ok(first.symbols.some((row) => row.name === "run_job" && row.kind === "function" && row.file_path === "src/jobs.py"));
      assert.ok(first.symbols.some((row) => row.name === "GoWorker" && row.kind === "type" && row.file_path === "src/worker.go"));
      assert.ok(first.symbols.some((row) => row.name === "LaunchWorker" && row.kind === "function" && row.file_path === "src/worker.go"));
      assert.ok(first.imports.some((row) => row.to_ref === "express" && row.from_file === "src/app.js"));
      assert.ok(first.imports.some((row) => row.to_ref === "json" && row.from_file === "src/jobs.py"));
      assert.ok(first.imports.some((row) => row.to_ref === "pathlib" && row.imported === "Path" && row.from_file === "src/jobs.py"));
      assert.ok(first.imports.some((row) => row.to_ref === "net/http" && row.from_file === "src/worker.go"));
      assert.ok(first.imports.some((row) => row.to_ref === "strings" && row.imported === "alias" && row.from_file === "src/worker.go"));
      assert.ok(first.routes.some((row) => row.route === "/health" && row.handler === "healthHandler"));
      assert.ok(first.edges.some((row) => row.kind === "route_to_handler" && row.target === "healthHandler"));

      const multiToken = searchSymbols(firstDatabase, "Promise UserRecord");
      assert.ok(multiToken.some((row) => row.name === "fetchUser" && row.file_path === "src/service.ts"));
      assert.ok(searchSymbols(firstDatabase, "LaunchWorker").some((row) => row.name === "LaunchWorker" && row.file_path === "src/worker.go"));
      assert.deepEqual(searchSymbols(firstDatabase, "literal%Token"), []);
      assert.doesNotThrow(() => searchSymbols(firstDatabase, "AND"));

      const pack = codeContextPack(firstDatabase, "healthHandler");
      assert.match(pack.split("\n")[0], /^Code context pack "healthHandler": /);
      assert.match(pack, /symbol-match src\/app\.js:\d+ function healthHandler/);
      assert.match(pack, /route-match GET \/health -> healthHandler/);
      assert.match(pack, /edge-in route_to_handler GET \/health -> healthHandler/);
      assert.match(pack, /Evidence is structural only/);
      assert.doesNotMatch(pack, /res\.json\(\{ ok: true \}\)/);

      const cliPack = runCli(cwd, ["--code-context-pack", "healthHandler"]);
      assert.match(cliPack, /^Code context pack "healthHandler": /);
      assert.match(cliPack, /Symbols:/);
      assert.ok(cliPack.length <= 4000, `context pack ${cliPack.length} chars exceeds cap`);

      const impact = codeImpact(firstDatabase, "src/app.js");
      assert.ok(impact.matches.files.some((row) => row.path === "src/app.js"));
      assert.ok(impact.matches.symbols.some((row) => row.name === "healthHandler" && row.file_path === "src/app.js"));
      assert.ok(impact.matches.routes.some((row) => row.route === "/health" && row.handler === "healthHandler"));
      assert.ok(impact.matches.imports.some((row) => row.from_file === "src/app.js" && row.to_ref === "express"));
      assert.ok(impact.edges.outgoing.some((row) => row.kind === "route_to_handler" && row.file_path === "src/app.js"));
      assert.ok(impact.edges.routes.some((row) => row.source === "GET /health" && row.target === "healthHandler"));
      assert.ok(impact.impacted_owners.some((row) => row.sample_files.includes("src/app.js")));

      const pathPack = codeContextPack(firstDatabase, "src/app.js");
      assert.match(pathPack, /file-match src\/app\.js/);
      assert.match(pathPack, /symbol-match src\/app\.js:\d+ function healthHandler/);
      assert.match(pathPack, /route-match GET \/health -> healthHandler/);
      assert.match(pathPack, /import-match src\/app\.js:\d+ -> express/);
      assert.match(pathPack, /edge-out route_to_handler GET \/health -> healthHandler/);
      assert.match(pathPack, /owner .*src\/app\.js/);
    } finally {
      firstDatabase.close();
      secondDatabase.close();
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("code search golden queries cover exact, prefix, FTS, and contains ranking paths", () => {
  const cwd = makeTmpDir("code-search-golden-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    initGitRepository(cwd);
    fs.writeFileSync(path.join(cwd, "src", "app.js"), [
      "const express = require(\"express\");",
      "const app = express();",
      "function healthHandler(req, res) { res.json({ ok: true }); }",
      "app.get(\"/health\", healthHandler);",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(cwd, "src", "service.ts"), [
      "export interface UserRecord { id: string; }",
      "export function fetchUser(): Promise<UserRecord> {",
      "  return Promise.resolve({ id: \"1\" });",
      "}",
      "export function literalPercentToken() {",
      "  return true;",
      "}",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(cwd, "src", "jobs.py"), [
      "import json",
      "",
      "class PythonJob:",
      "    pass",
      "",
      "def run_job(payload):",
      "    return json.dumps(payload)",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(cwd, "src", "worker.go"), [
      "package main",
      "",
      "import \"net/http\"",
      "",
      "type GoWorker struct{}",
      "",
      "func (worker GoWorker) ServeHTTP(w http.ResponseWriter, r *http.Request) {}",
      "",
      "func LaunchWorker() {}",
      "",
    ].join("\n"));
    runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src"]);

    const databasePath = path.join(cwd, ".project-wiki", "code-evidence.sqlite");
    const database = openSnapshotDatabase(databasePath);
    try {
      const fileCases = [
        { label: "file exact path", query: "src/service.ts", expectedPath: "src/service.ts", topN: 1 },
        { label: "file path prefix", query: "src/ser", expectedPath: "src/service.ts", topN: 1 },
        { label: "file path contains", query: "jobs", expectedPath: "src/jobs.py", topN: 1 },
        { label: "file FTS by content", query: "Promise UserRecord", expectedPath: "src/service.ts", topN: 3 },
        { label: "file FTS route handler content", query: "express healthHandler", expectedPath: "src/app.js", topN: 3 },
        { label: "file path contains extension", query: "worker.go", expectedPath: "src/worker.go", topN: 1 },
      ];
      for (const testCase of fileCases) {
        assertTopFile(searchFiles(database, testCase.query), testCase.expectedPath, testCase.label, testCase.topN);
      }

      const symbolCases = [
        { label: "symbol exact function", query: "healthHandler", expected: { name: "healthHandler", file_path: "src/app.js" }, topN: 1 },
        { label: "symbol prefix function", query: "fetch", expected: { name: "fetchUser", file_path: "src/service.ts" }, topN: 1 },
        { label: "symbol contains underscore", query: "run_", expected: { name: "run_job", file_path: "src/jobs.py" }, topN: 1 },
        { label: "symbol FTS signature", query: "Promise UserRecord", expected: { name: "fetchUser", file_path: "src/service.ts" }, topN: 3 },
        { label: "symbol exact Go function", query: "LaunchWorker", expected: { name: "LaunchWorker", file_path: "src/worker.go" }, topN: 1 },
        { label: "symbol prefix class", query: "Python", expected: { name: "PythonJob", file_path: "src/jobs.py" }, topN: 1 },
      ];
      for (const testCase of symbolCases) {
        assertTopSymbol(searchSymbols(database, testCase.query), testCase.expected, testCase.label, testCase.topN);
      }

      assert.deepEqual(searchFiles(database, "literal%Token"), []);
      assert.deepEqual(searchSymbols(database, "literal%Token"), []);
    } finally {
      database.close();
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("code index staleness skips file reads when stored freshness metadata matches", () => {
  const cwd = makeTmpDir("code-index-staleness-fast-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    initGitRepository(cwd);
    fs.writeFileSync(path.join(cwd, "src", "stable.js"), "export const stable = true;\n");
    runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src"]);

    const script = `
      const assert = require("node:assert/strict");
      const fs = require("node:fs");
      const path = require("node:path");
      const { codeIndexStaleness } = require(${JSON.stringify(path.resolve(__dirname, "..", "..", "dist", "code-index.js"))});
      const { openDatabase } = require(${JSON.stringify(path.resolve(__dirname, "..", "..", "dist", "code-index-db.js"))});
      const database = openDatabase(".project-wiki/code-evidence.sqlite", (message) => { throw new Error(message); });
      const originalReadFileSync = fs.readFileSync;
      try {
        fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
          if (String(filePath).endsWith(path.join("src", "stable.js"))) {
            throw new Error("staleness should not read unchanged file content");
          }
          return originalReadFileSync.call(this, filePath, ...args);
        };
        assert.deepEqual(codeIndexStaleness(database), { stale: false, changed: 0, added: 0, deleted: 0 });
      } finally {
        fs.readFileSync = originalReadFileSync;
        database.close();
      }
    `;
    const result = childProcess.spawnSync(process.execPath, ["-e", script], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("FTS search gate skips small-repo single-token searches but preserves multi-token search", () => {
  assert.equal(shouldUseFtsSearchForScale("Handler", SMALL_REPO_FILE_THRESHOLD - 1), false);
  assert.equal(shouldUseFtsSearchForScale("Promise UserRecord", 2), true);
  assert.equal(shouldUseFtsSearchForScale("Handler", SMALL_REPO_FILE_THRESHOLD), true);
});

test("code report sections expose focused routes, parsers, workspaces, and invalid-section errors", () => {
  const cwd = makeTmpDir("code-report-sections-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    initGitRepository(cwd);
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "report-sections", dependencies: { express: "^4.18.0" } }, null, 2));
    fs.writeFileSync(path.join(cwd, "src", "app.js"), [
      "const express = require(\"express\");",
      "const app = express();",
      "function healthHandler(req, res) { res.json({ ok: true }); }",
      "app.get(\"/health\", healthHandler);",
      "",
    ].join("\n"));
    runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src", "--code-scope", "package.json"]);

    const fullReport = JSON.parse(runCli(cwd, ["--code-report"]));
    assert.deepEqual(fullReport.report_sections, ["evidence_coverage", "ownership_summary", "language_profile_summary", "parser_backend_summary", "workspace_summary", "workspace_dependency_graph", "route_inventory", "dependency_hotspots", "config_inventory", "edge_summary"]);

    const routes = JSON.parse(runCli(cwd, ["--code-report", "--code-report-section", "routes"]));
    assert.equal(routes.section, "routes");
    assert.ok(routes.data.some((row) => row.route === "/health" && row.handler === "healthHandler"));

    const parsers = JSON.parse(runCli(cwd, ["--code-report", "--code-report-section", "parsers"]));
    assert.equal(parsers.section, "parsers");
    assert.ok(parsers.data.some((row) => row.profile === "typescript-ast" && row.backend === "typescript-compiler"));

    const workspaces = JSON.parse(runCli(cwd, ["--code-report", "--code-report-section", "workspaces"]));
    assert.equal(workspaces.section, "workspaces");
    assert.ok(Array.isArray(workspaces.data.workspace_packages));

    const invalid = runCliResult(cwd, ["--code-report", "--code-report-section", "not-a-section"]);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /invalid --code-report-section: not-a-section; expected one of: coverage, ownership, languages, parsers, workspaces, workspace-graph, routes, hotspots, configs, edges/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("code report skips symlinked ownership metadata outside the repository", (t) => {
  const cwd = makeTmpDir("code-report-symlink-metadata-");
  const outside = makeTmpDir("code-report-symlink-metadata-outside-");
  try {
    fs.mkdirSync(path.join(cwd, ".github"), { recursive: true });
    fs.mkdirSync(path.join(cwd, "packages", "leaked"), { recursive: true });
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    initGitRepository(cwd);
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "report-symlink-metadata", workspaces: ["packages/*"] }, null, 2));
    fs.writeFileSync(path.join(cwd, "src", "app.js"), "export const app = true;\n");
    fs.writeFileSync(path.join(outside, "CODEOWNERS"), "* @outside-owner\n");
    fs.writeFileSync(path.join(outside, "package.json"), JSON.stringify({ name: "@outside/leaked" }, null, 2));
    if (!symlinkOrSkip(t, path.join(outside, "CODEOWNERS"), path.join(cwd, ".github", "CODEOWNERS"))) return;
    if (!symlinkOrSkip(t, path.join(outside, "package.json"), path.join(cwd, "packages", "leaked", "package.json"))) return;

    runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src"]);

    const workspaces = JSON.parse(runCli(cwd, ["--code-report", "--code-report-section", "workspaces"]));
    assert.deepEqual(workspaces.data.codeowners, []);
    assert.ok(!workspaces.data.workspace_packages.some((row) => row.name === "@outside/leaked" || row.root === "packages/leaked"));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("incremental mode rejects parser-mode mismatches before loading optional parsers", () => {
  const cwd = makeTmpDir("code-index-parser-mismatch-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    initGitRepository(cwd);
    fs.writeFileSync(path.join(cwd, "src", "app.js"), "export function health() { return true; }\n");
    runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src"]);

    const result = runCliResult(cwd, ["--code-index", "--incremental", "--acknowledge-small-repo", "--code-scope", "src", "--code-parser", "tree-sitter"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /indexed parser mode default does not match requested parser mode tree-sitter/);
    assert.doesNotMatch(result.stderr, /requires optional package/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("tree-sitter mode fails loudly when an optional parser package is unavailable", () => {
  const backend = treeSitterBackends((message) => {
    throw new Error(message);
  }).find((candidate) => candidate.profile === "tree-sitter-javascript");
  assert.ok(backend);

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, ...args) {
    if (request === "@sengac/tree-sitter") throw new Error("mock missing parser package");
    return originalLoad.call(this, request, ...args);
  };
  try {
    assert.throws(
      () => backend.index({
        language: "javascript",
        path: "src/app.js",
        profile: "tree-sitter-javascript",
        text: "export const app = true;\n",
      }, {}),
      /--code-parser tree-sitter requires optional package @sengac\/tree-sitter;.*mock missing parser package/,
    );
  } finally {
    Module._load = originalLoad;
  }
});

test("read-only code evidence modes reject old schema indexes with a rebuild message", () => {
  const cwd = makeTmpDir("code-index-old-schema-");
  try {
    fs.mkdirSync(path.join(cwd, ".project-wiki"), { recursive: true });
    const database = openSnapshotDatabase(path.join(cwd, ".project-wiki", "code-evidence.sqlite"));
    try {
      database.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO meta (key, value) VALUES ('schema_version', '3');
      `);
    } finally {
      database.close();
    }
    const result = runCliResult(cwd, ["--code-status"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /schema version 3 is incompatible with \d+/);
    assert.match(result.stderr, /inspect: project-librarian --code-index-health/);
    assert.match(result.stderr, /rebuild: project-librarian --code-index --code-index-full --acknowledge-small-repo/);
    assert.match(result.stderr, /database: \.project-wiki\/code-evidence\.sqlite/);
    assert.doesNotMatch(result.stderr, /no such column|SQLITE_ERROR/i);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("code index health reports old schema details without requiring current schema columns", () => {
  const cwd = makeTmpDir("code-index-health-old-schema-");
  try {
    fs.mkdirSync(path.join(cwd, ".project-wiki"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "fixture.js"), "export const fixture = true;\n");
    const database = openSnapshotDatabase(path.join(cwd, ".project-wiki", "code-evidence.sqlite"));
    try {
      database.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE files (path TEXT PRIMARY KEY);
        INSERT INTO meta (key, value) VALUES ('schema_version', '3');
        INSERT INTO meta (key, value) VALUES ('scopes_json', '["."]');
        INSERT INTO meta (key, value) VALUES ('parser_mode', 'default');
        INSERT INTO files (path) VALUES ('fixture.js');
      `);
    } finally {
      database.close();
    }

    const health = JSON.parse(runCli(cwd, ["--code-index-health"]));
    assert.equal(health.status, "incompatible_schema");
    assert.equal(health.found_schema_version, "3");
    assert.equal(health.expected_schema_version, "4");
    assert.equal(health.indexed_files, 1);
    assert.match(health.recommended_rebuild_command, /project-librarian --code-index --code-index-full --acknowledge-small-repo/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("code status reports stale changed, added, and deleted files", () => {
  const cwd = makeTmpDir("code-status-stale-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    initGitRepository(cwd);
    fs.writeFileSync(path.join(cwd, "src", "changed.js"), "export const changed = 1;\n");
    fs.writeFileSync(path.join(cwd, "src", "deleted.js"), "export const deleted = 1;\n");
    runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src"]);

    fs.writeFileSync(path.join(cwd, "src", "changed.js"), "export const changed = 2;\n");
    fs.writeFileSync(path.join(cwd, "src", "added.js"), "export const added = 1;\n");
    fs.rmSync(path.join(cwd, "src", "deleted.js"));

    const rows = JSON.parse(runCli(cwd, ["--code-status"]));
    const byMetric = new Map(rows.map((row) => [row.metric, row.value]));
    assert.equal(byMetric.get("stale_changed_files"), 1);
    assert.equal(byMetric.get("stale_added_files"), 1);
    assert.equal(byMetric.get("stale_deleted_files"), 1);
    assert.equal(byMetric.get("stale_files"), 3);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("code status stays fresh when only file timestamps change", () => {
  const cwd = makeTmpDir("code-status-touched-only-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    initGitRepository(cwd);
    const filePath = path.join(cwd, "src", "touched.js");
    fs.writeFileSync(filePath, "export const touched = true;\n");
    runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src"]);

    const future = new Date(Date.now() + 5000);
    fs.utimesSync(filePath, future, future);

    const rows = JSON.parse(runCli(cwd, ["--code-status"]));
    const byMetric = new Map(rows.map((row) => [row.metric, row.value]));
    assert.equal(byMetric.get("stale_files"), 0);
    assert.equal(byMetric.get("stale_changed_files"), 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("code evidence CLI suppresses the known node:sqlite ExperimentalWarning", () => {
  const cwd = makeTmpDir("code-status-sqlite-warning-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "app.js"), "export const app = true;\n");

    const index = runCliResult(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src"]);
    assert.equal(index.status, 0, index.stderr || index.stdout);
    assertNoSqliteExperimentalWarning(index, "--code-index must not leak node:sqlite warning");

    const status = runCliResult(cwd, ["--code-status"]);
    assert.equal(status.status, 0, status.stderr || status.stdout);
    assertNoSqliteExperimentalWarning(status, "--code-status must not leak node:sqlite warning");

    const report = runCliResult(cwd, ["--code-report", "--code-report-section", "coverage"]);
    assert.equal(report.status, 0, report.stderr || report.stdout);
    assertNoSqliteExperimentalWarning(report, "--code-report must not leak node:sqlite warning");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("code index phase timings are opt-in stderr JSON", () => {
  const cwd = makeTmpDir("code-index-phase-timings-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "app.js"), "export const app = true;\n");

    const result = runCliResult(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src"], {
      env: { PROJECT_LIBRARIAN_CODE_INDEX_TIMINGS: "1" },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const line = result.stderr.split(/\r?\n/).find((entry) => entry.startsWith("code_index_phase_timings "));
    assert.ok(line, "expected code_index_phase_timings stderr line");
    const timings = JSON.parse(line.replace("code_index_phase_timings ", ""));
    assert.equal(typeof timings.discover_files_ms, "number");
    assert.equal(typeof timings.read_files_ms, "number");
    assert.equal(typeof timings.sqlite_write_ms, "number");
    assert.equal(typeof timings.total_ms, "number");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("native-rust code index engine fails explicitly without deleting the existing TS index", () => {
  const cwd = makeTmpDir("code-index-native-engine-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "app.js"), "export const app = true;\n");

    runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src"]);
    const databasePath = path.join(cwd, ".project-wiki", "code-evidence.sqlite");
    assert.equal(fs.existsSync(databasePath), true);

    const result = runCliResult(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src", "--code-index-engine", "native-rust"], {
      env: { PROJECT_LIBRARIAN_NATIVE_INDEXER: "" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires PROJECT_LIBRARIAN_NATIVE_INDEXER/);
    assert.equal(fs.existsSync(databasePath), true);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("implicit auto code index engine keeps TypeScript below the native auto threshold even when a helper path is set", () => {
  const cwd = makeTmpDir("code-index-auto-small-repo-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "app.js"), "export const app = true;\n");

    assert.equal(nativeCodeIndexAutoFileThreshold, 10000);
    const result = runCliResult(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src"], {
      env: { PROJECT_LIBRARIAN_NATIVE_INDEXER: path.join(cwd, "missing-native-helper") },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /engine: typescript/);
    assert.match(result.stdout, /engine_selection: auto/);
    assert.doesNotMatch(result.stdout, /native_strategy:/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("native helper wrapper fails on non-zero exits and malformed JSON summaries", () => {
  const cwd = makeTmpDir("code-index-native-helper-wrapper-");
  try {
    const job = buildNativeCodeIndexJob({
      database_path: path.join(cwd, "code.sqlite"),
      files: [],
      parser_mode: "default",
      schema_version: "4",
      scopes: ["src"],
    });
    const nonZeroHelper = path.join(cwd, "non-zero-helper.js");
    writeExecutableHelper(nonZeroHelper, [
      "#!/usr/bin/env node",
      "process.stderr.write('helper boom');",
      "process.exit(42);",
      "",
    ].join("\n"));
    assert.throws(
      () => runNativeCodeIndexHelper(job, { helperPath: nonZeroHelper }),
      /native code index helper failed \(42\): helper boom/,
    );

    const malformedHelper = path.join(cwd, "malformed-helper.js");
    writeExecutableHelper(malformedHelper, [
      "#!/usr/bin/env node",
      "process.stdout.write('not-json');",
      "",
    ].join("\n"));
    assert.throws(
      () => runNativeCodeIndexHelper(job, { helperPath: malformedHelper }),
      /native code index helper returned invalid JSON/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("native-rust helper prototype builds a bounded JS/TS code index", (t) => {
  const helperPath = buildNativeIndexerOrSkip(t);
  if (!helperPath) return;
  const cwd = makeTmpDir("code-index-native-rust-prototype-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "app.ts"), [
      'import { makeUser } from "./user";',
      'export function healthHandler() { return makeUser("ok"); }',
      'app.get("/health", healthHandler);',
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(cwd, "src", "user.ts"), [
      "export const makeUser = (name) => name;",
      "",
    ].join("\n"));

    const result = runCliResult(cwd, ["--code-index", "--acknowledge-small-repo", "--code-index-engine", "native-rust", "--code-scope", "src"], {
      env: { PROJECT_LIBRARIAN_NATIVE_INDEXER: helperPath },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /engine: native-rust/);

    const database = openSnapshotDatabase(path.join(cwd, ".project-wiki", "code-evidence.sqlite"));
    try {
      const snapshot = codeIndexSnapshot(database);
      assert(snapshot.files.some((row) => row.path === "src/app.ts" && row.profile === "typescript-ast"));
      assert(snapshot.files.some((row) => row.path === "src/user.ts" && row.profile === "typescript-ast"));
      assert(snapshot.symbols.some((row) => row.name === "healthHandler" && row.kind === "function"));
      assert(snapshot.symbols.some((row) => row.name === "makeUser" && row.kind === "function"));
      assert(snapshot.imports.some((row) => row.from_file === "src/app.ts" && row.to_ref === "./user" && row.imported === "makeUser"));
      assert(snapshot.routes.some((row) => row.file_path === "src/app.ts" && row.method === "GET" && row.route === "/health" && row.handler === "healthHandler"));
      assert(snapshot.edges.some((row) => row.kind === "route_to_handler" && row.source === "GET /health" && row.target === "healthHandler"));
    } finally {
      database.close();
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("native-rust helper matches the TypeScript engine for supported JS/TS snapshot rows", (t) => {
  const helperPath = buildNativeIndexerOrSkip(t);
  if (!helperPath) return;
  const cwd = makeTmpDir("code-index-native-rust-parity-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "app.ts"), [
      'import { makeUser } from "./user";',
      "export interface User { name: string }",
      "export type UserId = string;",
      "export enum Role { Admin }",
      "export function healthHandler() { return makeUser(); }",
      "class ApiController {",
      '  getUser() { return "ok"; }',
      "}",
      'app.get("/health", healthHandler);',
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(cwd, "src", "user.ts"), [
      'export function makeUser() { return "ok"; }',
      "",
    ].join("\n"));

    runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src", "--code-index-out", ".project-wiki/ts.sqlite"]);
    const tsDatabase = openSnapshotDatabase(path.join(cwd, ".project-wiki", "ts.sqlite"));
    try {
      for (const strategy of ["sqlite-bridge", "sqlite-direct", "row-stream"]) {
        const nativeOutput = `.project-wiki/native-${strategy}.sqlite`;
        const nativeResult = runCliResult(cwd, [
          "--code-index",
          "--acknowledge-small-repo",
          "--code-index-engine",
          "native-rust",
          "--code-scope",
          "src",
          "--code-index-out",
          nativeOutput,
        ], {
          env: {
            PROJECT_LIBRARIAN_NATIVE_INDEXER: helperPath,
            PROJECT_LIBRARIAN_NATIVE_INDEXER_STRATEGY: strategy,
          },
        });
        assert.equal(nativeResult.status, 0, nativeResult.stderr || nativeResult.stdout);
        assert.match(nativeResult.stdout, /engine: native-rust/);
        assert.match(nativeResult.stdout, new RegExp(`native_strategy: ${strategy}`));
        assert.match(nativeResult.stdout, /native_files: 2/);
        assert.match(nativeResult.stdout, /typescript_files: 0/);

        const nativeDatabase = openSnapshotDatabase(path.join(cwd, nativeOutput));
        try {
          assert.deepEqual(
            normalizedNativeParitySnapshot(codeIndexSnapshot(nativeDatabase)),
            normalizedNativeParitySnapshot(codeIndexSnapshot(tsDatabase)),
          );
        } finally {
          nativeDatabase.close();
        }
      }
    } finally {
      tsDatabase.close();
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("native-rust helper matches TypeScript for module and decorator patterns", (t) => {
  const helperPath = buildNativeIndexerOrSkip(t);
  if (!helperPath) return;
  const cwd = makeTmpDir("code-index-native-rust-module-parity-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "controller.ts"), [
      'import * as userApi from "./user";',
      'const fs = require("node:fs");',
      "export { makeUser } from \"./user\";",
      "const buildUser = () => ({ id: fs.readFileSync });",
      "class UserController {",
      '  @get("/users")',
      '  list() { return "ok"; }',
      "}",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(cwd, "src", "user.ts"), [
      'export const makeUser = () => "ok";',
      "",
    ].join("\n"));

    runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src", "--code-index-out", ".project-wiki/ts.sqlite"]);
    const nativeResult = runCliResult(cwd, [
      "--code-index",
      "--acknowledge-small-repo",
      "--code-index-engine",
      "native-rust",
      "--code-scope",
      "src",
      "--code-index-out",
      ".project-wiki/native.sqlite",
    ], {
      env: { PROJECT_LIBRARIAN_NATIVE_INDEXER: helperPath },
    });
    assert.equal(nativeResult.status, 0, nativeResult.stderr || nativeResult.stdout);

    const tsDatabase = openSnapshotDatabase(path.join(cwd, ".project-wiki", "ts.sqlite"));
    const nativeDatabase = openSnapshotDatabase(path.join(cwd, ".project-wiki", "native.sqlite"));
    try {
      assert.deepEqual(
        normalizedNativeParitySnapshot(codeIndexSnapshot(nativeDatabase)),
        normalizedNativeParitySnapshot(codeIndexSnapshot(tsDatabase)),
      );
    } finally {
      nativeDatabase.close();
      tsDatabase.close();
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("native-rust engine partitions JS/TS to Rust and non-JS profiles to TypeScript", (t) => {
  const helperPath = buildNativeIndexerOrSkip(t);
  if (!helperPath) return;
  const cwd = makeTmpDir("code-index-native-rust-mixed-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.mkdirSync(path.join(cwd, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(cwd, "cmd"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "app.ts"), [
      'export function healthHandler() { return "ok"; }',
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(cwd, "scripts", "tool.py"), [
      "import os",
      "def load_config(path):",
      "    return path",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(cwd, "cmd", "main.go"), [
      "package main",
      'import "fmt"',
      "func main() {",
      "    fmt.Println(\"ok\")",
      "}",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
      scripts: { test: "node --test" },
      dependencies: { express: "^4.0.0" },
    }, null, 2));

    const result = runCliResult(cwd, ["--code-index", "--acknowledge-small-repo", "--code-index-engine", "native-rust"], {
      env: { PROJECT_LIBRARIAN_NATIVE_INDEXER: helperPath },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /engine: mixed-native-rust/);
    assert.match(result.stdout, /files: 4/);
    assert.match(result.stdout, /native_files: 1/);
    assert.match(result.stdout, /typescript_files: 3/);
    assert.match(result.stdout, /typescript_profiles: config, go-light, python-light/);

    const database = openSnapshotDatabase(path.join(cwd, ".project-wiki", "code-evidence.sqlite"));
    try {
      const snapshot = codeIndexSnapshot(database);
      assert(snapshot.files.some((row) => row.path === "src/app.ts" && row.profile === "typescript-ast"));
      assert(snapshot.files.some((row) => row.path === "scripts/tool.py" && row.profile === "python-light"));
      assert(snapshot.files.some((row) => row.path === "cmd/main.go" && row.profile === "go-light"));
      assert(snapshot.files.some((row) => row.path === "package.json" && row.profile === "config"));
      assert(snapshot.symbols.some((row) => row.file_path === "src/app.ts" && row.name === "healthHandler"));
      assert(snapshot.symbols.some((row) => row.file_path === "scripts/tool.py" && row.name === "load_config"));
      assert(snapshot.symbols.some((row) => row.file_path === "cmd/main.go" && row.name === "main"));
      assert(snapshot.configs.some((row) => row.file_path === "package.json" && row.key === "script:test"));
    } finally {
      database.close();
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("native-rust helper matches TypeScript for checked-in mixed sample corpora", (t) => {
  const helperPath = buildNativeIndexerOrSkip(t);
  if (!helperPath) return;
  const samplesRoot = path.resolve(__dirname, "..", "..", "benchmarks", "samples");
  for (const sample of ["mixed-monorepo", "web-service"]) {
    const cwd = makeTmpDir(`code-index-native-rust-sample-${sample}-`);
    try {
      fs.cpSync(path.join(samplesRoot, sample), cwd, { recursive: true });
      runCli(cwd, [
        "--code-index",
        "--acknowledge-small-repo",
        "--code-scope",
        ".",
        "--code-index-out",
        ".project-wiki/ts.sqlite",
      ]);
      const nativeResult = runCliResult(cwd, [
        "--code-index",
        "--acknowledge-small-repo",
        "--code-index-engine",
        "native-rust",
        "--code-scope",
        ".",
        "--code-index-out",
        ".project-wiki/native.sqlite",
      ], {
        env: {
          PROJECT_LIBRARIAN_NATIVE_INDEXER: helperPath,
          PROJECT_LIBRARIAN_NATIVE_INDEXER_STRATEGY: "sqlite-direct",
        },
      });
      assert.equal(nativeResult.status, 0, nativeResult.stderr || nativeResult.stdout);

      const tsDatabase = openSnapshotDatabase(path.join(cwd, ".project-wiki", "ts.sqlite"));
      const nativeDatabase = openSnapshotDatabase(path.join(cwd, ".project-wiki", "native.sqlite"));
      try {
        assert.deepEqual(
          normalizedNativeParitySnapshot(codeIndexSnapshot(nativeDatabase)),
          normalizedNativeParitySnapshot(codeIndexSnapshot(tsDatabase)),
          `${sample} native snapshot should match TypeScript`,
        );
      } finally {
        nativeDatabase.close();
        tsDatabase.close();
      }
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test("--code-index-out accepts project-wiki paths and rejects paths outside the evidence directory", () => {
  const cwd = makeTmpDir("code-index-out-");
  try {
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    initGitRepository(cwd);
    fs.writeFileSync(path.join(cwd, "src", "app.js"), "export const ok = true;\n");

    runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src", "--code-index-out", ".project-wiki/custom/code.sqlite"]);
    assert.equal(fs.existsSync(path.join(cwd, ".project-wiki", "custom", "code.sqlite")), true);

    const result = runCliResult(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src", "--code-index-out", "outside.sqlite"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--code-index-out must stay inside \.project-wiki\//);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
