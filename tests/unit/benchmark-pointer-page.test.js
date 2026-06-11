"use strict";

// Tests for the code-evidence pointer page (wiki/canonical/code-evidence-query.md)
// and the in-fixture task-command verification (verifyInstalledRunnerCommands).
//
// Policy: fixtures advertise the product's task-shaped interface first; raw SQL
// is the documented fallback listed last. These tests enforce both the ordering
// and the content contract without executing real codex or running the full
// fixture build pipeline. Fixture builds for the verifyInstalledRunnerCommands
// path are tmp-confined and skip-guarded behind the built CLI.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  codeAdvancedCommands,
  codeEvidenceQueryPointerPage,
  codeRunnerBase,
  codeTaskCommands,
  materializeFixturePair,
  scales,
  verifyInstalledRunnerCommands,
} = require("../../benchmarks/lib/llm-fixtures");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");
const skip = !fs.existsSync(cliPath) ? "dist CLI not built" : false;

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// --- pointer page content contract -------------------------------------------

test("pointer page lists all three task-shaped commands", () => {
  const page = codeEvidenceQueryPointerPage();
  for (const entry of codeTaskCommands) {
    assert(page.includes(entry.command), `pointer page must include task command: ${entry.command}`);
  }
});

test("pointer page lists both advanced fallback commands", () => {
  const page = codeEvidenceQueryPointerPage();
  for (const entry of codeAdvancedCommands) {
    assert(page.includes(entry.command), `pointer page must include advanced command: ${entry.command}`);
  }
});

test("task commands appear before the SQL fallback in the pointer page", () => {
  const page = codeEvidenceQueryPointerPage();
  // The impact/ownership/workspace task commands must each appear earlier in the
  // page than the --code-query SQL fallback, so agents reading top-to-bottom see
  // the task interface first.
  const sqlFallbackEntry = codeAdvancedCommands.find((e) => e.command.includes("--code-query"));
  assert(sqlFallbackEntry, "expected an advanced command with --code-query");
  const sqlPos = page.indexOf(sqlFallbackEntry.command);
  assert(sqlPos > -1, "SQL fallback command must appear in pointer page");
  for (const entry of codeTaskCommands) {
    const taskPos = page.indexOf(entry.command);
    assert(taskPos > -1, `task command must appear in pointer page: ${entry.command}`);
    assert(
      taskPos < sqlPos,
      `task command (${entry.family}) must appear before SQL fallback in pointer page; taskPos=${taskPos} sqlPos=${sqlPos}`,
    );
  }
});

test("pointer page contains a 'Task commands' section header before an 'Advanced' section header", () => {
  const page = codeEvidenceQueryPointerPage();
  const taskHeaderPos = page.indexOf("Task commands");
  const advancedHeaderPos = page.indexOf("Advanced");
  assert(taskHeaderPos > -1, "pointer page must have a 'Task commands' section header");
  assert(advancedHeaderPos > -1, "pointer page must have an 'Advanced' section header");
  assert(taskHeaderPos < advancedHeaderPos, "'Task commands' header must precede 'Advanced' header");
});

test("pointer page does not contain any code_graph answer key terms", () => {
  // The docs-only gate enforces this at fixture-generation time; this test
  // pre-checks the static page content so a typo that embeds an answer value
  // fails immediately without requiring a full fixture build.
  const page = codeEvidenceQueryPointerPage();
  // Terms that would be answer keys: real module paths, workspace package names
  // with numeric suffixes, service team handles, or owned file paths.
  const forbiddenPatterns = [
    /packages\/workspace-0\/src\/mod-\d+\.ts/,
    /@benchmark\/workspace-\d+/,
    /@benchmark-service-team/,
    /packages\/workspace-0\/src\/service\/handler/,
  ];
  for (const pattern of forbiddenPatterns) {
    assert(
      !pattern.test(page),
      `pointer page must not contain answer key term matching ${pattern}; found in page`,
    );
  }
});

test("all task commands share the same runner base path", () => {
  // The installed runner path is deterministic; all commands must use the same
  // base so the agent learns one tool location, not scattered invocations.
  for (const entry of codeTaskCommands) {
    assert(
      entry.command.startsWith(codeRunnerBase),
      `task command for ${entry.family} must start with codeRunnerBase; got: ${entry.command}`,
    );
  }
  for (const entry of codeAdvancedCommands) {
    assert(
      entry.command.startsWith(codeRunnerBase),
      `advanced command must start with codeRunnerBase; got: ${entry.command}`,
    );
  }
});

