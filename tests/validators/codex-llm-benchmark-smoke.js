#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { summarizeJsonl } = require("../../benchmarks/lib/codex-jsonl");
const { applyCodexHomeRetention } = require("../../benchmarks/lib/llm-raw-retention");
const { evaluateCorrectness } = require("../../benchmarks/lib/llm-correctness");
const { aggregationExpectation, conditions } = require("../../benchmarks/lib/llm-fixtures");
const { sampleImpactTraceExpectation } = require("../../benchmarks/llm/samples/sample-code-graph-expectation");
const { claimableRuns, completePairCount, corporaPresent, costWeightedTokens, evaluateTracksClaimGate, measurementStatus, medianMetrics, metricStats, renderLlmMarkdownReport, resolveCacheDiscount, scenariosForTrack, scenariosForTrackCorpus, selectPairedScenarios, tracksPresent } = require("../../benchmarks/lib/llm-report");

const root = path.resolve(__dirname, "..", "..");
const sampleFinalText = "2026-06-10 metrics decision in wiki/decisions/log.md documents Project Librarian benchmark evidence.";
const controlSampleFinalText = "2026-06-10 metrics decision in docs/decisions.md documents benchmark evidence from README.md control docs.";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fingerprintDirectory(directory) {
  const entries = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if ([".git", "node_modules"].includes(entry.name)) continue;
        visit(absolute);
      } else if (entry.isFile()) {
        entries.push(`${relative}\0${sha256(fs.readFileSync(absolute))}`);
      }
    }
  }
  visit(directory);
  return {
    algorithm: "sha256-relative-path-content",
    value: sha256(entries.join("\n")),
    file_count: entries.length,
  };
}

function validateSampleJsonl() {
  const samplePath = path.join(root, "benchmarks", "llm", "samples", "codex-turn-completed.jsonl");
  const metrics = summarizeJsonl(fs.readFileSync(samplePath, "utf8"), { wall_ms: 2000 });
  assert.equal(metrics.input_tokens, 24763);
  assert.equal(metrics.cached_input_tokens, 24448);
  assert.equal(metrics.output_tokens, 122);
  assert.equal(metrics.reasoning_output_tokens, 0);
  assert.equal(metrics.total_tokens, 24885);
  // A4 derived cost fields, recomputed from raw JSONL: uncached = input - cached;
  // tool_output_bytes = UTF-8 bytes of aggregated_output on the completed command
  // item only (the started event carries an empty string); request_count_estimate
  // = the single completed turn boundary.
  assert.equal(metrics.uncached_input_tokens, 315);
  assert.equal(metrics.tool_output_bytes, 199);
  assert.equal(metrics.request_count_estimate, 1);
  assert.equal(metrics.first_response_ms, 0);
  assert.equal(metrics.codex_turn_count, 1);
  assert.equal(metrics.command_event_count, 2);
  assert.equal(metrics.command_invocation_count, 1);
  assert.equal(metrics.tool_event_count, 2);
  assert.equal(metrics.tool_invocation_count, 1);
  assert.equal(metrics.plan_event_count, 0);
  assert.equal(metrics.model, "gpt-5.5");
  assert.deepEqual(metrics.models, ["gpt-5.5"]);
  assert.equal(metrics.final_text, sampleFinalText);
  assert.equal(metrics.error_event_count, 0);
  assert(metrics.unavailable_event_fields.includes("first_response_latency"));
}

function validateControlSampleJsonl() {
  const samplePath = path.join(root, "benchmarks", "llm", "samples", "codex-turn-completed-control.jsonl");
  const metrics = summarizeJsonl(fs.readFileSync(samplePath, "utf8"), { wall_ms: 2000 });
  assert.equal(metrics.input_tokens, 24763);
  assert.equal(metrics.output_tokens, 122);
  assert.equal(metrics.total_tokens, 24885);
  // A4 derived cost fields recomputed from raw JSONL. The control's tool-output
  // volume is smaller than the with-condition sample (78 vs 199 bytes), matching
  // the trace finding that the maintained wiki is itself a larger grep surface at
  // small/medium scale.
  assert.equal(metrics.uncached_input_tokens, 315);
  assert.equal(metrics.tool_output_bytes, 78);
  assert.equal(metrics.request_count_estimate, 1);
  // Cost-weighted headline is recomputable from the raw-derived components and the
  // discount, not a stored field: uncached + 0.1*cached + output + reasoning.
  assert.equal(costWeightedTokens(metrics, 0.1), 315 + 0.1 * 24448 + 122 + 0);
  assert.equal(metrics.first_response_ms, 0);
  assert.equal(metrics.model, "gpt-5.5");
  assert.deepEqual(metrics.models, ["gpt-5.5"]);
  assert.equal(metrics.final_text, controlSampleFinalText);
  assert(metrics.unavailable_event_fields.includes("first_response_latency"));
  // The control sample cites docs/decisions.md, the curated profile layout, so it
  // is validated under the curated control profile.
  const correctness = evaluateCorrectness({
    taskFamily: "decision_lookup",
    condition: "without_project_librarian",
    finalText: metrics.final_text,
    fileChangeCount: metrics.file_change_event_count,
    controlProfile: "curated",
  });
  assert.equal(correctness.status, "passed");
}

