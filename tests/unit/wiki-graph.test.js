"use strict";

// Wiki link graph method transfer (2026-06-12): the code-evidence edges/impact
// model applied to the wiki itself. Covers the pure graph helpers in
// dist/wiki-graph.js, the A1-promoted router reachability diagnostics inside
// --link-check, the --wiki-impact backlink/decision_ref envelope, and the
// answer-shaped --query output. All writing CLI runs use tmp dirs.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");
const wikiGraph = require("../../dist/wiki-graph.js");
const wikiFiles = require("../../dist/wiki-files.js");

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

function runCliResult(cwd, args = []) {
  return childProcess.spawnSync(process.execPath, [cliPath, "--no-git-config", ...args], {
    cwd,
    encoding: "utf8",
  });
}

function writePage(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

// ---------------------------------------------------------------------------
// Pure graph helpers (dist/wiki-graph.js)
// ---------------------------------------------------------------------------

test("buildWikiGraph collects link edges and decision_ref edges", () => {
  const pages = [
    { file: "wiki/startup.md", text: "# Startup\n\n- [[index]]\n" },
    { file: "wiki/index.md", text: "# Index\n\n- [[canonical/topic]]\n" },
    { file: "wiki/canonical/topic.md", text: "---\nstatus: active\ndecision_ref: wiki/decisions/pack.md\n---\n\n# Topic\n" },
    { file: "wiki/decisions/pack.md", text: "# Pack\n" },
  ];
  const graph = wikiGraph.buildWikiGraph(pages);
  assert.equal(graph.links.length, 2);
  assert.equal(graph.outgoingDecisionRef.get("wiki/canonical/topic.md"), "wiki/decisions/pack.md");
  assert.deepEqual(graph.incomingDecisionRefs.get("wiki/decisions/pack.md"), ["wiki/canonical/topic.md"]);
  assert.equal((graph.incomingLinks.get("wiki/index.md") ?? []).length, 1);
});

test("buildWikiGraph ignores none/empty decision_ref markers", () => {
  const graph = wikiGraph.buildWikiGraph([
    { file: "wiki/a.md", text: "---\ndecision_ref: none\n---\n\n# A\n" },
    { file: "wiki/b.md", text: "---\ndecision_ref: -\n---\n\n# B\n" },
  ]);
  assert.equal(graph.outgoingDecisionRef.size, 0);
  assert.equal(graph.incomingDecisionRefs.size, 0);
});

test("wikiRouterDepths walks BFS from startup and skips unreachable islands", () => {
  const pages = [
    { file: "wiki/startup.md", text: "- [[index]]\n" },
    { file: "wiki/index.md", text: "- [[canonical/routed]]\n" },
    { file: "wiki/canonical/routed.md", text: "# Routed\n" },
    { file: "wiki/canonical/island-a.md", text: "- [[canonical/island-b]]\n" },
    { file: "wiki/canonical/island-b.md", text: "- [[canonical/island-a]]\n" },
  ];
  const depths = wikiGraph.wikiRouterDepths(wikiGraph.buildWikiGraph(pages));
  assert.equal(depths.get("wiki/startup.md"), 0);
  assert.equal(depths.get("wiki/index.md"), 1);
  assert.equal(depths.get("wiki/canonical/routed.md"), 2);
  assert.equal(depths.has("wiki/canonical/island-a.md"), false);
  assert.equal(depths.has("wiki/canonical/island-b.md"), false);
});

test("wikiRouterDepths returns empty when startup is missing", () => {
  const depths = wikiGraph.wikiRouterDepths(wikiGraph.buildWikiGraph([
    { file: "wiki/index.md", text: "- [[canonical/x]]\n" },
    { file: "wiki/canonical/x.md", text: "# X\n" },
  ]));
  assert.equal(depths.size, 0);
});

test("finalizeWikiAnswer enforces the hard cap with an explicit truncation notice", () => {
  const short = "answer line";
  assert.equal(wikiGraph.finalizeWikiAnswer(short), short);
  const long = "x".repeat(wikiGraph.wikiAnswerCharCap * 3);
  const finalized = wikiGraph.finalizeWikiAnswer(long);
  assert.ok(finalized.length <= wikiGraph.wikiAnswerCharCap);
  assert.ok(finalized.endsWith(wikiGraph.wikiAnswerTruncationNotice));
});

test("wikiImpactAnswer headline counts linking pages as a union across matches", () => {
  const pages = [
    { file: "wiki/startup.md", text: "- [[index]]\n" },
    { file: "wiki/index.md", text: "- [[canonical/twin-a]]\n- [[canonical/twin-b]]\n" },
    { file: "wiki/canonical/twin-a.md", text: "# Twin A\n" },
    { file: "wiki/canonical/twin-b.md", text: "# Twin B\n" },
  ];
  const answer = wikiGraph.wikiImpactAnswer(pages, "twin");
  // wiki/index.md links both matches but is ONE review candidate, not two.
  assert.match(answer, /2 matching pages; review the 1 linking page and 0 decision_ref citations/);
});

test("wikiImpactAnswer is answer-first and bounded for unknown terms", () => {
  const answer = wikiGraph.wikiImpactAnswer([
    { file: "wiki/startup.md", text: "- [[index]]\n" },
    { file: "wiki/index.md", text: "# Index\n" },
  ], "no-such-page");
  assert.equal(answer, 'Wiki impact "no-such-page": no matching wiki pages.');
});

test("firstTldrBullet extracts the first TL;DR bullet and stays empty without one", () => {
  const withTldr = "---\nstatus: active\n---\n\n# Page\n\n## TL;DR\n\n- First summary bullet.\n- Second bullet.\n\n## Next\n";
  assert.equal(wikiFiles.firstTldrBullet(withTldr), "First summary bullet.");
  assert.equal(wikiFiles.firstTldrBullet("# Page\n\nNo summary section here.\n"), "");
});

// ---------------------------------------------------------------------------
// --link-check router reachability diagnostics (A1 promoted to the real wiki)
// ---------------------------------------------------------------------------

test("fresh bootstrap passes link-check without reachability warnings", () => {
  const root = makeTmpDir("wg-fresh-");
  try {
    runCli(root);
    const output = runCli(root, ["--link-check"]);
    assert.match(output, /passed:/);
    assert.doesNotMatch(output, /router-unreachable/);
    assert.doesNotMatch(output, /router-depth-exceeded/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("linked-but-disconnected islands warn router-unreachable, not orphan-page", () => {
  const root = makeTmpDir("wg-island-");
  try {
    runCli(root);
    writePage(root, "wiki/canonical/island-a.md", "# Island A\n\n- [[canonical/island-b]]\n");
    writePage(root, "wiki/canonical/island-b.md", "# Island B\n\n- [[canonical/island-a]]\n");
    const result = runCliResult(root, ["--link-check"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /router-unreachable wiki\/canonical\/island-a\.md/);
    assert.match(result.stdout, /router-unreachable wiki\/canonical\/island-b\.md/);
    assert.doesNotMatch(result.stdout, /orphan-page wiki\/canonical\/island-(a|b)\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pages with zero incoming links stay orphan-page findings, not router-unreachable", () => {
  const root = makeTmpDir("wg-orphan-");
  try {
    runCli(root);
    writePage(root, "wiki/canonical/lonely.md", "# Lonely\n\nNo links touch this page.\n");
    const result = runCliResult(root, ["--link-check"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /orphan-page wiki\/canonical\/lonely\.md/);
    assert.doesNotMatch(result.stdout, /router-unreachable wiki\/canonical\/lonely\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a page linked only by itself stays an orphan-page finding, not router-unreachable", () => {
  const root = makeTmpDir("wg-selflink-");
  try {
    runCli(root);
    writePage(root, "wiki/canonical/selfonly.md", "# Self Only\n\nSelf loop probe: [[canonical/selfonly]]\n");
    const result = runCliResult(root, ["--link-check"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /orphan-page wiki\/canonical\/selfonly\.md/);
    assert.doesNotMatch(result.stdout, /router-unreachable wiki\/canonical\/selfonly\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("startup that never links the index breaks router hop 1", () => {
  const root = makeTmpDir("wg-hop1-");
  try {
    runCli(root);
    writePage(root, "wiki/startup.md", "---\nstatus: active\n---\n\n# Startup Context\n\n## TL;DR\n\n- Startup without an index route.\n");
    const result = runCliResult(root, ["--link-check"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /router-unreachable wiki\/index\.md .*hop 1 broken/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("routes deeper than the budget warn router-depth-exceeded on the deep page only", () => {
  const root = makeTmpDir("wg-depth-");
  try {
    runCli(root);
    fs.appendFileSync(path.join(root, "wiki", "index.md"), "\nDepth chain probe: [[canonical/chain-a]]\n");
    writePage(root, "wiki/canonical/chain-a.md", "# Chain A\n\n- [[canonical/chain-b]]\n");
    writePage(root, "wiki/canonical/chain-b.md", "# Chain B\n\n- [[canonical/chain-c]]\n");
    writePage(root, "wiki/canonical/chain-c.md", "# Chain C\n\nEnd of the chain.\n");
    const result = runCliResult(root, ["--link-check"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /router-depth-exceeded wiki\/canonical\/chain-c\.md .*depth 4 \(budget 3\)/);
    // chain-b sits at exactly the 3-hop budget: the boundary is inclusive.
    assert.doesNotMatch(result.stdout, /router-depth-exceeded wiki\/canonical\/chain-b\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// --wiki-impact envelope
// ---------------------------------------------------------------------------

test("wiki-impact reports backlinks, decision_ref citations, and router depth", () => {
  const root = makeTmpDir("wg-impact-");
  try {
    runCli(root);
    writePage(root, "wiki/canonical/citing-page.md", "---\nstatus: active\ndecision_ref: wiki/canonical/project-brief.md\n---\n\n# Citing Page\n\n- [[canonical/project-brief]]\n");
    const output = runCli(root, ["--wiki-impact", "canonical/project-brief"]);
    const firstLine = output.split(/\r?\n/)[0];
    assert.match(firstLine, /^Wiki impact "canonical\/project-brief": 1 matching page/);
    assert.match(output, /incoming links \(\d+\):.*wiki\/index\.md/);
    assert.match(output, /decision_ref from \(1\): wiki\/canonical\/citing-page\.md/);
    // The bootstrap startup template routes project-brief directly (depth 1).
    assert.match(output, /router: reachable at depth 1 \(budget 3\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("wiki-impact answers no-match terms answer-first and exits 0", () => {
  const root = makeTmpDir("wg-impact-none-");
  try {
    runCli(root);
    const result = runCliResult(root, ["--wiki-impact", "zzz-not-a-page"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^Wiki impact "zzz-not-a-page": no matching wiki pages\./);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("wiki-impact without a value fails before writing anything", () => {
  const root = makeTmpDir("wg-impact-missing-");
  try {
    const result = runCliResult(root, ["--wiki-impact"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing value for option: --wiki-impact/);
    assert.equal(fs.existsSync(path.join(root, "wiki")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Answer-shaped --query output
// ---------------------------------------------------------------------------

test("query output is answer-first with per-result TL;DR envelopes", () => {
  const root = makeTmpDir("wg-query-");
  try {
    runCli(root);
    const output = runCli(root, ["--query", "decision"]);
    const firstLine = output.split(/\r?\n/)[0];
    assert.match(firstLine, /^Project wiki query "decision": best match wiki\/.+ — .+ \(\d+ matching pages?, top \d+ shown\)\.$/);
    assert.match(output, /^\s+tldr: /m);
    assert.ok(output.length <= wikiGraph.wikiAnswerCharCap + 1, `query output ${output.length} chars exceeds the answer cap`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("query without matches answers answer-first and exits 0", () => {
  const root = makeTmpDir("wg-query-none-");
  try {
    runCli(root);
    const result = runCliResult(root, ["--query", "zzz-unfindable-term"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^Project wiki query "zzz-unfindable-term": no matches\./);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
