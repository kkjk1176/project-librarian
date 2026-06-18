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
const wikiConcepts = require("../../dist/wiki-concepts.js");
const wikiGraph = require("../../dist/wiki-graph.js");
const wikiVisualizer = require("../../dist/wiki-visualizer.js");
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

test("extractMarkdownBlocks ignores fenced headings and keeps section-level blocks", () => {
  const blocks = wikiFiles.extractMarkdownBlocks([
    "---",
    "status: active",
    "---",
    "",
    "# Real Heading",
    "",
    "Paragraph with AlphaTerm evidence.",
    "",
    "```md",
    "# Fenced Heading",
    "AlphaTerm inside code.",
    "```",
    "",
    "## Real Heading",
    "",
    "- AlphaTerm list item",
    "  - nested continuation",
    "",
    "| Term | Meaning |",
    "| --- | --- |",
    "| AlphaTerm | table evidence |",
    "",
  ].join("\n"));

  const headings = blocks.filter((block) => block.kind === "heading");
  assert.deepEqual(headings.map((block) => block.text), ["Real Heading", "Real Heading"]);
  assert.equal(headings[0].id === headings[1].id, false);
  assert.equal(headings.some((block) => block.text === "Fenced Heading"), false);
  assert.ok(blocks.some((block) => block.kind === "code_fence" && /AlphaTerm inside code/.test(block.text)));
  assert.ok(blocks.some((block) => block.kind === "list_item" && /AlphaTerm list item/.test(block.text)));
  assert.ok(blocks.some((block) => block.kind === "table_row" && /AlphaTerm \| table evidence/.test(block.text)));
});

test("extractMarkdownBlocks requires matching fence length before leaving code", () => {
  const blocks = wikiFiles.extractMarkdownBlocks([
    "# Page",
    "",
    "````md",
    "```",
    "## Still Fenced",
    "````",
    "",
    "## Real After",
  ].join("\n"));

  const headings = blocks.filter((block) => block.kind === "heading").map((block) => block.text);
  assert.deepEqual(headings, ["Page", "Real After"]);
  assert.ok(blocks.some((block) => block.kind === "code_fence" && /Still Fenced/.test(block.text)));
});

// ---------------------------------------------------------------------------
// Wiki concept read model and visualizer payload
// ---------------------------------------------------------------------------

test("wikiConceptType derives stable user-facing types from scope and path", () => {
  assert.equal(wikiConcepts.wikiConceptType("wiki/startup.md", "startup-router"), "Startup Router");
  assert.equal(wikiConcepts.wikiConceptType("wiki/index.md", "wiki-router"), "Wiki Router");
  assert.equal(wikiConcepts.wikiConceptType("wiki/canonical/project-brief.md", "project-canonical"), "Project Canonical Concept");
  assert.equal(wikiConcepts.wikiConceptType("wiki/decisions/log.md", "project-decisions"), "Project Decision");
  assert.equal(wikiConcepts.wikiConceptType("wiki/sources/source.md", "source-summary"), "Source Summary");
  assert.equal(wikiConcepts.wikiConceptType("wiki/meta/operating-model.md", "wiki-meta"), "Wiki Operations Concept");
  assert.equal(wikiConcepts.wikiConceptType("wiki/migration/coverage.md", "migration-ledger"), "Migration Ledger");
  assert.equal(wikiConcepts.wikiConceptType("wiki/custom/page.md", "custom-scope"), "Wiki Concept");
});

test("conceptFromPage preserves metadata and uses the TL;DR bullet as description", () => {
  const concept = wikiConcepts.conceptFromPage("wiki/canonical/topic.md", [
    "---",
    "status: active",
    "updated: 2026-06-16",
    "scope: project-canonical",
    "read_budget: medium",
    "review_trigger: topic contract changes",
    "---",
    "",
    "# Topic Contract",
    "",
    "## TL;DR",
    "",
    "- First useful summary.",
    "",
    "Body detail.",
  ].join("\n"));
  assert.equal(concept.conceptId, "canonical/topic");
  assert.equal(concept.title, "Topic Contract");
  assert.equal(concept.type, "Project Canonical Concept");
  assert.equal(concept.description, "First useful summary.");
  assert.equal(concept.timestamp, "2026-06-16");
  assert.equal(concept.reviewTrigger, "topic contract changes");
});

