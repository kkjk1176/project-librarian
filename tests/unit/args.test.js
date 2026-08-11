"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseArgs } = require("../../dist/args.js");

test("parseArgs keeps init as the default command", () => {
  const parsed = parseArgs(["--lint"]);
  assert.equal(parsed.command, "init");
  assert.equal(parsed.lintMode, true);
  assert.deepEqual(parsed.commandArgs, ["--lint"]);
});

test("parseArgs exposes only init, update, and install commands", () => {
  for (const command of ["init", "update", "install"]) {
    const parsed = parseArgs([command, "--no-git-config"]);
    assert.equal(parsed.command, command);
    assert.equal(parsed.unknownCommand, "");
  }
  assert.equal(parseArgs(["install-skill"]).unknownCommand, "install-skill");
  assert.equal(parseArgs(["mcp"]).unknownCommand, "mcp");
});

test("parseArgs parses and validates agent surface selection", () => {
  const parsed = parseArgs(["update", "--agents", "codex,claude", "--agents=cursor"]);
  assert.deepEqual(parsed.agentTargets, ["codex", "claude", "cursor"]);
  assert.deepEqual(parsed.invalidAgentTargets, []);

  const invalid = parseArgs(["--agents", "codex,unknown"]);
  assert.deepEqual(invalid.agentTargets, ["codex"]);
  assert.deepEqual(invalid.invalidAgentTargets, ["unknown"]);

  assert.deepEqual(parseArgs(["--agents=all"]).agentTargets, ["codex", "claude", "cursor", "gemini"]);
});

test("parseArgs reports unknown commands and options", () => {
  const parsed = parseArgs(["unknown-command", "--definitely-unknown"]);
  assert.equal(parsed.unknownCommand, "unknown-command");
  assert.deepEqual(parsed.unknownOptions, ["--definitely-unknown"]);
});

test("parseArgs validates missing values and boolean values", () => {
  assert.deepEqual(parseArgs(["--query"]).missingValueOptions, ["--query"]);
  assert.deepEqual(parseArgs(["--lint=true"]).unexpectedValueOptions, ["--lint"]);
});

test("parseArgs rejects unsupported options", () => {
  for (const option of ["--unsupported-option", "--not-a-real-mode"]) {
    assert.deepEqual(parseArgs([option]).unknownOptions, [option], option);
  }
});

test("parseArgs handles wiki diagnostics and retrieval", () => {
  const parsed = parseArgs([
    "--doctor",
    "--fix",
    "--prune-check",
    "--prune-check-strict",
    "--query=authentication",
    "--wiki-impact",
    "PRD-012",
    "--wiki-neighborhood=checkout",
  ]);
  assert.equal(parsed.doctorMode, true);
  assert.equal(parsed.fixMode, true);
  assert.equal(parsed.pruneCheckMode, true);
  assert.equal(parsed.pruneCheckStrictMode, true);
  assert.equal(parsed.queryTerm, "authentication");
  assert.equal(parsed.wikiImpactTarget, "PRD-012");
  assert.equal(parsed.wikiNeighborhoodTarget, "checkout");
});

test("parseArgs handles inbox capture", () => {
  const parsed = parseArgs(["--capture-inbox", "--title", "Open question", "--content=Who owns retries?", "--category", "question"]);
  assert.equal(parsed.captureInboxMode, true);
  assert.equal(parsed.captureTitle, "Open question");
  assert.equal(parsed.captureContent, "Who owns retries?");
  assert.equal(parsed.captureCategory, "question");
});

test("parseArgs handles session handoff modes and fields", () => {
  const parsed = parseArgs([
    "--handoff-save",
    "--goal=Ship handoff",
    "--state",
    "Implementation started",
    "--blocked",
    "none",
    "--next",
    "Add tests",
    "--next=Run build",
    "--decision",
    "Pointer only",
    "--open-question",
    "Review later?",
    "--last-success-command",
    "npm run build",
    "--last-failure-command",
    "npm test",
    "--verification",
    "unit tests",
  ]);
  assert.equal(parsed.handoffSaveMode, true);
  assert.equal(parsed.handoffInputMode, true);
  assert.equal(parsed.handoffGoal, "Ship handoff");
  assert.equal(parsed.handoffState, "Implementation started");
  assert.deepEqual(parsed.handoffBlocked, ["none"]);
  assert.deepEqual(parsed.handoffNextActions, ["Add tests", "Run build"]);
  assert.deepEqual(parsed.handoffDecisions, ["Pointer only"]);
  assert.deepEqual(parsed.handoffOpenQuestions, ["Review later?"]);
  assert.equal(parsed.handoffLastSuccessCommand, "npm run build");
  assert.equal(parsed.handoffLastFailureCommand, "npm test");
  assert.deepEqual(parsed.handoffVerification, ["unit tests"]);
});

test("parseArgs handles session handoff promotion and injection modes", () => {
  assert.equal(parseArgs(["--handoff-promote-inbox"]).handoffPromoteInboxMode, true);
  assert.equal(parseArgs(["--handoff-injection-enable"]).handoffInjectionEnableMode, true);
  assert.equal(parseArgs(["--handoff-injection-disable"]).handoffInjectionDisableMode, true);
  assert.equal(parseArgs(["--handoff-injection-status"]).handoffInjectionStatusMode, true);
});
