"use strict";

const VALID_WORK_BRANCH = /^(feat|fix|docs|test|refactor|chore|perf|security|hotfix)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VALID_RELEASE_BRANCH = /^release\/v\d+\.\d+\.\d+(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/;
const VALID_DEPENDABOT_BRANCH = /^dependabot\/(?:github_actions|npm_and_yarn)\/[a-z0-9._/@+-]+$/;

function validateBranchName(branch, options = {}) {
  const allowMain = options.allowMain !== false;

  if (typeof branch !== "string" || branch.length === 0) {
    return { valid: false, reason: "branch name is required" };
  }

  if (branch !== branch.trim()) {
    return { valid: false, reason: "branch name must not include leading or trailing whitespace" };
  }

  if (branch === "main") {
    return allowMain
      ? { valid: true }
      : { valid: false, reason: "`main` is the protected baseline, not a pull request work branch" };
  }

  if (branch === "develop" || branch.startsWith("develop/")) {
    return { valid: false, reason: "long-lived `develop` branches are not part of this repository strategy" };
  }

  if (/^(codex|human)\//.test(branch)) {
    return { valid: false, reason: "actor prefixes such as `codex/` or `human/` are not allowed" };
  }

  if (VALID_RELEASE_BRANCH.test(branch) || VALID_WORK_BRANCH.test(branch) || VALID_DEPENDABOT_BRANCH.test(branch)) {
    return { valid: true };
  }

  return {
    valid: false,
    reason:
      "use `<type>/<short-slug>` with an allowed type, `release/vX.Y.Z`, `hotfix/<short-slug>`, or an approved `dependabot/<ecosystem>/<dependency>` branch",
  };
}

function parseCli(argv, env) {
  let allowMain = env.BRANCH_POLICY_ALLOW_MAIN !== "false";
  let branch = env.BRANCH_NAME || env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || "";

  for (const arg of argv) {
    if (arg === "--no-main") {
      allowMain = false;
    } else if (arg === "--allow-main") {
      allowMain = true;
    } else if (!branch) {
      branch = arg;
    }
  }

  return { branch, allowMain };
}

if (require.main === module) {
  const { branch, allowMain } = parseCli(process.argv.slice(2), process.env);
  const result = validateBranchName(branch, { allowMain });

  if (!result.valid) {
    console.error(`Invalid branch name: ${branch || "(empty)"}`);
    console.error(result.reason);
    process.exit(1);
  }

  console.log(`Branch name accepted: ${branch}`);
}

module.exports = {
  validateBranchName,
};
