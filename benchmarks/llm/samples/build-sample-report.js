#!/usr/bin/env node
"use strict";

// Regenerates benchmarks/llm/samples/codex-measured-report.json from the checked
// in sample Codex JSONL transcripts using the real benchmark library functions,
// so the sample stays consistent with the report schema and the smoke validator
// (which recomputes every field from raw JSONL plus manifest-borne expectations).
//
// The sample covers both benchmark tracks and all A3 families at the medium scale:
// wiki decision_lookup (schema-static), code_graph impact_trace (manifest-borne),
// wiki multi_session (two sessions per scenario; session-2 metrics primary) and
// wiki aggregation (manifest-borne aggregate-component expectation).
// Run: node benchmarks/llm/samples/build-sample-report.js

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { summarizeJsonl } = require("../../lib/codex-jsonl");
const { evaluateCorrectness } = require("../../lib/llm-correctness");
const { aggregationExpectation, codeGraphExpectation, conditions } = require("../../lib/llm-fixtures");
const {
  claimableRuns,
  completePairCount,
  corporaPresent,
  evaluateTracksClaimGate,
  measurementStatus,
  medianMetrics,
  metricStats,
  passedRuns,
  scenariosForTrack,
  scenariosForTrackCorpus,
  tracksPresent,
} = require("../../lib/llm-report");

const samplesDir = __dirname;
const root = path.resolve(samplesDir, "..", "..", "..");
const WALL_MS = 2000;
// A4: the sample is generated at the default cache discount so the cost-weighted
// headline and merged-total-secondary rendering are exercised under the shipped
// default; the smoke validator recomputes cost-weighted from the same discount.
const SAMPLE_CACHE_DISCOUNT = 0.1;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function syntheticFingerprint(seed) {
  return {
    algorithm: "sha256-relative-path-content",
    value: sha256(seed),
    file_count: 1,
  };
}

// The sample uses the curated control profile so the checked-in control sample
// JSONL (which cites docs/decisions.md, the curated layout) keeps passing
// correctness; the profile is recorded on the report and every scenario.
const SAMPLE_CONTROL_PROFILE = "curated";

function framePrompt(scale, condition, taskFamily, sessionLabel) {
  const header = sessionLabel
    ? `Benchmark scenario: ${scale} / ${condition} / ${taskFamily} (${sessionLabel}).`
    : `Benchmark scenario: ${scale} / ${condition} / ${taskFamily}.`;
  return [
    header,
    "Work as a coding agent in this repository.",
    "Use only local repository evidence.",
    "Do not modify files unless explicitly asked.",
    "Sample transcript for parser/report smoke validation.",
  ].join("\n");
}