// code_graph correctness must be recomputable from raw JSONL plus the
// manifest-borne expectation, never from a stored verdict. The synthetic
// code_graph track has been removed (the real-repository corpus owns code_graph
// now); the sample uses a small INLINE impact_trace expectation (the real-corpus
// answer-key shape) whose required_terms match the checked-in impact_trace sample
// JSONL transcripts. Both the runner-backed with sample and the grep-backed
// control sample must pass against this same expectation.
function validateCodeGraphSampleJsonl() {
  // impact_trace asks for the TRANSITIVE importer set of the file-chain root
  // packages/workspace-0/src/mod-0.ts; the expected answer is the chain tail
  // (mod-1 .. mod-13), so the sample final text must list every path.
  const expectation = sampleImpactTraceExpectation;
  assert(expectation.answer_key_terms.includes("packages/workspace-0/src/mod-13.ts"));
  assert.equal(expectation.required_terms.length, 13);
  for (const [file, condition] of [
    ["benchmarks/llm/samples/codex-code-graph-impact-trace.jsonl", "with_project_librarian"],
    ["benchmarks/llm/samples/codex-code-graph-impact-trace-control.jsonl", "without_project_librarian"],
  ]) {
    const metrics = summarizeJsonl(fs.readFileSync(path.join(root, file), "utf8"), { wall_ms: 2000 });
    assert.equal(metrics.model, "gpt-5.5");
    const correctness = evaluateCorrectness({
      taskFamily: "impact_trace",
      condition,
      finalText: metrics.final_text,
      fileChangeCount: metrics.file_change_event_count,
      readOnly: true,
      expectation,
      benchmarkTrack: "code_graph",
    });
    assert.equal(correctness.status, "passed", `code_graph sample ${file} should pass: ${correctness.reason}`);
  }

  // A code_graph family without a provided expectation must not silently pass:
  // it resolves to needs_review (the static map has no entry).
  const missing = evaluateCorrectness({
    taskFamily: "impact_trace",
    condition: "with_project_librarian",
    finalText: "packages/workspace-0/src/mod-1.ts imports mod-0",
    fileChangeCount: 0,
    readOnly: true,
    expectation: null,
    benchmarkTrack: "code_graph",
  });
  assert.equal(missing.status, "needs_review");

  // A partial answer (missing one transitive importer) must fail — the traversal
  // requirement is not weakened: every expected path must be present.
  const partial = evaluateCorrectness({
    taskFamily: "impact_trace",
    condition: "with_project_librarian",
    finalText: expectation.required_terms.slice(0, -1).join(", "),
    fileChangeCount: 0,
    readOnly: true,
    expectation,
    benchmarkTrack: "code_graph",
  });
  assert.equal(partial.status, "failed");
}

// A3 multi_session: correctness is recomputed from the MEASURED session (session 2)
// only; the familiarization session (session 1) only needs to complete. Both the
// with-condition and control measured-session samples must pass against the static
// multi_session expectation, and a session-2 sample missing the seeded decision
// date must fail (so the family is not a free pass).
function validateMultiSessionSampleJsonl() {
  for (const [file, condition, profile] of [
    ["benchmarks/llm/samples/codex-multi-session-s2.jsonl", "with_project_librarian", "curated"],
    ["benchmarks/llm/samples/codex-multi-session-control-s2.jsonl", "without_project_librarian", "curated"],
  ]) {
    const metrics = summarizeJsonl(fs.readFileSync(path.join(root, file), "utf8"), { wall_ms: 2000 });
    assert.equal(metrics.model, "gpt-5.5");
    const correctness = evaluateCorrectness({
      taskFamily: "multi_session",
      condition,
      finalText: metrics.final_text,
      fileChangeCount: metrics.file_change_event_count,
      readOnly: true,
      controlProfile: profile,
      benchmarkTrack: "wiki",
    });
    assert.equal(correctness.status, "passed", `multi_session measured sample ${file} should pass: ${correctness.reason}`);
  }
  // The familiarization samples (session 1) are claimable completions: usage present.
  for (const file of ["benchmarks/llm/samples/codex-multi-session-s1.jsonl", "benchmarks/llm/samples/codex-multi-session-control-s1.jsonl"]) {
    const metrics = summarizeJsonl(fs.readFileSync(path.join(root, file), "utf8"), { wall_ms: 2000 });
    assert(metrics.codex_turn_count > 0, `familiarization sample ${file} must have a completed turn`);
    assert(metrics.final_text.length > 0);
  }
  // A measured session that omits the seeded latest-decision date fails correctness.
  const missingDate = evaluateCorrectness({
    taskFamily: "multi_session",
    condition: "with_project_librarian",
    finalText: "Before publishing benchmark claims you must run checks; see wiki/canonical/release-policy.md and wiki/decisions/log.md.",
    fileChangeCount: 0,
    readOnly: true,
    benchmarkTrack: "wiki",
  });
  assert.equal(missingDate.status, "failed");
}

// A3 aggregation: correctness is recomputed from raw JSONL plus the manifest-borne
// aggregate-component expectation (recomputed here from the deterministic ground
// truth), never a stored verdict. Both the with-condition and control samples must
// list every dated decision; a sample missing one date must fail.
function validateAggregationSampleJsonl() {
  const expectation = aggregationExpectation();
  assert(expectation.required_terms.includes("2026-01-15") && expectation.required_terms.includes("2026-06-10"));
  for (const [file, condition] of [
    ["benchmarks/llm/samples/codex-aggregation.jsonl", "with_project_librarian"],
    ["benchmarks/llm/samples/codex-aggregation-control.jsonl", "without_project_librarian"],
  ]) {
    const metrics = summarizeJsonl(fs.readFileSync(path.join(root, file), "utf8"), { wall_ms: 2000 });
    assert.equal(metrics.model, "gpt-5.5");
    const correctness = evaluateCorrectness({
      taskFamily: "aggregation",
      condition,
      finalText: metrics.final_text,
      fileChangeCount: metrics.file_change_event_count,
      readOnly: true,
      expectation,
      controlProfile: "curated",
      benchmarkTrack: "wiki",
    });
    assert.equal(correctness.status, "passed", `aggregation sample ${file} should pass: ${correctness.reason}`);
  }
  // Missing one aggregate date fails.
  const incomplete = evaluateCorrectness({
    taskFamily: "aggregation",
    condition: "with_project_librarian",
    finalText: "Decisions: 2026-01-15, 2026-02-09, 2026-03-22, 2026-06-10 in wiki/canonical/dated-decision-0.md.",
    fileChangeCount: 0,
    readOnly: true,
    expectation,
    benchmarkTrack: "wiki",
  });
  assert.equal(incomplete.status, "failed");
  // No-expectation aggregation must not silently pass.
  const missing = evaluateCorrectness({
    taskFamily: "aggregation",
    condition: "with_project_librarian",
    finalText: "2026-01-15 2026-02-09 2026-03-22 2026-05-04 2026-06-10",
    fileChangeCount: 0,
    readOnly: true,
    expectation: null,
    benchmarkTrack: "wiki",
  });
  assert.equal(missing.status, "needs_review");
}

function validateReasoningTokenTotal() {
  const metrics = summarizeJsonl([
    JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 100,
        output_tokens: 25,
        reasoning_output_tokens: 10,
      },
    }),
  ].join("\n"), { wall_ms: 1000 });
  assert.equal(metrics.total_tokens, 125);
}

