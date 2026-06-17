const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { codeContextPack, codeImpact, codeIndexSnapshot, isCodeEvidenceModeFor, searchSymbols } = require("../../dist/code-index.js");
const { openDatabase } = require("../../dist/code-index-db.js");
const { fileLanguage, ignoredDirectories, isIgnoredCodePath, shouldIndexFile } = require("../../dist/code-index-file-policy.js");
const { isReadOnlySql } = require("../../dist/code-index-sql.js");
const { ignoredDirs } = require("../../dist/wiki-files.js");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");

const inactiveFlags = {
  codeContextPackTarget: "",
  codeFilesMode: false,
  codeImpactMode: false,
  codeIndexMode: false,
  codeQuerySql: "",
  codeReportMode: false,
  codeSearchSymbol: "",
  codeStatusMode: false,
};

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(cwd, args) {
  const result = childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `CLI ${args.join(" ")} failed (${result.status}): ${result.stderr}`);
  return result.stdout;
}

function openSnapshotDatabase(databasePath) {
  return openDatabase(databasePath, (message) => {
    throw new Error(message);
  });
}

function initGitRepository(cwd) {
  const result = childProcess.spawnSync("git", ["init", "-q"], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `git init failed (${result.status}): ${result.stderr}`);
}

test("isCodeEvidenceModeFor includes every code evidence mode", () => {
  assert.equal(isCodeEvidenceModeFor(inactiveFlags), false);
  assert.equal(isCodeEvidenceModeFor({ ...inactiveFlags, codeIndexMode: true }), true);
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
  assert.equal(shouldIndexFile("config/service-token.yaml"), false);
  assert.equal(shouldIndexFile("config/service.yaml"), true);
  assert.equal(ignoredDirectories.has("dist"), true);
  assert.equal(ignoredDirectories.has(".project-wiki"), true);
  assert.equal(ignoredDirs.has("dist"), true);
  assert.equal(ignoredDirs.has(".project-wiki"), false);
  assert.equal(isIgnoredCodePath("dist/init-project-wiki.js"), true);
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