function codexCommand(prompt) {
  return ["codex", "exec", "--json", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", prompt];
}

// schema_version 4 clean fixture validation outcome a real hermetic run produces.
const SAMPLE_FIXTURE_VALIDATION = {
  status: "clean",
  runtime_state_paths: [],
  fingerprint_matched: true,
  file_count: 1,
};

// Build a single-session scenario (every family except multi_session). The single
// JSONL is the run's primary metrics and correctness is evaluated against it.
function buildScenario({ scale, condition, benchmarkTrack, taskFamily, jsonlRelative, cwd, expectation }) {
  const metrics = summarizeJsonl(fs.readFileSync(path.join(root, jsonlRelative), "utf8"), { wall_ms: WALL_MS });
  const correctness = evaluateCorrectness({
    taskFamily,
    condition,
    finalText: metrics.final_text,
    fileChangeCount: metrics.file_change_event_count,
    readOnly: true,
    expectation: expectation || null,
    controlProfile: SAMPLE_CONTROL_PROFILE,
    benchmarkTrack,
  });
  const prompt = framePrompt(scale, condition, taskFamily, "");
  const run = {
    run_index: 1,
    raw_jsonl_path: jsonlRelative,
    requested_model: null,
    metrics,
    correctness,
  };
  run.measurement = measurementStatus(run);
  run.execution = { status: "completed", exit_code: 0, error: "", stderr_path: null };
  run.fixture_validation = { ...SAMPLE_FIXTURE_VALIDATION };
  return finalizeScenario({ scale, condition, benchmarkTrack, taskFamily, cwd, expectation, prompt, command: codexCommand(prompt), measuredRuns: [run] });
}

// Build a real-corpus stub scenario (corpus "real"). Reuses a code-graph JSONL
// transcript but stamps the corpus/repo/repo_sha/question_id fields and the
// pinned-sha + git-clean fixture fingerprint a real-corpus run produces, plus the
// with-arm MCP-injection flag. This exists only so the report schema validates a
// real-corpus scenario and the per-corpus report split renders; it is NOT a
// measured number. The expectation reuses the impact_trace designation semantics.
function buildRealStubScenario({ condition, jsonlRelative, repo, repoSha, questionId, expectation, mcpInjected }) {
  const taskFamily = "impact_trace";
  const metrics = summarizeJsonl(fs.readFileSync(path.join(root, jsonlRelative), "utf8"), { wall_ms: WALL_MS });
  const correctness = evaluateCorrectness({
    taskFamily,
    condition,
    finalText: metrics.final_text,
    fileChangeCount: metrics.file_change_event_count,
    readOnly: true,
    expectation,
    controlProfile: SAMPLE_CONTROL_PROFILE,
    benchmarkTrack: "code_graph",
  });
  const prompt = framePrompt("real", condition, taskFamily, "");
  const run = {
    run_index: 1,
    raw_jsonl_path: jsonlRelative,
    requested_model: null,
    metrics,
    correctness,
  };
  run.measurement = measurementStatus(run);
  run.execution = { status: "completed", exit_code: 0, error: "", stderr_path: null };
  // A real-corpus run records a clean pinned-sha + git-clean validation outcome.
  run.fixture_validation = { status: "clean", head: repoSha, pinned_sha_matched: true, git_clean: true, new_untracked_runtime_state_paths: [] };
  const scenario = finalizeScenario({
    scale: "real",
    condition,
    benchmarkTrack: "code_graph",
    taskFamily,
    cwd: `/tmp/project-librarian-real-corpus/${repo}/${condition}`,
    expectation,
    prompt,
    command: codexCommand(prompt),
    measuredRuns: [run],
    corpus: "real",
    repo,
    repoSha,
    questionId,
    mcpInjected,
    promptId: `${repo}-${questionId}-${condition}`,
  });
  // The real-corpus fingerprint is pinned-sha + git-clean, not a content hash.
  scenario.fixture_fingerprint = { algorithm: "pinned-sha-git-clean", repo_sha: repoSha, value: sha256(`${repo}\0${repoSha}\0${condition}`) };
  return scenario;
}

// Build a multi_session scenario: two JSONL transcripts (familiarization session 1
// and measured session 2) in the SAME synthetic cwd. The run's primary metrics and
// correctness come from the MEASURED session (session 2); session 1 only needs to
// complete. The run carries a session_metrics array (both sessions) and the
// scenario carries session_count/sessions/session_metrics (schema_version 5).
function buildMultiSessionScenario({ scale, condition, taskFamily, sessionJsonl, cwd }) {
  const sessionDefs = [
    { session_index: 1, role: "familiarization", jsonl: sessionJsonl.familiarization, label: "session 1 of 2: familiarization" },
    { session_index: 2, role: "measured", jsonl: sessionJsonl.measured, label: "session 2 of 2: measured" },
  ];
  const sessionRecords = sessionDefs.map((def) => {
    const metrics = summarizeJsonl(fs.readFileSync(path.join(root, def.jsonl), "utf8"), { wall_ms: WALL_MS });
    return {
      session_index: def.session_index,
      role: def.role,
      raw_jsonl_path: def.jsonl,
      execution: { status: "completed", exit_code: 0, error: "", stderr_path: null },
      metrics,
      prompt: framePrompt(scale, condition, taskFamily, def.label),
    };
  });
  const measured = sessionRecords.find((record) => record.role === "measured");
  const metrics = measured.metrics;
  const correctness = evaluateCorrectness({
    taskFamily,
    condition,
    finalText: metrics.final_text,
    fileChangeCount: metrics.file_change_event_count,
    readOnly: true,
    expectation: null,
    controlProfile: SAMPLE_CONTROL_PROFILE,
    benchmarkTrack: "wiki",
  });
  const run = {
    run_index: 1,
    raw_jsonl_path: measured.raw_jsonl_path,
    requested_model: null,
    execution: measured.execution,
    metrics,
    correctness,
    fixture_validation: { ...SAMPLE_FIXTURE_VALIDATION },
    session_metrics: sessionRecords.map((record) => ({
      session_index: record.session_index,
      role: record.role,
      raw_jsonl_path: record.raw_jsonl_path,
      execution: record.execution,
      metrics: record.metrics,
    })),
    measured_session_index: measured.session_index,
  };
  run.measurement = measurementStatus(run);
  const scenario = finalizeScenario({
    scale,
    condition,
    benchmarkTrack: "wiki",
    taskFamily,
    cwd,
    expectation: null,
    prompt: measured.prompt,
    command: codexCommand(measured.prompt),
    measuredRuns: [run],
  });
  scenario.session_count = sessionRecords.length;
  scenario.sessions = sessionRecords.map((record) => ({
    session_index: record.session_index,
    role: record.role,
    prompt: record.prompt,
    command: codexCommand(record.prompt),
  }));
  scenario.session_metrics = [{
    run_index: run.run_index,
    measured_session_index: run.measured_session_index,
    sessions: run.session_metrics,
  }];
  return scenario;
}

// Shared scenario finalization: derive models, medians, dispersion, and counts the
// same way measuredReport does. corpus/repo/repo_sha/question_id/mcp_injected
// default to the synthetic shape; the real-corpus stub scenario overrides them.
function finalizeScenario({ scale, condition, benchmarkTrack, taskFamily, cwd, expectation, prompt, command, measuredRuns, corpus = "synthetic", repo = null, repoSha = null, questionId = null, mcpInjected = false, promptId }) {
  const actualClaimableRuns = claimableRuns(measuredRuns);
  const correctnessPassedRuns = passedRuns(measuredRuns);
  const observedModels = [...new Set(measuredRuns.flatMap((item) => item.metrics.models || []).filter(Boolean))];
  const scenarioModels = observedModels.length > 0 ? observedModels : [];
  return {
    scale,
    condition,
    benchmark_track: benchmarkTrack,
    corpus,
    repo,
    repo_sha: repoSha,
    question_id: questionId,
    mcp_injected: mcpInjected,
    control_profile: SAMPLE_CONTROL_PROFILE,
    task_family: taskFamily,
    prompt_id: promptId || `${taskFamily}-${scale}-${condition}`,
    cwd,
    requested_model: null,
    model: scenarioModels.length === 1 ? scenarioModels[0] : null,
    model_source: observedModels.length === 1 ? "jsonl" : null,
    models: scenarioModels,
    expectation: expectation || null,
    runs: measuredRuns,
    median: actualClaimableRuns.length > 0 ? medianMetrics(actualClaimableRuns) : null,
    median_all_runs: medianMetrics(measuredRuns),
    passed_run_count: correctnessPassedRuns.length,
    claimable_run_count: actualClaimableRuns.length,
    correctness: measuredRuns.map((item) => item.correctness),
    raw_jsonl_paths: measuredRuns.map((item) => item.raw_jsonl_path),
    fixture_fingerprint: syntheticFingerprint(`${scale}\0${condition}\0${taskFamily}`),
    dispersion: actualClaimableRuns.length > 0 ? metricStats(actualClaimableRuns) : null,
    dispersion_all_runs: metricStats(measuredRuns),
    prompt,
    command,
  };
}

function summarizeScenarios(scenarioList) {
  return {
    scenario_count: scenarioList.length,
    comparison_pair_count: completePairCount(scenarioList, conditions),
    passed_correctness_count: scenarioList.filter((scenario) => scenario.correctness.every((item) => item.status === "passed")).length,
    needs_review_count: scenarioList.filter((scenario) => scenario.correctness.some((item) => item.status === "needs_review")).length,
    failed_correctness_count: scenarioList.filter((scenario) => scenario.correctness.some((item) => item.status === "failed")).length,
    claimable_scenario_count: scenarioList.filter((scenario) => scenario.claimable_run_count > 0).length,
    unclaimable_scenario_count: scenarioList.filter((scenario) => scenario.claimable_run_count === 0).length,
  };
}

function main() {
  // Every family is sampled at the medium scale so each track covers the single
  // selected scale with all its expected tasks present (wiki: decision_lookup,
  // multi_session, aggregation; code_graph: impact_trace); this lets the per-track
  // and overall claim gates pass and exercises the passing-gate render path. The
  // wiki correctness expectations are scale-independent here.
  const impactExpectation = codeGraphExpectation("impact_trace", "medium");
  // The real-corpus stub reuses the medium impact_trace transcripts, so it reuses
  // their expectation; in a true real run this is the hand-authored answer key.
  const realImpactExpectation = impactExpectation;
  const scenarios = [
    buildScenario({
      scale: "medium",
      condition: "with_project_librarian",
      benchmarkTrack: "wiki",
      taskFamily: "decision_lookup",
      jsonlRelative: "benchmarks/llm/samples/codex-turn-completed.jsonl",
      cwd: "/tmp/project-librarian-codex-llm/sample",
      expectation: null,
    }),
    buildScenario({
      scale: "medium",
      condition: "without_project_librarian",
      benchmarkTrack: "wiki",
      taskFamily: "decision_lookup",
      jsonlRelative: "benchmarks/llm/samples/codex-turn-completed-control.jsonl",
      cwd: "/tmp/project-librarian-codex-llm/sample-control",
      expectation: null,
    }),
    buildScenario({
      scale: "medium",
      condition: "with_project_librarian",
      benchmarkTrack: "code_graph",
      taskFamily: "impact_trace",
      jsonlRelative: "benchmarks/llm/samples/codex-code-graph-impact-trace.jsonl",
      cwd: "/tmp/project-librarian-codex-llm/sample-code-graph",
      expectation: impactExpectation,
    }),
    buildScenario({
      scale: "medium",
      condition: "without_project_librarian",
      benchmarkTrack: "code_graph",
      taskFamily: "impact_trace",
      jsonlRelative: "benchmarks/llm/samples/codex-code-graph-impact-trace-control.jsonl",
      cwd: "/tmp/project-librarian-codex-llm/sample-code-graph-control",
      expectation: impactExpectation,
    }),
    // A3 multi_session pair (two sessions each); session-2 metrics are the primary.
    buildMultiSessionScenario({
      scale: "medium",
      condition: "with_project_librarian",
      taskFamily: "multi_session",
      sessionJsonl: {
        familiarization: "benchmarks/llm/samples/codex-multi-session-s1.jsonl",
        measured: "benchmarks/llm/samples/codex-multi-session-s2.jsonl",
      },
      cwd: "/tmp/project-librarian-codex-llm/sample-multi-session",
    }),
    buildMultiSessionScenario({
      scale: "medium",
      condition: "without_project_librarian",
      taskFamily: "multi_session",
      sessionJsonl: {
        familiarization: "benchmarks/llm/samples/codex-multi-session-control-s1.jsonl",
        measured: "benchmarks/llm/samples/codex-multi-session-control-s2.jsonl",
      },
      cwd: "/tmp/project-librarian-codex-llm/sample-multi-session-control",
    }),
    // A3 aggregation pair (manifest-borne aggregate-component expectation).
    buildScenario({
      scale: "medium",
      condition: "with_project_librarian",
      benchmarkTrack: "wiki",
      taskFamily: "aggregation",
      jsonlRelative: "benchmarks/llm/samples/codex-aggregation.jsonl",
      cwd: "/tmp/project-librarian-codex-llm/sample-aggregation",
      expectation: aggregationExpectation(),
    }),
    buildScenario({
      scale: "medium",
      condition: "without_project_librarian",
      benchmarkTrack: "wiki",
      taskFamily: "aggregation",
      jsonlRelative: "benchmarks/llm/samples/codex-aggregation-control.jsonl",
      cwd: "/tmp/project-librarian-codex-llm/sample-aggregation-control",
      expectation: aggregationExpectation(),
    }),
    // Real-corpus stub pair (corpus "real"): exercises the report schema's corpus
    // fields, the pinned-sha fingerprint, the with-arm MCP-injection flag, and the
    // per-corpus report split. Reuses the impact_trace transcripts/expectation; it
    // shares the code_graph track with the synthetic impact_trace pair but is
    // aggregated SEPARATELY (corpus split). Not a measured number.
    buildRealStubScenario({
      condition: "with_project_librarian",
      jsonlRelative: "benchmarks/llm/samples/codex-code-graph-impact-trace.jsonl",
      repo: "_stub-example",
      repoSha: "0000000000000000000000000000000000000000",
      questionId: "impact-trace-1",
      expectation: realImpactExpectation,
      mcpInjected: true,
    }),
    buildRealStubScenario({
      condition: "without_project_librarian",
      jsonlRelative: "benchmarks/llm/samples/codex-code-graph-impact-trace-control.jsonl",
      repo: "_stub-example",
      repoSha: "0000000000000000000000000000000000000000",
      questionId: "impact-trace-1",
      expectation: realImpactExpectation,
      mcpInjected: false,
    }),
  ];

  const selectedScales = ["medium"];
  const selectedTasks = ["decision_lookup", "impact_trace", "multi_session", "aggregation"];
  const expectedByTrack = { wiki: ["decision_lookup", "multi_session", "aggregation"], code_graph: ["impact_trace"] };
  const presentTracks = tracksPresent(scenarios);

  const manifestFingerprint = sha256(JSON.stringify(scenarios.map((scenario) => ({
    scale: scenario.scale,
    condition: scenario.condition,
    task_family: scenario.task_family,
    prompt: scenario.prompt,
    fixture_fingerprint: scenario.fixture_fingerprint,
    requested_model: scenario.requested_model,
  }))));
  const scenarioMatrixFingerprint = sha256(JSON.stringify(scenarios.map((scenario) => ({
    scale: scenario.scale,
    condition: scenario.condition,
    task_family: scenario.task_family,
    fixture_fingerprint: scenario.fixture_fingerprint,
    requested_model: scenario.requested_model,
  }))));

  const report = {
    schema_version: 7,
    benchmark_kind: "codex-actual-llm",
    auth_mode: "chatgpt_codex",
    auth: {
      auth_mode_source: "declared",
      code_api_key_present: false,
      openai_api_key_present: false,
      codex_home_set: true,
    },
    generated_at: "2026-06-10T00:00:00.000Z",
    environment: { node: "v22.19.0", platform: "darwin", arch: "arm64" },
    control_profile: SAMPLE_CONTROL_PROFILE,
    // The sample mixes synthetic and real-corpus scenarios; the top-level corpus
    // label is "mixed" so it does not read as a single-corpus report. Per-scenario
    // corpus fields carry the true corpus and drive the report split.
    corpus: "mixed",
    cache_discount: SAMPLE_CACHE_DISCOUNT,
    // schema_version 4 hermetic provenance (A5): a sample isolated CODEX_HOME with
    // auth-only copy and an allowlist-only subscription-mode env (no API keys, no
    // inherited process env).
    hermetic: {
      isolated_codex_home: "/tmp/project-librarian-codex-llm/sample/codex-home",
      real_codex_home: "/home/sample/.codex",
      auth_source: "/home/sample/.codex/auth.json",
      copied_files: ["auth.json"],
      allowlisted_env_keys: ["CODEX_HOME", "HOME", "LANG", "PATH", "TERM"],
      allowlisted_env_key_count: 5,
      inherited_process_env: false,
    },
    codex: { version: "codex-cli-sample" },
    configuration: {
      runs: 1,
      warmup_runs: 1,
      max_scenarios: 8,
      requested_model: null,
      selected_scenarios: scenarios.length,
      total_manifest_scenarios: 60,
      full_matrix: false,
      min_runs_for_claim: 1,
      require_claimable: false,
      control_profile: SAMPLE_CONTROL_PROFILE,
      cache_discount: SAMPLE_CACHE_DISCOUNT,
      selected_scales: selectedScales,
      selected_tasks: selectedTasks,
      manifest_fingerprint: manifestFingerprint,
      scenario_matrix_fingerprint: scenarioMatrixFingerprint,
      require_clean: false,
      scenario_order: "deterministic-alternating-pairs",
    },
    benchmark_tracks: presentTracks,
    summary: summarizeScenarios(scenarios),
    scenarios,
    source_control: {
      available: true,
      commit: "sample",
      short_commit: "sample",
      branch: "sample",
      dirty: false,
      status_entry_count: 0,
    },
  };

  const overallGate = evaluateTracksClaimGate(report, {
    conditions,
    expectedScales: selectedScales,
    expectedTasksByTrack: expectedByTrack,
    fullMatrix: false,
    minRunsForClaim: 1,
  });
  report.tracks = {};
  for (const track of presentTracks) {
    const trackScenarios = scenariosForTrack(scenarios, track);
    const trackCorpora = corporaPresent(trackScenarios);
    const corpora = {};
    for (const corpus of trackCorpora) {
      const corpusScenarios = scenariosForTrackCorpus(scenarios, track, corpus);
      corpora[corpus] = {
        corpus,
        summary: summarizeScenarios(corpusScenarios),
        prompt_ids: corpusScenarios.map((scenario) => scenario.prompt_id),
        claim_gate: overallGate.per_track[track].per_corpus[corpus],
      };
    }
    report.tracks[track] = {
      benchmark_track: track,
      expected_tasks: expectedByTrack[track] || [],
      summary: summarizeScenarios(trackScenarios),
      prompt_ids: trackScenarios.map((scenario) => scenario.prompt_id),
      corpora_present: trackCorpora,
      corpora,
      claim_gate: overallGate.per_track[track],
    };
  }
  report.claim_gate = overallGate;

  const outPath = path.join(samplesDir, "codex-measured-report.json");
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`wrote ${path.relative(root, outPath)}\n`);
}

main();
