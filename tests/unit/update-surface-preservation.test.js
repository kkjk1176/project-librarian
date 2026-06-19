"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");

function runCli(cwd, args = []) {
  return childProcess.execFileSync(process.execPath, [cliPath, "--no-git-config", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCommand(cwd, args = []) {
  return childProcess.execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCliFailure(cwd, args = []) {
  try {
    runCli(cwd, args);
  } catch (error) {
    return {
      stdout: error.stdout?.toString() ?? "",
      stderr: error.stderr?.toString() ?? "",
      status: error.status,
    };
  }
  throw new Error("expected command to fail");
}

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function exists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assertCodexClaudeOnly(root) {
  assert.equal(exists(root, "AGENTS.md"), true);
  assert.equal(exists(root, ".codex/hooks.json"), true);
  assert.equal(exists(root, ".codex/hooks/wiki-session-start.js"), true);
  assert.equal(exists(root, "CLAUDE.md"), true);
  assert.equal(exists(root, ".claude/settings.json"), true);
  assert.equal(exists(root, ".claude/hooks/wiki-session-start.js"), true);
  assert.equal(exists(root, ".cursor"), false, "Cursor surface should not be created");
  assert.equal(exists(root, ".gemini"), false, "Gemini surface directory should not be created");
  assert.equal(exists(root, "GEMINI.md"), false, "Gemini instructions should not be created");
}

test("fresh bootstrap without --agents still installs all supported agent surfaces", () => {
  const root = makeTmpDir("surface-default-");
  try {
    runCli(root);
    assert.equal(exists(root, ".codex/hooks.json"), true);
    assert.equal(exists(root, "CLAUDE.md"), true);
    assert.equal(exists(root, ".cursor/hooks.json"), true);
    assert.equal(exists(root, ".cursor/rules/project-librarian.mdc"), true);
    assert.equal(exists(root, "GEMINI.md"), true);
    assert.equal(exists(root, ".gemini/settings.json"), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fresh bootstrap with --agents codex,claude creates only Codex and Claude surfaces", () => {
  const root = makeTmpDir("surface-select-");
  try {
    runCli(root, ["--agents", "codex,claude"]);
    assertCodexClaudeOnly(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("project-scoped skill installs constrain the first bootstrap surface default", () => {
  const root = makeTmpDir("surface-skill-default-");
  try {
    runCommand(root, ["install-skill", "--scope", "project", "--agents", "codex"]);
    runCommand(root, ["install-skill", "--scope", "project", "--agents", "claude"]);
    assert.equal(exists(root, ".codex/skills/project-librarian/SKILL.md"), true);
    assert.equal(exists(root, ".claude/skills/project-librarian/SKILL.md"), true);

    runCli(root);

    assertCodexClaudeOnly(root);
    assert.equal(exists(root, ".cursor/skills/project-librarian/SKILL.md"), false, "Cursor skill should not be installed by bootstrap");
    assert.equal(exists(root, ".gemini/skills/project-librarian/SKILL.md"), false, "Gemini skill should not be installed by bootstrap");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("plain re-run preserves existing Codex and Claude surface set", () => {
  const root = makeTmpDir("surface-rerun-");
  try {
    runCli(root, ["--agents", "codex,claude"]);
    runCli(root);
    assertCodexClaudeOnly(root);
    runCli(root, ["update"]);
    assertCodexClaudeOnly(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("explicit opt-in adds Cursor without implying Gemini or deleting existing surfaces", () => {
  const root = makeTmpDir("surface-opt-in-");
  try {
    runCli(root, ["--agents", "codex,claude"]);
    runCli(root, ["update", "--agents", "cursor"]);
    assert.equal(exists(root, ".codex/hooks.json"), true);
    assert.equal(exists(root, "CLAUDE.md"), true);
    assert.equal(exists(root, ".cursor/hooks.json"), true);
    assert.equal(exists(root, ".cursor/hooks/wiki-session-start.js"), true);
    assert.equal(exists(root, ".cursor/rules/project-librarian.mdc"), true);
    assert.equal(exists(root, ".gemini"), false, "Gemini surface directory should not be created by Cursor opt-in");
    assert.equal(exists(root, "GEMINI.md"), false, "Gemini instructions should not be created by Cursor opt-in");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("invalid --agents value fails before writing project files", () => {
  const root = makeTmpDir("surface-invalid-");
  try {
    const result = runCliFailure(root, ["--agents", "codex,unknown-agent"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid --agents entr(?:y|ies): unknown-agent/);
    assert.equal(exists(root, "AGENTS.md"), false);
    assert.equal(exists(root, "wiki"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
