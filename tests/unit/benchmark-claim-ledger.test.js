"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const sampleReport = require("../../benchmarks/llm/samples/codex-measured-report.json");
const { buildClaimLedger, previewReadinessIssues, rowsForReport } = require("../../benchmarks/lib/claim-ledger");

function strictReport({ gateStatus = "passed" } = {}) {
  return {
    benchmark_kind: "codex-actual-llm",
    configuration: {
      runs: 3,
      min_runs_for_claim: 3,
      require_claimable: true,
      require_clean: true,
      requested_model: "gpt-test",
      sanitized_pack: true,
    },
    source_control: {
      available: true,
      dirty: false,
    },
    scenarios: [
      { benchmark_track: "wiki", corpus: "synthetic", prompt_id: "with", condition: "with_project_librarian" },
      { benchmark_track: "wiki", corpus: "synthetic", prompt_id: "without", condition: "without_project_librarian" },
    ],
    claim_gate: {
      status: gateStatus,
      issues: gateStatus === "passed" ? [] : ["track wiki claim gate failed"],
      per_track: {
        wiki: {
          status: gateStatus,
          per_corpus: {
            synthetic: {
              status: gateStatus,
              issues: gateStatus === "passed" ? [] : ["missing expected task: release_policy"],
            },
          },
        },
      },
    },
  };
}

test("sample measured report stays diagnostic-only despite a passing gate", () => {
  const rows = rowsForReport(sampleReport, "benchmarks/llm/samples/codex-measured-report.json");
  assert(rows.length >= 2, "expected rows for synthetic and real corpus evidence");
  assert(rows.some((row) => row.corpus === "synthetic"));
  assert(rows.some((row) => row.corpus === "real"));
  assert(rows.every((row) => row.status === "diagnostic_only"));
  assert(rows.every((row) => row.claim_gate === "passed"));
  assert(rows.every((row) => row.release_blockers.includes("configuration.require_claimable is not true")));
});

test("strict clean measured report is release-claimable, failed gate is failed", () => {
  assert.deepEqual(rowsForReport(strictReport()).map((row) => row.status), ["release_claimable"]);
  assert.deepEqual(rowsForReport(strictReport({ gateStatus: "failed" })).map((row) => row.status), ["failed"]);
});

test("payload preview is never measured evidence but validates release preflight shape", () => {
  const preview = {
    benchmark_kind: "codex-actual-llm-payload-preview",
    corpus: "synthetic",
    sanitized_pack: { enabled: true },
    disclosure_boundary: { codex_network_run: false },
    configuration: {
      require_claimable: true,
      require_clean: true,
      full_matrix: true,
      requested_model: "gpt-test",
      expected_codex_exec_count: 4,
    },
    scenarios: [
      { benchmark_track: "wiki", corpus: "synthetic" },
      { benchmark_track: "wiki", corpus: "synthetic" },
    ],
  };

  assert.deepEqual(previewReadinessIssues(preview), []);
  const ledger = buildClaimLedger([{ report: preview, reportPath: "preview.json" }]);
  assert.deepEqual(ledger.summary, { release_claimable: 0, diagnostic_only: 1, failed: 0 });
  assert.equal(ledger.rows[0].claim_gate, "not_measured");
  assert(ledger.rows[0].release_blockers.includes("payload preview is not measured evidence"));
});
