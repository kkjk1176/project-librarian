"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const { validateBranchName } = require("../../scripts/validate-branch-name.js");

const root = path.resolve(__dirname, "..", "..");
const validator = path.join(root, "scripts", "validate-branch-name.js");

test("branch policy accepts the repository branch strategy", () => {
  for (const branch of [
    "main",
    "feat/cli-issue-create",
    "fix/npm-publish-e404",
    "docs/wiki-routing-policy",
    "test/branch-policy",
    "refactor/code-index-contract",
    "chore/cleanup-stale-branches",
    "perf/code-evidence-cache",
    "security/token-rotation",
    "release/v0.5.0",
    "release/v0.5.0-rc.1",
    "hotfix/npm-publish-approval",
  ]) {
    assert.equal(validateBranchName(branch).valid, true, branch);
  }
});

test("branch policy rejects full Git-flow and actor-prefixed branches", () => {
  for (const branch of ["develop", "develop/release-train", "codex/fix-ci", "human/docs-update"]) {
    const result = validateBranchName(branch);
    assert.equal(result.valid, false, branch);
  }
});

test("branch policy rejects malformed branch names", () => {
  for (const branch of [
    "",
    "feat",
    "feat/",
    "feat/Uppercase",
    "feat/has_underscore",
    "feat/has/slash",
    "feature/unsupported-type",
    "release/next",
    "release/v1",
    "release/v1.2",
    "release/v1.2.3_beta",
  ]) {
    const result = validateBranchName(branch);
    assert.equal(result.valid, false, branch);
  }
});

test("pull request branch policy rejects main as a work branch", () => {
  const result = validateBranchName("main", { allowMain: false });
  assert.equal(result.valid, false);
  assert.match(result.reason, /protected baseline/);
});

test("branch policy CLI validates environment-provided branch names", () => {
  const ok = spawnSync(process.execPath, [validator], {
    cwd: root,
    env: { ...process.env, BRANCH_NAME: "feat/branch-policy-ci" },
    encoding: "utf8",
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Branch name accepted/);

  const bad = spawnSync(process.execPath, [validator], {
    cwd: root,
    env: {
      ...process.env,
      BRANCH_NAME: "codex/branch-policy-ci",
      BRANCH_POLICY_ALLOW_MAIN: "false",
    },
    encoding: "utf8",
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /actor prefixes/);
});
