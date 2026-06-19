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
  assert.match(workflow, /npm run test:coverage/);
});
