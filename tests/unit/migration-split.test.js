"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildMigrationBulkReviewPlan, extractMigrationUnits, normalizeMigrationStatus, semanticStatusForInboxStatus } = require("../../dist/migration.js");
const { classifyMigrationUnit } = require("../../dist/taxonomy.js");
const { starterFiles } = require("../../dist/templates.js");

test("extractMigrationUnits classifies mixed legacy content by target document area", () => {
  const units = extractMigrationUnits("checkout.md", [
    "# Checkout Mixed Spec",
    "",
    "## Feature",
    "",
    "Feature: customers can save checkout drafts before payment.",
    "",
    "## UX",
    "",
    "User flow: customer reviews the cart, chooses a payment method, then confirms the order.",
    "",
    "## API",
    "",
    "API endpoint POST /checkout accepts a request body and returns a response with order_id.",
    "",
    "## QA",
    "",
    "Test cases cover expired coupons, duplicate submissions, and payment retry regression.",
    "",
  ].join("\n"));

  const targets = new Set(units.map((unit) => unit.classification.target));
  assert.ok(Array.from(targets).some((target) => target.includes("product-requirements")));
  assert.ok(Array.from(targets).some((target) => target.includes("user-flows")));
  assert.ok(Array.from(targets).some((target) => target.includes("api-contracts")));
  assert.ok(Array.from(targets).some((target) => target.includes("qa-test-plan")));
});

test("extractMigrationUnits ignores form-only legacy templates and empty generated starters", () => {
  const adrTemplate = [
    "---",
    "status: template",
    "updated: 2026-06-01",
    "scope: project-decision-template",
    "---",
    "",
    "# ADR: <Title>",
    "",
    "Status: proposed | accepted | superseded",
    "Date: YYYY-MM-DD",
    "Canonical:",
    "",
    "## Context",
    "",
    "## Decision",
    "",
    "## Consequences",
    "",
  ].join("\n");

  assert.equal(extractMigrationUnits("decisions/full-adr-template.md", adrTemplate).length, 0);
  assert.equal(extractMigrationUnits("canonical/project-brief.md", starterFiles["wiki/canonical/project-brief.md"]).length, 0);
});

test("extractMigrationUnits keeps user-authored pages with the same starter filename", () => {
  const units = extractMigrationUnits("canonical/project-brief.md", [
    "# Project Brief",
    "",
    "## TL;DR",
    "",
    "- EchoPay helps billing operators reconcile failed payouts before month-end close.",
  ].join("\n"));

  assert.ok(units.length > 0);
  assert.ok(units.some((unit) => unit.summary.includes("EchoPay")));
});

function classify(content, legacyPath = "service-notes.md") {
  return classifyMigrationUnit({
    legacyPath,
    heading: "",
    headingPath: [],
    content,
    summary: content,
  });
}

test("classifyMigrationUnit covers service lifecycle taxonomy areas", () => {
  const cases = [
    ["출처 참고 링크 리서치 논문 근거", "sources", "research-sources"],
    ["Decision rationale rejected alternative and tradeoff", "decisions", "decision-records"],
    ["시장 포지셔닝 사업 전략 로드맵 KPI", "canonical", "strategy-context"],
    ["개인정보 보관 정책 환불 운영정책", "canonical", "policy-governance"],
    ["Threat model privacy permission auth compliance legal", "canonical", "security-legal"],
    ["ERD schema event metric analytics tracking", "canonical", "data-analytics"],
    ["Runbook monitoring incident rollout support migration", "canonical", "release-operations"],
    ["Sales CRM billing invoice contract marketing", "canonical", "business-operations"],
    ["위키 문서체계 정본 린트 닥터 document taxonomy", "meta", "wiki-operations"],
  ];

  for (const [content, storage, targetSlug] of cases) {
    const classification = classify(content);
    assert.equal(classification.storage, storage, content);
    assert.match(classification.target, new RegExp(targetSlug), content);
    assert.notEqual(classification.confidence, "low", content);
  }
});

test("classifyMigrationUnit marks weak signals as low-confidence review", () => {
  const classification = classify("Tuesday notes and scattered reminders without reusable context.", "misc.md");

  assert.equal(classification.confidence, "low");
  assert.equal(classification.label, "Needs Human Review");
  assert.match(classification.target, /migration-review/);
});

test("classifyMigrationUnit preserves legacy storage for low-confidence review targets", () => {
  const cases = [
    ["canonical/assumptions.md", "canonical", /wiki\/canonical\/assumptions-migration-review\.md/],
    ["meta/code-map.md", "meta", /wiki\/meta\/code-map-migration-review\.md/],
    ["decisions/old-choice.md", "decisions", /wiki\/decisions\/old-choice-migration-review\.md/],
    ["sources/misc.md", "sources", /wiki\/sources\/misc-migration-review\.md/],
  ];

  for (const [legacyPath, storage, targetPattern] of cases) {
    const classification = classify("Sparse notes without reusable taxonomy signals.", legacyPath);
    assert.equal(classification.confidence, "low", legacyPath);
    assert.equal(classification.storage, storage, legacyPath);
    assert.match(classification.target, targetPattern, legacyPath);
  }
});

