"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertDocsOnlyAnswerability,
  benchmarkTracks,
  codeGraphExpectation,
  codeGraphExpectationsForScale,
  conditions,
  scales,
  taskFamilies,
  taskTracks,
  trackForTaskFamily,
} = require("../../benchmarks/lib/llm-fixtures");
const {
  completePairCount,
  evaluateTracksClaimGate,
  scenariosForTrack,
  tracksPresent,
} = require("../../benchmarks/lib/llm-report");

const codeGraphFamilies = ["impact_trace", "ownership_lookup", "workspace_graph"];

test("every task family has a valid benchmark track", () => {
  const families = Object.keys(taskFamilies);
  // 8 dual-track families (A6) + 2 A3 wiki families (multi_session, aggregation).
  assert(families.length === 10, `expected 10 families, got ${families.length}`);
  for (const family of families) {
    const track = trackForTaskFamily(family);
    assert(benchmarkTracks.includes(track), `family ${family} has invalid track ${track}`);
    assert.equal(taskTracks[family], track);
  }
  // The original five plus the two A3 families stay wiki-track (code_impact and
  // change_location are planted doc lookups in both conditions; multi_session and
  // aggregation exercise the maintained-wiki routing thesis).
  for (const family of ["onboarding", "decision_lookup", "code_impact", "release_policy", "change_location", "multi_session", "aggregation"]) {
    assert.equal(trackForTaskFamily(family), "wiki");
  }
  for (const family of codeGraphFamilies) {
    assert.equal(trackForTaskFamily(family), "code_graph");
  }
});

test("trackForTaskFamily throws on unknown family", () => {
  assert.throws(() => trackForTaskFamily("does_not_exist"), /unknown task family/);
});

test("code-graph expected-answer computation is deterministic per scale", () => {
  for (const scale of Object.keys(scales)) {
    for (const family of codeGraphFamilies) {
      const first = codeGraphExpectation(family, scale);
      const second = codeGraphExpectation(family, scale);
      assert.deepEqual(first, second, `${family}/${scale} expectation not deterministic`);
      assert(Array.isArray(first.required_terms));
      assert(Array.isArray(first.answer_key_terms));
    }
  }
});

test("A7 impact_trace encodes the transitive file-chain importer set", () => {
  // impact_trace asks for the TRANSITIVE importers of the file-chain root
  // packages/workspace-0/src/mod-0.ts. The expected set is the whole chain tail
  // {mod-1 .. mod-(C-1)} as relative paths; the count tracks scale.importChain - 1.
  for (const scale of Object.keys(scales)) {
    const impact = codeGraphExpectation("impact_trace", scale);
    const chainLength = scales[scale].importChain;
    assert.equal(impact.required_terms.length, chainLength - 1, `${scale} importer count`);
    assert.equal(impact.required_terms[0], "packages/workspace-0/src/mod-1.ts");
    assert.equal(impact.required_terms.at(-1), `packages/workspace-0/src/mod-${chainLength - 1}.ts`);
    // mod-0 itself (the queried root) is NOT in its own importer set.
    assert(!impact.required_terms.includes("packages/workspace-0/src/mod-0.ts"));
    // The answer keys equal the importer set (all forbidden from Markdown).
    assert.deepEqual(impact.answer_key_terms, impact.required_terms);
  }
});

test("A7 workspace_graph encodes the transitive spine dependency set", () => {
  // workspace_graph asks for the transitive dependency set of the deepest
  // workspace under the spine K -> K-1: every lower workspace package name.
  for (const scale of Object.keys(scales)) {
    const workspaceCount = scales[scale].workspaces;
    const graph = codeGraphExpectation("workspace_graph", scale);
    if (workspaceCount <= 1) {
      assert.deepEqual(graph.answer_key_terms, []);
      continue;
    }
    // leaf = workspace-(W-1); transitive deps = workspace-(W-2) .. workspace-0.
    const expected = [];
    for (let k = workspaceCount - 2; k >= 0; k -= 1) expected.push(`@benchmark/workspace-${k}`);
    assert.deepEqual(graph.required_terms, expected, `${scale} transitive deps`);
    assert(graph.required_terms.includes("@benchmark/workspace-0"), "deepest dep is workspace-0");
    assert.deepEqual(graph.answer_key_terms, graph.required_terms);
  }
});

