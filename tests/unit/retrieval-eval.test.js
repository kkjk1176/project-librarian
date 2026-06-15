"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { computeRetrievalMetrics } = require("../../dist/retrieval-eval.js");

test("retrieval metrics score source hits, precision, block integrity, hops, and answer terms", () => {
  const metrics = computeRetrievalMetrics([
    {
      id: "result-1",
      blockId: "wiki/canonical/auth.md#decision-row-1",
      blockIntact: true,
      bytes: 40,
      hop: 0,
      sourceId: "wiki/canonical/auth.md",
      text: "OAuth decision row",
    },
    {
      id: "result-2",
      blockIntact: false,
      bytes: 100,
      hop: 2,
      sourceId: "wiki/canonical/noisy.md",
      text: "Unrelated noisy context",
    },
  ], {
    relevantSourceIds: ["wiki/canonical/auth.md#decision-row-1"],
    requiredAnswerTerms: ["OAuth", "decision"],
    requiredSourceIds: ["wiki/canonical/auth.md#decision-row-1"],
  }, {
    outputText: "The answer cites the OAuth decision.",
    topK: 2,
  });

  assert.equal(metrics.top_k, 2);
  assert.equal(metrics.considered_results, 2);
  assert.equal(metrics.required_source_count, 1);
  assert.equal(metrics.required_source_hits, 1);
  assert.equal(metrics.source_hit_rate, 1);
  assert.equal(metrics.evidence_precision, 0.5);
  assert.equal(metrics.block_integrity, 0.5);
  assert.equal(metrics.max_hop_count, 2);
  assert.equal(metrics.scan_bytes, 140);
  assert.equal(metrics.answer_correct, true);
  assert.ok(metrics.output_bytes > 0);
});

test("retrieval metrics respect top-k boundaries for missed evidence", () => {
  const results = [
    { id: "noise", sourceId: "wiki/noise.md", text: "noise" },
    { id: "hit", sourceId: "wiki/target.md", text: "target" },
  ];

  const topOne = computeRetrievalMetrics(results, {
    relevantSourceIds: ["wiki/target.md"],
    requiredSourceIds: ["wiki/target.md"],
  }, { topK: 1 });
  assert.equal(topOne.source_hit_rate, 0);
  assert.equal(topOne.evidence_precision, 0);

  const topTwo = computeRetrievalMetrics(results, {
    relevantSourceIds: ["wiki/target.md"],
    requiredSourceIds: ["wiki/target.md"],
  }, { topK: 2 });
  assert.equal(topTwo.source_hit_rate, 1);
  assert.equal(topTwo.evidence_precision, 0.5);
});

test("retrieval metrics handle empty expectations and empty results explicitly", () => {
  const metrics = computeRetrievalMetrics([], {}, { outputText: "" });
  assert.equal(metrics.source_hit_rate, 1);
  assert.equal(metrics.evidence_precision, 0);
  assert.equal(metrics.block_integrity, 1);
  assert.equal(metrics.answer_correct, null);
  assert.equal(metrics.output_bytes, 0);
  assert.equal(metrics.scan_bytes, 0);
});

test("retrieval metrics normalize duplicate expectations and invalid byte options", () => {
  const metrics = computeRetrievalMetrics([
    { id: "target", sourceId: "wiki/target.md", text: "needle" },
  ], {
    relevantSourceIds: ["wiki/target.md", "wiki/target.md", ""],
    requiredAnswerTerms: ["needle", "needle", ""],
    requiredSourceIds: ["wiki/target.md", "wiki/target.md", ""],
  }, {
    outputText: "Needle found",
    scanBytes: -10,
  });

  assert.equal(metrics.required_source_count, 1);
  assert.equal(metrics.required_source_hits, 1);
  assert.equal(metrics.source_hit_rate, 1);
  assert.equal(metrics.evidence_precision, 1);
  assert.equal(metrics.answer_correct, true);
  assert.equal(metrics.scan_bytes, 0);
});