test("migration review status normalization preserves terminal and review states", () => {
  assert.equal(normalizeMigrationStatus("adopt this"), "adopted");
  assert.equal(normalizeMigrationStatus("Rejected by reviewer"), "rejected");
  assert.equal(normalizeMigrationStatus("superseded / resolved elsewhere"), "resolved");
  assert.equal(normalizeMigrationStatus("needs human review"), "needs-human-review");
  assert.equal(normalizeMigrationStatus(""), "pending");
  assert.equal(semanticStatusForInboxStatus("adopted"), "adopted");
  assert.equal(semanticStatusForInboxStatus("rejected"), "rejected");
  assert.equal(semanticStatusForInboxStatus("resolved"), "resolved");
  assert.equal(semanticStatusForInboxStatus("needs-human-review"), "needs-human-review");
  assert.equal(semanticStatusForInboxStatus("pending"), "pending semantic rewrite");
});

test("classifyMigrationUnit keeps taxonomy slug in long target filenames", () => {
  const release = classify("release rollout monitoring incident runbook", "canonical/verification-and-skill-installation.md");
  const business = classify("sales marketing crm contract billing invoice", "canonical/verification-and-skill-installation.md");

  assert.match(release.target, /release-operations\.md$/);
  assert.match(business.target, /business-operations\.md$/);
  assert.notEqual(release.target, business.target);
});

test("buildMigrationBulkReviewPlan separates bulk candidates from human-review rows", () => {
  const rows = [
    {
      unitId: "feature.md#u001-feature",
      legacySource: "feature.md",
      unitType: "list-item",
      heading: "Feature",
      summary: "- Customers can save drafts.",
      target: "wiki/canonical/feature-product-requirements.md",
      area: "Product Requirements",
      confidence: "high",
      inboxStatus: "pending",
      semanticStatus: "pending semantic rewrite",
      reason: "matched Product Requirements",
    },
    {
      unitId: "feature.md#u002-feature",
      legacySource: "feature.md",
      unitType: "list-item",
      heading: "Feature",
      summary: "- Customers can resume drafts.",
      target: "wiki/canonical/feature-product-requirements.md",
      area: "Product Requirements",
      confidence: "high",
      inboxStatus: "pending",
      semanticStatus: "pending semantic rewrite",
      reason: "matched Product Requirements",
    },
    {
      unitId: "api.md#u001-api",
      legacySource: "api.md",
      unitType: "list-item",
      heading: "API",
      summary: "- POST /checkout creates an order.",
      target: "wiki/canonical/api-api-contracts.md",
      area: "API Contract",
      confidence: "medium",
      inboxStatus: "pending",
      semanticStatus: "pending semantic rewrite",
      reason: "matched API Contract",
    },
    {
      unitId: "notes.md#u001-notes",
      legacySource: "notes.md",
      unitType: "heading",
      heading: "TL;DR",
      summary: "TL;DR",
      target: "wiki/canonical/notes-migration-review.md",
      area: "Needs Human Review",
      confidence: "low",
      inboxStatus: "needs-human-review",
      semanticStatus: "needs-human-review",
      reason: "no strong taxonomy signal",
    },
    {
      unitId: "notes.md#u002-notes",
      legacySource: "notes.md",
      unitType: "list-item",
      heading: "TL;DR",
      summary: "- Preserve this ambiguous but useful product note.",
      target: "wiki/canonical/notes-migration-review.md",
      area: "Needs Human Review",
      confidence: "low",
      inboxStatus: "needs-human-review",
      semanticStatus: "needs-human-review",
      reason: "no strong taxonomy signal",
    },
    {
      unitId: "done.md#u001-done",
      legacySource: "done.md",
      unitType: "list-item",
      heading: "Done",
      summary: "- Done item.",
      target: "wiki/canonical/done-product-requirements.md",
      area: "Product Requirements",
      confidence: "high",
      inboxStatus: "adopted",
      semanticStatus: "adopted",
      reason: "matched Product Requirements",
    },
  ];

  const plan = buildMigrationBulkReviewPlan(rows);

  assert.equal(plan.totalRows, 6);
  assert.equal(plan.completedRows, 1);
  assert.equal(plan.openRows, 5);
  assert.equal(plan.highConfidenceRows, 2);
  assert.equal(plan.mediumConfidenceRows, 1);
  assert.equal(plan.humanReviewRows, 2);
  assert.equal(plan.humanReviewStructuralRows, 1);
  assert.equal(plan.humanReviewContentRows, 1);
  assert.equal(plan.highTargetGroups.length, 1);
  assert.equal(plan.highTargetGroups[0].rows, 2);
  assert.equal(plan.mediumTargetGroups.length, 1);
  assert.equal(plan.humanReviewSourceGroups.length, 1);
  assert.equal(plan.humanReviewStructuralSourceGroups.length, 1);
  assert.equal(plan.humanReviewContentSourceGroups.length, 1);
  assert.equal(plan.humanReviewContentSourceGroups[0].sampleSummaries[0], "- Preserve this ambiguous but useful product note.");
  assert.equal(plan.singleTargetSourceGroups.some((group) => group.key === "feature.md" && group.rows === 2), true);
});
