"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ANSWER_PAGE_ROUTES,
  SEEDED_DECISION,
  assertBoundedAnswerReachability,
  assertRouterTruthConsistency,
  maintainedIndex,
  maintainedRecentDecisions,
  maintainedStartup,
  materializeFixturePair,
} = require("../../benchmarks/lib/llm-fixtures");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");

// Hook budgets from src/hooks.ts: startup 3500, index 4500. The maintained
// routers must stay within these so the SessionStart hook does not truncate them.
const STARTUP_BUDGET = 3500;
const INDEX_BUDGET = 4500;

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeRouter(root, relative, content) {
  const filePath = path.join(root, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

// A maintained router set that should satisfy both asserts.
function seedMaintainedRouters(root) {
  writeRouter(root, "wiki/decisions/log.md", `# Decision Log\n\n- ${SEEDED_DECISION.date} | ${SEEDED_DECISION.category} | ${SEEDED_DECISION.summary}.\n`);
  writeRouter(root, "wiki/decisions/recent.md", maintainedRecentDecisions());
  writeRouter(root, "wiki/startup.md", maintainedStartup());
  writeRouter(root, "wiki/index.md", maintainedIndex());
}

test("maintained routers stay within the session-hook budgets", () => {
  assert(maintainedStartup().length <= STARTUP_BUDGET, `startup ${maintainedStartup().length} exceeds ${STARTUP_BUDGET}`);
  assert(maintainedIndex().length <= INDEX_BUDGET, `index ${maintainedIndex().length} exceeds ${INDEX_BUDGET}`);
});

test("maintained startup and recent carry the seeded dated decision and never say None yet.", () => {
  const startup = maintainedStartup();
  const recent = maintainedRecentDecisions();
  for (const [name, text] of [["startup", startup], ["recent", recent]]) {
    assert(!text.includes("None yet."), `${name} still says "None yet."`);
    assert(text.includes(SEEDED_DECISION.date), `${name} missing seeded decision date`);
  }
  assert(startup.includes("[[index]]"), "startup must link [[index]] for hop 1");
});

test("router-truth consistency assert passes on a maintained router set", () => {
  const root = makeTmpDir("a1-truth-pass-");
  try {
    seedMaintainedRouters(root);
    assert.doesNotThrow(() => assertRouterTruthConsistency(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("router-truth consistency assert throws when a router still says None yet.", () => {
  const root = makeTmpDir("a1-truth-fail-");
  try {
    seedMaintainedRouters(root);
    // Simulate the measured contradiction: log holds a dated entry but recent.md
    // reverts to the bootstrap "None yet." template.
    writeRouter(root, "wiki/decisions/recent.md", "# Recent Decisions\n\n## Decisions\n\n- None yet.\n");
    assert.throws(
      () => assertRouterTruthConsistency(root),
      (error) => error.message.includes("None yet.") && error.message.includes("recent.md"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("router-truth consistency assert throws when a router lacks the seeded date", () => {
  const root = makeTmpDir("a1-truth-date-");
  try {
    seedMaintainedRouters(root);
    // startup.md without the seeded date but also without "None yet." must still
    // fail: a maintained router must surface the dated decision.
    writeRouter(root, "wiki/startup.md", "# Startup Context\n\n## Recent Project Decisions\n\n- benchmark evidence adopted.\n");
    assert.throws(
      () => assertRouterTruthConsistency(root),
      (error) => error.message.includes(SEEDED_DECISION.date) && error.message.includes("startup.md"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("router-truth consistency assert is a no-op when the log has no dated entry", () => {
  const root = makeTmpDir("a1-truth-empty-");
  try {
    writeRouter(root, "wiki/decisions/log.md", "# Decision Log\n\nNo project decisions yet.\n");
    writeRouter(root, "wiki/startup.md", "# Startup Context\n\n## Recent Project Decisions\n\n- None yet.\n");
    writeRouter(root, "wiki/decisions/recent.md", "# Recent Decisions\n\n- None yet.\n");
    // No dated entry in the log => nothing to enforce, so "None yet." is allowed.
    assert.doesNotThrow(() => assertRouterTruthConsistency(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bounded reachability assert passes when the index routes every answer page", () => {
  const root = makeTmpDir("a1-reach-pass-");
  try {
    seedMaintainedRouters(root);
    assert.doesNotThrow(() => assertBoundedAnswerReachability(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bounded reachability assert throws when an answer route is removed from the index", () => {
  const root = makeTmpDir("a1-reach-fail-");
  try {
    seedMaintainedRouters(root);
    // Remove one hand-routed answer page from the index.
    const removed = ANSWER_PAGE_ROUTES[0].page.replace(/^canonical\//, "canonical/").replace(/\.md$/, "");
    const indexText = fs.readFileSync(path.join(root, "wiki", "index.md"), "utf8").replace(`[[${removed}]]`, "[[canonical/unrelated]]");
    fs.writeFileSync(path.join(root, "wiki", "index.md"), indexText);
    assert.throws(
      () => assertBoundedAnswerReachability(root),
      (error) => error.message.includes(ANSWER_PAGE_ROUTES[0].page) && error.message.includes("hop 2"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bounded reachability assert throws when startup does not link the index", () => {
  const root = makeTmpDir("a1-reach-hop1-");
  try {
    seedMaintainedRouters(root);
    fs.writeFileSync(path.join(root, "wiki", "startup.md"), "# Startup Context\n\nNo index link here.\n");
    assert.throws(
      () => assertBoundedAnswerReachability(root),
      /hop 1 broken/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// End-to-end: a real small-scale fixture pair must materialize (CLI bootstrap +
// maintained-router overwrite + --refresh-index + both A1 asserts) without
// throwing, and the resulting routers must reflect the maintained state.
test("normal small-scale fixture build passes the A1 asserts and is maintained", { skip: !fs.existsSync(cliPath) ? "dist CLI not built" : false }, () => {
  const fixtureRoot = makeTmpDir("a1-build-");
  try {
    materializeFixturePair(fixtureRoot, "small", cliPath, "organic");
    const withRoot = path.join(fixtureRoot, "small", "with_project_librarian");
    const startup = fs.readFileSync(path.join(withRoot, "wiki", "startup.md"), "utf8");
    const recent = fs.readFileSync(path.join(withRoot, "wiki", "decisions", "recent.md"), "utf8");
    const index = fs.readFileSync(path.join(withRoot, "wiki", "index.md"), "utf8");
    assert(!startup.includes("None yet."));
    assert(startup.includes(SEEDED_DECISION.date));
    assert(!recent.includes("None yet."));
    assert(recent.includes(SEEDED_DECISION.date));
    assert(startup.length <= STARTUP_BUDGET);
    assert(index.length <= INDEX_BUDGET, `built index ${index.length} exceeds ${INDEX_BUDGET}`);
    // Hand-routed answer pages survive --refresh-index.
    for (const route of ANSWER_PAGE_ROUTES) {
      const link = `[[${route.page.replace(/\.md$/, "")}]]`;
      assert(index.includes(link), `built index missing ${link}`);
    }
    // The asserts re-run clean against the built fixture.
    assert.doesNotThrow(() => assertRouterTruthConsistency(withRoot));
    assert.doesNotThrow(() => assertBoundedAnswerReachability(withRoot));
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
