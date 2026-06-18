"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { collectQualityDiagnostics } = require("../../dist/modes.js");
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