test("A7 ownership_lookup encodes last-match precedence and the owned set", () => {
  // ownership answer is the last-match owner (@benchmark-service-team) plus the
  // full service-directory owned file set; the *.go extension owner is forbidden.
  for (const scale of Object.keys(scales)) {
    const ownership = codeGraphExpectation("ownership_lookup", scale);
    assert.equal(ownership.required_terms[0], "@benchmark-service-team");
    // @go-benchmark-team is caught by designation_forbidden (line-scoped), not forbidden_terms,
    // so agents quoting the overridden rule in a precedence chain still pass.
    assert(
      (ownership.designation_forbidden || []).some((e) => e.team === "@go-benchmark-team"),
      "the *.go extension owner must be in designation_forbidden",
    );
    // serviceFiles owned paths are required and forbidden from Markdown.
    const ownedCount = scales[scale].serviceFiles;
    assert.equal(ownership.required_terms.length, ownedCount + 1, `${scale} owner + ${ownedCount} owned files`);
    assert(ownership.required_terms.includes("packages/workspace-0/src/service/handler.go"));
    assert.deepEqual(ownership.answer_key_terms, ownership.required_terms);
  }
});

test("codeGraphExpectationsForScale returns only code-graph families", () => {
  const medium = codeGraphExpectationsForScale("medium");
  assert.deepEqual(Object.keys(medium).sort(), [...codeGraphFamilies].sort());
});

