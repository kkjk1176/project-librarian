#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildClaimLedger, renderClaimLedgerMarkdown } = require("../lib/claim-ledger");

const repoRoot = path.resolve(__dirname, "..", "..");

function usage() {
  return `Usage:
  node benchmarks/tools/benchmark-claim-ledger.js [--markdown] <report.json>...

Summarizes measured reports and payload previews into release_claimable,
diagnostic_only, or failed rows. Payload previews are always diagnostic_only
because they do not measure Codex output.
`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function companionMarkdownPath(absolutePath) {
  if (path.extname(absolutePath) !== ".json") return "";
  const candidate = absolutePath.slice(0, -".json".length) + ".md";
  return fs.existsSync(candidate) ? path.relative(repoRoot, candidate) : "";
}

function loadReport(reportPath) {
  const absolutePath = path.isAbsolute(reportPath) ? reportPath : path.resolve(repoRoot, reportPath);
  if (!fs.existsSync(absolutePath)) fail(`missing report: ${reportPath}`);
  return {
    companionMarkdownPath: companionMarkdownPath(absolutePath),
    reportPath: path.relative(repoRoot, absolutePath),
    report: JSON.parse(fs.readFileSync(absolutePath, "utf8")),
  };
}

function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(usage());
    return;
  }
  const markdown = process.argv.includes("--markdown");
  const reportPaths = process.argv.slice(2).filter((arg) => arg !== "--markdown");
  if (reportPaths.length === 0) fail(usage().trim());

  const ledger = buildClaimLedger(reportPaths.map(loadReport));
  process.stdout.write(markdown ? renderClaimLedgerMarkdown(ledger) : `${JSON.stringify(ledger, null, 2)}\n`);
}

if (require.main === module) main();
