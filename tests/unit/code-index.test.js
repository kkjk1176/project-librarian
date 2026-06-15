const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { codeContextPack, codeIndexSnapshot, isCodeEvidenceModeFor, searchSymbols } = require("../../dist/code-index.js");
const { openDatabase } = require("../../dist/code-index-db.js");
const { fileLanguage, isIgnoredCodePath, shouldIndexFile } = require("../../dist/code-index-file-policy.js");
const { isReadOnlySql } = require("../../dist/code-index-sql.js");

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
    runCli(cwd, ["--code-index", "--acknowledge-small-repo", "--code-scope", "src", "--code-scope", "package.json"]);

    const databasePath = path.join(cwd, ".project-wiki", "code-evidence.sqlite");
    const firstDatabase = openSnapshotDatabase(databasePath);
    const secondDatabase = openSnapshotDatabase(databasePath);
    try {
      const first = codeIndexSnapshot(firstDatabase);
      const second = codeIndexSnapshot(secondDatabase);
      assert.deepEqual(first, second);
      assert.ok(first.files.some((row) => row.path === "src/app.js" && row.profile === "typescript-ast"));
      assert.ok(first.symbols.some((row) => row.name === "healthHandler" && row.kind === "function" && row.file_path === "src/app.js"));
      assert.ok(first.imports.some((row) => row.to_ref === "express" && row.from_file === "src/app.js"));
      assert.ok(first.routes.some((row) => row.route === "/health" && row.handler === "healthHandler"));
      assert.ok(first.edges.some((row) => row.kind === "route_to_handler" && row.target === "healthHandler"));

      const multiToken = searchSymbols(firstDatabase, "Promise UserRecord");
      assert.ok(multiToken.some((row) => row.name === "fetchUser" && row.file_path === "src/service.ts"));
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
    } finally {
      firstDatabase.close();
      secondDatabase.close();
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
