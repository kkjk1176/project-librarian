#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_AUTO_PRUNE_CODEX_HOME_AGE_DAYS,
  discoverPrunableCodexHomes,
  discoverPrunableRawRuns,
  summarizeDirectory,
} = require("../lib/llm-raw-retention");

const repoRoot = path.resolve(__dirname, "..", "..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name, defaultValue = "") {
  const index = process.argv.indexOf(name);
  if (index < 0) return defaultValue;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`missing value for ${name}`);
  return value;
}

function positiveIntegerArg(name, defaultValue) {
  const raw = argValue(name, String(defaultValue));
  if (!/^\d+$/.test(raw)) fail(`invalid integer for ${name}: ${raw || "(missing)"}`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail(`invalid integer for ${name}: ${raw}`);
  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node benchmarks/tools/audit-llm-raw.js [--older-than-days <n>] [--raw-root <path>] [--include-candidates]

Defaults:
  --older-than-days defaults to ${DEFAULT_AUTO_PRUNE_CODEX_HOME_AGE_DAYS}.
  --raw-root defaults to benchmarks/reports/llm/raw.

Safety:
  This is read-only. It reports stale raw run directories and isolated codex-home
  directories that the explicit prune helpers would target, but it never deletes
  JSONL, stderr, reports, manifests, or directories.`);
}

function candidateSummary(candidates, includeCandidates) {
  const entries = candidates.map(({ absolute_path, ...candidate }) => candidate);
  const candidateBytes = entries.reduce((sum, candidate) => sum + candidate.byte_count, 0);
  return {
    candidate_count: entries.length,
    candidate_bytes: candidateBytes,
    sample_candidates: entries.slice(0, 10),
    candidates: includeCandidates ? entries : [],
  };
}

function auditRawRoot({ rawRoot, olderThanDays = DEFAULT_AUTO_PRUNE_CODEX_HOME_AGE_DAYS, includeCandidates = false, now = new Date() } = {}) {
  const absoluteRawRoot = path.resolve(rawRoot || path.join(repoRoot, "benchmarks", "reports", "llm", "raw"));
  if (!fs.existsSync(absoluteRawRoot)) {
    return {
      schema_version: 1,
      generated_at: now.toISOString(),
      raw_root: absoluteRawRoot,
      older_than_days: olderThanDays,
      available: false,
      root_summary: { file_count: 0, directory_count: 0, byte_count: 0, largest_files: [] },
      codex_homes: { candidate_count: 0, candidate_bytes: 0, sample_candidates: [], candidates: [] },
      raw_runs: { candidate_count: 0, candidate_bytes: 0, sample_candidates: [], candidates: [] },
      message: `raw root does not exist: ${path.relative(repoRoot, absoluteRawRoot) || absoluteRawRoot}`,
    };
  }
  if (!fs.statSync(absoluteRawRoot).isDirectory()) {
    throw new Error(`raw root is not a directory: ${absoluteRawRoot}`);
  }

  const codexHomes = discoverPrunableCodexHomes({ rawRoot: absoluteRawRoot, olderThanDays, now });
  const rawRuns = discoverPrunableRawRuns({ rawRoot: absoluteRawRoot, olderThanDays, now });
  const rootSummary = summarizeDirectory(absoluteRawRoot);
  const codexSummary = candidateSummary(codexHomes.candidates, includeCandidates);
  const rawRunSummary = candidateSummary(rawRuns.candidates, includeCandidates);
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    raw_root: absoluteRawRoot,
    older_than_days: olderThanDays,
    available: true,
    root_summary: rootSummary,
    codex_homes: codexSummary,
    raw_runs: rawRunSummary,
    message: `raw root has ${rootSummary.file_count} files in ${rootSummary.directory_count} directories; ${rawRunSummary.candidate_count} stale raw run(s), ${codexSummary.candidate_count} stale codex-home director${codexSummary.candidate_count === 1 ? "y" : "ies"}`,
  };
}

function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage();
    return;
  }
  const rawRoot = path.resolve(repoRoot, argValue("--raw-root", "benchmarks/reports/llm/raw"));
  const olderThanDays = positiveIntegerArg("--older-than-days", DEFAULT_AUTO_PRUNE_CODEX_HOME_AGE_DAYS);
  const result = auditRawRoot({
    rawRoot,
    olderThanDays,
    includeCandidates: hasFlag("--include-candidates"),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

module.exports = {
  auditRawRoot,
  candidateSummary,
};
