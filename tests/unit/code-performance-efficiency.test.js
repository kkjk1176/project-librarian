"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const { sampleCorpusDefinitions } = require("../../benchmarks/tools/code-performance-efficiency.js");

function listFiles(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = `${root}/${entry.name}`;
    if (entry.isDirectory()) return listFiles(fullPath);
    return [fullPath];
  });
}

test("code performance harness includes diverse checked-in sample corpora", () => {
  const samples = sampleCorpusDefinitions();
  const mixed = samples.find((sample) => sample.name === "mixed-monorepo");
  const kinds = new Set(samples.map((sample) => sample.corpus_kind));

  assert(samples.length >= 4, "expected at least four checked-in sample corpora");
  assert(kinds.has("mixed"), "missing mixed corpus coverage");
  assert(kinds.has("service"), "missing service corpus coverage");
  assert(kinds.has("single-language"), "missing single-language corpus coverage");
  assert(kinds.has("docs-heavy"), "missing docs-heavy corpus coverage");
  assert(mixed, "missing mixed-monorepo sample corpus");
  assert.equal(mixed.corpus_kind, "mixed");
  assert.equal(mixed.terms.symbol, "getBillingSummary");

  let totalFiles = 0;
  for (const sample of samples) {
    assert(fs.existsSync(sample.source), `${sample.name} source path should exist`);
    const files = listFiles(sample.source);
    totalFiles += files.length;
    assert(files.length >= 7, `${sample.name} should include enough files for mixed-repo signal`);
    assert(sample.terms.file, `${sample.name} should define a representative file query`);
    assert(sample.terms.symbol, `${sample.name} should define a representative symbol query`);
    assert(sample.terms.route, `${sample.name} should define a representative route query`);
    assert(sample.terms.import, `${sample.name} should define a representative import query`);
    assert(sample.terms.edge, `${sample.name} should define a representative edge query`);
  }
  assert(totalFiles >= 40, "checked-in sample corpora should not shrink below mixed-corpus scale");
});
