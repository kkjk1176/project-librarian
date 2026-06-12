"use strict";

// A3 (Phase 3 remainder) unit tests for the multi_session and aggregation task
// families. These exercise the pure pieces only and NEVER execute real codex:
// manifest/scenario shape from buildManifest (tmp fixtures), aggregation
// ground-truth determinism, the no-single-page-aggregate assert (pass + violation
// for both prose-summary and date-enumeration shapes), session-2 metric extraction
// from crafted dual-session data, session-1-failure gate, and the correctness
// evaluators for both families (pass/fail cases). All fixtures are tmp-confined.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  AGGREGATION_DECISIONS,
  SEEDED_DECISION,
  aggregationExpectation,
  aggregationGroundTruth,
  assertNoSinglePageAggregate,
  buildManifest,
  conditions,
  controlProfiles,
  taskFamilies,
  taskFamilyDefinitions,
  taskTracks,
  trackForTaskFamily,
} = require("../../benchmarks/lib/llm-fixtures");
const { evaluateCorrectness } = require("../../benchmarks/lib/llm-correctness");
const { measurementStatus } = require("../../benchmarks/lib/llm-report");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");
const skip = !fs.existsSync(cliPath) ? "dist CLI not built" : false;

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeMarkdown(dir, name, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

// --- family registry --------------------------------------------------------

test("the matrix has 10 families and both A3 families are wiki-track", () => {
  const families = Object.keys(taskFamilies);
  assert.equal(families.length, 10, `expected 10 families, got ${families.length}`);
  for (const family of ["multi_session", "aggregation"]) {
    assert(families.includes(family), `missing ${family}`);
    assert.equal(trackForTaskFamily(family), "wiki");
    assert.equal(taskTracks[family], "wiki");
  }
});

test("multi_session definition carries a familiarization prompt distinct from the measured prompt", () => {
  const def = taskFamilyDefinitions.multi_session;
  assert(def.multi_session && typeof def.multi_session.familiarization_prompt === "string");
  assert(def.multi_session.familiarization_prompt.length > 0);
  assert.notEqual(def.multi_session.familiarization_prompt, def.prompt, "familiarization and measured prompts must differ");
});

// --- aggregation ground truth -------------------------------------------------

test("aggregation ground truth is deterministic and chronologically ordered", () => {
  const first = aggregationGroundTruth();
  const second = aggregationGroundTruth();
  assert.deepEqual(first, second, "ground truth must be deterministic");
  const dates = first.map((decision) => decision.date);
  const sorted = [...dates].sort();
  assert.deepEqual(dates, sorted, "ground-truth dates must be in ascending (chronological) order");
  // The inventory is the A3 decisions plus the seeded answer date.
  assert(dates.includes(SEEDED_DECISION.date), "ground truth must include the seeded decision date");
  for (const decision of AGGREGATION_DECISIONS) {
    assert(dates.includes(decision.date), `ground truth missing ${decision.date}`);
  }
  assert.equal(dates.length, AGGREGATION_DECISIONS.length + 1);
});

test("aggregation expectation encodes every date as a required term plus components", () => {
  const expectation = aggregationExpectation();
  const groundTruth = aggregationGroundTruth();
  assert.deepEqual(expectation.required_terms, groundTruth.map((decision) => decision.date));
  assert.equal(expectation.aggregate_components.length, groundTruth.length);
  assert.equal(expectation.no_single_page_terms.length, groundTruth.length);
  for (const component of expectation.aggregate_components) {
    assert(expectation.required_terms.includes(component.date));
    assert(expectation.no_single_page_terms.includes(component.summary));
  }
  // Profile-aware evidence: control side is profile-keyed for bare/organic/curated.
  for (const profile of controlProfiles) {
    assert(Array.isArray(expectation.evidence_by_condition.without_project_librarian[profile]), `missing aggregation evidence for ${profile}`);
  }
});

// --- no-single-page-aggregate assert ------------------------------------------

test("no-single-page-aggregate assert passes when components are split across pages", () => {
  const dir = makeTmpDir("a3-nsp-pass-");
  try {
    const terms = aggregationExpectation().no_single_page_terms;
    // One component per page: synthesis across pages is required, no page has all.
    terms.forEach((term, index) => writeMarkdown(dir, `page-${index}.md`, `# Page ${index}\n\nThe project decided to ${term}.\n`));
    assert.doesNotThrow(() => assertNoSinglePageAggregate(dir, terms));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no-single-page-aggregate assert throws and names the file when one page has the full inventory", () => {
  const dir = makeTmpDir("a3-nsp-fail-");
  try {
    const terms = aggregationExpectation().no_single_page_terms;
    // Pre-aggregated page: every component on one page is the forbidden shape.
    writeMarkdown(dir, "all-in-one.md", `# History\n\n${terms.map((term) => `- ${term}`).join("\n")}\n`);
    assert.throws(
      () => assertNoSinglePageAggregate(dir, terms),
      (error) => error.message.includes("no-single-page-aggregate") && error.message.includes("all-in-one.md"),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no-single-page-aggregate assert is a no-op for fewer than two components", () => {
  const dir = makeTmpDir("a3-nsp-noop-");
  try {
    writeMarkdown(dir, "single.md", "# Only one fact\n\ninitialize the project planning wiki\n");
    assert.doesNotThrow(() => assertNoSinglePageAggregate(dir, ["initialize the project planning wiki"]));
    assert.doesNotThrow(() => assertNoSinglePageAggregate(dir, []));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- correctness evaluators ---------------------------------------------------

test("aggregation correctness passes only when every dated component is present", () => {
  const expectation = aggregationExpectation();
  const allDates = expectation.required_terms.join(", ");
  const pass = evaluateCorrectness({
    taskFamily: "aggregation",
    condition: "with_project_librarian",
    benchmarkTrack: "wiki",
    expectation,
    finalText: `Chronological decisions: ${allDates} (see wiki/canonical/dated-decision-0.md).`,
    fileChangeCount: 0,
  });
  assert.equal(pass.status, "passed", pass.reason);

  // Drop one date -> fail.
  const partialDates = expectation.required_terms.slice(0, -1).join(", ");
  const fail = evaluateCorrectness({
    taskFamily: "aggregation",
    condition: "with_project_librarian",
    benchmarkTrack: "wiki",
    expectation,
    finalText: `Decisions: ${partialDates} in wiki/canonical/dated-decision-0.md.`,
    fileChangeCount: 0,
  });
  assert.equal(fail.status, "failed");
});

test("aggregation correctness is profile-aware on the control side", () => {
  const expectation = aggregationExpectation();
  const allDates = expectation.required_terms.join(", ");
  // organic control cites the organic history dir + decision log.
  const organic = evaluateCorrectness({
    taskFamily: "aggregation",
    condition: "without_project_librarian",
    benchmarkTrack: "wiki",
    controlProfile: "organic",
    expectation,
    finalText: `Dated decisions ${allDates} (docs/history/dated-decision-0.md and docs/notes/decision-log.md).`,
    fileChangeCount: 0,
  });
  assert.equal(organic.status, "passed", organic.reason);
  // curated control citing the organic path does not satisfy the curated evidence.
  const curatedMismatch = evaluateCorrectness({
    taskFamily: "aggregation",
    condition: "without_project_librarian",
    benchmarkTrack: "wiki",
    controlProfile: "curated",
    expectation,
    finalText: `Dated decisions ${allDates} (docs/history/dated-decision-0.md only).`,
    fileChangeCount: 0,
  });
  assert.equal(curatedMismatch.status, "failed");
});

test("aggregation without an expectation resolves to needs_review", () => {
  const result = evaluateCorrectness({
    taskFamily: "aggregation",
    condition: "with_project_librarian",
    benchmarkTrack: "wiki",
    expectation: null,
    finalText: "2026-01-15 2026-02-09 2026-03-22 2026-05-04 2026-06-10",
    fileChangeCount: 0,
  });
  assert.equal(result.status, "needs_review");
});

test("multi_session correctness evaluates the measured-session text via the static map", () => {
  // with-condition measured answer cites release policy + the seeded latest decision.
  const pass = evaluateCorrectness({
    taskFamily: "multi_session",
    condition: "with_project_librarian",
    benchmarkTrack: "wiki",
    finalText: `Before publishing benchmark claims you must pass checks (wiki/canonical/release-policy.md and wiki/canonical/benchmark-and-release-evidence.md); the latest decision is ${SEEDED_DECISION.date} in wiki/decisions/log.md.`,
    fileChangeCount: 0,
  });
  assert.equal(pass.status, "passed", pass.reason);

  // Missing the seeded date -> fail.
  const fail = evaluateCorrectness({
    taskFamily: "multi_session",
    condition: "with_project_librarian",
    benchmarkTrack: "wiki",
    finalText: "Run benchmark claim checks per wiki/canonical/release-policy.md and wiki/decisions/log.md.",
    fileChangeCount: 0,
  });
  assert.equal(fail.status, "failed");

  // organic control measured answer cites the organic release/decision files.
  const organic = evaluateCorrectness({
    taskFamily: "multi_session",
    condition: "without_project_librarian",
    benchmarkTrack: "wiki",
    controlProfile: "organic",
    finalText: `Benchmark release checks per docs/runbooks/release.md; latest decision ${SEEDED_DECISION.date} in docs/notes/decision-log.md.`,
    fileChangeCount: 0,
  });
  assert.equal(organic.status, "passed", organic.reason);
});

// --- session-2 metric extraction (crafted dual-session data) ------------------

// Reproduce the runner's session split from the runner's perspective without
// spawning codex: given two crafted session metric records, the MEASURED session
// (session 2) supplies the run's primary metrics. This mirrors
// runMultiSessionScenario's selection logic.
test("session-2 metrics are selected as the run primary from crafted dual-session data", () => {
  const sessions = [
    { session_index: 1, role: "familiarization", metrics: { input_tokens: 18000, output_tokens: 90, total_tokens: 18090, final_text: "onboarding summary" } },
    { session_index: 2, role: "measured", metrics: { input_tokens: 21000, output_tokens: 110, total_tokens: 21110, final_text: "release policy and latest decision 2026-06-10" } },
  ];
  const measured = sessions.find((session) => session.role === "measured");
  assert.equal(measured.session_index, 2);
  assert.equal(measured.metrics.input_tokens, 21000);
  // The familiarization session is reported separately, not as the primary.
  const familiarization = sessions.find((session) => session.role === "familiarization");
  assert.equal(familiarization.metrics.input_tokens, 18000);
  assert.notEqual(measured.metrics.total_tokens, familiarization.metrics.total_tokens);
});

// --- manifest / scenario shape (tmp fixtures) ---------------------------------

test("buildManifest produces multi_session scenarios with two sessions and measured-mirrored top fields", { skip }, () => {
  const fixtureRoot = makeTmpDir("a3-manifest-ms-");
  try {
    const manifest = buildManifest({
      fixtureRoot,
      cliPath,
      selectedScales: ["small"],
      selectedTasks: ["multi_session"],
      controlProfile: "organic",
    });
    assert.equal(manifest.schema_version, 5);
    // 1 scale x 1 family x 2 conditions.
    assert.equal(manifest.scenarios.length, 2);
    for (const scenario of manifest.scenarios) {
      assert.equal(scenario.task_family, "multi_session");
      assert.equal(scenario.benchmark_track, "wiki");
      // schema 5 corpus dimension: synthetic fixtures carry corpus "synthetic" and
      // null repo fields.
      assert.equal(scenario.corpus, "synthetic");
      assert.equal(scenario.repo, null);
      assert.equal(scenario.question_id, null);
      assert.equal(scenario.session_count, 2);
      assert(Array.isArray(scenario.sessions) && scenario.sessions.length === 2);
      assert.deepEqual(scenario.sessions.map((session) => session.role), ["familiarization", "measured"]);
      const measured = scenario.sessions.find((session) => session.role === "measured");
      assert.equal(scenario.prompt, measured.prompt);
      assert.deepEqual(scenario.command, measured.command);
      assert.equal(scenario.expectation, null);
      for (const session of scenario.sessions) {
        assert(Array.isArray(session.command) && session.command[0] === "codex");
      }
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("buildManifest produces aggregation scenarios with a manifest-borne expectation", { skip }, () => {
  const fixtureRoot = makeTmpDir("a3-manifest-agg-");
  try {
    const manifest = buildManifest({
      fixtureRoot,
      cliPath,
      selectedScales: ["small"],
      selectedTasks: ["aggregation"],
      controlProfile: "bare",
    });
    assert.equal(manifest.scenarios.length, 2);
    for (const scenario of manifest.scenarios) {
      assert.equal(scenario.task_family, "aggregation");
      assert.equal(scenario.benchmark_track, "wiki");
      assert(scenario.expectation && Array.isArray(scenario.expectation.required_terms));
      assert.deepEqual(scenario.expectation, aggregationExpectation());
      assert.equal(Object.hasOwn(scenario, "sessions"), false);
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

// --- MAJOR 1: session-1 failure voids run claimability ------------------------
// measurementStatus must fail the entire run when any session (including the
// familiarization session 1) fails, even when the measured session 2 is healthy.
// The failure reason must name the offending session index.

function makeHealthySessionMetrics(sessionIndex, role) {
  return {
    session_index: sessionIndex,
    role,
    execution: { status: "completed", exit_code: 0, error: "" },
    metrics: {
      input_tokens: 20000,
      output_tokens: 100,
      total_tokens: 20100,
      wall_ms: 5000,
      codex_turn_count: 1,
      models: ["gpt-5.5"],
      model: "gpt-5.5",
      final_text: "healthy final text",
      unavailable_event_fields: ["first_response_latency"],
    },
  };
}

function makeHealthyRun(sessionMetrics) {
  const measured = sessionMetrics.find((s) => s.role === "measured");
  return {
    run_index: 0,
    requested_model: "gpt-5.5",
    execution: { status: "completed", exit_code: 0, error: "" },
    metrics: measured.metrics,
    correctness: { status: "passed", reason: "" },
    session_metrics: sessionMetrics,
    measurement: null,
  };
}

test("multi_session: both sessions healthy produces a claimable run", () => {
  const sessionMetrics = [makeHealthySessionMetrics(1, "familiarization"), makeHealthySessionMetrics(2, "measured")];
  const run = makeHealthyRun(sessionMetrics);
  const status = measurementStatus(run);
  assert.equal(status.status, "claimable", `expected claimable but got: ${status.reason}`);
  const sessionCheck = status.checks.find((c) => c.name === "all sessions completed");
  assert(sessionCheck, "missing all sessions completed check");
  assert.equal(sessionCheck.passed, true);
});

test("multi_session: session-1 execution failed makes run unclaimable with session index named", () => {
  const session1 = makeHealthySessionMetrics(1, "familiarization");
  session1.execution = { status: "failed", exit_code: 1, error: "spawn error" };
  const session2 = makeHealthySessionMetrics(2, "measured");
  const run = makeHealthyRun([session1, session2]);
  const status = measurementStatus(run);
  assert.equal(status.status, "unclaimable");
  assert(status.reason.includes("session 1"), `reason must name session 1; got: ${status.reason}`);
  const sessionCheck = status.checks.find((c) => c.name === "all sessions completed");
  assert(sessionCheck && !sessionCheck.passed);
});

test("multi_session: session-1 usage unavailable makes run unclaimable with session index named", () => {
  const session1 = makeHealthySessionMetrics(1, "familiarization");
  session1.metrics.codex_turn_count = 0;
  session1.metrics.unavailable_event_fields = ["usage", "first_response_latency"];
  const session2 = makeHealthySessionMetrics(2, "measured");
  const run = makeHealthyRun([session1, session2]);
  const status = measurementStatus(run);
  assert.equal(status.status, "unclaimable");
  assert(status.reason.includes("session 1"), `reason must name session 1; got: ${status.reason}`);
});

test("multi_session: session-1 empty final text makes run unclaimable with session index named", () => {
  const session1 = makeHealthySessionMetrics(1, "familiarization");
  session1.metrics.final_text = "";
  const session2 = makeHealthySessionMetrics(2, "measured");
  const run = makeHealthyRun([session1, session2]);
  const status = measurementStatus(run);
  assert.equal(status.status, "unclaimable");
  assert(status.reason.includes("session 1"), `reason must name session 1; got: ${status.reason}`);
});

test("non-multi_session run without session_metrics is unaffected by the session check", () => {
  // A single-session run with no session_metrics array must not be failed by the
  // new session check (the check is a no-op when session_metrics is absent).
  const run = {
    run_index: 0,
    requested_model: "gpt-5.5",
    execution: { status: "completed", exit_code: 0, error: "" },
    metrics: {
      input_tokens: 20000,
      output_tokens: 100,
      total_tokens: 20100,
      wall_ms: 5000,
      codex_turn_count: 1,
      models: ["gpt-5.5"],
      model: "gpt-5.5",
      final_text: "healthy single-session answer",
      unavailable_event_fields: ["first_response_latency"],
    },
    correctness: { status: "passed", reason: "" },
  };
  const status = measurementStatus(run);
  const sessionCheck = status.checks.find((c) => c.name === "all sessions completed");
  assert(sessionCheck, "session check must always be present in checks");
  assert.equal(sessionCheck.passed, true, "session check must pass trivially for single-session runs");
});

// --- MAJOR 2: no-single-page gate also catches date-enumeration shape ---------
// The gate is called twice by materializeFixturePair: once for prose summaries
// and once for date strings. A page containing all required dates (but no prose
// summaries) must be caught by the date-string call.

test("no-single-page-aggregate assert catches a page with all required dates (date-enumeration shape)", () => {
  const dir = makeTmpDir("a3-nsp-dates-fail-");
  try {
    const expectation = aggregationExpectation();
    const dates = expectation.required_terms; // the 5 date strings
    // Page that enumerates all dates inline — no prose summaries.
    writeMarkdown(dir, "date-dump.md", `# All decisions\n\n${dates.join(", ")}\n`);
    // The prose-summary gate would NOT catch this (summaries absent),
    // but the date-string gate must catch it.
    assert.doesNotThrow(() => assertNoSinglePageAggregate(dir, expectation.no_single_page_terms), "prose gate should not trip on dates-only page");
    assert.throws(
      () => assertNoSinglePageAggregate(dir, dates),
      (error) => error.message.includes("no-single-page-aggregate") && error.message.includes("date-dump.md"),
      "date gate must catch a page that lists all required date strings",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no-single-page-aggregate date gate passes when dates are split across pages", () => {
  const dir = makeTmpDir("a3-nsp-dates-pass-");
  try {
    const expectation = aggregationExpectation();
    const dates = expectation.required_terms;
    // One date per page: synthesis required.
    dates.forEach((date, index) => writeMarkdown(dir, `date-${index}.md`, `# Decision ${index}\n\nMade on ${date}.\n`));
    assert.doesNotThrow(() => assertNoSinglePageAggregate(dir, dates));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no-single-page-aggregate error message names matched components for diagnostics", () => {
  const dir = makeTmpDir("a3-nsp-msg-");
  try {
    const terms = ["2026-01-15", "2026-02-09", "2026-03-22"];
    writeMarkdown(dir, "all-dates.md", `dates: ${terms.join(" and ")}`);
    assert.throws(
      () => assertNoSinglePageAggregate(dir, terms),
      (error) => {
        // Message must include the file name and at least one matched component.
        return error.message.includes("all-dates.md") && error.message.includes("2026-01-15");
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// End-to-end: a full small-scale build with both A3 families must pass the
// no-single-page-aggregate gate in EVERY control profile (the gate runs at build
// time in materializeFixturePair). The aggregation facts must be present in the
// control but never all on one page.
test("a small-scale build with A3 families passes the aggregate gate in every profile", { skip }, () => {
  for (const profile of controlProfiles) {
    const fixtureRoot = makeTmpDir(`a3-build-${profile}-`);
    try {
      // buildManifest calls materializeFixturePair, which runs the gate; if any
      // profile pre-aggregated the answer this would throw.
      const manifest = buildManifest({
        fixtureRoot,
        cliPath,
        selectedScales: ["small"],
        selectedTasks: ["multi_session", "aggregation"],
        controlProfile: profile,
      });
      assert.equal(manifest.control_profile, profile);
      // The dated-decision pages exist in the control fixture (facts present).
      const controlRoot = path.join(fixtureRoot, "small", "without_project_librarian");
      const expectation = aggregationExpectation();
      const allText = [];
      function visit(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if ([".git", "node_modules"].includes(entry.name)) continue;
            visit(abs);
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
            allText.push(fs.readFileSync(abs, "utf8"));
          }
        }
      }
      visit(controlRoot);
      const joined = allText.join("\n");
      for (const date of expectation.required_terms) {
        assert(joined.includes(date), `${profile} control missing aggregation date ${date}`);
      }
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
});
