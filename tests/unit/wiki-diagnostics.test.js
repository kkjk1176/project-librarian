"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildPruneCandidate, collectLinkDiagnostics, collectQualityDiagnostics } = require("../../dist/modes.js");
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

function page(file, { body = "", decisionRef = "none", readBudget = "medium", reviewTrigger = "specific fixture changes", scope = "project-canonical", status = "active", title = "Diagnostic Fixture", updated = "2026-06-20" } = {}) {
  return {
    file,
    text: [
      "---",
      `status: ${status}`,
      `updated: ${updated}`,
      `scope: ${scope}`,
      `read_budget: ${readBudget}`,
      `decision_ref: ${decisionRef}`,
      `review_trigger: ${reviewTrigger}`,
      "---",
      "",
      `# ${title}`,
      "",
      "## TL;DR",
      "",
      "- Diagnostic fixture.",
      "",
      body,
      "",
    ].join("\n"),
  };
}

function corpus(pages) {
  return {
    files: pages.map((item) => item.file),
    fileSet: new Set(pages.map((item) => item.file)),
    pages,
    textByFile: new Map(pages.map((item) => [item.file, item.text])),
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
  }, { today: "2026-06-18" });
  const staleFiles = diagnostics
    .filter((diagnostic) => diagnostic.code === "stale-review")
    .map((diagnostic) => diagnostic.file);

  assert.deepEqual(staleFiles, ["wiki/canonical/old.md"]);
});

test("topology diagnostics warn on overloaded hubs and weak generated-only routes", () => {
  const hubLinks = Array.from({ length: 65 }, (_, index) => `- [[canonical/hub-target-${index}]]`).join("\n");
  const fixturePages = [
    page("wiki/startup.md", { body: "- [[index]]", scope: "startup-router", title: "Startup" }),
    page("wiki/index.md", { body: "- [[indexes/auto-canonical]]", scope: "wiki-router", title: "Index" }),
    page("wiki/meta/large-hub.md", { body: hubLinks, scope: "wiki-meta", title: "Large Hub" }),
    page("wiki/indexes/auto-canonical.md", { body: "- [[canonical/generated-only]]", scope: "wiki-router", title: "Auto Canonical" }),
    page("wiki/canonical/generated-only.md", { decisionRef: "wiki/decisions/generated-only.md", title: "Generated Only" }),
    page("wiki/decisions/generated-only.md", { scope: "project-decisions", title: "Generated Only Decision" }),
    ...Array.from({ length: 65 }, (_, index) => page(`wiki/canonical/hub-target-${index}.md`, { title: `Hub Target ${index}` })),
  ];
  const diagnostics = collectLinkDiagnostics(corpus(fixturePages));
  assert(diagnostics.some((diagnostic) => diagnostic.code === "hub-overload" && diagnostic.file === "wiki/meta/large-hub.md"));
  assert(diagnostics.some((diagnostic) => diagnostic.code === "weak-authority-route" && diagnostic.file === "wiki/canonical/generated-only.md"));
});

test("topology diagnostics warn on evidence claims without evidence links and stale fanout", () => {
  const fixturePages = [
    page("wiki/startup.md", { body: "- [[index]]", scope: "startup-router", title: "Startup" }),
    page("wiki/index.md", { body: "- [[canonical/evidence-claim]]\n- [[canonical/fanout-target]]", scope: "wiki-router", title: "Index" }),
    page("wiki/canonical/evidence-claim.md", {
      body: "This source-backed claim summarizes external research without linking evidence.",
      title: "Evidence Claim",
    }),
    page("wiki/canonical/fanout-target.md", {
      reviewTrigger: "project changes",
      title: "Fanout Target",
    }),
    ...Array.from({ length: 8 }, (_, index) => page(`wiki/plans/fanout-source-${index}.md`, {
      body: "- [[canonical/fanout-target]]",
      scope: "project-plan",
      title: `Fanout Source ${index}`,
    })),
  ];
  const diagnostics = collectLinkDiagnostics(corpus(fixturePages));
  assert(diagnostics.some((diagnostic) => diagnostic.code === "missing-evidence-link" && diagnostic.file === "wiki/canonical/evidence-claim.md"));
  assert(diagnostics.some((diagnostic) => diagnostic.code === "stale-fanout" && diagnostic.file === "wiki/canonical/fanout-target.md"));
});

test("topology diagnostics keep generated, routine canonical, and historical pages quiet", () => {
  const fixturePages = [
    page("wiki/startup.md", { body: "- [[index]]", scope: "startup-router", title: "Startup" }),
    page("wiki/index.md", { body: "- [[indexes/auto-canonical]]", scope: "wiki-router", title: "Index" }),
    page("wiki/indexes/auto-canonical.md", { body: "- [[canonical/routine-generated]]\n" + Array.from({ length: 80 }, (_, index) => `- [[canonical/generated-${index}]]`).join("\n"), scope: "wiki-router", title: "Auto Canonical" }),
    page("wiki/canonical/routine-generated.md", { title: "Routine Generated" }),
    page("wiki/decisions/history.md", { body: "This source-backed historical decision is intentionally not a canonical claim.", scope: "project-decisions", title: "History" }),
    page("wiki/migration/coverage.md", { body: "source-backed migration row", scope: "migration-ledger", title: "Coverage" }),
    ...Array.from({ length: 80 }, (_, index) => page(`wiki/canonical/generated-${index}.md`, { title: `Generated ${index}` })),
  ];
  const diagnostics = collectLinkDiagnostics(corpus(fixturePages));
  assert.equal(diagnostics.some((diagnostic) => ["hub-overload", "missing-evidence-link", "stale-fanout"].includes(diagnostic.code)), false);
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
