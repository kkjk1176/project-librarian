"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const { sampleCorpusDefinitions } = require("../../benchmarks/tools/code-performance-efficiency.js");

test("code performance harness includes the checked-in mixed corpus sample", () => {
  const samples = sampleCorpusDefinitions();
  const mixed = samples.find((sample) => sample.name === "mixed-monorepo");

  assert(mixed, "missing mixed-monorepo sample corpus");
  assert.equal(mixed.corpus_kind, "mixed");
  assert.equal(mixed.terms.symbol, "getBillingSummary");
  for (const sample of samples) {
    assert(fs.existsSync(sample.source), `${sample.name} source path should exist`);
    assert(sample.terms.symbol, `${sample.name} should define a representative symbol query`);
  }
});
