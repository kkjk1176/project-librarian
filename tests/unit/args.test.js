const assert = require("node:assert/strict");
const test = require("node:test");
const { parseArgs } = require("../../dist/args.js");

test("parseArgs keeps init as the default command", () => {
  const parsed = parseArgs(["--lint"]);
  assert.equal(parsed.command, "init");
  assert.equal(parsed.lintMode, true);
  assert.deepEqual(parsed.commandArgs, ["--lint"]);
});

test("parseArgs separates install-skill command options", () => {
  const parsed = parseArgs(["install-skill", "--scope", "project", "--agents=codex"]);
  assert.equal(parsed.command, "install-skill");
  assert.deepEqual(parsed.commandArgs, ["--scope", "project", "--agents=codex"]);
  assert.equal(parsed.unknownCommand, "");
  assert.equal(parsed.missingValueOptions.length, 0);
});

test("parseArgs reports unknown commands and options without editing mode state", () => {
  const parsed = parseArgs(["unknown-command", "--definitely-unknown"]);
  assert.equal(parsed.unknownCommand, "unknown-command");
  assert.deepEqual(parsed.unknownOptions, ["--definitely-unknown"]);
});

test("parseArgs validates missing values and boolean values", () => {
  const missing = parseArgs(["--query"]);
  assert.deepEqual(missing.missingValueOptions, ["--query"]);

  const unexpected = parseArgs(["--lint=true"]);
  assert.deepEqual(unexpected.unexpectedValueOptions, ["--lint"]);
});

test("parseArgs handles code evidence aliases and comma scopes", () => {
  const parsed = parseArgs(["--code-evidence-impact=health", "--code-scope", "src,tests", "--code-evidence-scope=benchmarks"]);
  assert.equal(parsed.codeImpactMode, true);
  assert.equal(parsed.codeImpactTarget, "health");
  assert.deepEqual(parsed.codeIndexScopes, ["src", "tests", "benchmarks"]);
});

test("parseArgs handles code context pack aliases", () => {
  const parsed = parseArgs(["--code-evidence-context-pack", "healthHandler"]);
  assert.equal(parsed.codeContextPackMode, true);
  assert.equal(parsed.codeContextPackTarget, "healthHandler");
});

test("parseArgs handles migration diagnostic modes", () => {
  const parsed = parseArgs(["--migration-lint", "--migration-quality-check", "--migration-doctor"]);
  assert.equal(parsed.migrationLintMode, true);
  assert.equal(parsed.migrationQualityCheckMode, true);
  assert.equal(parsed.migrationDoctorMode, true);
});
