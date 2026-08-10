"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(cwd, args = []) {
  return childProcess.execFileSync(process.execPath, [cliPath, "--no-git-config", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("fresh bootstrap creates only service/PRD v2 hubs", () => {
  const root = makeTmpDir("wiki-layout-v2-fresh-");
  try {
    runCli(root);
    for (const file of [
      "wiki/00-index/README.md",
      "wiki/00-index/service-map.md",
      "wiki/00-index/prd-registry.md",
      "wiki/01-governance/README.md",
      "wiki/10-services/README.md",
      "wiki/20-shared/README.md",
      "wiki/30-portfolio/README.md",
      "wiki/90-archive/README.md",
      "wiki/meta/wiki-ops-v2-decisions.md",
    ]) {
      assert.equal(fs.existsSync(path.join(root, file)), true, file);
    }
    for (const legacyRoot of ["canonical", "roadmaps", "plans", "decisions", "sources"]) {
      assert.equal(fs.existsSync(path.join(root, "wiki", legacyRoot)), false, legacyRoot);
    }
    assert.equal(fs.existsSync(path.join(root, "wiki", "10-services", "project-librarian")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("glossary initialization routes the v2 shared glossary", () => {
  const root = makeTmpDir("wiki-layout-v2-glossary-");
  try {
    runCli(root, ["--glossary-init"]);
    assert.equal(fs.existsSync(path.join(root, "wiki/20-shared/glossary.md")), true);
    assert.equal(fs.existsSync(path.join(root, "wiki/canonical/glossary.md")), false);
    assert.match(fs.readFileSync(path.join(root, "wiki/index.md"), "utf8"), /20-shared\/glossary/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("update adds v2 hubs while preserving legacy lifecycle documents", () => {
  const root = makeTmpDir("wiki-layout-v2-update-");
  try {
    fs.mkdirSync(path.join(root, "wiki/canonical"), { recursive: true });
    fs.mkdirSync(path.join(root, ".codex"), { recursive: true });
    const legacy = "---\nstatus: active\n---\n\n# User Legacy Truth\n\nKeep this content.\n";
    fs.writeFileSync(path.join(root, "wiki/canonical/user-truth.md"), legacy);
    childProcess.execFileSync(process.execPath, [cliPath, "update", "--no-git-config"], { cwd: root, encoding: "utf8" });
    assert.equal(fs.readFileSync(path.join(root, "wiki/canonical/user-truth.md"), "utf8"), legacy);
    assert.equal(fs.existsSync(path.join(root, "wiki/00-index/prd-registry.md")), true);
    assert.equal(fs.existsSync(path.join(root, "wiki/meta/wiki-ops-v2-decisions.md")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("update preserves user-authored v2 operating documents", () => {
  const root = makeTmpDir("wiki-layout-v2-operating-preserve-");
  try {
    runCli(root);
    const files = [
      "wiki/meta/operating-model.md",
      "wiki/meta/decision-policy.md",
      "wiki/meta/document-taxonomy.md",
      "wiki/meta/wiki-ops-v2-decisions.md",
    ];
    const expected = new Map();
    for (const file of files) {
      const absolutePath = path.join(root, file);
      const customized = `${fs.readFileSync(absolutePath, "utf8").trimEnd()}\n\nCUSTOM-V2-POLICY: preserve this project decision.\n`;
      fs.writeFileSync(absolutePath, customized);
      expected.set(file, customized);
    }

    childProcess.execFileSync(process.execPath, [cliPath, "update", "--no-git-config"], { cwd: root, encoding: "utf8" });

    for (const [file, content] of expected) {
      assert.equal(fs.readFileSync(path.join(root, file), "utf8"), content, `${file} was overwritten by update`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("central layout contract classifies PRD areas", () => {
  const layout = require("../../dist/wiki-layout.js");
  const decision = layout.classifyWikiPath("wiki/10-services/payments/prds/PRD-012-checkout/09-decisions/adr.md");
  assert.equal(decision.version, "v2");
  assert.equal(decision.service, "payments");
  assert.equal(decision.prdId, "PRD-012");
  assert.equal(decision.area, "decisions");
  assert.equal(decision.currentTruth, false);
});

test("service and PRD metadata validation enforces ownership context", () => {
  const { validateWikiMetadataContext } = require("../../dist/wiki-layout.js");
  const file = "wiki/10-services/payments/prds/PRD-012-checkout/03-design/api.md";
  const invalid = [
    "---",
    "status: active",
    "updated: 2026-08-09",
    "scope: prd-design",
    "type: design",
    "read_budget: short",
    "decision_ref: none",
    "review_trigger: API changes",
    "service: wrong-service",
    "prd_id: PRD-999",
    "owner: none",
    "---",
    "",
    "# API",
  ].join("\n");
  const errors = validateWikiMetadataContext(file, invalid);
  assert(errors.some((error) => /service.*payments/.test(error)));
  assert(errors.some((error) => /prd_id.*PRD-012/.test(error)));
  assert(errors.some((error) => /owner/.test(error)));
});

test("shared, portfolio, and meta metadata types follow their owning area", () => {
  const { validateWikiMetadataContext } = require("../../dist/wiki-layout.js");
  const fixture = (type) => [
    "---",
    "status: active",
    "updated: 2026-08-09",
    "scope: v2-fixture",
    `type: ${type}`,
    "read_budget: short",
    "decision_ref: none",
    "review_trigger: fixture changes",
    "owner: product",
    "---",
    "",
    "# Fixture",
  ].join("\n");

  assert(validateWikiMetadataContext("wiki/20-shared/contract.md", fixture("plan")).some((error) => /type must be shared/.test(error)));
  assert(validateWikiMetadataContext("wiki/30-portfolio/roadmap.md", fixture("source")).some((error) => /type must be portfolio/.test(error)));
  assert(validateWikiMetadataContext("wiki/meta/custom-policy.md", fixture("decision")).some((error) => /type must be wiki-meta/.test(error)));
});
