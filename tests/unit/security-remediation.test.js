"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

test("prepare-commit-msg hook does not execute worktree-controlled trailer script", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-hook-security-"));
  try {
    fs.mkdirSync(path.join(fixture, ".githooks"), { recursive: true });
    fs.copyFileSync(path.join(root, ".githooks", "prepare-commit-msg"), path.join(fixture, ".githooks", "prepare-commit-msg"));
    fs.chmodSync(path.join(fixture, ".githooks", "prepare-commit-msg"), 0o755);
    fs.writeFileSync(path.join(fixture, ".githooks", "wiki-commit-trailers.js"), [
      "#!/usr/bin/env node",
      "require('fs').writeFileSync('pwned.txt', 'executed');",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(fixture, "COMMIT_EDITMSG"), "Commit message\n");

    const result = childProcess.spawnSync("sh", [".githooks/prepare-commit-msg", "COMMIT_EDITMSG", "message"], {
      cwd: fixture,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(path.join(fixture, "pwned.txt")), false);
    assert.equal(fs.readFileSync(path.join(fixture, "COMMIT_EDITMSG"), "utf8"), "Commit message\n");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("generated prepare-commit-msg hook template stays passive", () => {
  const { gitPrepareCommitMsgHook } = require("../../dist/hooks.js");
  assert.doesNotMatch(gitPrepareCommitMsgHook, /wiki-commit-trailers\.js/);
  assert.doesNotMatch(gitPrepareCommitMsgHook, /\bnode\b/);
});