function validateInvocationCounts() {
  const functionCallMetrics = summarizeJsonl([
    JSON.stringify({ type: "function_call", name: "read_file" }),
    JSON.stringify({ type: "function_call_output", name: "read_file" }),
  ].join("\n"));
  assert.equal(functionCallMetrics.tool_event_count, 2);
  assert.equal(functionCallMetrics.tool_invocation_count, 1);

  const completedOnlyMetrics = summarizeJsonl(JSON.stringify({
    type: "tool.command.completed",
    command: "rg benchmark wiki",
    exit_code: 0,
  }));
  assert.equal(completedOnlyMetrics.command_event_count, 1);
  assert.equal(completedOnlyMetrics.command_invocation_count, 1);
  assert.equal(completedOnlyMetrics.tool_event_count, 1);
  assert.equal(completedOnlyMetrics.tool_invocation_count, 1);
}

function validatePairSelectionOrder() {
  const scenarios = [];
  for (const task of ["a", "b", "c"]) {
    for (const condition of conditions) {
      scenarios.push({ scale: "small", task_family: task, condition, prompt_id: `${task}-${condition}` });
    }
  }
  assert.deepEqual(selectPairedScenarios(scenarios, 6, conditions).map((scenario) => scenario.prompt_id), [
    "a-with_project_librarian",
    "a-without_project_librarian",
    "b-without_project_librarian",
    "b-with_project_librarian",
    "c-with_project_librarian",
    "c-without_project_librarian",
  ]);
}

const validTracks = ["wiki", "code_graph"];

function assertValidTrackTag(track) {
  assert(validTracks.includes(track), `invalid benchmark_track: ${track}`);
}

const validControlProfiles = ["bare", "organic", "curated"];

const validCorpora = ["synthetic", "real"];

function validateManifest(report) {
  // schema_version 5 adds the corpus dimension (corpus/repo/repo_sha/question_id on
  // every scenario); schema_version 4 (A3) added multi_session sessions/session_count
  // and the aggregation expectation; schema_version 3 added control_profile (A2).
  assert.equal(report.schema_version, 5);
  // The corpus dimension is recorded at the manifest top level and on every
  // scenario. The synthetic fixtures are corpus "synthetic"; the real-repository
  // manifest is corpus "real".
  assert(validCorpora.includes(report.corpus), `invalid manifest corpus: ${report.corpus}`);
  // A2: the manifest records control_profile at the top level and on every
  // scenario, and the profile is a known value.
  assert(validControlProfiles.includes(report.control_profile), `invalid manifest control_profile: ${report.control_profile}`);
  assert(Array.isArray(report.scenarios));
  assert(report.scenarios.length > 0);
  assert(report.scenarios.every((scenario) => scenario.cwd && scenario.prompt && Array.isArray(scenario.command)));
  assert(report.scenarios.every((scenario) => scenario.control_profile === report.control_profile), "scenario control_profile must match the manifest control_profile");
  // Every scenario carries the corpus dimension fields. Synthetic scenarios carry
  // null repo/repo_sha/question_id; real scenarios carry strings.
  for (const scenario of report.scenarios) {
    assert(validCorpora.includes(scenario.corpus), `scenario ${scenario.prompt_id} has invalid corpus ${scenario.corpus}`);
    assert.equal(scenario.corpus, report.corpus, "scenario corpus must match the manifest corpus");
    if (scenario.corpus === "real") {
      assert(typeof scenario.repo === "string" && scenario.repo.length > 0, `real scenario ${scenario.prompt_id} needs a repo`);
      assert(typeof scenario.repo_sha === "string" && scenario.repo_sha.length > 0, `real scenario ${scenario.prompt_id} needs a repo_sha`);
      assert(typeof scenario.question_id === "string" && scenario.question_id.length > 0, `real scenario ${scenario.prompt_id} needs a question_id`);
    } else {
      assert.equal(scenario.repo, null);
      assert.equal(scenario.repo_sha, null);
      assert.equal(scenario.question_id, null);
    }
  }
  // Track tags exist and are valid on every scenario; benchmark_tracks lists the
  // tracks present and matches the per-scenario tags.
  assert(Array.isArray(report.benchmark_tracks) && report.benchmark_tracks.length > 0);
  for (const track of report.benchmark_tracks) assertValidTrackTag(track);
  const tracksSeen = new Set();
  for (const scenario of report.scenarios) {
    assertValidTrackTag(scenario.benchmark_track);
    tracksSeen.add(scenario.benchmark_track);
    assert(Object.hasOwn(scenario, "expectation"));
    // Expectation sourcing: code_graph carries a manifest-borne expectation with
    // answer_key_terms; the wiki aggregation family carries a manifest-borne
    // aggregate-component expectation; other wiki families carry expectation: null
    // (static path).
    if (scenario.benchmark_track === "code_graph") {
      assert(scenario.expectation && Array.isArray(scenario.expectation.required_terms), `code_graph scenario ${scenario.prompt_id} missing expectation`);
      assert(Array.isArray(scenario.expectation.answer_key_terms));
    } else if (scenario.task_family === "aggregation") {
      assert(scenario.expectation && Array.isArray(scenario.expectation.required_terms), `aggregation scenario ${scenario.prompt_id} missing expectation`);
      assert(Array.isArray(scenario.expectation.aggregate_components) && scenario.expectation.aggregate_components.length >= 2, `aggregation scenario ${scenario.prompt_id} needs >= 2 aggregate components`);
      assert(Array.isArray(scenario.expectation.no_single_page_terms) && scenario.expectation.no_single_page_terms.length >= 2);
      // Every aggregate component date must be a required term.
      for (const component of scenario.expectation.aggregate_components) {
        assert(scenario.expectation.required_terms.includes(component.date), `aggregation required_terms missing component date ${component.date}`);
      }
    } else {
      assert.equal(scenario.expectation, null);
    }
    // multi_session scenarios carry two session prompts/commands; the top-level
    // prompt/command mirror the measured session (session 2). Other families carry
    // no sessions array.
    if (scenario.task_family === "multi_session") {
      assert(Array.isArray(scenario.sessions) && scenario.sessions.length === 2, `multi_session scenario ${scenario.prompt_id} must carry two sessions`);
      assert.equal(scenario.session_count, 2);
      const roles = scenario.sessions.map((session) => session.role);
      assert.deepEqual(roles, ["familiarization", "measured"], `multi_session sessions must be [familiarization, measured], got ${JSON.stringify(roles)}`);
      for (const session of scenario.sessions) {
        assert(typeof session.prompt === "string" && session.prompt.length > 0);
        assert(Array.isArray(session.command) && session.command.length > 0);
        assert(Number.isInteger(session.session_index));
      }
      const measured = scenario.sessions.find((session) => session.role === "measured");
      assert.equal(scenario.prompt, measured.prompt, "multi_session top-level prompt must mirror the measured session");
      assert.deepEqual(scenario.command, measured.command, "multi_session top-level command must mirror the measured session");
    } else {
      assert.equal(Object.hasOwn(scenario, "sessions"), false, `${scenario.prompt_id} should not carry sessions`);
    }
    // task_tracks agrees with the scenario tag.
    assert.equal(report.task_tracks[scenario.task_family], scenario.benchmark_track);
  }
  for (const track of tracksSeen) assert(report.benchmark_tracks.includes(track));
}

