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

function runCommandResult(cwd, args = []) {
  return childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
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

function exists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
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
    runCommand(root, ["install", "--scope", "project", "--agents", "codex"]);
    runCommand(root, ["install", "--scope", "project", "--agents", "claude"]);
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

test("explicit update syncs existing project-scoped skill installs from the running package", () => {
  const root = makeTmpDir("surface-skill-sync-");
  try {
    runCommand(root, ["install", "--scope", "project", "--agents", "codex"]);
    fs.writeFileSync(path.join(root, ".codex", "skills", "project-librarian", "SKILL.md"), "stale skill copy\n");

    const output = runCommand(root, ["update", "--no-git-config"]);

    assert.equal(read(root, ".codex/skills/project-librarian/SKILL.md"), fs.readFileSync(path.resolve(__dirname, "..", "..", "SKILL.md"), "utf8"));
    assert.match(output, /\.codex\/skills\/project-librarian\/SKILL\.md/);
    assert.equal(exists(root, ".claude/skills/project-librarian/SKILL.md"), false, "update should not create new project-scoped skill installs by default");
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
    runCommand(root, ["update", "--no-git-config"]);
    assertCodexClaudeOnly(root);
    assert.equal(exists(root, ".codex/skills/project-librarian/SKILL.md"), false, "update should not create project-scoped skills when none were installed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("explicit opt-in adds Cursor without implying Gemini or deleting existing surfaces", () => {
  const root = makeTmpDir("surface-opt-in-");
  try {
    runCli(root, ["--agents", "codex,claude"]);
    runCommand(root, ["update", "--no-git-config", "--agents", "cursor"]);
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

test("bootstrap refuses to overwrite symlinked managed files outside the project", (t) => {
  const root = makeTmpDir("surface-symlink-write-");
  const outside = path.join(os.tmpdir(), `project-librarian-outside-${Date.now()}.md`);
  try {
    fs.writeFileSync(outside, "external sentinel\n");
    if (!symlinkOrSkip(t, outside, path.join(root, "AGENTS.md"))) return;

    const result = runCommandResult(root, ["--no-git-config"]);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /refuses to follow symlink/);
    assert.equal(fs.readFileSync(outside, "utf8"), "external sentinel\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});

test("project skill install refuses destination symlink traversal", (t) => {
  const root = makeTmpDir("surface-skill-symlink-");
  const outside = path.join(os.tmpdir(), `project-librarian-skill-outside-${Date.now()}.md`);
  try {
    fs.writeFileSync(outside, "external skill sentinel\n");
    fs.mkdirSync(path.join(root, ".codex", "skills", "project-librarian"), { recursive: true });
    if (!symlinkOrSkip(t, outside, path.join(root, ".codex", "skills", "project-librarian", "SKILL.md"))) return;

    const result = runCommandResult(root, ["install", "--scope", "project", "--agents", "codex"]);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /refuses to follow destination symlink/);
    assert.equal(fs.readFileSync(outside, "utf8"), "external skill sentinel\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});
