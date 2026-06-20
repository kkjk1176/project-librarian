"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { auditRawRoot } = require("../../benchmarks/tools/audit-llm-raw");

test("raw audit reports stale raw runs and codex homes without deleting them", () => {
  const rawRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-raw-audit-"));
  const oldRun = path.join(rawRoot, "2026-06-17T00-00-00-000Z");
  const freshRun = path.join(rawRoot, "2026-06-19T09-00-00-000Z");
  const oldHome = path.join(oldRun, "codex-home-old");
  const freshHome = path.join(freshRun, "codex-home-fresh");
  fs.mkdirSync(oldHome, { recursive: true });
  fs.mkdirSync(freshHome, { recursive: true });
  fs.writeFileSync(path.join(oldRun, "scenario-run-1.jsonl"), "{}\n");
  fs.writeFileSync(path.join(oldHome, "debug.log"), "old-home");
  fs.writeFileSync(path.join(freshHome, "debug.log"), "fresh-home");
  const oldDate = new Date("2026-06-17T00:00:00.000Z");
  const freshDate = new Date("2026-06-19T09:00:00.000Z");
  fs.utimesSync(oldRun, oldDate, oldDate);
  fs.utimesSync(oldHome, oldDate, oldDate);
  fs.utimesSync(freshRun, freshDate, freshDate);
  fs.utimesSync(freshHome, freshDate, freshDate);

  try {
    const audit = auditRawRoot({
      rawRoot,
      olderThanDays: 1,
      includeCandidates: true,
      now: new Date("2026-06-19T12:00:00.000Z"),
    });

    assert.equal(audit.available, true);
    assert.equal(audit.raw_runs.candidate_count, 1);
    assert.equal(audit.raw_runs.candidates[0].relative_path, "2026-06-17T00-00-00-000Z");
    assert.equal(audit.codex_homes.candidate_count, 1);
    assert.equal(audit.codex_homes.candidates[0].relative_path, "2026-06-17T00-00-00-000Z/codex-home-old");
    assert(audit.root_summary.byte_count >= "old-homefresh-home{}\n".length);
    assert.match(audit.message, /stale raw run/);
    assert(fs.existsSync(oldHome));
    assert(fs.existsSync(freshHome));
  } finally {
    fs.rmSync(rawRoot, { recursive: true, force: true });
  }
});

test("raw audit handles a missing raw root as an empty read-only result", () => {
  const rawRoot = path.join(os.tmpdir(), `missing-raw-${Date.now()}-${Math.random()}`);
  const audit = auditRawRoot({
    rawRoot,
    olderThanDays: 1,
    now: new Date("2026-06-19T12:00:00.000Z"),
  });
  assert.equal(audit.available, false);
  assert.equal(audit.raw_runs.candidate_count, 0);
  assert.equal(audit.codex_homes.candidate_count, 0);
});