function validateReport(reportPath) {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (report.benchmark_kind === "codex-actual-llm-manifest") {
    validateManifest(report);
    return;
  }
  assert.equal(report.schema_version, 7);
  assert.equal(report.benchmark_kind, "codex-actual-llm");
  // schema 7 corpus dimension: a top-level corpus label ("synthetic", "real", or
  // "mixed" when a report carries both). Every scenario carries its own corpus.
  assert(["synthetic", "real", "mixed"].includes(report.corpus), `invalid report corpus: ${report.corpus}`);
  assert(report.auth && report.auth.auth_mode_source === "declared");
  // A4: the report records the cache discount used for the cost-weighted headline,
  // at the top level and in configuration, and it is a finite 0..1 value.
  assert(Number.isFinite(report.cache_discount) && report.cache_discount >= 0 && report.cache_discount <= 1, `invalid report cache_discount: ${report.cache_discount}`);
  assert.equal(report.configuration.cache_discount, report.cache_discount);
  assert(report.source_control && typeof report.source_control.available === "boolean");
  // A5 hermetic provenance: the report records the isolated Codex home, the
  // auth-only copy, an allowlist-only env (never inheriting process.env), and the
  // auth-mode contract (no API-key env keys in subscription mode).
  assert(report.hermetic && typeof report.hermetic === "object", "measured report must carry a hermetic block");
  assert(typeof report.hermetic.isolated_codex_home === "string" && report.hermetic.isolated_codex_home.length > 0);
  assert(typeof report.hermetic.real_codex_home === "string" && report.hermetic.real_codex_home.length > 0);
  assert(typeof report.hermetic.auth_source === "string" && report.hermetic.auth_source.length > 0);
  assert(Array.isArray(report.hermetic.copied_files) && report.hermetic.copied_files.includes("auth.json"));
  // Only auth material is copied into the isolated home; nothing else.
  assert.deepEqual(report.hermetic.copied_files, ["auth.json"], "isolated home must copy auth material only");
  assert(Array.isArray(report.hermetic.allowlisted_env_keys) && report.hermetic.allowlisted_env_keys.length > 0);
  assert.equal(report.hermetic.allowlisted_env_key_count, report.hermetic.allowlisted_env_keys.length);
  assert.equal(report.hermetic.inherited_process_env, false, "hermetic env must not inherit process.env");
  assert(report.hermetic.allowlisted_env_keys.includes("PATH"), "allowlist must include PATH");
  assert(report.hermetic.allowlisted_env_keys.includes("CODEX_HOME"), "allowlist must include CODEX_HOME");
  if (report.hermetic.codex_home_retention) {
    const retention = report.hermetic.codex_home_retention;
    assert(typeof retention.manifest_path === "string" && retention.manifest_path.length > 0);
    assert.equal(typeof retention.keep_codex_homes, "boolean");
    assert.equal(retention.home_count, retention.retained_home_count + retention.pruned_home_count);
    assert(Number.isInteger(retention.retained_bytes));
    assert(Number.isInteger(retention.pruned_bytes));
  }
  // Auth-mode contract: subscription mode must not leak API-key env into the child.
  if (report.auth_mode !== "api-key") {
    assert(!report.hermetic.allowlisted_env_keys.includes("CODEX_API_KEY"), "subscription mode must not forward CODEX_API_KEY");
    assert(!report.hermetic.allowlisted_env_keys.includes("OPENAI_API_KEY"), "subscription mode must not forward OPENAI_API_KEY");
  }
  // A2: control_profile is recorded at the report top level, in configuration,
  // and on every scenario, and is internally consistent.
  assert(validControlProfiles.includes(report.control_profile), `invalid report control_profile: ${report.control_profile}`);
  assert.equal(report.configuration.control_profile, report.control_profile);
  assert(report.configuration && Number.isInteger(report.configuration.runs));
  assert(typeof report.configuration.manifest_fingerprint === "string" && report.configuration.manifest_fingerprint.length === 64);
  if (Object.hasOwn(report.configuration, "full_manifest_fingerprint")) {
    assert(typeof report.configuration.full_manifest_fingerprint === "string" && report.configuration.full_manifest_fingerprint.length === 64);
  }
  assert(typeof report.configuration.scenario_matrix_fingerprint === "string" && report.configuration.scenario_matrix_fingerprint.length === 64);
  assert(Array.isArray(report.configuration.selected_scales));
  assert(Array.isArray(report.configuration.selected_tasks));
  assert.equal(report.configuration.scenario_order, "deterministic-alternating-pairs");
  assert(Array.isArray(report.scenarios));
  assert(report.scenarios.length > 0);
  assert.equal(report.configuration.selected_scenarios, report.scenarios.length);
  assert(report.configuration.total_manifest_scenarios >= report.configuration.selected_scenarios);
  assert(report.configuration.max_scenarios >= conditions.length);

  let passedCorrectnessCount = 0;
  let needsReviewCount = 0;
  let failedCorrectnessCount = 0;
  let claimableScenarioCount = 0;
  let unclaimableScenarioCount = 0;

  for (const scenario of report.scenarios) {
    assert(Array.isArray(scenario.runs));
    assert(scenario.runs.length > 0);
    assertValidTrackTag(scenario.benchmark_track);
    // Corpus dimension on every scenario. Synthetic scenarios carry null repo
    // fields; real scenarios carry strings plus the with-arm mcp_injected flag.
    assert(["synthetic", "real"].includes(scenario.corpus), `scenario ${scenario.prompt_id} invalid corpus ${scenario.corpus}`);
    if (scenario.corpus === "real") {
      assert(typeof scenario.repo === "string" && scenario.repo.length > 0, `real scenario ${scenario.prompt_id} needs a repo`);
      assert(typeof scenario.repo_sha === "string" && scenario.repo_sha.length > 0, `real scenario ${scenario.prompt_id} needs a repo_sha`);
      assert(typeof scenario.question_id === "string" && scenario.question_id.length > 0, `real scenario ${scenario.prompt_id} needs a question_id`);
      assert.equal(typeof scenario.mcp_injected, "boolean", `real scenario ${scenario.prompt_id} needs an mcp_injected flag`);
      // MCP is injected on the with arm only.
      assert.equal(scenario.mcp_injected, scenario.condition === "with_project_librarian", `real scenario ${scenario.prompt_id} mcp_injected must be true only on the with arm`);
    } else {
      assert.equal(scenario.repo, null);
      assert.equal(scenario.repo_sha, null);
      assert.equal(scenario.question_id, null);
      assert.equal(scenario.mcp_injected, false, "synthetic scenarios never inject MCP");
    }
    // The control profile is uniform within the synthetic corpus; the real corpus
    // records its own organic profile (it has no synthetic control profiles).
    if (scenario.corpus === "synthetic") {
      assert.equal(scenario.control_profile, report.control_profile);
    }
    assert(Object.hasOwn(scenario, "expectation"));
    if (scenario.benchmark_track === "code_graph") {
      assert(scenario.expectation && Array.isArray(scenario.expectation.required_terms), `code_graph scenario ${scenario.prompt_id} missing expectation`);
    } else if (scenario.task_family === "aggregation") {
      // A3 aggregation carries a manifest-borne aggregate-component expectation.
      assert(scenario.expectation && Array.isArray(scenario.expectation.required_terms), `aggregation scenario ${scenario.prompt_id} missing expectation`);
      assert(Array.isArray(scenario.expectation.aggregate_components) && scenario.expectation.aggregate_components.length >= 2);
    } else {
      assert.equal(scenario.expectation, null);
    }
    // A3 multi_session: the scenario surfaces session_count, a session prompt/command
    // list, and a per-run session_metrics array so session-1 (familiarization) is
    // reported separately from session-2 (measured). The scenario's headline metrics
    // are session-2's, mirrored on each run.
    if (scenario.task_family === "multi_session") {
      assert.equal(scenario.session_count, 2);
      assert(Array.isArray(scenario.sessions) && scenario.sessions.length === 2);
      assert.deepEqual(scenario.sessions.map((session) => session.role), ["familiarization", "measured"]);
      assert(Array.isArray(scenario.session_metrics) && scenario.session_metrics.length === scenario.runs.length);
    } else {
      assert.equal(Object.hasOwn(scenario, "session_count"), false, `${scenario.prompt_id} should not carry session_count`);
      assert.equal(Object.hasOwn(scenario, "session_metrics"), false, `${scenario.prompt_id} should not carry session_metrics`);
    }
    assert(typeof scenario.prompt === "string" && scenario.prompt.length > 0);
    assert(Array.isArray(scenario.command) && scenario.command.length > 0);
    assert(Object.hasOwn(scenario, "median"));
    assert(scenario.median_all_runs);
    assert(Array.isArray(scenario.correctness));
    assert.equal(scenario.correctness.length, scenario.runs.length);
    assert.deepEqual(scenario.raw_jsonl_paths, scenario.runs.map((run) => run.raw_jsonl_path));
    assert(Number.isInteger(scenario.passed_run_count));
    assert(Number.isInteger(scenario.claimable_run_count));
    assert(Array.isArray(scenario.models));
    // Synthetic scenarios carry a content-hash fingerprint; real scenarios carry a
    // pinned-sha + git-clean fingerprint (a full-file hash of a large repo is
    // impractical). Each is validated for its own algorithm.
    if (scenario.corpus === "real") {
      assert(scenario.fixture_fingerprint && scenario.fixture_fingerprint.algorithm === "pinned-sha-git-clean" && scenario.fixture_fingerprint.value, `real scenario ${scenario.prompt_id} needs a pinned-sha fingerprint`);
      assert.equal(scenario.fixture_fingerprint.repo_sha, scenario.repo_sha, `real scenario ${scenario.prompt_id} fingerprint repo_sha must match the scenario repo_sha`);
    } else {
      assert(scenario.fixture_fingerprint && scenario.fixture_fingerprint.algorithm === "sha256-relative-path-content" && scenario.fixture_fingerprint.value);
      if (scenario.cwd && fs.existsSync(scenario.cwd)) {
        assert.deepEqual(scenario.fixture_fingerprint, fingerprintDirectory(scenario.cwd));
      }
    }
    assert(Object.hasOwn(scenario, "requested_model"));
    assert(Object.hasOwn(scenario, "model_source"));
    assert(scenario.dispersion_all_runs);

    let passedRunCount = 0;
    const runModels = new Set();
    for (const [index, run] of scenario.runs.entries()) {
      assert(run.metrics);
      assert(run.execution && ["completed", "failed"].includes(run.execution.status));
      // A5: every measured run carries a post-run fixture validation record. A
      // written report only exists when validation did not throw, so the recorded
      // state must be clean. The synthetic record carries runtime_state_paths +
      // fingerprint_matched; the real-corpus record carries pinned_sha_matched +
      // git_clean + new_untracked_runtime_state_paths (pinned-sha + git-clean checks).
      assert(run.fixture_validation && typeof run.fixture_validation === "object", `run ${run.run_index} missing fixture_validation`);
      assert.equal(run.fixture_validation.status, "clean");
      if (scenario.corpus === "real") {
        assert.equal(run.fixture_validation.pinned_sha_matched, true);
        assert.equal(run.fixture_validation.git_clean, true);
        assert.deepEqual(run.fixture_validation.new_untracked_runtime_state_paths, []);
      } else {
        assert.deepEqual(run.fixture_validation.runtime_state_paths, []);
        assert.equal(run.fixture_validation.fingerprint_matched, true);
      }
      assert.equal(run.requested_model, scenario.requested_model);
      const rawPath = path.resolve(root, run.raw_jsonl_path);
      assert(fs.existsSync(rawPath), `missing raw JSONL: ${run.raw_jsonl_path}`);
      const rawMetrics = summarizeJsonl(fs.readFileSync(rawPath, "utf8"), { wall_ms: run.metrics.wall_ms });
      assert.deepEqual(run.metrics, rawMetrics);
      // A3 multi_session run shape and session-2 sourcing. The run carries a
      // session_metrics array with both sessions; the measured session (session 2)
      // is the run's primary metrics, raw JSONL path, and execution. Each session's
      // metrics recompute from its own raw JSONL, so session 1 (familiarization) is
      // validated separately from session 2 and the two are not conflated.
      if (scenario.task_family === "multi_session") {
        assert(Array.isArray(run.session_metrics) && run.session_metrics.length === 2, `multi_session run ${run.run_index} must carry two session metrics`);
        assert.deepEqual(run.session_metrics.map((session) => session.role), ["familiarization", "measured"]);
        const measured = run.session_metrics.find((session) => session.role === "measured");
        assert.equal(run.measured_session_index, measured.session_index);
        // Primary metrics/raw path come from the measured session (session 2).
        assert.equal(run.raw_jsonl_path, measured.raw_jsonl_path, "multi_session run raw path must be the measured session's");
        assert.deepEqual(run.metrics, measured.metrics, "multi_session run metrics must be the measured session's (session 2)");
        // Each session's metrics recompute from its own raw JSONL.
        for (const session of run.session_metrics) {
          const sessionRaw = path.resolve(root, session.raw_jsonl_path);
          assert(fs.existsSync(sessionRaw), `missing session raw JSONL: ${session.raw_jsonl_path}`);
          assert.deepEqual(session.metrics, summarizeJsonl(fs.readFileSync(sessionRaw, "utf8"), { wall_ms: session.metrics.wall_ms }), `session ${session.session_index} metrics must recompute from raw JSONL`);
          assert(session.execution && ["completed", "failed"].includes(session.execution.status));
        }
        // Session-1 and session-2 raw paths must differ so the separation is real.
        assert.notEqual(run.session_metrics[0].raw_jsonl_path, run.session_metrics[1].raw_jsonl_path, "the two sessions must have distinct raw JSONL paths");
        // The scenario's per-run session_metrics summary mirrors the run's sessions.
        const scenarioSessionRecord = scenario.session_metrics[index];
        assert.equal(scenarioSessionRecord.run_index, run.run_index);
        assert.equal(scenarioSessionRecord.measured_session_index, run.measured_session_index);
        assert.deepEqual(scenarioSessionRecord.sessions, run.session_metrics);
      } else {
        assert.equal(Object.hasOwn(run, "session_metrics"), false, `${scenario.prompt_id} run should not carry session_metrics`);
      }
      assert(Number.isInteger(run.metrics.command_invocation_count));
      assert(Number.isInteger(run.metrics.tool_invocation_count));
      assert(Number.isInteger(run.metrics.plan_event_count));
      assert(typeof run.metrics.first_response_ms === "number");
      assert(Array.isArray(run.metrics.models));
      if (run.metrics.first_response_ms === 0) assert(run.metrics.unavailable_event_fields.includes("first_response_latency"));
      for (const model of run.metrics.models) runModels.add(model);
      if (run.metrics.models.length === 0) assert(run.metrics.unavailable_event_fields.includes("model"));
      if (run.metrics.models.length === 1) assert.equal(run.metrics.model, run.metrics.models[0]);
      if (run.metrics.models.length > 1) assert(run.metrics.unavailable_event_fields.includes("single_model"));
      const expectedCorrectness = evaluateCorrectness({
        taskFamily: scenario.task_family,
        condition: scenario.condition,
        finalText: run.metrics.final_text,
        fileChangeCount: run.metrics.file_change_event_count,
        readOnly: true,
        expectation: scenario.expectation || null,
        controlProfile: scenario.control_profile || "organic",
        benchmarkTrack: scenario.benchmark_track,
      });
      assert.deepEqual(scenario.correctness[index], expectedCorrectness);
      assert.deepEqual(run.correctness, expectedCorrectness);
      assert.deepEqual(run.measurement, measurementStatus(run));
      if (expectedCorrectness.status === "passed") {
        passedRunCount += 1;
        assert(expectedCorrectness.checks.length > 0);
      }
    }

    const actualClaimableRuns = claimableRuns(scenario.runs);
    const observedModels = [...runModels];
    const expectedScenarioModels = observedModels.length > 0 ? observedModels : (scenario.requested_model ? [scenario.requested_model] : []);
    assert.deepEqual(scenario.models, expectedScenarioModels);
    if (scenario.models.length === 1) assert.equal(scenario.model, scenario.models[0]);
    if (scenario.models.length !== 1) assert.equal(scenario.model, null);
    assert.equal(scenario.model_source, observedModels.length === 1 ? "jsonl" : (scenario.requested_model ? "requested" : null));
    assert.equal(scenario.passed_run_count, passedRunCount);
    assert.equal(scenario.claimable_run_count, actualClaimableRuns.length);
    assert.deepEqual(scenario.median_all_runs, medianMetrics(scenario.runs));
    assert.deepEqual(scenario.median, actualClaimableRuns.length > 0 ? medianMetrics(actualClaimableRuns) : null);
    // A4: the claimable median carries the derived cost fields (they are part of the
    // metricFields aggregated by medianMetrics), and the cost-weighted headline for
    // the median is recomputable from its components and the report discount.
    if (scenario.median) {
      assert(Number.isFinite(scenario.median.uncached_input_tokens), `${scenario.prompt_id} median missing uncached_input_tokens`);
      assert(Number.isFinite(scenario.median.tool_output_bytes), `${scenario.prompt_id} median missing tool_output_bytes`);
      assert(Number.isFinite(scenario.median.request_count_estimate), `${scenario.prompt_id} median missing request_count_estimate`);
      const expectedCostWeighted = scenario.median.uncached_input_tokens
        + report.cache_discount * scenario.median.cached_input_tokens
        + scenario.median.output_tokens
        + scenario.median.reasoning_output_tokens;
      assert.equal(costWeightedTokens(scenario.median, report.cache_discount), expectedCostWeighted);
    }
    assert.deepEqual(scenario.dispersion_all_runs, metricStats(scenario.runs));
    assert.deepEqual(scenario.dispersion, actualClaimableRuns.length > 0 ? metricStats(actualClaimableRuns) : null);
    if (actualClaimableRuns.length === 0) assert.equal(scenario.median, null);
    if (scenario.correctness.every((item) => item.status === "passed")) passedCorrectnessCount += 1;
    if (scenario.correctness.some((item) => item.status === "needs_review")) needsReviewCount += 1;
    if (scenario.correctness.some((item) => item.status === "failed")) failedCorrectnessCount += 1;
    if (actualClaimableRuns.length > 0) claimableScenarioCount += 1;
    if (actualClaimableRuns.length === 0) unclaimableScenarioCount += 1;
  }

  assert.equal(report.summary.scenario_count, report.scenarios.length);
  assert.equal(report.summary.comparison_pair_count, completePairCount(report.scenarios, conditions));
  assert.equal(report.summary.comparison_pair_count * conditions.length, report.scenarios.length);
  assert.equal(report.summary.passed_correctness_count, passedCorrectnessCount);
  assert.equal(report.summary.needs_review_count, needsReviewCount);
  assert.equal(report.summary.failed_correctness_count, failedCorrectnessCount);
  assert.equal(report.summary.claimable_scenario_count, claimableScenarioCount);
  assert.equal(report.summary.unclaimable_scenario_count, unclaimableScenarioCount);
  assert.equal(report.configuration.scenario_matrix_fingerprint, sha256(JSON.stringify(report.scenarios.map((scenario) => ({
    scale: scenario.scale,
    condition: scenario.condition,
    task_family: scenario.task_family,
    fixture_fingerprint: scenario.fixture_fingerprint,
    requested_model: scenario.requested_model,
  })))));
  assert.equal(report.configuration.manifest_fingerprint, sha256(JSON.stringify(report.scenarios.map((scenario) => ({
    scale: scenario.scale,
    condition: scenario.condition,
    task_family: scenario.task_family,
    prompt: scenario.prompt,
    fixture_fingerprint: scenario.fixture_fingerprint,
    requested_model: scenario.requested_model,
  })))));
  // Per-track structure: benchmark_tracks lists present tracks; report.tracks
  // carries a per-track summary and per-track claim gate. Recompute the overall
  // and per-track claim gates from scenarios and assert they match the report.
  const presentTracks = tracksPresent(report.scenarios);
  assert(Array.isArray(report.benchmark_tracks));
  assert.deepEqual(report.benchmark_tracks, presentTracks);
  assert(report.tracks && typeof report.tracks === "object");
  const expectedTasksByTrack = {};
  for (const track of presentTracks) {
    assert(report.tracks[track], `missing report.tracks.${track}`);
    const trackScenarios = scenariosForTrack(report.scenarios, track);
    // Recompute per-track summary from the scenario subset.
    assert.equal(report.tracks[track].summary.scenario_count, trackScenarios.length);
    assert.equal(report.tracks[track].summary.comparison_pair_count, completePairCount(trackScenarios, conditions));
    assert.deepEqual(report.tracks[track].prompt_ids, trackScenarios.map((scenario) => scenario.prompt_id));
    assert(Array.isArray(report.tracks[track].expected_tasks));
    expectedTasksByTrack[track] = report.tracks[track].expected_tasks;
  }

  const expectedOverallGate = evaluateTracksClaimGate(report, {
    conditions,
    expectedScales: report.configuration.selected_scales,
    expectedTasksByTrack,
    fullMatrix: report.configuration.full_matrix,
    minRunsForClaim: report.configuration.min_runs_for_claim,
  });
  assert.deepEqual(report.claim_gate, expectedOverallGate);
  // The overall gate passes only if every present track passes.
  const allTracksPassed = presentTracks.every((track) => report.claim_gate.per_track[track].status === "passed");
  assert.equal(report.claim_gate.status, allTracksPassed ? "passed" : "failed");
  for (const track of presentTracks) {
    assert.deepEqual(report.tracks[track].claim_gate, report.claim_gate.per_track[track]);
    // Per-corpus structure within each track: report.tracks[track].corpora lists
    // the corpora present in that track, each with its own summary and per-corpus
    // claim gate; the track claim gate carries a per_corpus breakdown. Real and
    // synthetic are reported SEPARATELY (the corpus split discipline).
    const trackScenariosForCorpus = scenariosForTrack(report.scenarios, track);
    const corpora = corporaPresent(trackScenariosForCorpus);
    assert.deepEqual(report.tracks[track].corpora_present, corpora);
    assert(report.tracks[track].corpora && typeof report.tracks[track].corpora === "object");
    assert.deepEqual(Object.keys(report.claim_gate.per_track[track].per_corpus).sort(), [...corpora].sort());
    for (const corpus of corpora) {
      const corpusScenarios = scenariosForTrackCorpus(report.scenarios, track, corpus);
      assert(report.tracks[track].corpora[corpus], `missing report.tracks.${track}.corpora.${corpus}`);
      assert.equal(report.tracks[track].corpora[corpus].summary.scenario_count, corpusScenarios.length);
      assert.deepEqual(report.tracks[track].corpora[corpus].prompt_ids, corpusScenarios.map((scenario) => scenario.prompt_id));
      // The per-corpus claim gate in tracks matches the overall gate's per_corpus.
      assert.deepEqual(report.tracks[track].corpora[corpus].claim_gate, report.claim_gate.per_track[track].per_corpus[corpus]);
    }
    // A track passes only if every corpus in it passes.
    const trackCorporaPassed = corpora.every((corpus) => report.claim_gate.per_track[track].per_corpus[corpus].status === "passed");
    assert.equal(report.claim_gate.per_track[track].status, trackCorporaPassed ? "passed" : "failed");
  }

  const markdown = renderLlmMarkdownReport(report);
  assert(markdown.includes("# Codex Actual LLM Benchmark Report"));
  assert(markdown.includes(`Overall claim gate: ${report.claim_gate.status}`));
  // Separate per-track sections, no merged cross-track headline.
  assert(markdown.includes("Tracks are reported separately"));
  // A4: the per-track headline is the cost-weighted delta, and the report states
  // the cache discount it used. Merged total tokens is rendered only as a labeled
  // secondary, never a headline.
  assert(markdown.includes("Headline metric per track: cost-weighted tokens"));
  assert(markdown.includes(`cache discount ${report.cache_discount}`), "Markdown must state the cache discount used");
  // Within each track, the Markdown renders SEPARATE per-corpus subsections so real
  // and synthetic results are never merged into one table. Each (track, corpus)
  // subsection carries its own scenario-metrics, cost-weighted headline delta, and
  // labeled-secondary merged-total tables.
  for (const track of presentTracks) {
    const title = track === "wiki" ? "Wiki Track" : "Code Graph Track";
    assert(markdown.includes(`## ${title}`));
    assert(markdown.includes("Real-corpus and synthetic results are never merged into one number."));
    const corpora = corporaPresent(scenariosForTrack(report.scenarios, track));
    for (const corpus of corpora) {
      const corpusTitle = corpus === "synthetic" ? "Synthetic Corpus" : (corpus === "real" ? "Real Corpus" : `${corpus} Corpus`);
      const heading = `${title} — ${corpusTitle}`;
      assert(markdown.includes(`### ${heading}`), `missing subsection heading ${heading}`);
      assert(markdown.includes(`#### ${heading} Scenario Metrics`), `missing ${heading} scenario metrics`);
      // The delta table is the cost-weighted headline for this corpus.
      assert(markdown.includes(`#### ${heading} With vs Without Delta (headline: cost-weighted)`), `${heading} headline must be cost-weighted`);
      // Merged total tokens is present only as a secondary, explicitly labeled.
      assert(markdown.includes(`#### ${heading} Merged Total Tokens (secondary, not a headline)`), `${heading} merged total must be labeled secondary`);
    }
  }
  assert(markdown.includes("Cost-Weighted Delta"));
  // The merged-total section must label itself secondary and defer to cost-weighted.
  assert(markdown.includes("Secondary only: merged total tokens counts cached resends at full weight"));
  // The recomputed discount used by the renderer matches the report's recorded one.
  assert.equal(resolveCacheDiscount(report), report.cache_discount);
}

