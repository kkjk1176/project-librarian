"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildPruneCandidate, collectQualityDiagnostics } = require("../../dist/modes.js");
const { staleReviewAge, staleReviewAgeDays } = require("../../dist/wiki-diagnostics.js");

function wikiFile(path, { updated }) {
  return {
    path,
    content: [
      "---",
      "status: active",
      `updated: ${updated}`,
      "scope: project-canonical",
      "read_budget: short",
      "decision_ref: none",
      "review_trigger: regression fixture",
      "---",
      "",
      "# Diagnostic Fixture",
      "",
      "## TL;DR",
      "",
      "- Fixture page with enough metadata for quality diagnostics.",
      "",
    ].join("\n"),
  };
}

function prunePage({ body = "", reviewTrigger = "regression fixture", scope = "project-canonical", updated = "2026-06-20" } = {}) {
  return [
    "---",
    "status: active",
    `updated: ${updated}`,
    `scope: ${scope}`,
    "read_budget: short",
    "decision_ref: none",
    `review_trigger: ${reviewTrigger}`,
    "---",
    "",
    "# Prune Fixture",
    "",
    body,
    "",
  ].join("\n");
}

test("staleReviewAge only flags active review dates beyond the age threshold", () => {
  assert.equal(staleReviewAge("2026-05-20", "2026-06-18"), null);
  assert.equal(staleReviewAge("2026-05-19", "2026-06-18"), null);
  assert.equal(staleReviewAge("2026-05-18", "2026-06-18"), staleReviewAgeDays + 1);
  assert.equal(staleReviewAge("not-a-date", "2026-06-18"), null);
});

test("quality diagnostics keep recent reviews quiet and flag old active canonical pages", () => {
  const pages = [
    wikiFile("wiki/canonical/recent.md", { updated: "2026-06-01" }),
    wikiFile("wiki/canonical/old.md", { updated: "2000-01-01" }),
  ];
  const diagnostics = collectQualityDiagnostics({
    files: pages.map((page) => page.path),
    fileSet: new Set(pages.map((page) => page.path)),
    pages: pages.map((page) => ({ file: page.path, text: page.content })),
    textByFile: new Map(pages.map((page) => [page.path, page.content])),
  });
  const staleFiles = diagnostics
    .filter((diagnostic) => diagnostic.code === "stale-review")
    .map((diagnostic) => diagnostic.file);

  assert.deepEqual(staleFiles, ["wiki/canonical/old.md"]);
});

test("strict prune candidates omit age-only pages", () => {
  const text = prunePage({ reviewTrigger: "routine review", updated: "2026-06-20" });
  const defaultCandidate = buildPruneCandidate("wiki/canonical/age-only.md", text, { today: "2026-06-21" });
  assert.deepEqual(defaultCandidate.reasons, ["updated before today: 2026-06-20"]);
  assert.equal(buildPruneCandidate("wiki/canonical/age-only.md", text, { strict: true, today: "2026-06-21" }), null);
});

test("strict prune candidates keep unresolved lifecycle signals", () => {
  const text = prunePage({ body: "- TODO: resolve the lifecycle decision.", reviewTrigger: "routine review", updated: "2026-06-20" });
  const candidate = buildPruneCandidate("wiki/canonical/unresolved.md", text, { strict: true, today: "2026-06-21" });
  assert(candidate);
  assert(candidate.reasons.includes("contains pending/proposed/undecided signal"));
  assert(candidate.reasons.includes("updated before today: 2026-06-20"));
});
