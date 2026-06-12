"use strict";

// Scale-aware code-evidence guidance (2026-06-12 decision, stageR1 evidence):
// (1) --code-index halts below SMALL_REPO_FILE_THRESHOLD with an evidence-citing
//     warning unless --acknowledge-small-repo is passed (consent honored, never
//     refused);
// (2) bootstrap skips MCP auto-registration below the threshold when no
//     .project-wiki index exists, prints the reason, and registers regardless of
//     scale when an index exists (standing consent);
// (3) the code_status MCP tool reports the scale bracket plus question-shape
//     guidance;
// (4) the AGENTS.md code-evidence trust sentence carries the scale-conditional
//     clause.
//
// All CLI runs that WRITE use tmp dirs (never this repo root; a repo-root write
// destroyed the wiki on 2026-06-10).

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");
const { SMALL_REPO_FILE_THRESHOLD, smallRepoCodeIndexGate } = require("../../dist/code-index-file-policy.js");
const { scaleGuidanceLines } = require("../../dist/mcp-server.js");
const { codeEvidenceTrustContract } = require("../../dist/templates.js");

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(cwd, args = []) {
  return childProcess.spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8" });
}

function runCliOk(cwd, args = []) {
  const result = runCli(cwd, args);
  assert.equal(result.status, 0, `CLI ${args.join(" ")} failed (${result.status}): ${result.stderr}`);
  return result.stdout;
}

// Minimal sub-threshold fixture: a couple of indexable files.
function writeSmallFixture(cwd) {
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "app.ts"), "export const answer = 42;\n");
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "scale-fixture" }, null, 2));
}

// ---------------------------------------------------------------------------
// Pure gate decision: below/above threshold x flag (4 paths)
// ---------------------------------------------------------------------------

test("smallRepoCodeIndexGate covers the four threshold/flag paths", () => {
  const belowNoFlag = smallRepoCodeIndexGate(SMALL_REPO_FILE_THRESHOLD - 1, false);
  assert.equal(belowNoFlag.proceed, false, "below threshold without the flag must halt");
  assert.ok(belowNoFlag.warning.length > 0, "the halt must carry the warning");

  const belowWithFlag = smallRepoCodeIndexGate(SMALL_REPO_FILE_THRESHOLD - 1, true);
  assert.equal(belowWithFlag.proceed, true, "below threshold with the flag must proceed");
  assert.equal(belowWithFlag.warning, "");

  const atThresholdNoFlag = smallRepoCodeIndexGate(SMALL_REPO_FILE_THRESHOLD, false);
  assert.equal(atThresholdNoFlag.proceed, true, "at/above threshold without the flag must proceed");
  assert.equal(atThresholdNoFlag.warning, "");

  const atThresholdWithFlag = smallRepoCodeIndexGate(SMALL_REPO_FILE_THRESHOLD, true);
  assert.equal(atThresholdWithFlag.proceed, true, "at/above threshold with the flag must proceed");
});

test("the gate warning cites the measured numbers, report paths, the unmeasured note, and the flag", () => {
  const { warning } = smallRepoCodeIndexGate(3, false);
  assert.match(warning, /3 indexable files is below the \d+-file scale threshold/);
  // Measured stageR1 numbers: small-repo losses, large-repo ownership loss, the
  // only measured win.
  assert.match(warning, /\+116\.9%/);
  assert.match(warning, /\+106\.5%/);
  assert.match(warning, /\+99\.0%/);
  assert.match(warning, /-27\.7%/);
  // Report paths backing the threshold.
  assert.ok(warning.includes("benchmarks/reports/llm/stageR1-real.md"), "must cite the stageR1 report path");
  assert.ok(warning.includes("benchmarks/reports/llm/stage2d-codegraph.md"), "must cite the stage2d report path");
  // Human-report/accuracy value is unmeasured, not negated.
  assert.ok(warning.includes("Not measured, so not disproven"), "must state the unmeasured-not-disproven boundary");
  // How to proceed.
  assert.ok(warning.includes("--acknowledge-small-repo"), "must point at the acknowledge flag");
  // Threshold provenance is marked revisable.
  assert.ok(warning.includes("n=2 extrapolation"), "must mark the threshold as an n=2 extrapolation");
});

// ---------------------------------------------------------------------------
// CLI e2e: --code-index gate paths
// ---------------------------------------------------------------------------