function validateCorrectness() {
  const passed = evaluateCorrectness({
    taskFamily: "decision_lookup",
    condition: "with_project_librarian",
    finalText: sampleFinalText,
    fileChangeCount: 0,
  });
  assert.equal(passed.status, "passed");

  const needsReview = evaluateCorrectness({
    taskFamily: "decision_lookup",
    condition: "with_project_librarian",
    finalText: "",
    fileChangeCount: 0,
  });
  assert.equal(needsReview.status, "needs_review");
}

function validateMeasurementClaimability() {
  const correctness = {
    status: "passed",
    reason: "",
    checks: [{ name: "synthetic correctness", passed: true }],
  };
  const unclaimable = measurementStatus({
    correctness,
    metrics: summarizeJsonl(JSON.stringify({
      type: "assistant.message",
      message: sampleFinalText,
    }), { wall_ms: 1000 }),
  });
  assert.equal(unclaimable.status, "unclaimable");
  assert(unclaimable.reason.includes("usage available"));
  assert(unclaimable.reason.includes("model available"));

  const claimable = measurementStatus({
    correctness,
    metrics: summarizeJsonl(JSON.stringify({
      type: "turn.completed",
      model: "gpt-5.5",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
      message: sampleFinalText,
    }), { wall_ms: 1000 }),
  });
  assert.equal(claimable.status, "claimable");

  const claimableWithRequestedModel = measurementStatus({
    correctness,
    requested_model: "gpt-test",
    metrics: summarizeJsonl(JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
      message: sampleFinalText,
    }), { wall_ms: 1000 }),
  });
  assert.equal(claimableWithRequestedModel.status, "claimable");
}

