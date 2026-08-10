"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

test("publish workflow runs normal verification and trusted publishing", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "publish.yml"), "utf8");
  assert.match(workflow, /^permissions:\s*\n\s+contents:\s*read/m);
  assert.match(workflow, /node-version:\s*"24\.x"/);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/setup-node@[a-f0-9]{40}/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run audit:supply-chain/);
  assert.match(workflow, /npm pack --dry-run --json/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /npm publish --access public --ignore-scripts/);
});

test("security workflows provide CodeQL and dependency review with minimal permissions", () => {
  const codeql = fs.readFileSync(path.join(root, ".github", "workflows", "codeql.yml"), "utf8");
  assert.match(codeql, /name:\s*CodeQL/);
  assert.match(codeql, /^permissions:\s*\n\s+contents:\s*read/m);
  assert.match(codeql, /security-events:\s*write/);
  assert.match(codeql, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(codeql, /github\/codeql-action\/init@[a-f0-9]{40}/);
  assert.match(codeql, /github\/codeql-action\/analyze@[a-f0-9]{40}/);
  assert.match(codeql, /languages:\s*javascript-typescript/);

  const dependencyReview = fs.readFileSync(path.join(root, ".github", "workflows", "dependency-review.yml"), "utf8");
  assert.match(dependencyReview, /name:\s*Dependency Review/);
  assert.match(dependencyReview, /^permissions:\s*\n\s+contents:\s*read\s*\n\s+pull-requests:\s*read/m);
  assert.match(dependencyReview, /package-lock\.json/);
  assert.match(dependencyReview, /actions\/dependency-review-action@[a-f0-9]{40}/);
});

test("branch policy workflow validates PR and pushed branch names", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "branch-policy.yml"), "utf8");
  assert.match(workflow, /name:\s*Branch Policy/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:[\s\S]*branches-ignore:[\s\S]*-\s*main/);
  assert.match(workflow, /name:\s*Branch policy/);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /BRANCH_NAME:\s*\$\{\{\s*steps\.branch\.outputs\.branch\s*\}\}/);
  assert.match(workflow, /BRANCH_POLICY_ALLOW_MAIN:\s*\$\{\{\s*steps\.branch\.outputs\.allow_main\s*\}\}/);
  assert.match(workflow, /node scripts\/validate-branch-name\.js/);
});
