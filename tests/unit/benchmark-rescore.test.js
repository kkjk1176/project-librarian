"use strict";

// Offline rescore path tests: exercises `node benchmarks/codex-llm-metrics.js --rescore`
// without any codex execution.  A mini-report fixture with stub raw JSONL files is
// constructed in tmp; the rescore re-reads those JSONL files with the CURRENT evaluator
// and writes a new -rescored.json alongside the original (which is never modified).
//
// Tests demonstrate a fail→pass flip when the evaluator is fixed (FP1 real-corpus
// condition evidence, FP2 rule-chain designation).  The original report files under
// benchmarks/reports/llm/ are NOT touched; those are immutable.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const metricsScript = path.join(root, "benchmarks", "codex-llm-metrics.js");

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

// Build a minimal JSONL string matching the shape codex outputs so that
// summarizeJsonl can extract a final_text from it.
function buildMinimalJsonl(finalText) {
  const lines = [
    // A minimal session_started event.
    JSON.stringify({ type: "session_started", session_id: "s1" }),
    // A message completion event that carries the final text.
    JSON.stringify({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: finalText }],
    }),
    // A turn completion event.
    JSON.stringify({ type: "agent_turn_complete" }),
  ];
  return lines.join("\n") + "\n";
}

// Stub scenario for a synthetic code_graph ownership_lookup.
// The first correctness pass has wrong final designation → stored as "failed".
// After rescore the evaluator should see the correct answer from the JSONL stub and pass.
function buildSyntheticOwnershipScenario(rawDir) {
  // The stored "failed" run: stored correctness says failed (simulates old evaluator result).
  // The raw JSONL carries the CORRECT answer — rescore must re-evaluate from JSONL.
  const correctFinalText = [
    "The effective owner of packages/workspace-0/src/service/main.go is @benchmark-service-team.",
    "",
    "CODEOWNERS chain:",
    "- `* @benchmark-org-default` matches",
    "- `*.go @go-benchmark-team` matches",
    "- `/packages/workspace-0/src/service/ @benchmark-service-team` matches (last match, wins)",
  ].join("\n");

  const rawPath = path.join(rawDir, "ownership-stub-with-run-1.jsonl");
  writeText(rawPath, buildMinimalJsonl(correctFinalText));

  return {
    scale: "small",
    condition: "with_project_librarian",
    benchmark_track: "code_graph",
    corpus: "synthetic",
    repo: null,
    repo_sha: null,
    question_id: null,
    mcp_injected: false,
    control_profile: "organic",
    task_family: "ownership_lookup",
    prompt_id: "stub-ownership-with",
    prompt: "stub prompt",
    command: ["codex", "exec", "stub"],
    cwd: rawDir,
    expectation: {
      required_terms: ["@benchmark-service-team"],
      any_terms: [["last match", "last-match", "last matching", "precedence", "wins", "CODEOWNERS"]],
      forbidden_terms: ["I cannot access"],
      designation_forbidden: [
        { team: "@go-benchmark-team", correct_owner: "@benchmark-service-team" },
      ],
    },
    fixture_fingerprint: { algorithm: "content-hash", value: "stub" },
    requested_model: "stub-model",
    model: "stub-model",
    model_source: "requested",
    models: ["stub-model"],
    runs: [
      {
        run_index: 1,
        raw_jsonl_path: rawPath,
        requested_model: "stub-model",
        execution: { status: "completed", exit_code: 0, error: "", stderr_path: null },
        metrics: {
          input_tokens: 100,
          cached_input_tokens: 0,
          uncached_input_tokens: 100,
          output_tokens: 50,
          reasoning_output_tokens: 0,
          total_tokens: 150,
          tool_output_bytes: 0,
          request_count_estimate: 1,
          wall_ms: 1000,
          first_response_ms: 0,
          tokens_per_second: 50,
          codex_turn_count: 1,
          jsonl_event_count: 3,
          command_event_count: 0,
          command_invocation_count: 0,
          tool_event_count: 0,
          tool_invocation_count: 0,
          mcp_event_count: 0,
          mcp_invocation_count: 0,
          plan_event_count: 0,
          file_change_event_count: 0,
          error_event_count: 0,
          // Deliberately store empty final_text to simulate the stored-report shape
          // (real reports strip final_text from stored runs).
          final_text: "",
          model: "stub-model",
          models: ["stub-model"],
          unavailable_event_fields: [],
        },
        // Stored as failed (old evaluator verdict — this is what rescore must flip).
        correctness: {
          status: "failed",
          reason: "1 correctness checks failed",
          checks: [
            { name: "required term: @benchmark-service-team", passed: false },
            { name: "not designated owner: @go-benchmark-team", passed: false },
          ],
        },
        fixture_validation: { status: "ok" },
        measurement: { status: "unclaimable", reasons: ["correctness: failed"] },
      },
    ],
    passed_run_count: 0,
    claimable_run_count: 0,
    correctness: [{ status: "failed", reason: "1 correctness checks failed", checks: [] }],
    median: null,
    median_all_runs: { input_tokens: 100, total_tokens: 150, wall_ms: 1000 },
    dispersion: null,
    dispersion_all_runs: {},
  };
}

