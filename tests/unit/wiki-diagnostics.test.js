"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildPruneCandidate, collectLinkDiagnostics, collectMigrationQualityDiagnostics, collectQualityDiagnostics } = require("../../dist/modes.js");
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

function v2Page(file, { body = "", owner = "product", prdId = "", service = "", type = "shared" } = {}) {
  return {
    file,
    text: [
      "---",
      "status: active",
      "updated: 2026-08-09",
      "scope: v2-fixture",
      `type: ${type}`,
      "read_budget: short",
      "decision_ref: none",
      "review_trigger: fixture changes",
      `owner: ${owner}`,
      ...(service ? [`service: ${service}`] : []),
      ...(prdId ? [`prd_id: ${prdId}`] : []),
      "---",
      "",
      "# V2 Fixture",
      "",
      "## TL;DR",
      "",
      "- Diagnostic fixture.",
      "",
      body,
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

test("v2 diagnostics detect duplicate PRD IDs, registry drift, and PRD area/type mismatch", () => {
  const fixturePages = [
    v2Page("wiki/00-index/prd-registry.md", { body: "- [[10-services/payments/prds/PRD-012-checkout/README]]", type: "router" }),
    v2Page("wiki/00-index/service-map.md", { body: "- [[10-services/payments/README]]\n- [[10-services/orders/README]]", type: "router" }),
    v2Page("wiki/10-services/payments/README.md", { service: "payments", type: "service-hub" }),
    v2Page("wiki/10-services/orders/README.md", { service: "orders", type: "service-hub" }),
    v2Page("wiki/10-services/payments/prds/PRD-012-checkout/README.md", { prdId: "PRD-012", service: "payments", type: "prd-hub" }),
    v2Page("wiki/10-services/orders/prds/PRD-012-order-checkout/README.md", { prdId: "PRD-012", service: "orders", type: "prd-hub" }),
    v2Page("wiki/10-services/payments/prds/PRD-012-checkout/03-design/api.md", { prdId: "PRD-012", service: "payments", type: "requirements" }),
  ];
  const diagnostics = collectLinkDiagnostics(corpus(fixturePages));
  assert(diagnostics.some((diagnostic) => diagnostic.code === "duplicate-prd-id"));
  assert(diagnostics.some((diagnostic) => diagnostic.code === "registry-hub-mismatch" && /orders\/prds/.test(diagnostic.file)));
  assert(diagnostics.some((diagnostic) => diagnostic.code === "area-type-mismatch" && diagnostic.file.endsWith("03-design/api.md")));
});

test("v2 diagnostics count only PRD root README files as PRD hubs", () => {
  const fixturePages = [
    v2Page("wiki/00-index/prd-registry.md", {
      body: [
        "| PRD ID | Service | Owner | Hub | Status |",
        "| --- | --- | --- | --- | --- |",
        "| PRD-012 | payments | checkout | [[10-services/payments/prds/PRD-012-checkout/README]] | active |",
      ].join("\n"),
      type: "router",
    }),
    v2Page("wiki/10-services/payments/prds/PRD-012-checkout/README.md", { prdId: "PRD-012", service: "payments", type: "prd-hub" }),
    v2Page("wiki/10-services/payments/prds/PRD-012-checkout/01-discovery/README.md", { prdId: "PRD-012", service: "payments", type: "discovery" }),
    v2Page("wiki/10-services/payments/prds/PRD-012-checkout/02-requirements/README.md", { prdId: "PRD-012", service: "payments", type: "requirements" }),
  ];

  const diagnostics = collectLinkDiagnostics(corpus(fixturePages));
  assert.equal(diagnostics.some((diagnostic) => diagnostic.code === "duplicate-prd-id"), false);
});

test("v2 diagnostics validate registry table identity and missing registered service hubs", () => {
  const fixturePages = [
    v2Page("wiki/00-index/prd-registry.md", {
      body: [
        "| PRD ID | Service | Owner | Hub | Status |",
        "| --- | --- | --- | --- | --- |",
        "| PRD-012 | payments | checkout | [[10-services/orders/prds/PRD-099-wrong/README]] | active |",
        "| PRD-012 | payments | checkout | [[10-services/payments/prds/PRD-012-checkout/README]] | active |",
      ].join("\n"),
      type: "router",
    }),
    v2Page("wiki/00-index/service-map.md", {
      body: [
        "| Service | Owner | Hub | Status |",
        "| --- | --- | --- | --- |",
        "| payments | platform | [[10-services/payments/README]] | active |",
        "| missing | platform | [[10-services/missing/README]] | active |",
      ].join("\n"),
      type: "router",
    }),
    v2Page("wiki/10-services/payments/README.md", { service: "payments", type: "service-hub" }),
    v2Page("wiki/10-services/payments/prds/PRD-012-checkout/README.md", { prdId: "PRD-012", service: "payments", type: "prd-hub" }),
  ];

  const diagnostics = collectLinkDiagnostics(corpus(fixturePages));
  assert(diagnostics.some((diagnostic) => diagnostic.code === "duplicate-prd-id" && diagnostic.file === "wiki/00-index/prd-registry.md"));
  assert(diagnostics.some((diagnostic) => diagnostic.code === "registry-entry-mismatch" && /PRD-012/.test(diagnostic.message)));
  assert(diagnostics.some((diagnostic) => diagnostic.code === "registry-hub-mismatch" && /registered service hub is missing/.test(diagnostic.message)));
});

test("historical legacy pages are excluded from reachability noise while active legacy remains visible", () => {
  const fixturePages = [
    page("wiki/startup.md", { body: "- [[index]]", scope: "startup-router", title: "Startup" }),
    page("wiki/index.md", { body: "- [[20-shared/README]]", scope: "wiki-router", title: "Index" }),
    v2Page("wiki/20-shared/README.md", { type: "shared" }),
    page("wiki/canonical/active-a.md", { body: "- [[canonical/active-b]]", status: "active", title: "Active A" }),
    page("wiki/canonical/active-b.md", { body: "- [[canonical/active-a]]", status: "active", title: "Active B" }),
    page("wiki/canonical/superseded-a.md", { body: "- [[canonical/superseded-b]]", status: "superseded", title: "Superseded A" }),
    page("wiki/canonical/superseded-b.md", { body: "- [[canonical/superseded-a]]", status: "compatibility", title: "Superseded B" }),
    page("wiki/canonical/archived.md", { status: "archived", title: "Archived" }),
  ];

  const diagnostics = collectLinkDiagnostics(corpus(fixturePages));
  const reachability = diagnostics.filter((diagnostic) => ["orphan-page", "router-unreachable", "router-depth-exceeded"].includes(diagnostic.code));
  assert(reachability.some((diagnostic) => diagnostic.file === "wiki/canonical/active-a.md"));
  assert(reachability.some((diagnostic) => diagnostic.file === "wiki/canonical/active-b.md"));
  assert.equal(reachability.some((diagnostic) => /superseded|archived/.test(diagnostic.file)), false);
});

test("migration quality rejects v2 truth that depends on preserved legacy roots", () => {
  const diagnostics = collectMigrationQualityDiagnostics(corpus([
    v2Page("wiki/20-shared/bad-reference.md", { body: "Read wiki_legacy/canonical/old.md as the current source of truth.", type: "shared" }),
    v2Page("wiki/meta/migration-note.md", { body: "The preserved source is wiki_legacy/canonical/old.md.", type: "wiki-meta" }),
  ]));
  assert(diagnostics.some((diagnostic) => diagnostic.code === "migration-legacy-reference" && diagnostic.file === "wiki/20-shared/bad-reference.md"));
  assert.equal(diagnostics.some((diagnostic) => diagnostic.file === "wiki/meta/migration-note.md"), false);
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
