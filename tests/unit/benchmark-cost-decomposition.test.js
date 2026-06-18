"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { summarizeJsonl } = require("../../benchmarks/lib/codex-jsonl");
const { conditions } = require("../../benchmarks/lib/llm-fixtures");
const {
  DEFAULT_CACHE_DISCOUNT,
  corporaPresent,
  costWeightedTokens,
  evaluateTracksClaimGate,
  medianMetrics,
  metricFields,
  renderLlmMarkdownReport,
  resolveCacheDiscount,
  scenariosForTrack,
  scenariosForTrackCorpus,
  tracksPresent,
} = require("../../benchmarks/lib/llm-report");

const root = path.resolve(__dirname, "..", "..");
const metricsCli = path.join(root, "benchmarks", "codex-llm-metrics.js");

function jsonl(...events) {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

// A real Codex command_execution pair: the started event carries an empty
// in-progress aggregated_output, the completed event carries the captured output.
function commandPair(command, output) {
  return [
    { type: "item.started", item: { type: "command_execution", command, status: "in_progress", exit_code: null, aggregated_output: "" } },
    { type: "item.completed", item: { type: "command_execution", command, status: "completed", exit_code: 0, aggregated_output: output } },
  ];
}

function turnCompleted(usage) {
  return { type: "turn.completed", usage };
}

// --- Derivation correctness (recomputed from raw JSONL) -------------------------

test("uncached_input_tokens = input - cached, derived from raw usage", () => {
  const metrics = summarizeJsonl(jsonl(turnCompleted({ input_tokens: 1000, cached_input_tokens: 600, output_tokens: 50 })), { wall_ms: 1000 });
  assert.equal(metrics.uncached_input_tokens, 400);
});

test("a fully cached resend (cached == input) yields uncached 0 without throwing", () => {
  const metrics = summarizeJsonl(jsonl(turnCompleted({ input_tokens: 800, cached_input_tokens: 800, output_tokens: 10 })), { wall_ms: 1000 });
  assert.equal(metrics.uncached_input_tokens, 0);
});

test("cached_input_tokens exceeding input_tokens is corrupt usage and fails loudly", () => {
  assert.throws(
    () => summarizeJsonl(jsonl(turnCompleted({ input_tokens: 100, cached_input_tokens: 250, output_tokens: 5 })), { wall_ms: 1000 }),
    /corrupt usage: cached_input_tokens \(250\) exceeds input_tokens \(100\)/,
  );
});

test("corrupt usage is detected on the merged total across multiple turns", () => {
  // Two turns whose summed cached exceeds summed input: still corrupt, still throws.
  assert.throws(
    () => summarizeJsonl(jsonl(
      turnCompleted({ input_tokens: 100, cached_input_tokens: 90, output_tokens: 5 }),
      turnCompleted({ input_tokens: 100, cached_input_tokens: 150, output_tokens: 5 }),
    ), { wall_ms: 1000 }),
    /corrupt usage/,
  );
});

test("tool_output_bytes counts aggregated_output bytes on completed command items only", () => {
  // The started event's empty aggregated_output must not be double counted; only the
  // completed event's output is summed (UTF-8 byte length).
  const output = "line one\nline two\n"; // 18 bytes ASCII
  const metrics = summarizeJsonl(jsonl(
    ...commandPair("rg foo wiki", output),
    turnCompleted({ input_tokens: 100, cached_input_tokens: 50, output_tokens: 5 }),
  ), { wall_ms: 1000 });
  assert.equal(metrics.tool_output_bytes, Buffer.byteLength(output, "utf8"));
  assert.equal(metrics.tool_output_bytes, 18);
});

test("tool_output_bytes sums multiple commands and uses UTF-8 byte length", () => {
  const a = "ascii\n"; // 6 bytes
  const b = "café\n"; // 'é' is 2 bytes => 6 bytes total
  const metrics = summarizeJsonl(jsonl(
    ...commandPair("cmd-a", a),
    ...commandPair("cmd-b", b),
    turnCompleted({ input_tokens: 10, cached_input_tokens: 0, output_tokens: 1 }),
  ), { wall_ms: 1000 });
  assert.equal(metrics.tool_output_bytes, Buffer.byteLength(a, "utf8") + Buffer.byteLength(b, "utf8"));
  assert.equal(metrics.tool_output_bytes, 12);
});

test("tool_output_bytes is zero when no command/tool output field is present", () => {
  const metrics = summarizeJsonl(jsonl(turnCompleted({ input_tokens: 10, cached_input_tokens: 0, output_tokens: 1 })), { wall_ms: 1000 });
  assert.equal(metrics.tool_output_bytes, 0);
});

test("request_count_estimate counts completed turn boundaries", () => {
  const metrics = summarizeJsonl(jsonl(
    { type: "turn.started" },
    turnCompleted({ input_tokens: 10, cached_input_tokens: 0, output_tokens: 1 }),
  ), { wall_ms: 1000 });
  assert.equal(metrics.request_count_estimate, 1);
});

test("request_count_estimate counts each completed turn for multi-request transcripts", () => {
  const metrics = summarizeJsonl(jsonl(
    turnCompleted({ input_tokens: 10, cached_input_tokens: 0, output_tokens: 1 }),
    turnCompleted({ input_tokens: 20, cached_input_tokens: 5, output_tokens: 2 }),
  ), { wall_ms: 1000 });
  assert.equal(metrics.request_count_estimate, 2);
});

test("request_count is recorded unavailable when no turn boundary exists", () => {
  // A transcript with a command but no turn.* event exposes nothing usable to count
  // requests from; the field is marked unavailable rather than guessed.
  const metrics = summarizeJsonl(jsonl(
    { type: "item.completed", item: { type: "command_execution", command: "ls", status: "completed", exit_code: 0, aggregated_output: "x\n" } },
  ), { wall_ms: 1000 });
  assert.equal(metrics.request_count_estimate, 0);
  assert(metrics.unavailable_event_fields.includes("request_count"));
});

test("the derived cost fields are part of metricFields so medians aggregate them", () => {
  for (const field of ["uncached_input_tokens", "tool_output_bytes", "request_count_estimate"]) {
    assert(metricFields.includes(field), `metricFields missing ${field}`);
  }
  const runs = [
    { metrics: summarizeJsonl(jsonl(...commandPair("c", "aa\n"), turnCompleted({ input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 })), { wall_ms: 1000 }) },
    { metrics: summarizeJsonl(jsonl(...commandPair("c", "aaaa\n"), turnCompleted({ input_tokens: 200, cached_input_tokens: 60, output_tokens: 20 })), { wall_ms: 1000 }) },
  ];
  const median = medianMetrics(runs);
  assert.equal(median.uncached_input_tokens, (60 + 140) / 2);
  assert(Number.isFinite(median.tool_output_bytes));
  assert.equal(median.request_count_estimate, 1);
});

// --- Cost-weighted metric -------------------------------------------------------

test("cost_weighted_tokens = uncached + discount*cached + output + reasoning", () => {
  const metrics = { uncached_input_tokens: 100, cached_input_tokens: 1000, output_tokens: 50, reasoning_output_tokens: 10 };
  assert.equal(costWeightedTokens(metrics, 0.1), 100 + 0.1 * 1000 + 50 + 10);
  assert.equal(costWeightedTokens(metrics, 0), 100 + 0 + 50 + 10);
  assert.equal(costWeightedTokens(metrics, 1), 100 + 1000 + 50 + 10);
});

test("DEFAULT_CACHE_DISCOUNT is 0.1", () => {
  assert.equal(DEFAULT_CACHE_DISCOUNT, 0.1);
});

test("resolveCacheDiscount prefers configuration, then top-level, then the default", () => {
  assert.equal(resolveCacheDiscount({ configuration: { cache_discount: 0.25 }, cache_discount: 0.9 }), 0.25);
  assert.equal(resolveCacheDiscount({ cache_discount: 0.3 }), 0.3);
  assert.equal(resolveCacheDiscount({}), DEFAULT_CACHE_DISCOUNT);
  assert.equal(resolveCacheDiscount({ configuration: {} }), DEFAULT_CACHE_DISCOUNT);
});

// --- Discount configurability flowing flag -> report ----------------------------

function runDryRun(args) {
  return childProcess.spawnSync(process.execPath, [metricsCli, "--dry-run", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runMetrics(args, options = {}) {
  return childProcess.spawnSync(process.execPath, [metricsCli, ...args], {
    cwd: root,
    env: options.env || process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 50 * 1024 * 1024,
  });
}

function writeFakeCodex(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const codexPath = path.join(binDir, "codex");
  fs.writeFileSync(codexPath, `#!/usr/bin/env node
"use strict";

if (process.argv.includes("--version")) {
  console.log("codex-test 0.0.0");
  process.exit(0);
}

console.log(JSON.stringify({ type: "session.started", model: "gpt-test", cwd: process.cwd() }));
console.log(JSON.stringify({ type: "assistant.message", message: { content: "fake codex benchmark response" } }));
console.log(JSON.stringify({
  type: "turn.completed",
  usage: {
    input_tokens: 100,
    cached_input_tokens: 0,
    output_tokens: 5,
    reasoning_output_tokens: 0
  }
}));
`);
  fs.chmodSync(codexPath, 0o755);
  return codexPath;
}

function fakeCodexEnv(tmp) {
  const binDir = path.join(tmp, "bin");
  writeFakeCodex(binDir);
  const codexHome = path.join(tmp, "codex-home");
  fs.mkdirSync(codexHome, { recursive: true });
  const authPath = path.join(codexHome, "auth.json");
  fs.writeFileSync(authPath, "{}\n");
  fs.chmodSync(authPath, 0o600);
  return {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
    CODEX_HOME: codexHome,
    CODEX_API_KEY: "test-key",
  };
}

test("--cache-discount validates: rejects negative, > 1, and non-numeric values", () => {
  for (const bad of ["-0.1", "1.5", "abc", "0.1.2"]) {
    const result = runDryRun(["--cache-discount", bad, "--scales", "small", "--tasks", "decision_lookup"]);
    assert.notEqual(result.status, 0, `--cache-discount ${bad} should fail`);
    assert(/cache-discount/.test(result.stderr), `error should mention cache-discount for ${bad}`);
  }
});

test("--cache-discount accepts the 0..1 boundary values", () => {
  for (const good of ["0", "1", "0.05", "0.5"]) {
    const result = runDryRun(["--cache-discount", good, "--scales", "small", "--tasks", "decision_lookup"]);
    // Dry-run does not consume Codex; it should succeed (or fail only if dist is
    // unbuilt, which is unrelated to the flag). Assert the flag itself was accepted.
    assert(!/cache-discount/.test(result.stderr || ""), `--cache-discount ${good} should be accepted`);
  }
});

test("--payload-preview writes a local audit file without requiring --allow-codex-run", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-payload-preview-"));
  const previewPath = path.join(tmp, "preview.json");
  const result = runMetrics([
    "--payload-preview", previewPath,
    "--scales", "small",
    "--tasks", "decision_lookup",
    "--max-scenarios", "2",
    "--runs", "1",
    "--warmup-runs", "0",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const stdout = JSON.parse(result.stdout);
  assert.equal(stdout.mode, "payload-preview");
  assert.equal(stdout.scenario_count, 2);
  assert.equal(stdout.expected_codex_exec_count, 2);
  const preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));
  assert.equal(preview.benchmark_kind, "codex-actual-llm-payload-preview");
  assert.equal(preview.disclosure_boundary.codex_network_run, false);
  assert.equal(preview.configuration.expected_codex_exec_count, 2);
  assert.equal(preview.scenarios.length, 2);
  for (const scenario of preview.scenarios) {
    assert(scenario.prompt.includes("Benchmark scenario:"));
    assert.equal(typeof scenario.prompt_sha256, "string");
    assert.equal(scenario.prompt_sha256.length, 64);
    assert(path.isAbsolute(scenario.cwd));
    assert(!scenario.cwd.startsWith(root), "preview fixture cwd must not be the source checkout");
  }
});

test("--require-claimable fails before measurement when no --model is provided", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-claimable-model-"));
  const previewPath = path.join(tmp, "preview.json");
  const result = runMetrics([
    "--payload-preview", previewPath,
    "--require-claimable",
    "--scales", "small",
    "--tasks", "decision_lookup",
    "--max-scenarios", "2",
    "--runs", "1",
    "--warmup-runs", "0",
  ]);
  assert.notEqual(result.status, 0, "missing --model must fail before any claimable run is started");
  assert.match(result.stderr, /--require-claimable requires --model <model>/);
  assert(!fs.existsSync(previewPath), "failed preflight must not write a claimable preview");
});

test("--payload-preview records the requested model for claimable release preflight", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-claimable-preview-"));
  const previewPath = path.join(tmp, "preview.json");
  const result = runMetrics([
    "--payload-preview", previewPath,
    "--require-claimable",
    "--model", "gpt-test",
    "--scales", "small",
    "--tasks", "decision_lookup",
    "--max-scenarios", "2",
    "--runs", "1",
    "--warmup-runs", "0",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));
  assert.equal(preview.configuration.requested_model, "gpt-test");
  assert(preview.scenarios.every((scenario) => scenario.command_prefix.includes("--model")), "preview command prefix must expose the requested model flag");
  assert(preview.scenarios.every((scenario) => scenario.command_prefix.includes("gpt-test")), "preview command prefix must expose the requested model value");
});

test("--sanitized-pack re-executes dry-run from a minimized pack boundary", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-sanitized-pack-test-"));
  const packRoot = path.join(tmp, "pack");
  const manifestPath = path.join(tmp, "manifest.json");
  const result = runMetrics([
    "--dry-run",
    "--sanitized-pack",
    "--sanitized-pack-dir", packRoot,
    "--scales", "small",
    "--tasks", "decision_lookup",
    "--max-scenarios", "2",
    "--out", manifestPath,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const stdout = JSON.parse(result.stdout);
  assert.equal(stdout.mode, "dry-run");
  assert.equal(stdout.sanitized_pack, packRoot);
  const packManifestPath = path.join(packRoot, "SANITIZED_BENCHMARK_PACK.json");
  assert(fs.existsSync(packManifestPath), "sanitized pack must write provenance");
  const packManifest = JSON.parse(fs.readFileSync(packManifestPath, "utf8"));
  assert.equal(packManifest.kind, "project-librarian-sanitized-benchmark-pack");
  assert(packManifest.copied_entries.includes("dist/"));
  assert(packManifest.copied_entries.includes("benchmarks/lib/"));
  assert(packManifest.copied_entries.includes("node_modules/typescript/"));
  for (const excluded of ["src", "tests", "wiki", ".git", "README.md", "README.ko.md"]) {
    assert(!fs.existsSync(path.join(packRoot, excluded)), `sanitized pack must not copy ${excluded}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.scenarios.length, 2);
  assert(manifest.scenarios.every((scenario) => scenario.cwd.startsWith(packRoot)), "scenario cwd must stay inside the sanitized pack");
});

test("measured benchmark reports live progress on stderr without corrupting stdout JSON", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-progress-test-"));
  const reportPath = path.join(tmp, "report.json");
  const result = runMetrics([
    "--allow-codex-run",
    "--auth-mode", "api-key",
    "--scales", "small",
    "--tasks", "decision_lookup",
    "--max-scenarios", "2",
    "--runs", "1",
    "--warmup-runs", "0",
    "--model", "gpt-test",
    "--out", reportPath,
  ], { env: fakeCodexEnv(tmp) });
  assert.equal(result.status, 0, result.stderr);
  const stdout = JSON.parse(result.stdout);
  assert.equal(stdout.mode, "measured");
  assert.equal(stdout.scenario_count, 2);
  assert.match(result.stderr, /\[benchmark:progress\] plan .*scenarios=2 .*codex_exec_total=2/);
  assert.match(result.stderr, /\[benchmark:progress\] start .*current=1\/2 .*phase=measured/);
  assert.match(result.stderr, /\[benchmark:progress\] done .*current=2\/2 .*status=completed .*exit=0/);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.scenarios.length, 2);
});

// --- Per-track report assembly: cost-weighted headline, merged total secondary ---

function syntheticScenario({ scale, track, taskFamily, condition, uncached, cached, output, toolBytes, claimable = true }) {
  const median = {
    input_tokens: uncached + cached,
    cached_input_tokens: cached,
    uncached_input_tokens: uncached,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: uncached + cached + output,
    tool_output_bytes: toolBytes,
    request_count_estimate: 1,
    wall_ms: 1000,
    first_response_ms: 0,
    tokens_per_second: 10,
    command_invocation_count: 2,
  };
  return {
    scale,
    condition,
    benchmark_track: track,
    task_family: taskFamily,
    prompt_id: `${taskFamily}-${scale}-${condition}`,
    runs: [{ execution: { status: "completed" } }],
    correctness: [{ status: "passed" }],
    claimable_run_count: claimable ? 1 : 0,
    model: "gpt-5.5",
    model_source: "jsonl",
    median: claimable ? median : null,
    dispersion: null,
  };
}

function pair({ scale, track, taskFamily, withMetrics, withoutMetrics }) {
  return [
    syntheticScenario({ scale, track, taskFamily, condition: "with_project_librarian", ...withMetrics }),
    syntheticScenario({ scale, track, taskFamily, condition: "without_project_librarian", ...withoutMetrics }),
  ];
}

function reportWith(scenarios, cacheDiscount = 0.1) {
  const present = tracksPresent(scenarios);
  const report = {
    schema_version: 7,
    generated_at: "2026-06-10T00:00:00.000Z",
    auth_mode: "chatgpt_codex",
    corpus: "synthetic",
    cache_discount: cacheDiscount,
    configuration: { runs: 3, warmup_runs: 1, requested_model: "gpt-5.5", cache_discount: cacheDiscount, require_clean: false },
    summary: { scenario_count: scenarios.length, comparison_pair_count: 1, claimable_scenario_count: scenarios.length },
    scenarios,
    claim_gate: { status: "passed", per_track: {} },
    tracks: {},
  };
  // schema 7 per-corpus structure: these mock scenarios default to the synthetic
  // corpus, so each track carries a single synthetic corpus whose gate equals the
  // track gate; the renderer reads per_track[track].per_corpus[corpus].status.
  for (const track of present) {
    const trackScenarios = scenariosForTrack(scenarios, track);
    const corpora = corporaPresent(trackScenarios);
    const perCorpus = {};
    const corporaInfo = {};
    for (const corpus of corpora) {
      const corpusScenarios = scenariosForTrackCorpus(scenarios, track, corpus);
      perCorpus[corpus] = { status: "passed", per_corpus: undefined };
      corporaInfo[corpus] = {
        corpus,
        summary: { scenario_count: corpusScenarios.length, comparison_pair_count: 1, claimable_scenario_count: corpusScenarios.length },
        claim_gate: { status: "passed" },
      };
    }
    report.tracks[track] = {
      benchmark_track: track,
      summary: { scenario_count: trackScenarios.length, comparison_pair_count: 1, claimable_scenario_count: trackScenarios.length },
      corpora_present: corpora,
      corpora: corporaInfo,
      claim_gate: { status: "passed", per_corpus: perCorpus },
    };
    report.claim_gate.per_track[track] = { status: "passed", per_corpus: perCorpus };
  }
  return report;
}

test("the per-track headline delta is the cost-weighted number, not merged total", () => {
  // Construct a pair where merged total and cost-weighted point OPPOSITE directions:
  // the with-condition adds turns (more total tokens) but most extra input is cached,
  // so its cost-weighted total is LOWER. The headline must reflect cost-weighted.
  const scenarios = pair({
    scale: "medium",
    track: "wiki",
    taskFamily: "multi_session",
    withMetrics: { uncached: 5000, cached: 40000, output: 100, toolBytes: 1000 },
    withoutMetrics: { uncached: 9000, cached: 5000, output: 100, toolBytes: 8000 },
  });
  const report = reportWith(scenarios, 0.1);
  const md = renderLlmMarkdownReport(report);

  // Merged total: with = 45100, without = 14100 -> +219.86% (penalizes the with run).
  // Cost-weighted: with = 5000 + 4000 + 100 = 9100; without = 9000 + 500 + 100 = 9600
  // -> -5.21% (the with run is actually cheaper). The headline section shows the
  // negative cost-weighted delta; the merged positive number is only in the secondary.
  const withCost = costWeightedTokens(scenarios[0].median, 0.1);
  const withoutCost = costWeightedTokens(scenarios[1].median, 0.1);
  assert.equal(withCost, 9100);
  assert.equal(withoutCost, 9600);

  const headlineIdx = md.indexOf("With vs Without Delta (headline: cost-weighted)");
  const secondaryIdx = md.indexOf("Merged Total Tokens (secondary, not a headline)");
  assert(headlineIdx >= 0 && secondaryIdx >= 0 && headlineIdx < secondaryIdx, "headline must precede the secondary merged section");

  // The headline table carries the cost-weighted values; the merged totals carry the
  // raw 45,100 / 14,100 and are explicitly labeled secondary.
  const headlineBlock = md.slice(headlineIdx, secondaryIdx);
  assert(headlineBlock.includes("9,100") && headlineBlock.includes("9,600"), "headline shows cost-weighted with/without");
  assert(!headlineBlock.includes("45,100"), "merged total must not appear in the headline delta block");
  const secondaryBlock = md.slice(secondaryIdx);
  assert(secondaryBlock.includes("45,100") && secondaryBlock.includes("14,100"), "secondary shows merged totals");
});

test("the headline cost-weighted delta tracks the configured discount", () => {
  const scenarios = pair({
    scale: "medium",
    track: "wiki",
    taskFamily: "decision_lookup",
    withMetrics: { uncached: 1000, cached: 10000, output: 100, toolBytes: 500 },
    withoutMetrics: { uncached: 1000, cached: 2000, output: 100, toolBytes: 200 },
  });
  // At discount 0.1 the with run pays for more cached input; at discount 0 cached is
  // free, so the cost-weighted with/without converge. The report renders the
  // discount it was given, and the cost-weighted values follow it.
  const md01 = renderLlmMarkdownReport(reportWith(scenarios, 0.1));
  assert(md01.includes("cache discount 0.1"));
  assert.equal(costWeightedTokens(scenarios[0].median, 0.1), 1000 + 1000 + 100);

  const md0 = renderLlmMarkdownReport(reportWith(scenarios, 0));
  assert(md0.includes("cache discount 0"));
  assert.equal(costWeightedTokens(scenarios[0].median, 0), 1000 + 0 + 100);
});

test("per-track sections stay separated with no merged cross-track headline", () => {
  const scenarios = [
    ...pair({ scale: "medium", track: "wiki", taskFamily: "decision_lookup", withMetrics: { uncached: 100, cached: 100, output: 10, toolBytes: 0 }, withoutMetrics: { uncached: 100, cached: 100, output: 10, toolBytes: 0 } }),
    ...pair({ scale: "medium", track: "code_graph", taskFamily: "impact_trace", withMetrics: { uncached: 100, cached: 100, output: 10, toolBytes: 0 }, withoutMetrics: { uncached: 100, cached: 100, output: 10, toolBytes: 0 } }),
  ];
  const md = renderLlmMarkdownReport(reportWith(scenarios, 0.1));
  assert(md.includes("## Wiki Track"));
  assert(md.includes("## Code Graph Track"));
  // Within each track the cost-weighted headline is rendered per-corpus (these mock
  // scenarios are the synthetic corpus), so the heading carries the corpus name.
  assert(md.includes("#### Wiki Track — Synthetic Corpus With vs Without Delta (headline: cost-weighted)"));
  assert(md.includes("#### Code Graph Track — Synthetic Corpus With vs Without Delta (headline: cost-weighted)"));
  assert(md.includes("Tracks are reported separately"));
  assert(md.includes("Real-corpus and synthetic results are never merged into one number."));
});

// --- multi_session per-session derivation ---------------------------------------

test("multi_session derives cost fields per session from each session's raw JSONL", () => {
  // Two sessions in one run; each session's metrics derive independently from its own
  // transcript. Session 2 (measured) is the primary; session 1 (familiarization) is
  // reported separately and is NOT conflated with session 2.
  const session1 = summarizeJsonl(jsonl(
    ...commandPair("cat wiki/startup.md", "startup content\n"),
    turnCompleted({ input_tokens: 18000, cached_input_tokens: 12000, output_tokens: 90 }),
  ), { wall_ms: 1500 });
  const session2 = summarizeJsonl(jsonl(
    ...commandPair("cat wiki/decisions/log.md", "2026-06-10 decision\n"),
    turnCompleted({ input_tokens: 21000, cached_input_tokens: 15000, output_tokens: 110 }),
  ), { wall_ms: 1200 });

  // Session 1 derived independently.
  assert.equal(session1.uncached_input_tokens, 6000);
  assert.equal(session1.request_count_estimate, 1);
  assert.equal(session1.tool_output_bytes, Buffer.byteLength("startup content\n", "utf8"));

  // Session 2 derived independently; different uncached input than session 1.
  assert.equal(session2.uncached_input_tokens, 6000);
  assert.notEqual(session2.tool_output_bytes, session1.tool_output_bytes);

  // The measured (session-2) cost-weighted total uses session 2's own components.
  assert.equal(costWeightedTokens(session2, 0.1), 6000 + 0.1 * 15000 + 110);
});

// --- validator recomputation path (the checked-in sample) -----------------------

test("the regenerated sample report is schema 7 with a recorded cache discount", () => {
  const report = JSON.parse(fs.readFileSync(path.join(root, "benchmarks", "llm", "samples", "codex-measured-report.json"), "utf8"));
  assert.equal(report.schema_version, 7);
  assert(Number.isFinite(report.cache_discount));
  assert.equal(report.configuration.cache_discount, report.cache_discount);
});

test("every sample-report median exposes the derived cost fields and a recomputable headline", () => {
  const report = JSON.parse(fs.readFileSync(path.join(root, "benchmarks", "llm", "samples", "codex-measured-report.json"), "utf8"));
  for (const scenario of report.scenarios) {
    if (!scenario.median) continue;
    assert(Number.isFinite(scenario.median.uncached_input_tokens), `${scenario.prompt_id} median missing uncached_input_tokens`);
    assert(Number.isFinite(scenario.median.tool_output_bytes), `${scenario.prompt_id} median missing tool_output_bytes`);
    assert(Number.isFinite(scenario.median.request_count_estimate), `${scenario.prompt_id} median missing request_count_estimate`);
    const expected = scenario.median.uncached_input_tokens
      + report.cache_discount * scenario.median.cached_input_tokens
      + scenario.median.output_tokens
      + scenario.median.reasoning_output_tokens;
    assert.equal(costWeightedTokens(scenario.median, report.cache_discount), expected);
  }
});

test("the sample report's claim gate recomputes from scenarios under the per-track structure", () => {
  const report = JSON.parse(fs.readFileSync(path.join(root, "benchmarks", "llm", "samples", "codex-measured-report.json"), "utf8"));
  const present = tracksPresent(report.scenarios);
  const expectedTasksByTrack = {};
  for (const track of present) expectedTasksByTrack[track] = report.tracks[track].expected_tasks;
  const recomputed = evaluateTracksClaimGate(report, {
    conditions,
    expectedScales: report.configuration.selected_scales,
    expectedTasksByTrack,
    fullMatrix: report.configuration.full_matrix,
    minRunsForClaim: report.configuration.min_runs_for_claim,
  });
  assert.deepEqual(report.claim_gate, recomputed);
});