// Matching control scenario (without_project_librarian) with a passing stored result.
function buildSyntheticOwnershipControlScenario(rawDir) {
  const controlText = [
    "@benchmark-service-team owns /packages/workspace-0/src/service/ (last-match precedence).",
    "CODEOWNERS lines: * @benchmark-org-default, *.go @go-benchmark-team, /packages/workspace-0/src/service/ @benchmark-service-team.",
  ].join("\n");

  const rawPath = path.join(rawDir, "ownership-stub-without-run-1.jsonl");
  writeText(rawPath, buildMinimalJsonl(controlText));

  return {
    scale: "small",
    condition: "without_project_librarian",
    benchmark_track: "code_graph",
    corpus: "synthetic",
    repo: null,
    repo_sha: null,
    question_id: null,
    mcp_injected: false,
    control_profile: "organic",
    task_family: "ownership_lookup",
    prompt_id: "stub-ownership-without",
    prompt: "stub prompt",
    command: ["codex", "exec", "stub"],
    cwd: rawDir,
    expectation: {
      required_terms: ["@benchmark-service-team"],
      any_terms: [["last match", "last-match", "last matching", "precedence", "wins", "CODEOWNERS"]],
      forbidden_terms: ["I cannot access"],
      designation_forbidden: [
        { team: "@go-benchmark-team", correct_owner: "@benchmark-service-team" },
      ],
    },
    fixture_fingerprint: { algorithm: "content-hash", value: "stub" },
    requested_model: "stub-model",
    model: "stub-model",
    model_source: "requested",
    models: ["stub-model"],
    runs: [
      {
        run_index: 1,
        raw_jsonl_path: rawPath,
        requested_model: "stub-model",
        execution: { status: "completed", exit_code: 0, error: "", stderr_path: null },
        metrics: {
          input_tokens: 90,
          cached_input_tokens: 0,
          uncached_input_tokens: 90,
          output_tokens: 45,
          reasoning_output_tokens: 0,
          total_tokens: 135,
          tool_output_bytes: 0,
          request_count_estimate: 1,
          wall_ms: 900,
          first_response_ms: 0,
          tokens_per_second: 45,
          codex_turn_count: 1,
          jsonl_event_count: 3,
          command_event_count: 0,
          command_invocation_count: 0,
          tool_event_count: 0,
          tool_invocation_count: 0,
          mcp_event_count: 0,
          mcp_invocation_count: 0,
          plan_event_count: 0,
          file_change_event_count: 0,
          error_event_count: 0,
          final_text: "",
          model: "stub-model",
          models: ["stub-model"],
          unavailable_event_fields: [],
        },
        correctness: {
          status: "passed",
          reason: "",
          checks: [{ name: "required term: @benchmark-service-team", passed: true }],
        },
        fixture_validation: { status: "ok" },
        measurement: { status: "claimable" },
      },
    ],
    passed_run_count: 1,
    claimable_run_count: 1,
    correctness: [{ status: "passed", reason: "", checks: [] }],
    median: { input_tokens: 90, total_tokens: 135, wall_ms: 900 },
    median_all_runs: { input_tokens: 90, total_tokens: 135, wall_ms: 900 },
    dispersion: {},
    dispersion_all_runs: {},
  };
}

