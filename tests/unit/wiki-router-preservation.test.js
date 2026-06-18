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

function snapshotFiles(root, files) {
  return new Map(files.map((file) => {
    const absolutePath = path.join(root, file);
    return [file, fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : null];
  }));
}

function assertSnapshotUnchanged(root, snapshot) {
  for (const [file, before] of snapshot.entries()) {
    const absolutePath = path.join(root, file);
    const after = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : null;
    assert.equal(after, before, `${file} changed during wiki-only refresh-index`);
  }
}

test("bootstrap creates router templates when absent", () => {
  const root = makeTmpDir("router-create-");
  try {
    runCli(root);
    assert.match(readFile(root, "wiki/startup.md"), /## Read On Demand/);
    assert.match(readFile(root, "wiki/startup.md"), /meta\/document-taxonomy/);
    assert.match(readFile(root, "wiki/index.md"), /# Wiki Index/);
    assert.match(readFile(root, "wiki/index.md"), /## Language Policy/);
    assert.match(readFile(root, "wiki/index.md"), /decisions\/README/);
    assert.match(readFile(root, "AGENTS.md"), /Classify new project-planning content with `wiki\/meta\/document-taxonomy.md`/);
    assert.match(readFile(root, "wiki/index.md"), /meta\/document-taxonomy/);
    assert.match(readFile(root, "wiki/AGENTS.md"), /Before adding or consolidating project content/);
    assert.match(readFile(root, "wiki/meta/document-taxonomy.md"), /# Document Taxonomy/);
    assert.match(readFile(root, "wiki/meta/document-taxonomy.md"), /Source-of-truth governance/);
    for (const emptyStarter of [
      "wiki/canonical/project-brief.md",
      "wiki/canonical/open-questions.md",
      "wiki/canonical/assumptions.md",
      "wiki/canonical/risks.md",
      "wiki/decisions/decision-pack-template.md",
      "wiki/decisions/full-adr-template.md",
    ]) {
      assert.equal(fs.existsSync(path.join(root, emptyStarter)), false, `${emptyStarter} should not be created without content`);
    }
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
    const nonWikiGeneratedFiles = snapshotFiles(root, [
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      ".codex/hooks.json",
      ".codex/hooks/wiki-session-start.js",
      ".claude/settings.json",
      ".claude/hooks/wiki-session-start.js",
      ".cursor/hooks.json",
      ".cursor/hooks/wiki-session-start.js",
      ".cursor/rules/project-librarian.mdc",
      ".gemini/settings.json",
      ".gemini/hooks/wiki-session-start.js",
      ".githooks/prepare-commit-msg",
      ".githooks/wiki-commit-trailers.js",
    ]);
    runCli(root, ["--refresh-index"]);
    assertSnapshotUnchanged(root, nonWikiGeneratedFiles);
    assert.equal(readFile(root, "wiki/startup.md"), customizedStartup);
    const index = readFile(root, "wiki/index.md");
    assert.match(index, /CUSTOM-INDEX-ROUTE: keep this during refresh-index\./);
    assert.match(index, /canonical\/extra-page/);
    assert.match(index, /PROJECT-WIKI-AUTO-INDEX:START/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("--refresh-index splits oversized scoped auto routers", () => {
  const root = makeTmpDir("router-split-");
  try {
    runCli(root);
    for (let index = 1; index <= 120; index += 1) {
      const suffix = String(index).padStart(3, "0");
      fs.writeFileSync(path.join(root, "wiki", "canonical", `generated-budget-route-${suffix}.md`), [
        "---",
        "status: active",
        "updated: 2026-06-18",
        "scope: project-canonical",
        "read_budget: medium",
        "decision_ref: none",
        "review_trigger: regression fixture",
        "---",
        "",
        `# Generated Budget Route ${suffix}`,
        "",
        "## TL;DR",
        "",
        "- Regression fixture page for scoped auto-index splitting.",
        "",
      ].join("\n"));
    }

    runCli(root, ["--refresh-index"]);

    const indexText = readFile(root, "wiki/index.md");
    const scopedRouters = fs.readdirSync(path.join(root, "wiki", "indexes"))
      .filter((file) => /^auto-canonical-\d+\.md$/.test(file))
      .sort();
    assert(scopedRouters.length > 1, "expected canonical scoped router to split into multiple files");
    for (const router of scopedRouters) {
      const relativePath = `wiki/indexes/${router}`;
      const linkTarget = relativePath.replace(/^wiki\//, "").replace(/\.md$/, "");
      assert(indexText.includes(`[[${linkTarget}]]`), `${relativePath} missing from wiki/index.md`);
      assert(readFile(root, relativePath).length <= 8000, `${relativePath} exceeds medium read_budget`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("re-bootstrap preserves user-created canonical pages", () => {
  const root = makeTmpDir("starter-preserve-");
  try {
    runCli(root);
    fs.writeFileSync(path.join(root, "wiki", "canonical", "project-brief.md"), [
      "---",
      "status: active",
      "updated: 2026-06-14",
      "scope: project-canonical",
      "read_budget: medium",
      "decision_ref: none",
      "review_trigger: project direction changes",
      "---",
      "",
      "# Project Brief",
      "",
      "## TL;DR",
      "",
      "- CUSTOM-BRIEF-FACT: project truth added after bootstrap.",
      "",
    ].join("\n"));
    const customized = readFile(root, "wiki/canonical/project-brief.md");
    runCli(root);
    assert.equal(readFile(root, "wiki/canonical/project-brief.md"), customized);
    runCli(root, ["--refresh-index"]);
    assert.match(readFile(root, "wiki/index.md"), /canonical\/project-brief/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
