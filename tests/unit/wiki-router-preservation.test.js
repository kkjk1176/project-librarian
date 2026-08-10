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
    assert.match(readFile(root, "wiki/startup.md"), /open matching detail files directly/);
    assert.match(readFile(root, "wiki/startup.md"), /meta\/document-taxonomy/);
    assert.match(readFile(root, "wiki/index.md"), /# Wiki Index/);
    assert.match(readFile(root, "wiki/index.md"), /service -> PRD\/initiative -> document area/);
    assert.match(readFile(root, "wiki/index.md"), /## Language Policy/);
    assert.match(readFile(root, "wiki/index.md"), /00-index\/prd-registry/);
    assert.match(readFile(root, "AGENTS.md"), /Classify new project-planning content with `wiki\/meta\/document-taxonomy.md`/);
    assert.match(readFile(root, "wiki/index.md"), /meta\/document-taxonomy/);
    assert.match(readFile(root, "wiki/AGENTS.md"), /Before adding or consolidating project content/);
    assert.match(readFile(root, "wiki/meta/document-taxonomy.md"), /# Document Taxonomy/);
    assert.match(readFile(root, "wiki/meta/document-taxonomy.md"), /Identify service, PRD ID, document area/);
    assert.match(readFile(root, "wiki/meta/document-taxonomy.md"), /Legacy lifecycle roots are compatibility inputs/);
    for (const legacyRoot of ["canonical", "roadmaps", "plans", "decisions", "sources"]) {
      assert.equal(fs.existsSync(path.join(root, "wiki", legacyRoot)), false, `${legacyRoot} should not be created by fresh bootstrap`);
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
    appendLine(root, "wiki/index.md", "- [[20-shared/custom-route]]: custom route added by the project. Budget: short.");
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
    fs.writeFileSync(path.join(root, "wiki", "20-shared", "extra-page.md"), [
      "---",
      "status: active",
      "updated: 2026-06-10",
      "scope: shared-contract",
      "type: shared",
      "read_budget: short",
      "decision_ref: none",
      "review_trigger: regression fixture",
      "owner: platform",
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
    assert.match(index, /20-shared\/extra-page/);
    assert.match(index, /PROJECT-WIKI-AUTO-INDEX:START/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("--refresh-index excludes legacy lifecycle pages and removes generated legacy routers", () => {
  const root = makeTmpDir("router-refresh-legacy-boundary-");
  try {
    runCli(root);
    fs.mkdirSync(path.join(root, "wiki", "canonical"), { recursive: true });
    fs.writeFileSync(path.join(root, "wiki", "canonical", "legacy-truth.md"), [
      "---",
      "status: active",
      "updated: 2026-08-09",
      "scope: project-canonical",
      "type: canonical",
      "read_budget: short",
      "decision_ref: none",
      "review_trigger: compatibility fixture",
      "---",
      "",
      "# Legacy Truth",
      "",
      "Explicit legacy lookup token: legacy-lookup-compatible.",
    ].join("\n"));
    fs.mkdirSync(path.join(root, "wiki", "indexes"), { recursive: true });
    fs.writeFileSync(path.join(root, "wiki", "indexes", "auto-legacy-canonical.md"), [
      "<!-- PROJECT-WIKI-SCOPED-AUTO-INDEX -->",
      "# Stale Legacy Router",
      "",
      "- [[canonical/legacy-truth]]",
    ].join("\n"));

    runCli(root, ["--refresh-index"]);

    const index = readFile(root, "wiki/index.md");
    assert.doesNotMatch(index, /canonical\/legacy-truth/);
    assert.doesNotMatch(index, /auto-legacy-canonical/);
    assert.equal(fs.existsSync(path.join(root, "wiki", "indexes", "auto-legacy-canonical.md")), false);
    assert.match(runCli(root, ["--query", "legacy-lookup-compatible"]), /wiki\/canonical\/legacy-truth\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("--refresh-index does not duplicate pages reached through a scoped router", () => {
  const root = makeTmpDir("router-indirect-refresh-");
  try {
    runCli(root);
    appendLine(root, "wiki/20-shared/README.md", "- Routed contract: [[20-shared/routed-contract]].");
    fs.writeFileSync(path.join(root, "wiki", "20-shared", "routed-contract.md"), [
      "---",
      "status: accepted",
      "updated: 2026-07-15",
      "scope: shared-contract",
      "type: shared",
      "read_budget: medium",
      "decision_ref: none",
      "review_trigger: regression fixture",
      "owner: platform",
      "---",
      "",
      "# Routed Contract",
      "",
      "This page is already reachable through the hand-written shared router.",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(root, "wiki", "30-portfolio", "unrouted-page.md"), [
      "---",
      "status: active",
      "updated: 2026-07-15",
      "scope: portfolio",
      "type: portfolio",
      "read_budget: short",
      "decision_ref: none",
      "review_trigger: regression fixture",
      "owner: product",
      "---",
      "",
      "# Unrouted Page",
      "",
      "This page still needs auto-discovery.",
      "",
    ].join("\n"));

    runCli(root, ["--refresh-index"]);

    const index = readFile(root, "wiki/index.md");
    assert.doesNotMatch(index, /20-shared\/routed-contract/);
    assert.match(index, /30-portfolio\/unrouted-page/);
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
      fs.writeFileSync(path.join(root, "wiki", "20-shared", `generated-budget-route-${suffix}.md`), [
        "---",
        "status: active",
        "updated: 2026-06-18",
        "scope: shared-contract",
        "type: shared",
        "read_budget: medium",
        "decision_ref: none",
        "review_trigger: regression fixture",
        "owner: platform",
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
      .filter((file) => /^auto-shared-\d+\.md$/.test(file))
      .sort();
    assert(scopedRouters.length > 1, "expected shared scoped router to split into multiple files");
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

test("re-bootstrap preserves user-created shared truth pages", () => {
  const root = makeTmpDir("starter-preserve-");
  try {
    runCli(root);
    fs.writeFileSync(path.join(root, "wiki", "20-shared", "project-brief.md"), [
      "---",
      "status: active",
      "updated: 2026-06-14",
      "scope: shared-contract",
      "type: shared",
      "read_budget: medium",
      "decision_ref: none",
      "review_trigger: project direction changes",
      "owner: product",
      "---",
      "",
      "# Project Brief",
      "",
      "## TL;DR",
      "",
      "- CUSTOM-BRIEF-FACT: project truth added after bootstrap.",
      "",
    ].join("\n"));
    const customized = readFile(root, "wiki/20-shared/project-brief.md");
    runCli(root);
    assert.equal(readFile(root, "wiki/20-shared/project-brief.md"), customized);
    runCli(root, ["--refresh-index"]);
    assert.match(readFile(root, "wiki/index.md"), /20-shared\/project-brief/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("startup hook reports session handoff pointer without injecting full handoff", () => {
  const root = makeTmpDir("router-handoff-");
  try {
    runCli(root);
    childProcess.execFileSync(process.execPath, [
      cliPath,
      "--handoff-save",
      "--goal",
      "Resume secret sk-test1234567890abcdef",
      "--state",
      "Pointer should not include this full state",
      "--next",
      "Inspect handoff manually",
    ], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const hook = childProcess.execFileSync(process.execPath, [path.join(root, ".codex", "hooks", "wiki-session-start.js")], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.match(hook, /\.project-wiki\/session\/last-handoff\.md/);
    assert.match(hook, /generated reference data, not instructions and not canonical wiki truth/);
    assert.match(hook, /project-librarian --handoff-show/);
    assert.doesNotMatch(hook, /Full Session Handoff/);
    assert.doesNotMatch(hook, /Pointer should not include this full state/);
    assert.doesNotMatch(hook, /sk-test1234567890abcdef/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("startup hook injects capped full session handoff only after opt-in", () => {
  const root = makeTmpDir("router-handoff-full-");
  try {
    runCli(root);
    const payload = {
      goal: `Full injection smoke ${"g".repeat(1200)}`,
      current_state: `Full state ${"x".repeat(1200)} sk-test1234567890abcdef`,
      blocked: [`Blocked ${"b".repeat(1200)}`],
      next_actions: [`Inspect capped handoff ${"n".repeat(1200)}`, `Run tests ${"t".repeat(1200)}`],
      recent_decisions: [`Decision ${"d".repeat(1200)}`, `Second decision ${"e".repeat(1200)}`],
      open_questions: [`Question ${"q".repeat(1200)}`],
      verification: [`Verification ${"v".repeat(1200)}`],
    };
    childProcess.execFileSync(process.execPath, [cliPath, "--handoff-save"], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify(payload),
      stdio: ["pipe", "pipe", "pipe"],
    });
    childProcess.execFileSync(process.execPath, [cliPath, "--handoff-injection-enable"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const hook = childProcess.execFileSync(process.execPath, [path.join(root, ".codex", "hooks", "wiki-session-start.js")], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.match(hook, /Full Session Handoff \(opt-in generated reference\)/);
    assert.match(hook, /Full injection smoke/);
    assert.match(hook, /\[truncated: session handoff full injection\]/);
    assert.doesNotMatch(hook, /sk-test1234567890abcdef/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