function writeMarkdown(dir, name, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

test("docs-only answerability gate passes when answers are not in Markdown", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-gate-pass-"));
  try {
    writeMarkdown(dir, "overview.md", "This repository has multiple workspace packages and a CODEOWNERS file.\n");
    const expectations = Object.values(codeGraphExpectationsForScale("medium"));
    assert.doesNotThrow(() => assertDocsOnlyAnswerability(dir, expectations));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("docs-only answerability gate throws and names the file and term on violation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-gate-fail-"));
  try {
    // The last-match owner is a code_graph answer key; leaking it into Markdown trips the gate.
    writeMarkdown(dir, "leak.md", "The service files are owned by @benchmark-service-team per the docs.\n");
    const expectations = Object.values(codeGraphExpectationsForScale("medium"));
    assert.throws(
      () => assertDocsOnlyAnswerability(dir, expectations),
      (error) => error.message.includes("@benchmark-service-team") && error.message.includes("leak.md"),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("docs-only gate scans nested Markdown and forbids transitive answer paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-gate-nested-"));
  try {
    // A transitive importer path (mod-13.ts is in the medium chain) leaking into a
    // nested page must trip the gate.
    writeMarkdown(path.join(dir, "wiki", "decisions"), "log.md", "Importer answer packages/workspace-0/src/mod-13.ts leaked here.\n");
    assert.throws(
      () => assertDocsOnlyAnswerability(dir, [codeGraphExpectation("impact_trace", "medium")]),
      /mod-13\.ts/,
    );
    // A clean page with no answer key term does not trip the gate.
    fs.rmSync(path.join(dir, "wiki", "decisions", "log.md"));
    writeMarkdown(path.join(dir, "wiki"), "clean.md", "This repository has workspace packages and a CODEOWNERS file.\n");
    assert.doesNotThrow(() => assertDocsOnlyAnswerability(dir, [codeGraphExpectation("impact_trace", "medium")]));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Minimal scenario factory for aggregation/gate tests.
function scenario({ scale, track, taskFamily, condition, claimable = true }) {
  const median = { total_tokens: 100, input_tokens: 80, output_tokens: 20, wall_ms: 1000, command_invocation_count: 1, tokens_per_second: 20, first_response_ms: 0 };
  return {
    scale,
    condition,
    benchmark_track: track,
    task_family: taskFamily,
    prompt_id: `${taskFamily}-${scale}-${condition}`,
    runs: [{ execution: { status: "completed" } }],
    correctness: [{ status: "passed" }],
    claimable_run_count: claimable ? 1 : 0,
    median: claimable ? median : null,
  };
}

function pairedScenarios({ scale, track, taskFamily, claimable = true }) {
  return conditions.map((condition) => scenario({ scale, track, taskFamily, condition, claimable }));
}

function baseReport(scenarios) {
  return {
    scenarios,
    configuration: { runs: 3, require_clean: false },
    source_control: { available: true, dirty: false },
    summary: { comparison_pair_count: completePairCount(scenarios, conditions) },
  };
}

test("per-track aggregation groups scenarios by benchmark_track", () => {
  const scenarios = [
    ...pairedScenarios({ scale: "small", track: "wiki", taskFamily: "decision_lookup" }),
    ...pairedScenarios({ scale: "small", track: "code_graph", taskFamily: "impact_trace" }),
  ];
  assert.deepEqual(tracksPresent(scenarios), ["wiki", "code_graph"]);
  assert.equal(scenariosForTrack(scenarios, "wiki").length, 2);
  assert.equal(scenariosForTrack(scenarios, "code_graph").length, 2);
  assert(scenariosForTrack(scenarios, "wiki").every((item) => item.benchmark_track === "wiki"));
});

test("overall claim gate composes from per-track gates: passes only if every track passes", () => {
  // Both tracks cover the same selected scale, matching the real matrix where
  // every track runs at every selected scale.
  const scenarios = [
    ...pairedScenarios({ scale: "small", track: "wiki", taskFamily: "decision_lookup" }),
    ...pairedScenarios({ scale: "small", track: "code_graph", taskFamily: "impact_trace" }),
  ];
  const report = baseReport(scenarios);
  const gate = evaluateTracksClaimGate(report, {
    conditions,
    expectedScales: ["small"],
    expectedTasksByTrack: { wiki: ["decision_lookup"], code_graph: ["impact_trace"] },
    minRunsForClaim: 3,
  });
  assert.equal(gate.status, "passed");
  assert.deepEqual(gate.tracks_present, ["wiki", "code_graph"]);
  assert.equal(gate.per_track.wiki.status, "passed");
  assert.equal(gate.per_track.code_graph.status, "passed");
});

test("overall claim gate fails when one track fails even if the other passes", () => {
  const scenarios = [
    ...pairedScenarios({ scale: "small", track: "wiki", taskFamily: "decision_lookup" }),
    // code_graph pair has an unclaimable scenario -> that track's gate fails.
    ...pairedScenarios({ scale: "small", track: "code_graph", taskFamily: "impact_trace", claimable: false }),
  ];
  const report = baseReport(scenarios);
  const gate = evaluateTracksClaimGate(report, {
    conditions,
    expectedScales: ["small"],
    expectedTasksByTrack: { wiki: ["decision_lookup"], code_graph: ["impact_trace"] },
    minRunsForClaim: 3,
  });
  assert.equal(gate.per_track.wiki.status, "passed");
  assert.equal(gate.per_track.code_graph.status, "failed");
  assert.equal(gate.status, "failed");
  assert(gate.issues.some((issue) => issue.includes("code_graph")));
});

test("overall claim gate fails when no tracks are present", () => {
  const gate = evaluateTracksClaimGate(baseReport([]), {
    conditions,
    expectedScales: [],
    expectedTasksByTrack: {},
    minRunsForClaim: 1,
  });
  assert.equal(gate.status, "failed");
  assert(gate.issues.includes("no benchmark tracks present"));
});

test("a single-track report gates on that track alone", () => {
  const scenarios = pairedScenarios({ scale: "small", track: "wiki", taskFamily: "decision_lookup" });
  const gate = evaluateTracksClaimGate(baseReport(scenarios), {
    conditions,
    expectedScales: ["small"],
    expectedTasksByTrack: { wiki: ["decision_lookup"] },
    minRunsForClaim: 3,
  });
  assert.deepEqual(gate.tracks_present, ["wiki"]);
  assert.equal(gate.status, "passed");
  assert(!Object.hasOwn(gate.per_track, "code_graph"));
});
