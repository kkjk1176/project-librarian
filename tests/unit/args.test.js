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

test("parseArgs treats update as an explicit init/update command", () => {
  const parsed = parseArgs(["update", "--no-git-config"]);
  assert.equal(parsed.command, "update");
  assert.deepEqual(parsed.commandArgs, ["--no-git-config"]);
  assert.equal(parsed.noGitConfigMode, true);
  assert.equal(parsed.unknownCommand, "");
});

test("parseArgs preserves update migration conflicts for command validation", () => {
  const migrate = parseArgs(["update", "--migrate"]);
  assert.equal(migrate.command, "update");
  assert.equal(migrate.migrateMode, true);
  assert.deepEqual(migrate.commandArgs, ["--migrate"]);

  const adopt = parseArgs(["update", "--adopt-existing"]);
  assert.equal(adopt.command, "update");
  assert.equal(adopt.migrateMode, true);
  assert.deepEqual(adopt.commandArgs, ["--adopt-existing"]);
});

test("parseArgs parses init/update agent surface selection", () => {
  const parsed = parseArgs(["update", "--agents", "codex,claude", "--agents=cursor"]);
  assert.equal(parsed.command, "update");
  assert.deepEqual(parsed.agentTargets, ["codex", "claude", "cursor"]);
  assert.deepEqual(parsed.invalidAgentTargets, []);
});

test("parseArgs validates invalid agent surface entries", () => {
  const parsed = parseArgs(["--agents", "codex,unknown"]);
  assert.deepEqual(parsed.agentTargets, ["codex"]);
  assert.deepEqual(parsed.invalidAgentTargets, ["unknown"]);
});

test("parseArgs expands all agent surfaces", () => {
  const parsed = parseArgs(["--agents=all"]);
  assert.deepEqual(parsed.agentTargets, ["codex", "claude", "cursor", "gemini"]);
  assert.deepEqual(parsed.invalidAgentTargets, []);
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