function buildMiniReport(rawDir, scenarios) {
  return {
    schema_version: 7,
    benchmark_kind: "codex-actual-llm",
    auth_mode: "chatgpt_codex",
    auth: { auth_mode_source: "declared", code_api_key_present: false, openai_api_key_present: false, codex_home_set: false },
    generated_at: "2026-06-12T00:00:00.000Z",
    environment: { node: process.version, platform: "darwin", arch: "arm64", os_release: "25.5.0", cpu_model: "stub", cpu_count: 4, total_memory_mb: 8192 },
    source_control: { available: false },
    control_profile: "organic",
    corpus: "synthetic",
    cache_discount: 0.1,
    hermetic: {
      isolated_codex_home: rawDir,
      real_codex_home: rawDir,
      auth_source: rawDir,
      copied_files: [],
      allowlisted_env_keys: ["HOME", "PATH"],
      allowlisted_env_key_count: 2,
      inherited_process_env: false,
    },
    codex: { version: "stub-codex 0.0.0" },
    configuration: {
      runs: 1,
      warmup_runs: 0,
      max_scenarios: 2,
      full_matrix: false,
      min_runs_for_claim: 1,
      require_claimable: false,
      require_clean: false,
      control_profile: "organic",
      cache_discount: 0.1,
      scenario_order: "deterministic-alternating-pairs",
      requested_model: "stub-model",
      selected_scales: ["small"],
      selected_tasks: ["ownership_lookup"],
      selected_scenarios: scenarios.length,
      total_manifest_scenarios: scenarios.length,
      full_manifest_fingerprint: "stub-fingerprint",
      manifest_fingerprint: "stub-fingerprint",
      scenario_matrix_fingerprint: "stub-fingerprint",
    },
    benchmark_tracks: ["code_graph"],
    summary: {
      scenario_count: scenarios.length,
      comparison_pair_count: 1,
      passed_correctness_count: 1,
      needs_review_count: 0,
      failed_correctness_count: 1,
      claimable_scenario_count: 1,
      unclaimable_scenario_count: 1,
    },
    scenarios,
    tracks: {
      code_graph: {
        benchmark_track: "code_graph",
        expected_tasks: ["ownership_lookup"],
        summary: { scenario_count: 2, comparison_pair_count: 1, passed_correctness_count: 1, needs_review_count: 0, failed_correctness_count: 1, claimable_scenario_count: 1, unclaimable_scenario_count: 1 },
        prompt_ids: scenarios.map((s) => s.prompt_id),
        corpora_present: ["synthetic"],
        corpora: {
          synthetic: {
            corpus: "synthetic",
            summary: { scenario_count: 2, comparison_pair_count: 1, passed_correctness_count: 1, needs_review_count: 0, failed_correctness_count: 1, claimable_scenario_count: 1, unclaimable_scenario_count: 1 },
            prompt_ids: scenarios.map((s) => s.prompt_id),
            claim_gate: { status: "failed", issues: ["code_graph/synthetic: 1 of 1 pairs unclaimable (with: 0 claimable, without: 1 claimable)"] },
          },
        },
        claim_gate: { status: "failed", issues: ["code_graph: 1 of 1 pairs unclaimable"] },
      },
    },
    claim_gate: { status: "failed", issues: ["code_graph: 1 of 1 pairs unclaimable"] },
  };
}