test("buildWikiVisualizerPayload exposes concept nodes, link edges, and decision_ref edges", () => {
  const payload = wikiVisualizer.buildWikiVisualizerPayload([
    { file: "wiki/startup.md", text: "---\nscope: startup-router\n---\n\n# Startup\n\n- [[index]]\n" },
    { file: "wiki/index.md", text: "---\nscope: wiki-router\n---\n\n# Index\n\n- [[canonical/topic]]\n" },
    { file: "wiki/canonical/topic.md", text: "---\nscope: project-canonical\ndecision_ref: wiki/decisions/topic.md\n---\n\n# Topic\n\n## TL;DR\n\n- Topic summary.\n" },
    { file: "wiki/decisions/topic.md", text: "---\nscope: project-decisions\n---\n\n# Topic Decision\n" },
  ], "2026-06-16T00:00:00.000Z");
  assert.equal(payload.summary.nodeCount, 4);
  assert.equal(payload.summary.edgeCount, 3);
  assert.ok(payload.nodes.some((node) => node.file === "wiki/canonical/topic.md" && node.type === "Project Canonical Concept" && node.routerDepth === 2));
  assert.ok(payload.edges.some((edge) => edge.kind === "link" && edge.source === "wiki/index.md" && edge.target === "wiki/canonical/topic.md"));
  assert.ok(payload.edges.some((edge) => edge.kind === "decision_ref" && edge.source === "wiki/canonical/topic.md" && edge.target === "wiki/decisions/topic.md"));
});

test("buildWikiVisualizerPayload surfaces broken links and orphan/broken summary counts", () => {
  const payload = wikiVisualizer.buildWikiVisualizerPayload([
    { file: "wiki/startup.md", text: "---\nscope: startup-router\n---\n\n# Startup\n\n- [[canonical/topic]]\n" },
    { file: "wiki/canonical/topic.md", text: "---\nscope: project-canonical\n---\n\n# Topic\n\n- [[canonical/missing]]\n" },
    { file: "wiki/canonical/lonely.md", text: "---\nscope: project-canonical\n---\n\n# Lonely\n\nNo links here.\n" },
  ], "2026-06-16T00:00:00.000Z");
  const topic = payload.nodes.find((node) => node.file === "wiki/canonical/topic.md");
  assert.equal(topic.brokenLinks.length, 1);
  assert.match(topic.brokenLinks[0], /missing/);
  assert.equal(payload.summary.brokenCount, 1);
  assert.equal(payload.summary.orphanCount, 1);
});