function validateRawRetention() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-raw-retention-"));
  try {
    const rawRoot = path.join(tempRoot, "raw");
    const rawJsonl = path.join(rawRoot, "sample-run-1.jsonl");
    const stderrPath = path.join(rawRoot, "sample-run-1.stderr.txt");
    const home = path.join(rawRoot, "codex-home");
    fs.mkdirSync(path.join(home, ".tmp", "plugins", ".git", "objects", "pack"), { recursive: true });
    fs.writeFileSync(rawJsonl, `${JSON.stringify({ type: "assistant.message", message: "ok" })}\n`);
    fs.writeFileSync(stderrPath, "stderr\n");
    fs.writeFileSync(path.join(home, "auth.json"), "{}\n");
    fs.writeFileSync(path.join(home, ".tmp", "plugins", ".git", "objects", "pack", "pack-a.pack"), Buffer.alloc(1024));

    const pruned = applyCodexHomeRetention({ rawRoot, homePaths: [home], keepCodexHomes: false });
    assert.equal(pruned.home_count, 1);
    assert.equal(pruned.pruned_home_count, 1);
    assert(pruned.pruned_bytes >= 1024);
    assert(fs.existsSync(pruned.manifest_path), "retention manifest should remain after pruning homes");
    assert(!fs.existsSync(home), "codex home should be pruned by default");
    assert(fs.existsSync(rawJsonl), "raw JSONL must survive codex-home pruning");
    assert(fs.existsSync(stderrPath), "stderr must survive codex-home pruning");

    const keepRawRoot = path.join(tempRoot, "keep-raw");
    const keepHome = path.join(keepRawRoot, "codex-home");
    fs.mkdirSync(keepHome, { recursive: true });
    fs.writeFileSync(path.join(keepHome, "auth.json"), "{}\n");
    const kept = applyCodexHomeRetention({ rawRoot: keepRawRoot, homePaths: [keepHome], keepCodexHomes: true });
    assert.equal(kept.retained_home_count, 1);
    assert.equal(kept.pruned_home_count, 0);
    assert(fs.existsSync(keepHome), "codex home should remain when explicitly retained");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function validateCliArgumentFailures() {
  for (const args of [
    ["benchmarks/codex-llm-metrics.js", "--dry-run", "--scales", ","],
    ["benchmarks/codex-llm-metrics.js", "--dry-run", "--tasks", ","],
    ["benchmarks/codex-llm-metrics.js", "--dry-run", "--scales", "small,medium,large", "--tasks", "decision_lookup", "--full-matrix", "--max-scenarios", "2"],
    ["benchmarks/codex-llm-metrics.js"],
  ]) {
    const result = childProcess.spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.notEqual(result.status, 0);
  }
}

const reportPath = process.argv[2];
validateSampleJsonl();
validateControlSampleJsonl();
validateCodeGraphSampleJsonl();
validateMultiSessionSampleJsonl();
validateAggregationSampleJsonl();
validateReasoningTokenTotal();
validateInvocationCounts();
validatePairSelectionOrder();
validateCorrectness();
validateMeasurementClaimability();
validateRawRetention();
validateCliArgumentFailures();
if (reportPath) validateReport(path.resolve(reportPath));
console.log("codex llm benchmark smoke ok");
