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

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readFile(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function appendLine(root, relativePath, line) {
  fs.appendFileSync(path.join(root, relativePath), `${line}\n`);
}

test("bootstrap creates router templates when absent", () => {
  const root = makeTmpDir("router-create-");
  try {
    runCli(root);
    assert.match(readFile(root, "wiki/startup.md"), /## Read On Demand/);
    assert.match(readFile(root, "wiki/index.md"), /# Wiki Index/);
    assert.match(readFile(root, "wiki/index.md"), /## Language Policy/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("re-bootstrap preserves customized startup.md and index.md", () => {
  const root = makeTmpDir("router-preserve-");
  try {
    runCli(root);
    appendLine(root, "wiki/startup.md", "- CUSTOM-STARTUP-FACT: keep this router line.");
    appendLine(root, "wiki/index.md", "- [[canonical/custom-route]]: custom route added by the project. Budget: short.");
    const customizedStartup = readFile(root, "wiki/startup.md");
    const customizedIndex = readFile(root, "wiki/index.md");
    runCli(root);
    assert.equal(readFile(root, "wiki/startup.md"), customizedStartup);
    assert.equal(readFile(root, "wiki/index.md"), customizedIndex);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("--refresh-index preserves customized routers while updating the auto-index block", () => {
  const root = makeTmpDir("router-refresh-");
  try {
    runCli(root);
    appendLine(root, "wiki/startup.md", "- CUSTOM-STARTUP-FACT: keep this during refresh-index.");
    appendLine(root, "wiki/index.md", "- CUSTOM-INDEX-ROUTE: keep this during refresh-index.");
    const customizedStartup = readFile(root, "wiki/startup.md");
    fs.writeFileSync(path.join(root, "wiki", "canonical", "extra-page.md"), [
      "---",
      "status: active",
      "updated: 2026-06-10",
      "scope: project-canonical",
      "read_budget: short",
      "decision_ref: none",
      "review_trigger: regression fixture",
      "---",
      "",
      "# Extra Page",
      "",
      "Regression fixture page for auto-index discovery.",
      "",
    ].join("\n"));
    runCli(root, ["--refresh-index"]);
    assert.equal(readFile(root, "wiki/startup.md"), customizedStartup);
    const index = readFile(root, "wiki/index.md");
    assert.match(index, /CUSTOM-INDEX-ROUTE: keep this during refresh-index\./);
    assert.match(index, /canonical\/extra-page/);
    assert.match(index, /PROJECT-WIKI-AUTO-INDEX:START/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("re-bootstrap preserves customized canonical starter pages", () => {
  const root = makeTmpDir("starter-preserve-");
  try {
    runCli(root);
    appendLine(root, "wiki/canonical/project-brief.md", "- CUSTOM-BRIEF-FACT: project truth added after bootstrap.");
    const customized = readFile(root, "wiki/canonical/project-brief.md");
    runCli(root);
    assert.equal(readFile(root, "wiki/canonical/project-brief.md"), customized);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