test("buildWikiVisualizerPayload is deterministic for a fixed generatedAt", () => {
  const pages = [
    { file: "wiki/startup.md", text: "---\nscope: startup-router\n---\n\n# Startup\n\n- [[index]]\n" },
    { file: "wiki/index.md", text: "---\nscope: wiki-router\n---\n\n# Index\n\n- [[canonical/topic]]\n" },
    { file: "wiki/canonical/topic.md", text: "---\nscope: project-canonical\n---\n\n# Topic\n" },
  ];
  const a = wikiVisualizer.buildWikiVisualizerPayload(pages, "2026-06-16T00:00:00.000Z");
  const b = wikiVisualizer.buildWikiVisualizerPayload(pages, "2026-06-16T00:00:00.000Z");
  assert.deepEqual(a, b);
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
    writePage(root, "wiki/canonical/project-brief.md", "# Project Brief\n\n## TL;DR\n\n- Impact fixture project truth.\n");
    fs.appendFileSync(path.join(root, "wiki", "index.md"), "\n- [[canonical/project-brief]]\n");
    writePage(root, "wiki/canonical/citing-page.md", "---\nstatus: active\ndecision_ref: wiki/canonical/project-brief.md\n---\n\n# Citing Page\n\n- [[canonical/project-brief]]\n");
    const output = runCli(root, ["--wiki-impact", "canonical/project-brief"]);
    const firstLine = output.split(/\r?\n/)[0];
    assert.match(firstLine, /^Wiki impact "canonical\/project-brief": 1 matching page/);
    assert.match(output, /incoming links \(\d+\):.*wiki\/index\.md/);
    assert.match(output, /decision_ref from \(1\): wiki\/canonical\/citing-page\.md/);
    assert.match(output, /router: reachable at depth 2 \(budget 3\)/);
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
// --wiki-visualize static artifact
// ---------------------------------------------------------------------------

test("wiki-visualize writes a static HTML graph artifact under .project-wiki", () => {
  const root = makeTmpDir("wg-visualize-");
  try {
    runCli(root);
    fs.appendFileSync(path.join(root, "wiki", "index.md"), "\n- [[canonical/visual-topic]]\n");
    writePage(root, "wiki/canonical/visual-topic.md", [
      "---",
      "status: active",
      "updated: 2026-06-16",
      "scope: project-canonical",
      "read_budget: medium",
      "decision_ref: none",
      "review_trigger: visualizer fixture changes",
      "---",
      "",
      "# Visual Topic",
      "",
      "## TL;DR",
      "",
      "- Visualizer fixture summary.",
      "",
    ].join("\n"));
    const output = runCli(root, ["--wiki-visualize"]);
    const artifact = path.join(root, ".project-wiki", "wiki-graph.html");
    assert.match(output, /Project wiki visualizer written: \.project-wiki\/wiki-graph\.html/);
    assert.equal(fs.existsSync(artifact), true);
    const html = fs.readFileSync(artifact, "utf8");
    assert.match(html, /Project Librarian Wiki Graph/);
    assert.match(html, /"file":"wiki\/canonical\/visual-topic\.md"/);
    assert.match(html, /"type":"Project Canonical Concept"/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("wiki-visualize-out rejects paths outside .project-wiki", () => {
  const root = makeTmpDir("wg-visualize-out-");
  try {
    runCli(root);
    const result = runCliResult(root, ["--wiki-visualize", "--wiki-visualize-out", "wiki/viz.html"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--wiki-visualize-out must stay under \.project-wiki\//);
    assert.equal(fs.existsSync(path.join(root, "wiki", "viz.html")), false);
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
    assert.match(output, /^\s+match: /m);
    assert.match(output, /^\s+graph: /m);
    assert.ok(output.length <= wikiGraph.wikiAnswerCharCap + 1, `query output ${output.length} chars exceeds the answer cap`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("query output reports the strongest section-aware table row match", () => {
  const root = makeTmpDir("wg-query-block-");
  try {
    runCli(root);
    writePage(root, "wiki/canonical/retrieval-blocks.md", [
      "---",
      "status: active",
      "updated: 2026-06-15",
      "scope: project-canonical",
      "read_budget: medium",
      "decision_ref: none",
      "review_trigger: retrieval block query changes",
      "---",
      "",
      "# Retrieval Blocks",
      "",
      "## TL;DR",
      "",
      "- Retrieval query block fixture.",
      "",
      "## Evidence Table",
      "",
      "| Metric | Meaning |",
      "| --- | --- |",
      "| SourceHitMetric | confirms the expected evidence source appears in the ranked set |",
      "",
      "```md",
      "## SourceHitMetric fenced heading should not become a heading block",
      "```",
      "",
    ].join("\n"));

    const output = runCli(root, ["--query", "SourceHitMetric"]);
    assert.match(output.split(/\r?\n/)[0], /^Project wiki query "SourceHitMetric": best match wiki\/canonical\/retrieval-blocks\.md/);
    assert.match(output, /match: table_row@L\d+: Retrieval Blocks > Evidence Table: SourceHitMetric \| confirms the expected evidence source/);
    assert.doesNotMatch(output, /fenced heading should not become a heading block/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("broad efficiency queries rank active canonical pages ahead of migration ledgers", () => {
  const root = makeTmpDir("wg-query-ranking-");
  try {
    runCli(root);
    writePage(root, "wiki/canonical/code-efficiency-active.md", [
      "---",
      "status: active",
      "updated: 2026-06-17",
      "scope: project-canonical",
      "read_budget: medium",
      "decision_ref: none",
      "review_trigger: efficiency query ranking changes",
      "---",
      "",
      "# Code Efficiency Active",
      "",
      "## TL;DR",
      "",
      "- Active canonical guidance for technology stack efficiency and code evidence.",
      "",
      "The active project truth covers technology stack efficiency, runtime storage efficiency, and code evidence.",
      "",
    ].join("\n"));
    writePage(root, "wiki/migration/coverage.md", [
      "---",
      "status: active",
      "updated: 2026-06-17",
      "scope: migration-ledger",
      "read_budget: on-demand",
      "decision_ref: none",
      "review_trigger: migration audit changes",
      "---",
      "",
      "# Migration Coverage",
      "",
      "## TL;DR",
      "",
      "- Migration ledger with repeated historical terms.",
      "",
      "technology stack efficiency code evidence technology stack efficiency code evidence",
      "technology stack efficiency code evidence technology stack efficiency code evidence",
      "",
    ].join("\n"));

    const broad = runCli(root, ["--query", "technology stack efficiency code evidence"]);
    assert.match(broad.split(/\r?\n/)[0], /^Project wiki query "technology stack efficiency code evidence": best match wiki\/canonical\/code-efficiency-active\.md/);

    const migrationSpecific = runCli(root, ["--query", "migration coverage technology stack efficiency code evidence"]);
    assert.match(migrationSpecific.split(/\r?\n/)[0], /^Project wiki query "migration coverage technology stack efficiency code evidence": best match wiki\/migration\/coverage\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("query output includes capped one-hop graph evidence without self-link cycles", () => {
  const root = makeTmpDir("wg-query-graph-");
  try {
    runCli(root);
    fs.appendFileSync(path.join(root, "wiki", "index.md"), "\n- [[canonical/graph-target]]\n");
    writePage(root, "wiki/canonical/graph-target.md", [
      "---",
      "status: active",
      "decision_ref: wiki/decisions/graph-choice.md",
      "---",
      "",
      "# Graph Target",
      "",
      "## TL;DR",
      "",
      "- Graph evidence fixture.",
      "",
      "GraphTerm appears on the target page.",
      "",
      "- [[sources/graph-source]]",
      "- [[canonical/graph-target]]",
      "",
    ].join("\n"));
    writePage(root, "wiki/sources/graph-source.md", "# Graph Source\n\nSource evidence.\n");
    writePage(root, "wiki/decisions/graph-choice.md", "# Graph Choice\n\nDecision evidence.\n");
    writePage(root, "wiki/canonical/graph-citer.md", [
      "---",
      "status: active",
      "decision_ref: wiki/canonical/graph-target.md",
      "---",
      "",
      "# Graph Citer",
      "",
      "- [[canonical/graph-target]]",
      "",
    ].join("\n"));

    const output = runCli(root, ["--query", "GraphTerm"]);
    assert.match(output.split(/\r?\n/)[0], /^Project wiki query "GraphTerm": best match wiki\/canonical\/graph-target\.md/);
    assert.match(output, /graph: .*router depth 2/);
    assert.match(output, /graph: .*links-out 1: wiki\/sources\/graph-source\.md/);
    assert.match(output, /graph: .*decision_ref-> wiki\/decisions\/graph-choice\.md/);
    assert.match(output, /graph: .*linked-by 2: wiki\/canonical\/graph-citer\.md, wiki\/index\.md/);
    assert.match(output, /graph: .*decision_ref-by 1: wiki\/canonical\/graph-citer\.md/);
    assert.doesNotMatch(output, /links-out [^;\n]*wiki\/canonical\/graph-target\.md/);
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
