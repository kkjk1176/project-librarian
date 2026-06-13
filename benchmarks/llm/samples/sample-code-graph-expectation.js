"use strict";

// Inline code_graph (impact_trace) expectation shared by the smoke validator and
// the sample-report builder. It replaces the deleted synthetic codeGraphExpectation
// helper as the test data that drives the SHARED code_graph correctness path
// (designation-semantics evaluators in benchmarks/lib/llm-correctness.js, which the
// real-repository corpus also uses).
//
// Shape: the real-corpus answer-key expectation consumed by
// llm-correctness.evaluateCorrectness and validated by real-corpus.validateExpectationShape
// (required_terms, any_terms, forbidden_terms, evidence_by_condition, answer_key_terms).
//
// required_terms is the transitive importer set the checked-in impact_trace sample
// JSONL transcripts (benchmarks/llm/samples/codex-code-graph-impact-trace*.jsonl)
// already report: packages/workspace-0/src/mod-1.ts .. mod-13.ts. Keep these in sync
// with those transcripts — a correct answer must name every path.
const SAMPLE_IMPACT_TRACE_IMPORTERS = [
  "packages/workspace-0/src/mod-1.ts",
  "packages/workspace-0/src/mod-2.ts",
  "packages/workspace-0/src/mod-3.ts",
  "packages/workspace-0/src/mod-4.ts",
  "packages/workspace-0/src/mod-5.ts",
  "packages/workspace-0/src/mod-6.ts",
  "packages/workspace-0/src/mod-7.ts",
  "packages/workspace-0/src/mod-8.ts",
  "packages/workspace-0/src/mod-9.ts",
  "packages/workspace-0/src/mod-10.ts",
  "packages/workspace-0/src/mod-11.ts",
  "packages/workspace-0/src/mod-12.ts",
  "packages/workspace-0/src/mod-13.ts",
];

const sampleImpactTraceExpectation = {
  required_terms: [...SAMPLE_IMPACT_TRACE_IMPORTERS],
  any_terms: [["import", "transitive", "depends", "chain"]],
  forbidden_terms: ["I cannot access"],
  evidence_by_condition: {
    with_project_librarian: ["packages/"],
    without_project_librarian: ["packages/"],
  },
  answer_key_terms: [...SAMPLE_IMPACT_TRACE_IMPORTERS],
};

module.exports = {
  SAMPLE_IMPACT_TRACE_IMPORTERS,
  sampleImpactTraceExpectation,
};
