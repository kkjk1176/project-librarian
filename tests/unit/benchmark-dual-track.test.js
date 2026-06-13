"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  benchmarkTracks,
  conditions,
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

test("every task family has a valid benchmark track", () => {
  const families = Object.keys(taskFamilies);
  // The synthetic matrix is wiki-only now (the code_graph track lives entirely in
  // the real-repository corpus): the 5 original wiki families plus the 2 A3 wiki
  // families (multi_session, aggregation).
  assert(families.length === 7, `expected 7 families, got ${families.length}`);
  for (const family of families) {
    const track = trackForTaskFamily(family);
    assert(benchmarkTracks.includes(track), `family ${family} has invalid track ${track}`);
    assert.equal(taskTracks[family], track);
  }
  // Every synthetic family is wiki-track (code_impact and change_location are
  // planted doc lookups in both conditions; multi_session and aggregation exercise
  // the maintained-wiki routing thesis). There are no synthetic code_graph families.
  for (const family of ["onboarding", "decision_lookup", "code_impact", "release_policy", "change_location", "multi_session", "aggregation"]) {
    assert.equal(trackForTaskFamily(family), "wiki");
  }
  assert(!Object.values(taskTracks).includes("code_graph"), "synthetic matrix must have no code_graph families");
});

test("trackForTaskFamily throws on unknown family", () => {
  assert.throws(() => trackForTaskFamily("does_not_exist"), /unknown task family/);
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
