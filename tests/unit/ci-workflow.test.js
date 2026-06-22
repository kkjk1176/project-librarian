"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

test("benchmark workflow gates Node 22 and 24, probes Node 26, and runs coverage thresholds", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "benchmark.yml"), "utf8");
  assert.match(workflow, /node-version:\s*\$\{\{\s*matrix\.node-version\s*\}\}/);
  assert.match(workflow, /node-version:\s*"22\.19\.0"[\s\S]*experimental:\s*false/);
  assert.match(workflow, /node-version:\s*"24\.x"[\s\S]*experimental:\s*false/);
  assert.match(workflow, /node-version:\s*"26\.x"[\s\S]*experimental:\s*true/);
  assert.match(workflow, /continue-on-error:\s*\$\{\{\s*matrix\.experimental\s*\}\}/);
  assert.match(workflow, /npm run check:dist/);
  assert.match(workflow, /npm run test:coverage/);
});

test("branch policy workflow validates PR and pushed branch names", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "branch-policy.yml"), "utf8");
  assert.match(workflow, /name:\s*Branch Policy/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:[\s\S]*branches-ignore:[\s\S]*-\s*main/);
  assert.match(workflow, /name:\s*Branch policy/);
  assert.match(workflow, /BRANCH_NAME:\s*\$\{\{\s*steps\.branch\.outputs\.branch\s*\}\}/);
  assert.match(workflow, /BRANCH_POLICY_ALLOW_MAIN:\s*\$\{\{\s*steps\.branch\.outputs\.allow_main\s*\}\}/);
  assert.match(workflow, /node scripts\/validate-branch-name\.js/);
});
