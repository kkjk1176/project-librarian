"use strict";

const { corporaPresent, scenariosForTrack, scenariosForTrackCorpus, tracksPresent } = require("./llm-report");

const statuses = ["release_claimable", "diagnostic_only", "failed"];

function topLevelClaimGate(report) {
  return report && report.claim_gate && typeof report.claim_gate.status === "string"
    ? report.claim_gate.status
    : "not_evaluated";
}

function perCorpusClaimGate(report, track, corpus) {
  return report?.claim_gate?.per_track?.[track]?.per_corpus?.[corpus]?.status
    || report?.tracks?.[track]?.corpora?.[corpus]?.claim_gate?.status
    || "not_evaluated";
}

function releaseReadinessIssues(report) {
  const issues = [];
  const configuration = report.configuration || {};
  const minRuns = Number(configuration.min_runs_for_claim || 1);
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];

  if (topLevelClaimGate(report) !== "passed") issues.push(`claim gate ${topLevelClaimGate(report)}`);
  if (configuration.require_claimable !== true) issues.push("configuration.require_claimable is not true");
  if (configuration.require_clean !== true) issues.push("configuration.require_clean is not true");
  if (Number(configuration.runs || 0) < minRuns) issues.push(`runs ${configuration.runs || 0} below min_runs_for_claim ${minRuns}`);
  if (!configuration.requested_model) issues.push("configuration.requested_model is missing");
  if (configuration.sanitized_pack !== true) issues.push("configuration.sanitized_pack is not true");
  if (scenarios.some((scenario) => scenario.model_source !== "jsonl")) issues.push("scenario model_source is not jsonl");
  if (scenarios.some((scenario) => !Array.isArray(scenario.models) || scenario.models.length !== 1)) {
    issues.push("scenario observed model set is not exactly one model");
  }
  if (!report.source_control || report.source_control.available !== true) issues.push("source_control is unavailable");
  if (report.source_control && report.source_control.dirty) issues.push("source_control is dirty");

  return issues;
}

function previewReadinessIssues(preview) {
  const issues = [];
  const configuration = preview.configuration || {};
  const disclosure = preview.disclosure_boundary || {};
  if (preview.benchmark_kind !== "codex-actual-llm-payload-preview") issues.push("not a payload preview");
  if (disclosure.codex_network_run !== false) issues.push("preview must not launch Codex");
  if (configuration.require_claimable !== true) issues.push("configuration.require_claimable is not true");
  if (configuration.require_clean !== true) issues.push("configuration.require_clean is not true");
  if (configuration.full_matrix !== true) issues.push("configuration.full_matrix is not true");
  if (!configuration.requested_model) issues.push("configuration.requested_model is missing");
  if (!preview.sanitized_pack || preview.sanitized_pack.enabled !== true) issues.push("sanitized_pack is not enabled");
  if (!Number.isInteger(configuration.expected_codex_exec_count) || configuration.expected_codex_exec_count < 1) {
    issues.push("expected_codex_exec_count is missing");
  }
  return issues;
}

function statusForGate(gateStatus, releaseIssues) {
  if (gateStatus !== "passed") return "failed";
  return releaseIssues.length === 0 ? "release_claimable" : "diagnostic_only";
}

function summarizeStatuses(rows) {
  return Object.fromEntries(statuses.map((status) => [
    status,
    rows.filter((row) => row.status === status).length,
  ]));
}

function measuredRows(report, reportPath) {
  const releaseIssues = releaseReadinessIssues(report);
  const rows = [];
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  for (const track of tracksPresent(scenarios)) {
    const trackScenarios = scenariosForTrack(scenarios, track);
    for (const corpus of corporaPresent(trackScenarios)) {
      const corpusScenarios = scenariosForTrackCorpus(scenarios, track, corpus);
      const gateStatus = perCorpusClaimGate(report, track, corpus);
      const gateIssues = report?.claim_gate?.per_track?.[track]?.per_corpus?.[corpus]?.issues
        || report?.tracks?.[track]?.corpora?.[corpus]?.claim_gate?.issues
        || [];
      rows.push({
        report_path: reportPath,
        report_kind: report.benchmark_kind || "codex-actual-llm",
        benchmark_track: track,
        corpus,
        status: statusForGate(gateStatus, releaseIssues),
        claim_gate: gateStatus,
        scenario_count: corpusScenarios.length,
        release_blockers: releaseIssues,
        gate_issues: gateIssues,
      });
    }
  }
  if (rows.length === 0) {
    rows.push({
      report_path: reportPath,
      report_kind: report.benchmark_kind || "codex-actual-llm",
      benchmark_track: "unknown",
      corpus: report.corpus || "unknown",
      status: "failed",
      claim_gate: topLevelClaimGate(report),
      scenario_count: 0,
      release_blockers: releaseIssues,
      gate_issues: ["no benchmark scenarios"],
    });
  }
  return rows;
}

function previewRows(preview, reportPath) {
  const issues = previewReadinessIssues(preview);
  const scenarios = Array.isArray(preview.scenarios) ? preview.scenarios : [];
  const trackCorpusPairs = new Map();
  for (const scenario of scenarios) {
    const track = scenario.benchmark_track || "unknown";
    const corpus = scenario.corpus || preview.corpus || "synthetic";
    const key = `${track}\0${corpus}`;
    trackCorpusPairs.set(key, {
      benchmark_track: track,
      corpus,
      scenario_count: (trackCorpusPairs.get(key)?.scenario_count || 0) + 1,
    });
  }
  const pairs = [...trackCorpusPairs.values()];
  const base = {
    report_path: reportPath,
    report_kind: preview.benchmark_kind || "codex-actual-llm-payload-preview",
    status: "diagnostic_only",
    claim_gate: "not_measured",
    release_blockers: ["payload preview is not measured evidence", ...issues],
    gate_issues: [],
  };
  return pairs.length > 0
    ? pairs.map((pair) => ({ ...base, ...pair }))
    : [{ ...base, benchmark_track: "preview", corpus: preview.corpus || "unknown", scenario_count: 0 }];
}

function rowsForReport(report, reportPath = "") {
  if (report && report.benchmark_kind === "codex-actual-llm-payload-preview") {
    return previewRows(report, reportPath);
  }
  return measuredRows(report, reportPath);
}

function buildClaimLedger(reports) {
  const rows = reports.flatMap(({ report, reportPath }) => rowsForReport(report, reportPath));
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    summary: summarizeStatuses(rows),
    rows,
  };
}

function renderClaimLedgerMarkdown(ledger) {
  const lines = [
    "# Benchmark Claim Ledger",
    "",
    `Generated: ${ledger.generated_at}`,
    "",
    "| Report | Track | Corpus | Status | Claim Gate | Scenarios | Blockers |",
    "| --- | --- | --- | --- | --- | ---: | --- |",
  ];
  for (const row of ledger.rows) {
    lines.push(`| ${row.report_path || "-"} | ${row.benchmark_track} | ${row.corpus} | ${row.status} | ${row.claim_gate} | ${row.scenario_count} | ${row.release_blockers.join("; ") || "-"} |`);
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildClaimLedger,
  previewReadinessIssues,
  releaseReadinessIssues,
  renderClaimLedgerMarkdown,
  rowsForReport,
  statusForGate,
};