function runRescore(reportPath) {
  const result = childProcess.spawnSync(
    process.execPath,
    [metricsScript, "--rescore", reportPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return result;
}

test("rescore: --rescore rewrites correctness from raw JSONL (fail→pass flip) and writes -rescored.json", () => {
  const tmpDir = makeTmpDir("rescore-test-");
  try {
    const rawDir = path.join(tmpDir, "raw");
    fs.mkdirSync(rawDir, { recursive: true });

    const withScenario = buildSyntheticOwnershipScenario(rawDir);
    const withoutScenario = buildSyntheticOwnershipControlScenario(rawDir);
    const report = buildMiniReport(rawDir, [withScenario, withoutScenario]);

    const reportPath = path.join(tmpDir, "mini-report.json");
    writeJson(reportPath, report);

    const result = runRescore(reportPath);
    assert.equal(result.status, 0, `rescore exited non-zero:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // Output path is <basename>-rescored.json
    const rescoredPath = path.join(tmpDir, "mini-report-rescored.json");
    assert(fs.existsSync(rescoredPath), "rescored JSON file must be written");

    const rescored = JSON.parse(fs.readFileSync(rescoredPath, "utf8"));

    // Original report must be untouched.
    const original = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.equal(original.summary.failed_correctness_count, 1, "original report must not be modified");

    // The with-arm scenario's stored correctness was "failed" — rescore must flip it to "passed"
    // because the raw JSONL carries the correct answer.
    const rescoredWith = rescored.scenarios.find((s) => s.condition === "with_project_librarian");
    assert(rescoredWith, "rescored report must include with_project_librarian scenario");
    assert.equal(rescoredWith.passed_run_count, 1, "rescore must flip the run to passed");
    assert.equal(rescoredWith.claimable_run_count, 1, "rescore must mark the run claimable");
    assert.equal(rescoredWith.runs[0].correctness.status, "passed", `with-arm run must pass after rescore; checks: ${JSON.stringify(rescoredWith.runs[0].correctness.checks)}`);

    // Summary must reflect both scenarios now passing.
    assert.equal(rescored.summary.failed_correctness_count, 0, "rescored summary must have 0 failed");
    assert.equal(rescored.summary.passed_correctness_count, 2, "rescored summary must have 2 passed");

    // rescored_at and rescored_from must be set.
    assert(rescored.rescored_at, "rescored_at must be set");
    assert.equal(rescored.rescored_from, reportPath, "rescored_from must point to original");

    // Markdown must also be written.
    const mdPath = path.join(tmpDir, "mini-report-rescored.md");
    assert(fs.existsSync(mdPath), "rescored markdown file must be written");

    // stdout must be valid JSON summary.
    const stdout = JSON.parse(result.stdout.trim());
    assert.equal(stdout.status, "ok");
    assert.equal(stdout.mode, "rescore");
    assert.equal(stdout.out, rescoredPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("rescore: claim gate reflects rescored verdicts (gate flips from failed to passed when all pairs claimable)", () => {
  const tmpDir = makeTmpDir("rescore-gate-");
  try {
    const rawDir = path.join(tmpDir, "raw");
    fs.mkdirSync(rawDir, { recursive: true });

    const withScenario = buildSyntheticOwnershipScenario(rawDir);
    const withoutScenario = buildSyntheticOwnershipControlScenario(rawDir);
    const report = buildMiniReport(rawDir, [withScenario, withoutScenario]);

    const reportPath = path.join(tmpDir, "mini-gate.json");
    writeJson(reportPath, report);

    const result = runRescore(reportPath);
    assert.equal(result.status, 0, `rescore exited non-zero: ${result.stderr}`);

    const rescoredPath = path.join(tmpDir, "mini-gate-rescored.json");
    const rescored = JSON.parse(fs.readFileSync(rescoredPath, "utf8"));

    // After rescore both pairs are claimable → gate must pass.
    assert.equal(rescored.claim_gate.status, "passed", `claim gate must pass after rescore; issues: ${JSON.stringify(rescored.claim_gate.issues)}`);

    // stdout claim_gate field must also reflect the new status.
    const stdout = JSON.parse(result.stdout.trim());
    assert.equal(stdout.claim_gate, "passed");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("rescore: original report file is not modified after rescore", () => {
  const tmpDir = makeTmpDir("rescore-immutable-");
  try {
    const rawDir = path.join(tmpDir, "raw");
    fs.mkdirSync(rawDir, { recursive: true });

    const withScenario = buildSyntheticOwnershipScenario(rawDir);
    const withoutScenario = buildSyntheticOwnershipControlScenario(rawDir);
    const report = buildMiniReport(rawDir, [withScenario, withoutScenario]);

    const reportPath = path.join(tmpDir, "mini-immutable.json");
    writeJson(reportPath, report);
    const originalContent = fs.readFileSync(reportPath, "utf8");

    const result = runRescore(reportPath);
    assert.equal(result.status, 0, `rescore exited non-zero: ${result.stderr}`);

    const afterContent = fs.readFileSync(reportPath, "utf8");
    assert.equal(afterContent, originalContent, "original report file must not be modified by rescore");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("rescore: --rescore with missing file exits non-zero with error message", () => {
  const result = runRescore("/nonexistent/path/report.json");
  assert.notEqual(result.status, 0, "must exit non-zero for missing file");
  assert(
    result.stderr.includes("not found") || result.stderr.includes("ENOENT") || result.stderr.includes("report file not found"),
    `stderr must mention missing file: ${result.stderr}`,
  );
});
