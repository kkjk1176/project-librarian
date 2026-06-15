"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  SEEDED_DECISION,
  buildManifest,
  controlProfiles,
} = require("../../benchmarks/lib/llm-fixtures");
const { evaluateCorrectness } = require("../../benchmarks/lib/llm-correctness");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");
const skip = !fs.existsSync(cliPath) ? "dist CLI not built" : false;

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function controlRootFor(manifest, scale) {
  return path.join(manifest.fixture_root, scale, "without_project_librarian");
}

// Read all Markdown text under the control root so "answer present" checks do not
// depend on which file a profile put the fact in.
function allMarkdownText(root) {
  const texts = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if ([".git", "node_modules"].includes(entry.name)) continue;
        visit(abs);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        texts.push(fs.readFileSync(abs, "utf8"));
      }
    }
  }
  visit(root);
  return texts.join("\n");
}

test("controlProfiles is exactly bare/organic/curated", () => {
  assert.deepEqual([...controlProfiles].sort(), ["bare", "curated", "organic"]);
});

test("each control profile materializes with the seeded answer present", { skip }, () => {
  for (const profile of controlProfiles) {
    const fixtureRoot = makeTmpDir(`a2-present-${profile}-`);
    try {
      const manifest = buildManifest({
        fixtureRoot,
        cliPath,
        selectedScales: ["small"],
        selectedTasks: ["decision_lookup"],
        controlProfile: profile,
      });
      assert.equal(manifest.control_profile, profile);
      const text = allMarkdownText(controlRootFor(manifest, "small"));
      // The seeded decision and its date must be findable in every profile so
      // correctness stays satisfiable.
      assert(text.includes(SEEDED_DECISION.date), `${profile} control missing seeded date`);
      assert(text.toLowerCase().includes("benchmark"), `${profile} control missing benchmark facts`);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
});

test("organic control plants dated distractor decisions strictly earlier than the seeded date", { skip }, () => {
  const fixtureRoot = makeTmpDir("a2-organic-dates-");
  try {
    const manifest = buildManifest({
      fixtureRoot,
      cliPath,
      selectedScales: ["small"],
      selectedTasks: ["decision_lookup"],
      controlProfile: "organic",
    });
    const text = allMarkdownText(controlRootFor(manifest, "small"));
    const dates = [...new Set([...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((match) => match[1]))];
    const distractors = dates.filter((date) => date !== SEEDED_DECISION.date);
    assert(distractors.length >= 2, `expected >= 2 distractor dates, got ${JSON.stringify(distractors)}`);
    for (const date of distractors) {
      assert(date < SEEDED_DECISION.date, `distractor ${date} is not strictly earlier than ${SEEDED_DECISION.date}`);
    }
    assert(dates.includes(SEEDED_DECISION.date), "seeded date must still be present so it remains the latest decision");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("manifest schema_version is 5 and carries control_profile and corpus top-level and per scenario", { skip }, () => {
  const fixtureRoot = makeTmpDir("a2-manifest-");
  try {
    const manifest = buildManifest({
      fixtureRoot,
      cliPath,
      selectedScales: ["small"],
      selectedTasks: ["decision_lookup"],
      controlProfile: "bare",
    });
    // schema_version 5 (corpus dimension) supersedes 4 (A3) and 3 (A2);
    // control_profile and the synthetic corpus label are recorded top-level and
    // per scenario.
    assert.equal(manifest.schema_version, 5);
    assert.equal(manifest.control_profile, "bare");
    assert.equal(manifest.corpus, "synthetic");
    assert(manifest.scenarios.length > 0);
    for (const scenario of manifest.scenarios) {
      assert.equal(scenario.control_profile, "bare");
      assert.equal(scenario.corpus, "synthetic");
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("buildManifest rejects an unknown control profile", { skip }, () => {
  const fixtureRoot = makeTmpDir("a2-bad-profile-");
  try {
    assert.throws(
      () => buildManifest({ fixtureRoot, cliPath, selectedScales: ["small"], selectedTasks: ["decision_lookup"], controlProfile: "deluxe" }),
      /unknown control profile: deluxe/,
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("control-side correctness is profile-aware and satisfiable per profile", () => {
  // decision_lookup: a correct answer citing the profile's decision file passes.
  const decisionAnswers = {
    curated: "Latest decision 2026-06-10: benchmark comparison adopted, see docs/decisions.md.",
    organic: "Latest decision 2026-06-10: benchmark comparison adopted, see docs/notes/decision-log.md.",
    bare: "Latest decision 2026-06-10: benchmark comparison adopted, see docs/NOTES.md.",
  };
  for (const profile of controlProfiles) {
    const result = evaluateCorrectness({
      taskFamily: "decision_lookup",
      condition: "without_project_librarian",
      finalText: decisionAnswers[profile],
      fileChangeCount: 0,
      controlProfile: profile,
    });
    assert.equal(result.status, "passed", `${profile} decision_lookup: ${result.reason}`);
  }
});

test("a missing control profile in a static expectation throws loudly", () => {
  assert.throws(
    () => evaluateCorrectness({
      taskFamily: "decision_lookup",
      condition: "without_project_librarian",
      finalText: "2026-06-10 benchmark decision",
      fileChangeCount: 0,
      controlProfile: "does-not-exist",
    }),
    /missing control-profile evidence for profile "does-not-exist"/,
  );
});

test("with-condition correctness is unaffected by the control profile", () => {
  // The with-condition evidence is a plain array (not profile-keyed), so the
  // profile argument is irrelevant; the maintained-wiki answer passes regardless.
  const withText = "2026-06-10 metrics decision in wiki/decisions/log.md and wiki/canonical/benchmark-and-release-evidence.md.";
  for (const profile of controlProfiles) {
    const result = evaluateCorrectness({
      taskFamily: "decision_lookup",
      condition: "with_project_librarian",
      finalText: withText,
      fileChangeCount: 0,
      controlProfile: profile,
    });
    assert.equal(result.status, "passed", `with-condition under ${profile}: ${result.reason}`);
  }
});
