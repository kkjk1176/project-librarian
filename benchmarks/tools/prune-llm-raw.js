#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { pruneOldCodexHomes } = require("../lib/llm-raw-retention");

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

function positiveIntegerArg(name) {
  const raw = argValue(name);
  if (!/^\d+$/.test(raw)) fail(`invalid integer for ${name}: ${raw || "(missing)"}`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail(`invalid integer for ${name}: ${raw}`);
  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node benchmarks/tools/prune-llm-raw.js --older-than-days <n> [--dry-run|--execute] [--raw-root <path>]

Defaults:
  --dry-run is implied. Only --execute deletes matching codex-home directories.
  --raw-root defaults to benchmarks/reports/llm/raw.

Safety:
  Only directories named codex-home or codex-home-* directly under the raw root or
  one timestamp directory below it are candidates. Raw JSONL, stderr, report files,
  sanitized-pack manifests, and retention manifests are never deletion targets.`);
}

if (hasFlag("--help") || hasFlag("-h")) {
  printUsage();
  process.exit(0);
}

if (!hasFlag("--older-than-days")) {
  fail("missing required --older-than-days <n>");
}

if (hasFlag("--dry-run") && hasFlag("--execute")) {
  fail("use only one of --dry-run or --execute");
}

const rawRoot = path.resolve(repoRoot, argValue("--raw-root", "benchmarks/reports/llm/raw"));
const olderThanDays = positiveIntegerArg("--older-than-days");
const dryRun = !hasFlag("--execute");

try {
  const result = pruneOldCodexHomes({ rawRoot, olderThanDays, dryRun });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