test("codeTaskCommands covers all three code_graph families", () => {
  const families = codeTaskCommands.map((e) => e.family).sort();
  assert.deepEqual(families, ["impact_trace", "ownership_lookup", "workspace_graph"]);
});

// --- verifyInstalledRunnerCommands: pass + failure paths ---------------------
// These tests build a minimal on-disk fixture using the real CLI (tmp-confined)
// and then exercise the verification function's success and failure paths.

test("verifyInstalledRunnerCommands passes on a structurally valid small fixture", { skip }, () => {
  const fixtureRoot = makeTmpDir("ptr-verify-pass-");
  try {
    // materializeFixturePair plants the full structure including the import
    // chain and workspace spine, indexes it, installs the runner, and calls
    // verifyInstalledRunnerCommands internally.  If it returns without throwing,
    // the verification passed.
    assert.doesNotThrow(() => materializeFixturePair(fixtureRoot, "small", cliPath, "organic"));
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("verifyInstalledRunnerCommands fails with a clear message when --code-impact returns no importers", { skip }, () => {
  // Build a valid small fixture, then delete the entire import chain so the
  // installed runner's --code-impact finds no importers in a re-indexed state.
  // We simulate this by building a separate minimal fixture without the chain.
  const tmpRoot = makeTmpDir("ptr-verify-fail-impact-");
  try {
    // Build a bare fixture directory with an index but NO import chain.
    fs.mkdirSync(path.join(tmpRoot, "packages", "workspace-0", "src"), { recursive: true });
    // Write a package.json so the runner can locate the project root.
    fs.writeFileSync(path.join(tmpRoot, "package.json"), JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }));
    fs.writeFileSync(path.join(tmpRoot, "packages", "workspace-0", "package.json"), JSON.stringify({ name: "@benchmark/workspace-0", version: "1.0.0", private: true }));
    // Write CODEOWNERS so ownership section is non-empty.
    fs.writeFileSync(path.join(tmpRoot, "CODEOWNERS"), "* @org-default\n");
    // Write a second workspace so workspace-graph has an internal dep edge.
    fs.mkdirSync(path.join(tmpRoot, "packages", "workspace-1", "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, "packages", "workspace-1", "package.json"),
      JSON.stringify({ name: "@benchmark/workspace-1", version: "1.0.0", private: true, dependencies: { "@benchmark/workspace-0": "workspace:*" } }),
    );
    fs.writeFileSync(path.join(tmpRoot, "packages", "workspace-1", "src", "bridge.ts"), 'import "@benchmark/workspace-0";\n');
    // Build the index (no mod-0.ts / no import chain planted).
    childProcess.execFileSync(process.execPath, [cliPath, "--code-index", "--code-scope", "packages", "--code-scope", "package.json", "--code-scope", "CODEOWNERS"], { cwd: tmpRoot, stdio: ["ignore", "pipe", "pipe"] });
    // Install runner into the fixture using the same pattern as materializeWithProjectLibrarian.
    const distDir = path.dirname(cliPath);
    const runnerDir = path.join(tmpRoot, "tools", "project-librarian");
    const targetDir = path.join(runnerDir, "dist");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.cpSync(distDir, targetDir, { recursive: true });
    fs.writeFileSync(path.join(runnerDir, "package.json"), JSON.stringify({ name: "project-librarian-local-runner", private: true, type: "commonjs" }, null, 2) + "\n");
    // Symlink typescript dependency.
    const tsDir = path.dirname(require.resolve("typescript/package.json", { paths: [__dirname] }));
    const nmDir = path.join(runnerDir, "node_modules");
    fs.mkdirSync(nmDir, { recursive: true });
    const tsLink = path.join(nmDir, "typescript");
    if (!fs.existsSync(tsLink)) fs.symlinkSync(tsDir, tsLink, "dir");
    // Convert out of WAL mode.
    const dbPath = path.join(tmpRoot, ".project-wiki", "code-evidence.sqlite");
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.prepare("PRAGMA journal_mode=DELETE").get();
    db.close();
    const installedCli = path.join(targetDir, path.basename(cliPath));
    const installedRelative = path.relative(tmpRoot, installedCli).split(path.sep).join("/");
    // Now call verifyInstalledRunnerCommands — it must fail because mod-0 is absent.
    assert.throws(
      () => verifyInstalledRunnerCommands(tmpRoot, installedRelative),
      (err) => err.message.includes("--code-impact") && err.message.includes("no importers"),
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