test("--code-index below the threshold without the flag exits 1 with the warning and writes nothing", () => {
  const cwd = makeTmpDir("scale-gate-halt-");
  try {
    writeSmallFixture(cwd);
    const result = runCli(cwd, ["--code-index"]);
    assert.equal(result.status, 1, "sub-threshold --code-index without the flag must exit 1");
    assert.match(result.stderr, /is below the \d+-file scale threshold/);
    assert.ok(result.stderr.includes("--acknowledge-small-repo"), "warning must include the acknowledge flag");
    assert.ok(!fs.existsSync(path.join(cwd, ".project-wiki")), "the gate must fire before any .project-wiki write");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("--code-index below the threshold with --acknowledge-small-repo builds the index", () => {
  const cwd = makeTmpDir("scale-gate-ack-");
  try {
    writeSmallFixture(cwd);
    const stdout = runCliOk(cwd, ["--code-index", "--acknowledge-small-repo"]);
    assert.match(stdout, /Project wiki code evidence index complete\./);
    assert.match(stdout, /files: 2/);
    assert.ok(fs.existsSync(path.join(cwd, ".project-wiki", "code-evidence.sqlite")));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("--acknowledge-small-repo without --code-index fails before writing project files", () => {
  const cwd = makeTmpDir("scale-gate-lone-");
  try {
    const result = runCli(cwd, ["--acknowledge-small-repo"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--acknowledge-small-repo is only supported with --code-index\./);
    assert.ok(!fs.existsSync(path.join(cwd, "AGENTS.md")), "the arg error must fire before bootstrap writes");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// At/above the threshold the CLI proceeds without the flag, and bootstrap on the
// same fixture auto-registers MCP with no index present (the large-repo path).
// One expensive fixture (SMALL_REPO_FILE_THRESHOLD empty .js files) covers both.
test("at the threshold --code-index proceeds without the flag and bootstrap auto-registers MCP", () => {
  const cwd = makeTmpDir("scale-gate-large-");
  try {
    const dir = path.join(cwd, "src");
    fs.mkdirSync(dir, { recursive: true });
    for (let index = 0; index < SMALL_REPO_FILE_THRESHOLD; index += 1) {
      fs.writeFileSync(path.join(dir, `m${index}.js`), "");
    }
    const stdout = runCliOk(cwd, ["--code-index"]);
    assert.match(stdout, new RegExp(`files: ${SMALL_REPO_FILE_THRESHOLD}\\b`));

    // Remove the index so bootstrap registration is decided by scale alone.
    fs.rmSync(path.join(cwd, ".project-wiki"), { recursive: true, force: true });
    const bootstrap = runCliOk(cwd, ["--no-git-config"]);
    assert.ok(!bootstrap.includes("skipped-small-repo"), "at/above threshold bootstrap must not skip registration");
    const claude = JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8"));
    assert.ok(claude.mcpServers["project-librarian"], "large-repo bootstrap must register the MCP server");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Bootstrap MCP auto-registration gate
// ---------------------------------------------------------------------------

test("bootstrap on a sub-threshold repo without an index skips MCP registration with the reason", () => {
  const cwd = makeTmpDir("scale-mcp-skip-");
  try {
    writeSmallFixture(cwd);
    const stdout = runCliOk(cwd, ["--no-git-config"]);
    const skipRows = stdout.split("\n").filter((line) => line.includes("skipped-small-repo"));
    assert.equal(skipRows.length, 3, `expected the three MCP rows to carry the skip reason, got:\n${stdout}`);
    for (const row of skipRows) {
      assert.match(row, /\d+ indexable files < \d+/);
      assert.ok(row.includes("--code-index --acknowledge-small-repo"), "the reason must explain how to opt in");
    }
    assert.ok(!fs.existsSync(path.join(cwd, ".mcp.json")), ".mcp.json must not be written");
    assert.ok(!fs.existsSync(path.join(cwd, ".cursor", "mcp.json")), ".cursor/mcp.json must not be written");
    const gemini = JSON.parse(fs.readFileSync(path.join(cwd, ".gemini", "settings.json"), "utf8"));
    assert.equal(gemini.mcpServers, undefined, "Gemini settings must carry no mcpServers map");
    assert.ok(Array.isArray(gemini.hooks.SessionStart), "the Gemini SessionStart hook config must still be written");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("bootstrap registers MCP regardless of scale when a .project-wiki index exists, idempotently", () => {
  const cwd = makeTmpDir("scale-mcp-index-");
  try {
    writeSmallFixture(cwd);
    runCliOk(cwd, ["--code-index", "--acknowledge-small-repo"]);
    const first = runCliOk(cwd, ["--no-git-config"]);
    assert.ok(!first.includes("skipped-small-repo"), "an existing index must override the scale gate");
    assert.match(first, /created {1,7}\.mcp\.json/);
    const claude = JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8"));
    assert.ok(claude.mcpServers["project-librarian"]);
    const cursor = JSON.parse(fs.readFileSync(path.join(cwd, ".cursor", "mcp.json"), "utf8"));
    assert.ok(cursor.mcpServers["project-librarian"]);
    const gemini = JSON.parse(fs.readFileSync(path.join(cwd, ".gemini", "settings.json"), "utf8"));
    assert.ok(gemini.mcpServers["project-librarian"]);

    const rerun = runCliOk(cwd, ["--no-git-config"]);
    assert.match(rerun, /exists {2}\.mcp\.json/);
    assert.match(rerun, /exists {2}\.cursor\/mcp\.json/);
    assert.match(rerun, /exists {2}\.gemini\/settings\.json mcpServers/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// code_status scale guidance (pure brackets + MCP e2e)
// ---------------------------------------------------------------------------

test("scaleGuidanceLines reports the small bracket and the every-scale ownership guidance", () => {
  const small = scaleGuidanceLines(SMALL_REPO_FILE_THRESHOLD - 1);
  assert.equal(small.length, 2);
  assert.match(small[0], /^Scale: small \(\d+ indexed files < \d+\)/);
  assert.ok(small[0].includes("prefer direct reads for simple lookups"), "small bracket must steer simple lookups to direct reads");
  assert.ok(small[0].includes("expensive traversal questions"), "small bracket must reserve the tools for traversal questions");
  assert.ok(small[1].includes("Ownership-style simple lookups measured cheaper via direct reads at every scale"));

  const large = scaleGuidanceLines(SMALL_REPO_FILE_THRESHOLD);
  assert.match(large[0], /^Scale: large \(\d+ indexed files >= \d+\)/);
  assert.ok(large[0].includes("impact tracing"), "large bracket must name the question shape that measured cheaper");
  assert.equal(large[1], small[1], "the ownership guidance line applies at every scale");
});

test("the code_status MCP tool answer carries the scale bracket and guidance lines", () => {
  const cwd = makeTmpDir("scale-status-");
  try {
    writeSmallFixture(cwd);
    runCliOk(cwd, ["--code-index", "--acknowledge-small-repo"]);
    const input = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "code_status", arguments: {} } },
    ].map((object) => JSON.stringify(object)).join("\n") + "\n";
    const result = childProcess.spawnSync(process.execPath, [cliPath, "mcp"], { cwd, input, encoding: "utf8" });
    assert.equal(result.status, 0, `mcp server exited ${result.status}: ${result.stderr}`);
    const responses = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
    const status = responses.find((message) => message.id === 2);
    const text = status.result.content[0].text;
    assert.match(text, /Scale: small \(2 indexed files < \d+\)/);
    assert.ok(text.includes("Ownership-style simple lookups measured cheaper via direct reads at every scale"), `missing ownership guidance in:\n${text}`);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AGENTS.md code-evidence trust sentence (scale-conditional clause)
// ---------------------------------------------------------------------------

test("the code-evidence trust sentence keeps the staleness contract and adds the scale clause", () => {
  assert.ok(
    codeEvidenceTrustContract.includes("`--code-status`/`code_status` reports staleness"),
    "the staleness-gated trust contract must survive",
  );
  assert.ok(
    codeEvidenceTrustContract.includes("on small repos below the measured scale threshold, prefer direct reads over these tools for simple lookups"),
    "the scale-conditional guidance clause must be present",
  );
});

test("bootstrap writes the scale-conditional trust sentence into the managed AGENTS.md block", () => {
  const cwd = makeTmpDir("scale-agents-");
  try {
    runCliOk(cwd, ["--no-git-config"]);
    const agents = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
    assert.ok(agents.includes(codeEvidenceTrustContract), "AGENTS.md must carry the full updated trust sentence");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
