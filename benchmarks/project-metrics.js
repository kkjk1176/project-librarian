#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { benchmarkValidation } = require("./lib/validation");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "dist", "init-project-wiki.js");
const schemaVersion = 9;

const scales = {
  quick: {
    docsHeavyPages: 40,
    monorepoApps: 3,
    monorepoPackages: 6,
    docsPerWorkspace: 3,
    codePackages: 4,
    filesPerCodePackage: 20,
    scopedRouteAreas: 3,
    scopedPagesPerArea: 18,
    readIterations: 10,
  },
  large: {
    docsHeavyPages: 500,
    monorepoApps: 8,
    monorepoPackages: 32,
    docsPerWorkspace: 8,
    codePackages: 24,
    filesPerCodePackage: 50,
    scopedRouteAreas: 12,
    scopedPagesPerArea: 60,
    readIterations: 35,
  },
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

const { expectBenchmark, passedValidation } = benchmarkValidation(fail);

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return "";
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`missing value for ${name}`);
  return value;
}

function argValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) fail(`missing value for ${name}`);
    values.push(value);
  }
  return values;
}

function positiveIntegerArgValue(name, defaultValue) {
  const value = argValue(name);
  if (!value) return defaultValue;
  if (!/^\d+$/.test(value)) fail(`invalid integer for ${name}: ${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail(`invalid integer for ${name}: ${value}`);
  return parsed;
}

function nonNegativeIntegerArgValue(name, defaultValue) {
  const value = argValue(name);
  if (!value) return defaultValue;
  if (!/^\d+$/.test(value)) fail(`invalid integer for ${name}: ${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`invalid integer for ${name}: ${value}`);
  return parsed;
}

function optionalArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return "";
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return "";
  return value;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return ((sorted[middle - 1] || 0) + (sorted[middle] || 0)) / 2;
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function stats(values) {
  const average = mean(values);
  const deviation = standardDeviation(values);
  return {
    runs: values.length,
    min: round(Math.min(...values), 3),
    median: round(median(values), 3),
    max: round(Math.max(...values), 3),
    mean: round(average, 3),
    stddev: round(deviation, 3),
    coefficient_of_variation_percent: average === 0 ? 0 : round((deviation / average) * 100),
  };
}

function estimatedTokens(chars) {
  return Math.ceil(chars / 4);
}

function timed(label, fn) {
  const start = process.hrtime.bigint();
  const value = fn();
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  return { elapsed_ms: round(elapsedMs, 3), label, value };
}

function runNode(args, cwd) {
  return timed(args.join(" "), () => childProcess.execFileSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

function gitOutput(args) {
  return childProcess.execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sourceControlFingerprint() {
  if (!fs.existsSync(path.join(root, ".git"))) {
    return { available: false, reason: "not-a-git-checkout" };
  }
  const status = gitOutput(["status", "--porcelain"]);
  const branch = gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = gitOutput(["rev-parse", "HEAD"]);
  const statusEntries = status ? status.split(/\r?\n/).filter(Boolean) : [];
  return {
    available: true,
    commit,
    short_commit: commit.slice(0, 12),
    branch,
    dirty: statusEntries.length > 0,
    status_entry_count: statusEntries.length,
    status_kinds: Array.from(new Set(statusEntries.map((line) => line.slice(0, 2)))).sort(),
  };
}

function environmentFingerprint() {
  const cpus = os.cpus();
  return {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    os_release: os.release(),
    cpu_model: cpus[0]?.model || "unknown",
    cpu_count: cpus.length,
    total_memory_mb: Math.round(os.totalmem() / 1024 / 1024),
  };
}

function requireCleanWorkingTree() {
  if (!fs.existsSync(path.join(root, ".git"))) fail("benchmark --require-clean requires a git checkout");
  const status = childProcess.execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (status) {
    fail(`benchmark --require-clean found uncommitted changes:\n${status}`);
  }
}

function parseKeyValueOutput(output) {
  return Object.fromEntries(output
    .split(/\r?\n/)
    .map((line) => line.match(/^([a-z_]+):\s*(.+)$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

const sampleRepoIgnoredDirectories = new Set([
  ".git",
  ".codex",
  ".claude",
  ".project-wiki",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "vendor",
  "tmp",
  "temp",
]);

function copyDirectoryFiltered(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.isDirectory() && sampleRepoIgnoredDirectories.has(entry.name)) continue;
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryFiltered(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    } else if (entry.isSymbolicLink()) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.symlinkSync(fs.readlinkSync(sourcePath), targetPath);
    }
  }
}

function filteredFileEntries(sourceDir) {
  const entries = [];
  function walk(relativeDir) {
    const absoluteDir = path.join(sourceDir, relativeDir);
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.isDirectory() && sampleRepoIgnoredDirectories.has(entry.name)) continue;
      const relativePath = path.join(relativeDir, entry.name);
      const absolutePath = path.join(sourceDir, relativePath);
      if (entry.isDirectory()) {
        walk(relativePath);
      } else if (entry.isFile()) {
        entries.push({
          type: "file",
          relativePath: relativePath.split(path.sep).join("/"),
          absolutePath,
        });
      } else if (entry.isSymbolicLink()) {
        entries.push({
          type: "symlink",
          relativePath: relativePath.split(path.sep).join("/"),
          target: fs.readlinkSync(absolutePath),
        });
      }
    }
  }
  walk("");
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function sampleRepoFingerprint(sourceDir) {
  const hash = crypto.createHash("sha256");
  const entries = filteredFileEntries(sourceDir);
  for (const entry of entries) {
    hash.update(`${entry.type}\0${entry.relativePath}\0`);
    if (entry.type === "file") hash.update(fs.readFileSync(entry.absolutePath));
    else hash.update(entry.target);
    hash.update("\0");
  }
  return {
    algorithm: "sha256",
    value: hash.digest("hex"),
    file_count: entries.filter((entry) => entry.type === "file").length,
    symlink_count: entries.filter((entry) => entry.type === "symlink").length,
  };
}

function isSampleRepoScenario(scenario) {
  return typeof scenario.fixture_kind === "string" && scenario.fixture_kind.startsWith("sample-repo-validation-");
}

function sampleRepoKind(index) {
  return `sample-repo-validation-${String(index + 1).padStart(2, "0")}`;
}

function sampleRepoId(sourcePath, index) {
  const base = path.basename(sourcePath).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
  return `${String(index + 1).padStart(2, "0")}-${base}`;
}

function sampleRepoProfile(architectureReport, evidenceCoverage, packageDependencies, sourcePath = "") {
  const languageProfiles = Array.isArray(architectureReport.language_profile_summary)
    ? architectureReport.language_profile_summary.map((row) => `${row.language}:${row.profile}`)
    : [];
  const traits = [];
  const ownershipAreas = Array.isArray(architectureReport.ownership_summary)
    ? new Set(architectureReport.ownership_summary.map((row) => row.owner).filter(Boolean))
    : new Set();
  if (Number(evidenceCoverage.routes || 0) > 0) traits.push("web-routes");
  if (packageDependencies.length > 0) traits.push("package-dependencies");
  if (Number(evidenceCoverage.configs || 0) > 0) traits.push("config-bearing");
  if (Number(evidenceCoverage.symbols || 0) > 0) traits.push("symbol-bearing");
  const sourceAreas = ["apps", "packages", "services", "libs"].filter((owner) => fs.existsSync(path.join(sourcePath, owner)));
  if (["apps", "packages", "services", "libs"].filter((owner) => ownershipAreas.has(owner)).length >= 2 || sourceAreas.length >= 2) traits.push("monorepo-shaped");
  traits.push(languageProfiles.length > 1 ? "mixed-language" : "single-language");
  if (Number(evidenceCoverage.routes || 0) === 0 && packageDependencies.length === 0) traits.push("library-or-tooling");
  return {
    primary: traits.join("+"),
    traits,
    language_profiles: languageProfiles,
  };
}

function readFiles(files, cwd, iterations) {
  const result = timed("read files", () => {
    let chars = 0;
    for (let index = 0; index < iterations; index += 1) {
      for (const file of files) chars += fs.readFileSync(path.join(cwd, file), "utf8").length;
    }
    return Math.round(chars / iterations);
  });
  return {
    avg_read_ms: round(result.elapsed_ms / iterations, 3),
    chars: result.value,
    estimated_tokens: estimatedTokens(result.value),
    file_count: files.length,
    files,
  };
}

function listWikiMarkdown(cwd) {
  const files = [];
  function walk(relativeDir) {
    const absoluteDir = path.join(cwd, relativeDir);
    if (!fs.existsSync(absoluteDir)) return;
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      const relativePath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) walk(relativePath);
      else if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name) && relativePath !== path.join("wiki", "AGENTS.md")) {
        files.push(relativePath.split(path.sep).join("/"));
      }
    }
  }
  walk("wiki");
  return files.sort();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function metadata(scope, budget = "medium") {
  return `---
status: active
updated: ${today()}
scope: ${scope}
read_budget: ${budget}
decision_ref: none
review_trigger: benchmark fixture regeneration
---
`;
}

function verboseProjectDoc(title, lines, scope = "project-canonical", variant = "canonical") {
  const body = Array.from({ length: lines }, (_, index) => {
    if (variant === "incident") {
      return `- ${title} incident note ${index + 1}: affected workspace, customer-facing symptom, mitigation owner, rollback condition, verification command, and release-blocking signal.`;
    }
    if (variant === "reference") {
      return `- ${title} reference ${index + 1}: source URL summary, imported concept, local adaptation constraint, stale-data trigger, and review owner.`;
    }
    return `- ${title} evidence ${index + 1}: ownership boundary, API contract, operational constraint, dependency relationship, release evidence, escalation rule, and verification signal.`;
  }).join("\n");
  return `${metadata(scope)}
# ${title}

## TL;DR

- Large-project benchmark document for ${title}.
- This page is intentionally detailed and should be read on demand, not at session start.

## Details

${body}
`;
}

function packageName(index) {
  return `workspace-${String(index).padStart(2, "0")}`;
}

function generatedTsFile(packageIndex, fileIndex, filesPerPackage) {
  const localName = `service${packageIndex}_${fileIndex}`;
  const next = fileIndex + 1 < filesPerPackage ? `import { service${packageIndex}_${fileIndex + 1} } from "./service-${fileIndex + 1}";\n` : "";
  const callNext = fileIndex + 1 < filesPerPackage ? `  return value + service${packageIndex}_${fileIndex + 1}(value - 1);\n` : "  return value;\n";
  return `${next}
export interface ${localName}Config {
  id: string;
  enabled: boolean;
  retryLimit: number;
}

export class ${localName}Runner {
  constructor(private readonly config: ${localName}Config) {}

  run(value: number): number {
    return ${localName}(value) + this.config.retryLimit;
  }
}

export function ${localName}(value: number): number {
${callNext}}
`;
}

function generatedJsFile(packageIndex) {
  return `export function workspace${packageIndex}HealthHandler(request, response) {
  return response.json({
    workspace: ${packageIndex},
    status: "ok",
  });
}

export function registerWorkspace${packageIndex}Routes(app) {
  app.get("/workspace-${packageIndex}/health", workspace${packageIndex}HealthHandler);
}
`;
}

function generatedTsxFile(packageIndex) {
  return `export function Workspace${packageIndex}Panel(props: { title: string; count: number }) {
  return <section data-workspace="${packageIndex}"><h2>{props.title}</h2><strong>{props.count}</strong></section>;
}
`;
}

function generatedYamlFile(packageIndex) {
  return `service: workspace-${packageIndex}
owner: platform-${packageIndex % 4}
routes:
  - /workspace-${packageIndex}/health
  - /workspace-${packageIndex}/ready
`;
}

function generatedWorkflowJsonFile(packageIndex) {
  return JSON.stringify({
    service: `workspace-${packageIndex}`,
    owner: `platform-${packageIndex % 4}`,
    runtime: {
      queue: `workspace-${packageIndex}-events`,
      retry: { attempts: 3 + (packageIndex % 3), backoffMs: 250 },
      featureFlags: {
        asyncHydration: packageIndex % 2 === 0,
        auditTrail: true,
      },
    },
    dependencies: {
      upstream: [`workspace-${(packageIndex + 1) % 7}`, `workspace-${(packageIndex + 2) % 7}`],
      external: ["postgres", "redis", "object-storage"],
    },
  }, null, 2);
}

function generatedLockFile(packageIndex) {
  return JSON.stringify({
    name: packageName(packageIndex),
    lockfileVersion: 3,
    packages: {
      "": {
        name: packageName(packageIndex),
        dependencies: {
          express: `^4.${packageIndex % 20}.0`,
          zod: `^3.${packageIndex % 20}.0`,
        },
      },
      "node_modules/express": { version: `4.${packageIndex % 20}.0` },
      "node_modules/zod": { version: `3.${packageIndex % 20}.0` },
    },
  }, null, 2);
}

function generatedTestFile(packageIndex) {
  return `import { service${packageIndex}_0 } from "./service-0";

describe("workspace ${packageIndex} service contract", () => {
  it("keeps the generated service chain callable", () => {
    expect(service${packageIndex}_0(3)).toBeGreaterThan(0);
  });
});
`;
}

function generatedGoFile(packageIndex) {
  return `package worker

import (
  "context"
  "net/http"
)

type Workspace${packageIndex}Worker struct{}

func Workspace${packageIndex}Health(ctx context.Context, request *http.Request) error {
  return nil
}
`;
}

function generatedPythonFile(packageIndex) {
  return `import json
from pathlib import Path


class Workspace${packageIndex}Audit:
    def __init__(self, root: Path):
        self.root = root

    def load(self):
        return json.loads((self.root / "config" / "workflow-${packageIndex}.json").read_text())


def audit_workspace_${packageIndex}(root: Path):
    return Workspace${packageIndex}Audit(root).load()
`;
}

function generatedRustFile(packageIndex) {
  return `use std::collections::HashMap;

pub struct Workspace${packageIndex}RustWorker {
    pub id: String,
}

pub fn workspace_${packageIndex}_rust_health() -> HashMap<String, String> {
    HashMap::new()
}
`;
}

function generatedJavaFile(packageIndex) {
  return `package benchmark.workspace${packageIndex};

import java.util.Map;

public class Workspace${packageIndex}Controller {
  public Map<String, String> health() {
    return Map.of("status", "ok");
  }
}
`;
}

function generatedPhpFile(packageIndex) {
  return `<?php
namespace Benchmark\\Workspace${packageIndex};

use DateTimeImmutable;

class Workspace${packageIndex}Action {
  public function handle(): DateTimeImmutable {
    return new DateTimeImmutable();
  }
}
`;
}

function generatedKotlinFile(packageIndex) {
  return `package benchmark.workspace${packageIndex}

import java.time.Instant

class Workspace${packageIndex}Job {
  fun run(): Instant {
    return Instant.now()
  }
}
`;
}

function generatedSwiftFile(packageIndex) {
  return `import Foundation

struct Workspace${packageIndex}Event {
  let id: String
}

func workspace${packageIndex}Event() -> Workspace${packageIndex}Event {
  return Workspace${packageIndex}Event(id: "ok")
}
`;
}

function generatedCFile(packageIndex) {
  return `#include <stdio.h>

struct workspace_${packageIndex}_state {
  int ready;
};

int workspace_${packageIndex}_health(void) {
  return 1;
}
`;
}

function generatedCppFile(packageIndex) {
  return `#include <string>

namespace benchmark {
class Workspace${packageIndex}Engine {
 public:
  std::string health() const {
    return "ok";
  }
};
}
`;
}

function generatedCSharpFile(packageIndex) {
  return `using System;

namespace Benchmark.Workspace${packageIndex};

public class Workspace${packageIndex}Service
{
    public string Health()
    {
        return "ok";
    }
}
`;
}

function docsHeavyLineCount(index) {
  if (index % 17 === 0) return 96;
  if (index % 11 === 0) return 62;
  if (index % 7 === 0) return 18;
  return 34;
}

function docsHeavyVariant(index) {
  if (index % 11 === 0) return "incident";
  if (index % 5 === 0) return "reference";
  return "canonical";
}

function workspaceLayout(scale) {
  const serviceCount = Math.floor(scale.monorepoPackages / 4);
  const libCount = Math.floor(scale.monorepoPackages / 8);
  const packageCount = scale.monorepoPackages - serviceCount - libCount;
  return {
    apps: Array.from({ length: scale.monorepoApps }, (_, index) => `apps/app-${index}`),
    packages: Array.from({ length: packageCount }, (_, index) => `packages/${packageName(index)}`),
    services: Array.from({ length: serviceCount }, (_, index) => `services/service-${index}`),
    libs: Array.from({ length: libCount }, (_, index) => `libs/lib-${index}`),
  };
}

function flattenWorkspaces(layout) {
  return [...layout.apps, ...layout.packages, ...layout.services, ...layout.libs];
}

function benchmarkPackageJson(name, packageIndex = 0) {
  return JSON.stringify({
    name,
    version: "0.0.0",
    scripts: {
      build: "tsc -p tsconfig.json",
      test: "node test.js",
    },
    dependencies: {
      express: `^4.${packageIndex % 20}.0`,
      zod: `^3.${packageIndex % 20}.0`,
    },
    devDependencies: {
      typescript: "^5.0.0",
    },
  }, null, 2);
}

function bootstrapProject(cwd) {
  fs.mkdirSync(cwd, { recursive: true });
  return runNode([cli], cwd).elapsed_ms;
}

function nodeSubprocessOverhead(cwd) {
  return runNode(["-e", ""], cwd).elapsed_ms;
}

function estimatedOperationMs(elapsedMs, overheadMs) {
  if (typeof elapsedMs !== "number" || typeof overheadMs !== "number") return null;
  return round(Math.max(0, elapsedMs - overheadMs), 3);
}

function uniqueFiles(files) {
  return Array.from(new Set(files)).sort();
}

function contextSavings(cwd, iterations, targetedFiles) {
  const compactFiles = ["wiki/startup.md", "wiki/index.md"];
  const targetedContextFiles = uniqueFiles([...compactFiles, ...targetedFiles]);
  const fullWikiFiles = listWikiMarkdown(cwd);
  const compactContext = readFiles(compactFiles, cwd, iterations);
  const targetedContext = readFiles(targetedContextFiles, cwd, iterations);
  const fullWiki = readFiles(fullWikiFiles, cwd, iterations);
  const savedTokens = fullWiki.estimated_tokens - targetedContext.estimated_tokens;
  const savedReadMs = fullWiki.avg_read_ms - targetedContext.avg_read_ms;
  const upperBoundSavedTokens = fullWiki.estimated_tokens - compactContext.estimated_tokens;
  const upperBoundSavedReadMs = fullWiki.avg_read_ms - compactContext.avg_read_ms;
  return {
    compact_context: compactContext,
    targeted_context: targetedContext,
    full_wiki: {
      ...fullWiki,
      files_sample: fullWiki.files.slice(0, 20),
      files: undefined,
    },
    savings: {
      basis: "targeted_context_vs_full_wiki_scan",
      token_estimator: "ceil(characters / 4)",
      estimated_tokens: savedTokens,
      estimated_token_avoidance_percent: round((savedTokens / fullWiki.estimated_tokens) * 100),
      read_ms: round(savedReadMs, 3),
      read_time_reduction_percent: round((savedReadMs / fullWiki.avg_read_ms) * 100),
    },
    startup_index_only_upper_bound: {
      basis: "startup_index_only_vs_full_wiki_scan",
      estimated_tokens: upperBoundSavedTokens,
      estimated_token_avoidance_percent: round((upperBoundSavedTokens / fullWiki.estimated_tokens) * 100),
      read_ms: round(upperBoundSavedReadMs, 3),
      read_time_reduction_percent: round((upperBoundSavedReadMs / fullWiki.avg_read_ms) * 100),
    },
    retrieval_strategy_comparison: [
      {
        strategy: "full_wiki_scan",
        file_count: fullWiki.file_count,
        estimated_tokens: fullWiki.estimated_tokens,
        estimated_token_avoidance_percent: 0,
        expected_evidence_files_included: targetedFiles.length,
        expected_evidence_files_missing: 0,
        correctness_status: "complete-context",
      },
      {
        strategy: "startup_index_only",
        file_count: compactContext.file_count,
        estimated_tokens: compactContext.estimated_tokens,
        estimated_token_avoidance_percent: round((upperBoundSavedTokens / fullWiki.estimated_tokens) * 100),
        expected_evidence_files_included: targetedFiles.filter((file) => compactFiles.includes(file)).length,
        expected_evidence_files_missing: targetedFiles.filter((file) => !compactFiles.includes(file)).length,
        correctness_status: targetedFiles.every((file) => compactFiles.includes(file)) ? "evidence-present" : "evidence-missing-without-followup",
      },
      {
        strategy: "targeted_query_result",
        file_count: targetedContext.file_count,
        estimated_tokens: targetedContext.estimated_tokens,
        estimated_token_avoidance_percent: round((savedTokens / fullWiki.estimated_tokens) * 100),
        expected_evidence_files_included: targetedFiles.filter((file) => targetedContextFiles.includes(file)).length,
        expected_evidence_files_missing: targetedFiles.filter((file) => !targetedContextFiles.includes(file)).length,
        correctness_status: targetedFiles.every((file) => targetedContextFiles.includes(file)) ? "evidence-present" : "evidence-missing",
      },
    ],
  };
}

function docsHeavyScenario(baseDir, scale) {
  const cwd = path.join(baseDir, "docs-heavy-large-project");
  const bootstrapMs = bootstrapProject(cwd);
  const subprocessOverheadMs = nodeSubprocessOverhead(cwd);
  const validationIndex = Math.min(42, scale.docsHeavyPages - 1);
  let validationRelativePath = "";
  for (let index = 0; index < scale.docsHeavyPages; index += 1) {
    const bucket = index % 4 === 0 ? "decisions" : index % 5 === 0 ? "sources" : "canonical";
    const scope = bucket === "decisions" ? "project-decisions" : bucket === "sources" ? "source-summary" : "project-canonical";
    const relativePath = path.join("wiki", bucket, `large-topic-${index}.md`).split(path.sep).join("/");
    if (index === validationIndex) validationRelativePath = relativePath;
    writeFile(path.join(cwd, relativePath), verboseProjectDoc(`Docs Heavy Topic ${index}`, docsHeavyLineCount(index), scope, docsHeavyVariant(index)));
  }
  fs.appendFileSync(path.join(cwd, validationRelativePath), "\nBenchmark validation marker: docs-heavy-needle.\n");
  const doctor = runNode([cli, "--doctor"], cwd);
  const query = runNode([cli, "--query", "docs-heavy-needle"], cwd);
  expectBenchmark(query.value.includes(validationRelativePath), "docs-heavy query did not return the expected generated wiki page");
  return {
    fixture_kind: "docs-heavy-large-project",
    confidence: "high-for-token-and-wiki-read-claims",
    assumptions: {
      generated_wiki_pages: scale.docsHeavyPages,
      varied_page_lengths: true,
      mixed_doc_kinds: ["canonical", "decision", "source", "incident-style"],
      curated_startup_index: true,
      refresh_index_all_pages: false,
    },
    bootstrap_create_ms: bootstrapMs,
    timing_scope: "node_cli_subprocess_e2e",
    node_subprocess_overhead_ms: subprocessOverheadMs,
    doctor_ms: doctor.elapsed_ms,
    doctor_operation_estimated_ms: estimatedOperationMs(doctor.elapsed_ms, subprocessOverheadMs),
    query_ms: query.elapsed_ms,
    query_operation_estimated_ms: estimatedOperationMs(query.elapsed_ms, subprocessOverheadMs),
    retrieval_correctness: {
      query: "docs-heavy-needle",
      expected_file: validationRelativePath,
      query_returned_expected_file: query.value.includes(validationRelativePath),
      targeted_context_expected_files: [validationRelativePath],
      correctness_status: "passed",
    },
    validations: [
      passedValidation("doctor command completed"),
      passedValidation(`query returned ${validationRelativePath}`),
    ],
    ...contextSavings(cwd, scale.readIterations, [validationRelativePath]),
  };
}

function monorepoScenario(baseDir, scale) {
  const cwd = path.join(baseDir, "monorepo-large-project");
  const bootstrapMs = bootstrapProject(cwd);
  const subprocessOverheadMs = nodeSubprocessOverhead(cwd);
  const layout = workspaceLayout(scale);
  const workspaces = flattenWorkspaces(layout);
  for (const workspace of workspaces) {
    writeFile(path.join(cwd, workspace, "package.json"), benchmarkPackageJson(workspace.replace("/", "-")));
    for (let index = 0; index < scale.docsPerWorkspace; index += 1) {
      const slug = workspace.replace(/\//g, "-");
      const bucket = workspace.startsWith("services/") && index % 2 === 0 ? "decisions" : "canonical";
      writeFile(path.join(cwd, "wiki", bucket, `${slug}-topic-${index}.md`), verboseProjectDoc(`Monorepo ${workspace} Topic ${index}`, 18 + (index % 3) * 8, bucket === "decisions" ? "project-decisions" : "project-canonical", docsHeavyVariant(index)));
    }
  }
  const validationRelativePath = "wiki/canonical/packages-workspace-00-topic-0.md";
  fs.appendFileSync(path.join(cwd, validationRelativePath), "\nBenchmark validation marker: monorepo-package-needle.\n");
  const doctor = runNode([cli, "--doctor"], cwd);
  const query = runNode([cli, "--query", "monorepo-package-needle"], cwd);
  expectBenchmark(query.value.includes("wiki/canonical/packages-workspace-00-topic-0.md"), "monorepo query did not return the expected generated package wiki page");
  return {
    fixture_kind: "monorepo-large-project",
    confidence: "high-for-monorepo-routing-and-diagnostics-claims",
    assumptions: {
      apps: layout.apps.length,
      packages: layout.packages.length,
      services: layout.services.length,
      libs: layout.libs.length,
      generated_wiki_pages: workspaces.length * scale.docsPerWorkspace,
      curated_startup_index: true,
    },
    bootstrap_create_ms: bootstrapMs,
    timing_scope: "node_cli_subprocess_e2e",
    node_subprocess_overhead_ms: subprocessOverheadMs,
    doctor_ms: doctor.elapsed_ms,
    doctor_operation_estimated_ms: estimatedOperationMs(doctor.elapsed_ms, subprocessOverheadMs),
    query_ms: query.elapsed_ms,
    query_operation_estimated_ms: estimatedOperationMs(query.elapsed_ms, subprocessOverheadMs),
    retrieval_correctness: {
      query: "monorepo-package-needle",
      expected_file: validationRelativePath,
      query_returned_expected_file: query.value.includes(validationRelativePath),
      targeted_context_expected_files: [validationRelativePath],
      correctness_status: "passed",
    },
    validations: [
      passedValidation("doctor command completed"),
      passedValidation("query returned wiki/canonical/packages-workspace-00-topic-0.md"),
    ],
    ...contextSavings(cwd, scale.readIterations, [validationRelativePath]),
  };
}

function scopedRoutingScenario(baseDir, scale) {
  const cwd = path.join(baseDir, "scoped-routing-large-project");
  const bootstrapMs = bootstrapProject(cwd);
  const subprocessOverheadMs = nodeSubprocessOverhead(cwd);
  const generatedPages = scale.scopedRouteAreas * scale.scopedPagesPerArea;
  const targetArea = "apps-app-0";
  const targetRouter = "wiki/indexes/auto-apps-app-0.md";
  const validationRelativePath = "wiki/canonical/apps-app-0-topic-0.md";
  for (let areaIndex = 0; areaIndex < scale.scopedRouteAreas; areaIndex += 1) {
    for (let pageIndex = 0; pageIndex < scale.scopedPagesPerArea; pageIndex += 1) {
      const relativePath = path.join("wiki", "canonical", `apps-app-${areaIndex}-topic-${pageIndex}.md`).split(path.sep).join("/");
      writeFile(path.join(cwd, relativePath), verboseProjectDoc(`Scoped App ${areaIndex} Topic ${pageIndex}`, 20 + (pageIndex % 4) * 6, "project-canonical", docsHeavyVariant(pageIndex)));
    }
  }
  fs.appendFileSync(path.join(cwd, validationRelativePath), "\nBenchmark validation marker: scoped-router-needle.\n");
  const refreshIndex = runNode([cli, "--refresh-index"], cwd);
  const linkCheck = runNode([cli, "--link-check"], cwd);
  const query = runNode([cli, "--query", "scoped-router-needle"], cwd);
  const mainIndexText = fs.readFileSync(path.join(cwd, "wiki", "index.md"), "utf8");
  const scopedIndexDir = path.join(cwd, "wiki", "indexes");
  const scopedRouters = fs.existsSync(scopedIndexDir)
    ? fs.readdirSync(scopedIndexDir).filter((file) => /^auto-[a-z0-9-]+\.md$/.test(file)).sort()
    : [];
  const targetRouterText = fs.existsSync(path.join(cwd, targetRouter)) ? fs.readFileSync(path.join(cwd, targetRouter), "utf8") : "";
  expectBenchmark(refreshIndex.value.includes("wiki/index.md auto-discovered pages"), "scoped routing refresh-index did not report index update");
  expectBenchmark(linkCheck.value.includes("0 warnings"), "scoped routing link-check had warnings");
  expectBenchmark(query.value.includes(validationRelativePath), "scoped routing query did not return expected page");
  expectBenchmark(scopedRouters.length >= scale.scopedRouteAreas, `scoped routing generated ${scopedRouters.length} scoped routers; expected at least ${scale.scopedRouteAreas}`);
  expectBenchmark(mainIndexText.includes("[[indexes/auto-apps-app-0]]"), "main index did not link the expected scoped router");
  expectBenchmark(targetRouterText.includes("[[canonical/apps-app-0-topic-0]]"), "scoped router did not link the expected target page");
  expectBenchmark(mainIndexText.length <= 4500, `main index exceeded compact budget: ${mainIndexText.length} chars`);
  return {
    fixture_kind: "scoped-routing-large-project",
    confidence: "high-for-scoped-router-generation-and-read-budget-claims",
    assumptions: {
      generated_wiki_pages: generatedPages,
      scoped_route_areas: scale.scopedRouteAreas,
      pages_per_area: scale.scopedPagesPerArea,
      expected_scoped_router_count_min: scale.scopedRouteAreas,
      target_area: targetArea,
      target_router: targetRouter,
      compact_main_index_budget_chars: 4500,
    },
    bootstrap_create_ms: bootstrapMs,
    timing_scope: "node_cli_subprocess_e2e",
    node_subprocess_overhead_ms: subprocessOverheadMs,
    refresh_index_ms: refreshIndex.elapsed_ms,
    refresh_index_operation_estimated_ms: estimatedOperationMs(refreshIndex.elapsed_ms, subprocessOverheadMs),
    link_check_ms: linkCheck.elapsed_ms,
    link_check_operation_estimated_ms: estimatedOperationMs(linkCheck.elapsed_ms, subprocessOverheadMs),
    query_ms: query.elapsed_ms,
    query_operation_estimated_ms: estimatedOperationMs(query.elapsed_ms, subprocessOverheadMs),
    main_index_chars: mainIndexText.length,
    scoped_router_count: scopedRouters.length,
    scoped_router_files: scopedRouters.map((file) => `wiki/indexes/${file}`),
    scoped_target_router_chars: targetRouterText.length,
    retrieval_correctness: {
      query: "scoped-router-needle",
      expected_file: validationRelativePath,
      expected_router: targetRouter,
      query_returned_expected_file: query.value.includes(validationRelativePath),
      targeted_context_expected_files: [targetRouter, validationRelativePath],
      correctness_status: "passed",
    },
    validations: [
      passedValidation(`refresh-index generated ${scopedRouters.length} scoped routers`),
      passedValidation("main index stayed within compact budget"),
      passedValidation(`target scoped router linked ${validationRelativePath}`),
      passedValidation("link-check completed with 0 warnings"),
      passedValidation(`query returned ${validationRelativePath}`),
    ],
    ...contextSavings(cwd, scale.readIterations, [targetRouter, validationRelativePath]),
  };
}

function codeHeavyScenario(baseDir, scale) {
  const cwd = path.join(baseDir, "code-heavy-large-project");
  const bootstrapMs = bootstrapProject(cwd);
  const subprocessOverheadMs = nodeSubprocessOverhead(cwd);
  for (let packageIndex = 0; packageIndex < scale.codePackages; packageIndex += 1) {
    const packageDir = path.join(cwd, "packages", packageName(packageIndex));
    writeFile(path.join(packageDir, "package.json"), benchmarkPackageJson(packageName(packageIndex), packageIndex));
    writeFile(path.join(packageDir, "package-lock.json"), generatedLockFile(packageIndex));
    writeFile(path.join(packageDir, "src", `route-${packageIndex}.js`), generatedJsFile(packageIndex));
    writeFile(path.join(packageDir, "src", `view-${packageIndex}.tsx`), generatedTsxFile(packageIndex));
    writeFile(path.join(packageDir, "src", `service-${packageIndex}.test.ts`), generatedTestFile(packageIndex));
    writeFile(path.join(packageDir, "workers", `worker-${packageIndex}.go`), generatedGoFile(packageIndex));
    writeFile(path.join(packageDir, "scripts", `audit-${packageIndex}.py`), generatedPythonFile(packageIndex));
    writeFile(path.join(packageDir, "polyglot", `worker-${packageIndex}.rs`), generatedRustFile(packageIndex));
    writeFile(path.join(packageDir, "polyglot", `Controller${packageIndex}.java`), generatedJavaFile(packageIndex));
    writeFile(path.join(packageDir, "polyglot", `Action${packageIndex}.php`), generatedPhpFile(packageIndex));
    writeFile(path.join(packageDir, "polyglot", `Job${packageIndex}.kt`), generatedKotlinFile(packageIndex));
    writeFile(path.join(packageDir, "polyglot", `Event${packageIndex}.swift`), generatedSwiftFile(packageIndex));
    writeFile(path.join(packageDir, "polyglot", `health-${packageIndex}.c`), generatedCFile(packageIndex));
    writeFile(path.join(packageDir, "polyglot", `engine-${packageIndex}.cpp`), generatedCppFile(packageIndex));
    writeFile(path.join(packageDir, "polyglot", `Service${packageIndex}.cs`), generatedCSharpFile(packageIndex));
    writeFile(path.join(packageDir, "config", `service-${packageIndex}.yaml`), generatedYamlFile(packageIndex));
    writeFile(path.join(packageDir, "config", `workflow-${packageIndex}.json`), generatedWorkflowJsonFile(packageIndex));
    writeFile(path.join(packageDir, "config", "service-token.yaml"), "SERVICE_TOKEN: do-not-index\n");
    writeFile(path.join(packageDir, ".env.local"), "LOCAL_SECRET=do-not-index\n");
    writeFile(path.join(packageDir, "dist", `generated-${packageIndex}.js`), "export const ignoredDistFile = true;\n");
    writeFile(path.join(packageDir, "node_modules", "ignored", "index.js"), "export const ignoredNodeModule = true;\n");
    writeFile(path.join(packageDir, "coverage", `coverage-${packageIndex}.json`), "{\"ignored\":true}\n");
    writeFile(path.join(packageDir, "tmp", `generated-${packageIndex}.ts`), "export const ignoredTmpFile = true;\n");
    for (let fileIndex = 0; fileIndex < scale.filesPerCodePackage; fileIndex += 1) {
      writeFile(path.join(packageDir, "src", `service-${fileIndex}.ts`), generatedTsFile(packageIndex, fileIndex, scale.filesPerCodePackage));
    }
  }
  const codeIndex = runNode([cli, "--code-index", "--code-scope", "packages"], cwd);
  const status = JSON.parse(runNode([cli, "--code-status"], cwd).value);
  const statusMap = Object.fromEntries(status.map((row) => [row.metric, row.value]));
  fs.appendFileSync(path.join(cwd, "packages", packageName(0), "src", "service-0.ts"), "\nexport const incrementalBenchmarkSignal = true;\n");
  writeFile(path.join(cwd, "packages", packageName(0), "src", "service-new.ts"), "export function incrementalBenchmarkNewFile(): boolean {\n  return true;\n}\n");
  fs.unlinkSync(path.join(cwd, "packages", packageName(0), "src", `service-${scale.filesPerCodePackage - 1}.ts`));
  const incrementalIndex = runNode([cli, "--code-index", "--code-scope", "packages"], cwd);
  const incrementalOutput = parseKeyValueOutput(incrementalIndex.value);
  const routeEvidenceQuery = runNode([cli, "--code-query", "SELECT route, file_path FROM routes WHERE route = '/workspace-0/health' ORDER BY file_path LIMIT 5"], cwd);
  const dependencyEvidenceQuery = runNode([cli, "--code-query", "SELECT key, value, file_path FROM configs WHERE key = 'dependency:express' ORDER BY file_path LIMIT 5"], cwd);
  const codeReport = runNode([cli, "--code-report"], cwd);
  const architectureReport = JSON.parse(codeReport.value);
  const treeSitterIndex = runNode([cli, "--code-index", "--code-parser", "tree-sitter", "--code-index-out", ".project-wiki/tree-sitter-code-evidence.sqlite", "--code-scope", "packages"], cwd);
  const treeSitterStatus = JSON.parse(runNode([cli, "--code-status", "--code-index-out", ".project-wiki/tree-sitter-code-evidence.sqlite"], cwd).value);
  const treeSitterStatusMap = Object.fromEntries(treeSitterStatus.map((row) => [row.metric, row.value]));
  const treeSitterReportRun = runNode([cli, "--code-report", "--code-index-out", ".project-wiki/tree-sitter-code-evidence.sqlite"], cwd);
  const treeSitterReport = JSON.parse(treeSitterReportRun.value);
  const treeSitterProfiles = Array.isArray(treeSitterReport.language_profile_summary)
    ? treeSitterReport.language_profile_summary.map((row) => row.profile).sort()
    : [];
  const routeEvidenceRows = JSON.parse(routeEvidenceQuery.value);
  const dependencyEvidenceRows = JSON.parse(dependencyEvidenceQuery.value);
  const incrementalMode = incrementalOutput.mode || "unsupported";
  const reindexedFiles = Number(incrementalOutput.reindexed_files || 0);
  const deletedFiles = Number(incrementalOutput.deleted_files || 0);
  const generatedTsFiles = scale.codePackages * scale.filesPerCodePackage;
  const generatedJsFiles = scale.codePackages;
  const generatedTsxFiles = scale.codePackages;
  const generatedTestFiles = scale.codePackages;
  const generatedGoFiles = scale.codePackages;
  const generatedPythonFiles = scale.codePackages;
  const generatedRustFiles = scale.codePackages;
  const generatedJavaFiles = scale.codePackages;
  const generatedPhpFiles = scale.codePackages;
  const generatedKotlinFiles = scale.codePackages;
  const generatedSwiftFiles = scale.codePackages;
  const generatedCFiles = scale.codePackages;
  const generatedCppFiles = scale.codePackages;
  const generatedCSharpFiles = scale.codePackages;
  const generatedConfigFiles = scale.codePackages * 2;
  const generatedPackageJsonFiles = scale.codePackages;
  const generatedLockFiles = scale.codePackages;
  const generatedIgnoredFiles = scale.codePackages * 6;
  const expectedIndexedFiles = generatedTsFiles
    + generatedJsFiles
    + generatedTsxFiles
    + generatedTestFiles
    + generatedGoFiles
    + generatedPythonFiles
    + generatedRustFiles
    + generatedJavaFiles
    + generatedPhpFiles
    + generatedKotlinFiles
    + generatedSwiftFiles
    + generatedCFiles
    + generatedCppFiles
    + generatedCSharpFiles
    + generatedConfigFiles
    + generatedPackageJsonFiles
    + generatedLockFiles;
  expectBenchmark(Number(statusMap.files || 0) === expectedIndexedFiles, `code-heavy full index file count was ${statusMap.files}; expected ${expectedIndexedFiles}`);
  expectBenchmark(incrementalMode === "incremental", `code-heavy rerun used ${incrementalMode} mode; expected incremental`);
  expectBenchmark(reindexedFiles === 2, `code-heavy incremental reindexed ${reindexedFiles} files; expected 2`);
  expectBenchmark(deletedFiles === 1, `code-heavy incremental deleted ${deletedFiles} files; expected 1`);
  const reportSections = Array.isArray(architectureReport.report_sections) ? architectureReport.report_sections : [];
  const evidenceCoverage = architectureReport.evidence_coverage || {};
  const populatedEvidenceTables = Object.values(evidenceCoverage).filter((value) => Number(value) > 0).length;
  const packageDependencies = architectureReport.dependency_hotspots?.package_dependencies || [];
  const edgeKinds = architectureReport.edge_summary?.by_kind || [];
  const languageProfiles = architectureReport.language_profile_summary || [];
  expectBenchmark(architectureReport.schema_version === 1, `code-heavy architecture report schema was ${architectureReport.schema_version}; expected 1`);
  expectBenchmark(reportSections.length >= 7, `code-heavy architecture report had ${reportSections.length} sections; expected at least 7`);
  expectBenchmark(Number(evidenceCoverage.files || 0) === expectedIndexedFiles, `code-heavy architecture report covered ${evidenceCoverage.files} files; expected ${expectedIndexedFiles}`);
  expectBenchmark(Number(evidenceCoverage.routes || 0) >= scale.codePackages, `code-heavy architecture report covered ${evidenceCoverage.routes} routes; expected at least ${scale.codePackages}`);
  expectBenchmark(populatedEvidenceTables >= 6, `code-heavy architecture report populated ${populatedEvidenceTables} evidence tables; expected at least 6`);
  expectBenchmark(Array.isArray(architectureReport.ownership_summary) && architectureReport.ownership_summary.length > 0, "code-heavy architecture report had no ownership summary");
  expectBenchmark(Array.isArray(languageProfiles) && languageProfiles.some((row) => row.profile === "go-light"), "code-heavy architecture report had no go-light language profile");
  expectBenchmark(Array.isArray(languageProfiles) && languageProfiles.some((row) => row.profile === "python-light"), "code-heavy architecture report had no python-light language profile");
  expectBenchmark(Array.isArray(languageProfiles) && languageProfiles.some((row) => row.profile === "config"), "code-heavy architecture report had no config language profile");
  expectBenchmark(Array.isArray(packageDependencies) && packageDependencies.length > 0, "code-heavy architecture report had no package dependency hotspots");
  expectBenchmark(Array.isArray(edgeKinds) && edgeKinds.some((row) => row.kind === "route_to_handler"), "code-heavy architecture report had no route_to_handler edge summary");
  expectBenchmark(routeEvidenceRows.some((row) => row.file_path === "packages/workspace-00/src/route-0.js"), "code-heavy route evidence query did not return workspace-00 route file");
  expectBenchmark(dependencyEvidenceRows.some((row) => row.file_path === "packages/workspace-00/package.json" && row.value === "^4.0.0"), "code-heavy dependency evidence query did not return workspace-00 express dependency");
  expectBenchmark(treeSitterReport.parser_mode === "tree-sitter", `tree-sitter code report parser mode was ${treeSitterReport.parser_mode}; expected tree-sitter`);
  expectBenchmark(Number(treeSitterStatusMap.files || 0) === expectedIndexedFiles, `tree-sitter code index file count was ${treeSitterStatusMap.files}; expected ${expectedIndexedFiles}`);
  for (const profile of ["tree-sitter-c", "tree-sitter-cpp", "tree-sitter-csharp", "tree-sitter-go", "tree-sitter-java", "tree-sitter-javascript", "tree-sitter-kotlin", "tree-sitter-php", "tree-sitter-python", "tree-sitter-rust", "tree-sitter-swift", "tree-sitter-tsx", "tree-sitter-typescript"]) {
    expectBenchmark(treeSitterProfiles.includes(profile), `tree-sitter code report missed profile ${profile}`);
  }
  return {
    fixture_kind: "code-heavy-large-project",
    confidence: "high-for-js-ts-tsx-config-code-index-throughput-claims",
    assumptions: {
      packages: scale.codePackages,
      files_per_package: scale.filesPerCodePackage,
      generated_ts_files: generatedTsFiles,
      generated_js_files: generatedJsFiles,
      generated_tsx_files: generatedTsxFiles,
      generated_test_files: generatedTestFiles,
      generated_go_files: generatedGoFiles,
      generated_python_files: generatedPythonFiles,
      generated_rust_files: generatedRustFiles,
      generated_java_files: generatedJavaFiles,
      generated_php_files: generatedPhpFiles,
      generated_kotlin_files: generatedKotlinFiles,
      generated_swift_files: generatedSwiftFiles,
      generated_c_files: generatedCFiles,
      generated_cpp_files: generatedCppFiles,
      generated_csharp_files: generatedCSharpFiles,
      generated_config_files: generatedConfigFiles,
      generated_package_json_files: generatedPackageJsonFiles,
      generated_lock_files: generatedLockFiles,
      generated_ignored_files: generatedIgnoredFiles,
      ignored_file_kinds: ["secret-config", "env-local", "dist", "node_modules", "coverage", "tmp"],
    },
    bootstrap_create_ms: bootstrapMs,
    timing_scope: "node_cli_subprocess_e2e",
    node_subprocess_overhead_ms: subprocessOverheadMs,
    code_index_ms: codeIndex.elapsed_ms,
    code_index_operation_estimated_ms: estimatedOperationMs(codeIndex.elapsed_ms, subprocessOverheadMs),
    code_index_files: Number(statusMap.files || 0),
    code_index_symbols: Number(statusMap.symbols || 0),
    code_index_edges: Number(statusMap.edges || 0),
    code_index_files_per_second: round(Number(statusMap.files || 0) / (codeIndex.elapsed_ms / 1000)),
    incremental_index_ms: incrementalIndex.elapsed_ms,
    incremental_index_operation_estimated_ms: estimatedOperationMs(incrementalIndex.elapsed_ms, subprocessOverheadMs),
    incremental_index_mode: incrementalMode,
    incremental_reindexed_files: reindexedFiles,
    incremental_deleted_files: deletedFiles,
    incremental_files_per_second: round(reindexedFiles / (incrementalIndex.elapsed_ms / 1000)),
    full_to_incremental_time_reduction_percent: round(((codeIndex.elapsed_ms - incrementalIndex.elapsed_ms) / codeIndex.elapsed_ms) * 100),
    architecture_report_ms: codeReport.elapsed_ms,
    architecture_report_operation_estimated_ms: estimatedOperationMs(codeReport.elapsed_ms, subprocessOverheadMs),
    code_evidence_query_ms: routeEvidenceQuery.elapsed_ms,
    code_evidence_query_operation_estimated_ms: estimatedOperationMs(routeEvidenceQuery.elapsed_ms, subprocessOverheadMs),
    architecture_report_schema_version: architectureReport.schema_version,
    architecture_report_sections: reportSections.length,
    architecture_report_evidence_tables: populatedEvidenceTables,
    architecture_report_language_profiles: Array.isArray(languageProfiles) ? languageProfiles.length : 0,
    architecture_report_owners: Array.isArray(architectureReport.ownership_summary) ? architectureReport.ownership_summary.length : 0,
    architecture_report_routes: Number(evidenceCoverage.routes || 0),
    architecture_report_dependencies: packageDependencies.length,
    architecture_report_configs: Number(evidenceCoverage.configs || 0),
    architecture_report_edges: Number(evidenceCoverage.edges || 0),
    architecture_report_stale_files: Number(architectureReport.stale?.files || 0),
    tree_sitter_code_index_ms: treeSitterIndex.elapsed_ms,
    tree_sitter_code_index_operation_estimated_ms: estimatedOperationMs(treeSitterIndex.elapsed_ms, subprocessOverheadMs),
    tree_sitter_code_files: Number(treeSitterStatusMap.files || 0),
    tree_sitter_code_symbols: Number(treeSitterStatusMap.symbols || 0),
    tree_sitter_code_imports: Number(treeSitterStatusMap.imports || 0),
    tree_sitter_code_edges: Number(treeSitterStatusMap.edges || 0),
    tree_sitter_code_files_per_second: round(Number(treeSitterStatusMap.files || 0) / (treeSitterIndex.elapsed_ms / 1000)),
    tree_sitter_architecture_report_ms: treeSitterReportRun.elapsed_ms,
    tree_sitter_architecture_report_operation_estimated_ms: estimatedOperationMs(treeSitterReportRun.elapsed_ms, subprocessOverheadMs),
    tree_sitter_parser_profiles: treeSitterProfiles.length,
    tree_sitter_parser_profile_names: treeSitterProfiles,
    tree_sitter_vs_default_index_ms_delta_percent: compareNumber(codeIndex.elapsed_ms, treeSitterIndex.elapsed_ms),
    tree_sitter_vs_default_symbol_delta_percent: compareNumber(Number(statusMap.symbols || 0), Number(treeSitterStatusMap.symbols || 0)),
    evidence_correctness: {
      route_query_returned_expected_file: routeEvidenceRows.some((row) => row.file_path === "packages/workspace-00/src/route-0.js"),
      dependency_query_returned_expected_file: dependencyEvidenceRows.some((row) => row.file_path === "packages/workspace-00/package.json" && row.value === "^4.0.0"),
      expected_route: "/workspace-0/health",
      expected_dependency: "dependency:express",
      correctness_status: "passed",
    },
    validations: [
      passedValidation(`full index contained ${expectedIndexedFiles} files`),
      passedValidation("code index rerun completed"),
      passedValidation("rerun used incremental index mode"),
      passedValidation("incremental rerun reindexed 2 files"),
      passedValidation("incremental rerun deleted 1 file"),
      passedValidation(`architecture report populated ${populatedEvidenceTables} evidence tables`),
      passedValidation(`architecture report listed ${Array.isArray(languageProfiles) ? languageProfiles.length : 0} language profiles`),
      passedValidation(`architecture report covered ${Number(evidenceCoverage.routes || 0)} routes`),
      passedValidation(`architecture report listed ${packageDependencies.length} package dependencies`),
      passedValidation("code evidence query returned expected route file"),
      passedValidation("code evidence query returned expected dependency file"),
      passedValidation(`tree-sitter index covered ${treeSitterProfiles.length} parser profiles`),
    ],
  };
}

function sampleRepoPathValues() {
  const seen = new Set();
  return argValues("--sample-repo").map((value) => {
    const resolved = path.resolve(value);
    if (!fs.existsSync(resolved)) fail(`missing benchmark sample repo: ${resolved}`);
    if (!fs.statSync(resolved).isDirectory()) fail(`benchmark sample repo is not a directory: ${resolved}`);
    return resolved;
  }).filter((resolved) => {
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  }).map((resolved, index) => ({
    id: sampleRepoId(resolved, index),
    kind: sampleRepoKind(index),
    sourcePath: resolved,
    fingerprint: sampleRepoFingerprint(resolved),
  }));
}

function sampleRepoScenario(baseDir, sampleRepo) {
  const cwd = path.join(baseDir, sampleRepo.kind);
  copyDirectoryFiltered(sampleRepo.sourcePath, cwd);
  const bootstrapMs = bootstrapProject(cwd);
  const subprocessOverheadMs = nodeSubprocessOverhead(cwd);
  const codeIndex = runNode([cli, "--code-index", "--code-scope", "."], cwd);
  const status = JSON.parse(runNode([cli, "--code-status"], cwd).value);
  const statusMap = Object.fromEntries(status.map((row) => [row.metric, row.value]));
  const codeReport = runNode([cli, "--code-report"], cwd);
  const architectureReport = JSON.parse(codeReport.value);
  const reportSections = Array.isArray(architectureReport.report_sections) ? architectureReport.report_sections : [];
  const evidenceCoverage = architectureReport.evidence_coverage || {};
  const populatedEvidenceTables = Object.values(evidenceCoverage).filter((value) => Number(value) > 0).length;
  const packageDependencies = architectureReport.dependency_hotspots?.package_dependencies || [];
  const profile = sampleRepoProfile(architectureReport, evidenceCoverage, packageDependencies, sampleRepo.sourcePath);
  const routeCount = Number(evidenceCoverage.routes || 0);
  const fileCount = Number(statusMap.files || 0);
  expectBenchmark(fileCount > 0, "sample repo code index found no indexable files");
  expectBenchmark(Number(statusMap.stale_files || 0) === 0, `sample repo code index had ${statusMap.stale_files} stale files after indexing`);
  expectBenchmark(architectureReport.schema_version === 1, `sample repo architecture report schema was ${architectureReport.schema_version}; expected 1`);
  expectBenchmark(reportSections.length >= 7, `sample repo architecture report had ${reportSections.length} sections; expected at least 7`);
  expectBenchmark(Number(evidenceCoverage.files || 0) === fileCount, `sample repo architecture report covered ${evidenceCoverage.files} files; expected ${fileCount}`);
  expectBenchmark(populatedEvidenceTables >= 2, `sample repo architecture report populated ${populatedEvidenceTables} evidence tables; expected at least 2`);
  expectBenchmark(Array.isArray(architectureReport.ownership_summary) && architectureReport.ownership_summary.length > 0, "sample repo architecture report had no ownership summary");
  expectBenchmark(Array.isArray(architectureReport.language_profile_summary) && architectureReport.language_profile_summary.length > 0, "sample repo architecture report had no language profile summary");
  return {
    fixture_kind: sampleRepo.kind,
    sample_repo_id: sampleRepo.id,
    sample_repo_name: path.basename(sampleRepo.sourcePath) || sampleRepo.id,
    confidence: "observational-for-the-explicit-local-repo-only",
    assumptions: {
      source_path: sampleRepo.sourcePath,
      copied_worktree: true,
      code_scope: ".",
      excluded_directories: Array.from(sampleRepoIgnoredDirectories).sort(),
    },
    sample_repo_fingerprint: sampleRepo.fingerprint.value,
    sample_repo_fingerprint_algorithm: sampleRepo.fingerprint.algorithm,
    sample_repo_fingerprint_file_count: sampleRepo.fingerprint.file_count,
    sample_repo_fingerprint_symlink_count: sampleRepo.fingerprint.symlink_count,
    sample_repo_profile: profile.primary,
    sample_repo_profile_traits: profile.traits,
    sample_repo_language_profiles: profile.language_profiles,
    bootstrap_create_ms: bootstrapMs,
    timing_scope: "node_cli_subprocess_e2e",
    node_subprocess_overhead_ms: subprocessOverheadMs,
    sample_repo_code_index_ms: codeIndex.elapsed_ms,
    sample_repo_code_index_operation_estimated_ms: estimatedOperationMs(codeIndex.elapsed_ms, subprocessOverheadMs),
    sample_repo_code_files: fileCount,
    sample_repo_code_symbols: Number(statusMap.symbols || 0),
    sample_repo_code_edges: Number(statusMap.edges || 0),
    sample_repo_code_configs: Number(statusMap.configs || 0),
    sample_repo_code_routes: Number(statusMap.routes || 0),
    sample_repo_code_files_per_second: round(fileCount / (codeIndex.elapsed_ms / 1000)),
    sample_repo_architecture_report_ms: codeReport.elapsed_ms,
    sample_repo_architecture_report_operation_estimated_ms: estimatedOperationMs(codeReport.elapsed_ms, subprocessOverheadMs),
    sample_repo_architecture_report_schema_version: architectureReport.schema_version,
    sample_repo_architecture_report_sections: reportSections.length,
    sample_repo_architecture_report_evidence_tables: populatedEvidenceTables,
    sample_repo_architecture_report_owners: Array.isArray(architectureReport.ownership_summary) ? architectureReport.ownership_summary.length : 0,
    sample_repo_architecture_report_routes: routeCount,
    sample_repo_architecture_report_dependencies: packageDependencies.length,
    sample_repo_architecture_report_configs: Number(evidenceCoverage.configs || 0),
    sample_repo_architecture_report_edges: Number(evidenceCoverage.edges || 0),
    sample_repo_architecture_report_stale_files: Number(architectureReport.stale?.files || 0),
    validations: [
      passedValidation(`sample repo full index contained ${fileCount} files`),
      passedValidation("sample repo code index was fresh after indexing"),
      passedValidation(`sample repo architecture report populated ${populatedEvidenceTables} evidence tables`),
      passedValidation(`sample repo profile ${profile.primary}`),
      passedValidation(`sample repo architecture report covered ${routeCount} routes`),
      passedValidation(`sample repo architecture report listed ${packageDependencies.length} package dependencies`),
    ],
  };
}

function packageVersion() {
  const parsed = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return parsed.version || "unknown";
}

function defaultBaselinePath(report) {
  return path.join(root, "benchmarks", "baselines", `${report.package_version}-${report.scale}.json`);
}

function baselineManifestPath() {
  return path.join(root, "benchmarks", "baselines", "manifest.json");
}

function defaultMarkdownPath(report) {
  return path.join(root, "benchmarks", "reports", `${report.package_version}-${report.scale}.md`);
}

function defaultTrendJsonPath() {
  return path.join(root, "benchmarks", "reports", "trend.json");
}

function defaultTrendMarkdownPath() {
  return path.join(root, "benchmarks", "reports", "trend.md");
}

function compareNumber(previous, current) {
  if (typeof previous !== "number" || previous === 0 || typeof current !== "number") return null;
  return round(((current - previous) / previous) * 100);
}

const regressionThresholds = {
  docs_query_ms_delta_percent: { direction: "max", threshold: 10 },
  monorepo_doctor_ms_delta_percent: { direction: "max", threshold: 10 },
  scoped_refresh_index_ms_delta_percent: { direction: "max", threshold: 15 },
  scoped_main_index_chars_delta_percent: { direction: "max", threshold: 5 },
  code_index_ms_delta_percent: { direction: "max", threshold: 10 },
  code_index_throughput_delta_percent: { direction: "min", threshold: -10 },
  incremental_index_ms_delta_percent: { direction: "max", threshold: 15 },
  architecture_report_ms_delta_percent: { direction: "max", threshold: 15 },
  tree_sitter_code_index_ms_delta_percent: { direction: "max", threshold: 20 },
  tree_sitter_architecture_report_ms_delta_percent: { direction: "max", threshold: 20 },
  sample_repo_code_index_ms_delta_percent: { direction: "max", threshold: 20 },
  sample_repo_architecture_report_ms_delta_percent: { direction: "max", threshold: 20 },
  sample_repo_worst_code_index_ms_delta_percent: { direction: "max", threshold: 20 },
  sample_repo_worst_architecture_report_ms_delta_percent: { direction: "max", threshold: 20 },
  summary_min_estimated_token_avoidance_delta_percent: { direction: "min", threshold: -0.1 },
};

const claimMetricRules = [
  { id: "docs.query_ms", scenario: "docs-heavy-large-project", path: ["query_ms"], max_cv_percent: 12, max_range_ms: 20, claim: "docs-heavy wiki query latency" },
  { id: "docs.targeted_context.avg_read_ms", scenario: "docs-heavy-large-project", path: ["targeted_context", "avg_read_ms"], max_cv_percent: 15, max_range_ms: 2, claim: "docs-heavy targeted-context read timing" },
  { id: "docs.full_wiki.avg_read_ms", scenario: "docs-heavy-large-project", path: ["full_wiki", "avg_read_ms"], max_cv_percent: 15, max_range_ms: 2, claim: "docs-heavy full-wiki read timing" },
  { id: "monorepo.doctor_ms", scenario: "monorepo-large-project", path: ["doctor_ms"], max_cv_percent: 12, max_range_ms: 25, claim: "monorepo diagnostics latency" },
  { id: "monorepo.query_ms", scenario: "monorepo-large-project", path: ["query_ms"], max_cv_percent: 12, max_range_ms: 20, claim: "monorepo wiki query latency" },
  { id: "monorepo.targeted_context.avg_read_ms", scenario: "monorepo-large-project", path: ["targeted_context", "avg_read_ms"], max_cv_percent: 15, max_range_ms: 2, claim: "monorepo targeted-context read timing" },
  { id: "monorepo.full_wiki.avg_read_ms", scenario: "monorepo-large-project", path: ["full_wiki", "avg_read_ms"], max_cv_percent: 15, max_range_ms: 2, claim: "monorepo full-wiki read timing" },
  { id: "scoped.refresh_index_ms", scenario: "scoped-routing-large-project", path: ["refresh_index_ms"], max_cv_percent: 15, max_range_ms: 60, claim: "scoped-router refresh-index latency" },
  { id: "scoped.targeted_context.avg_read_ms", scenario: "scoped-routing-large-project", path: ["targeted_context", "avg_read_ms"], max_cv_percent: 15, max_range_ms: 2, claim: "scoped-router targeted-context read timing" },
  { id: "scoped.full_wiki.avg_read_ms", scenario: "scoped-routing-large-project", path: ["full_wiki", "avg_read_ms"], max_cv_percent: 15, max_range_ms: 2, claim: "scoped-router full-wiki read timing" },
  { id: "code.code_index_ms", scenario: "code-heavy-large-project", path: ["code_index_ms"], max_cv_percent: 12, max_range_ms: 75, claim: "full code-index latency" },
  { id: "code.incremental_index_ms", scenario: "code-heavy-large-project", path: ["incremental_index_ms"], max_cv_percent: 15, max_range_ms: 35, claim: "incremental code-index latency" },
  { id: "code.architecture_report_ms", scenario: "code-heavy-large-project", path: ["architecture_report_ms"], max_cv_percent: 15, max_range_ms: 35, claim: "architecture report latency" },
  { id: "code.tree_sitter_code_index_ms", scenario: "code-heavy-large-project", path: ["tree_sitter_code_index_ms"], max_cv_percent: 18, max_range_ms: 125, claim: "Tree-sitter code-index latency" },
  { id: "code.tree_sitter_architecture_report_ms", scenario: "code-heavy-large-project", path: ["tree_sitter_architecture_report_ms"], max_cv_percent: 18, max_range_ms: 50, claim: "Tree-sitter architecture report latency" },
];

function claimMetricRulesForScenarios(scenarios) {
  const sampleRules = scenarios.filter(isSampleRepoScenario).flatMap((scenario) => [
    {
      id: `sample_repo.${scenario.sample_repo_id}.code_index_ms`,
      scenario: scenario.fixture_kind,
      path: ["sample_repo_code_index_ms"],
      max_cv_percent: 20,
      max_range_ms: 100,
      claim: "explicit sample repo code-index latency",
    },
    {
      id: `sample_repo.${scenario.sample_repo_id}.architecture_report_ms`,
      scenario: scenario.fixture_kind,
      path: ["sample_repo_architecture_report_ms"],
      max_cv_percent: 20,
      max_range_ms: 100,
      claim: "explicit sample repo architecture report latency",
    },
  ]);
  return [...claimMetricRules, ...sampleRules];
}

function scenarioCompatibilitySignature(scenario) {
  if (!isSampleRepoScenario(scenario)) {
    return { kind: scenario.fixture_kind };
  }
  return {
    kind: scenario.fixture_kind,
    sample_repo_id: scenario.sample_repo_id,
    sample_repo_profile: scenario.sample_repo_profile,
    sample_repo_fingerprint: scenario.sample_repo_fingerprint,
    sample_repo_fingerprint_algorithm: scenario.sample_repo_fingerprint_algorithm,
  };
}

function compatibilitySignature(report) {
  return {
    scenarios: (report.scenarios || []).map(scenarioCompatibilitySignature),
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function nodeMajorVersion(value) {
  const match = String(value || "").match(/^v?(\d+)\./);
  return match ? Number(match[1]) : null;
}

function assessCompatibility(current, baseline, options = {}) {
  const mode = options.compatibilityMode || "strict";
  const strict = mode === "strict";
  const environment = {
    node: strict ? current.environment?.node === baseline.environment?.node : nodeMajorVersion(current.environment?.node) === nodeMajorVersion(baseline.environment?.node),
    v8: strict ? current.environment?.v8 === baseline.environment?.v8 : true,
    platform: current.environment?.platform === baseline.environment?.platform,
    arch: current.environment?.arch === baseline.environment?.arch,
    os_release: strict ? current.environment?.os_release === baseline.environment?.os_release : true,
    cpu_model: strict ? current.environment?.cpu_model === baseline.environment?.cpu_model : true,
    cpu_count: strict ? current.environment?.cpu_count === baseline.environment?.cpu_count : true,
    total_memory_mb: strict ? current.environment?.total_memory_mb === baseline.environment?.total_memory_mb : true,
  };
  const benchmark = {
    schema_version: current.schema_version === baseline.schema_version,
    scale: current.scale === baseline.scale,
    runs: current.measurement?.runs === baseline.measurement?.runs,
    warmup_runs: current.measurement?.warmup_runs === baseline.measurement?.warmup_runs,
    measurement_protocol: current.measurement?.measurement_protocol === baseline.measurement?.measurement_protocol,
    scenarios: stableStringify(compatibilitySignature(current).scenarios) === stableStringify(compatibilitySignature(baseline).scenarios),
  };
  const sourceControl = {
    available: Boolean(current.source_control?.available) && Boolean(baseline.source_control?.available),
    clean: !current.source_control?.dirty && !baseline.source_control?.dirty,
  };
  const issues = [
    ...Object.entries(environment).filter(([, matches]) => !matches).map(([field]) => `environment.${field}`),
    ...Object.entries(benchmark).filter(([, matches]) => !matches).map(([field]) => field === "schema_version" ? field : `benchmark.${field}`),
    ...(options.strictSourceControl ? Object.entries(sourceControl).filter(([, matches]) => !matches).map(([field]) => `source_control.${field}`) : []),
  ];
  return {
    comparable: issues.length === 0,
    mode,
    environment,
    benchmark,
    source_control: sourceControl,
    strict_source_control: Boolean(options.strictSourceControl),
    issues,
  };
}

function assessComparison(comparison, current, baseline, options = {}) {
  const regressions = [];
  for (const [metric, rule] of Object.entries(regressionThresholds)) {
    const value = comparison[metric];
    if (typeof value !== "number") continue;
    if (rule.direction === "max" && value > rule.threshold) regressions.push({ metric, value, threshold: rule.threshold });
    if (rule.direction === "min" && value < rule.threshold) regressions.push({ metric, value, threshold: rule.threshold });
  }
  const compatibility = assessCompatibility(current, baseline, options);
  const unstableMetrics = current.measurement?.unstable_metrics || [];
  let regressionStatus = "passed";
  if (!compatibility.comparable) regressionStatus = "not_comparable";
  else if (regressions.length > 0) regressionStatus = "failed";
  else if (unstableMetrics.length > 0 || current.measurement?.timing_status !== "stable") regressionStatus = "unstable";
  return {
    regression_status: regressionStatus,
    regression_thresholds: regressionThresholds,
    compatibility,
    unstable_metrics: unstableMetrics,
    regressions,
  };
}

function loadBaseline(filePath) {
  if (!filePath) return null;
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) fail(`missing benchmark baseline: ${absolutePath}`);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  if (parsed.schema_version !== schemaVersion) fail(`unsupported benchmark baseline schema: ${absolutePath}`);
  return parsed;
}

function scenarioByKind(report, kind) {
  return report.scenarios.find((scenario) => scenario.fixture_kind === kind) || {};
}

function maxNumber(values) {
  const numbers = values.filter((value) => typeof value === "number");
  if (numbers.length === 0) return null;
  return Math.max(...numbers);
}

function sampleRepoComparisonDeltas(current, baseline) {
  const baselineById = new Map(baseline.scenarios.filter(isSampleRepoScenario).map((scenario) => [scenario.sample_repo_id, scenario]));
  return current.scenarios.filter(isSampleRepoScenario).map((currentScenario) => {
    const baselineScenario = baselineById.get(currentScenario.sample_repo_id) || {};
    return {
      sample_repo_id: currentScenario.sample_repo_id,
      fixture_kind: currentScenario.fixture_kind,
      sample_repo_profile: currentScenario.sample_repo_profile,
      code_index_ms_delta_percent: compareNumber(baselineScenario.sample_repo_code_index_ms, currentScenario.sample_repo_code_index_ms),
      architecture_report_ms_delta_percent: compareNumber(baselineScenario.sample_repo_architecture_report_ms, currentScenario.sample_repo_architecture_report_ms),
    };
  });
}

function compareReport(current, baseline, options = {}) {
  const docsCurrent = scenarioByKind(current, "docs-heavy-large-project");
  const docsBaseline = scenarioByKind(baseline, "docs-heavy-large-project");
  const monorepoCurrent = scenarioByKind(current, "monorepo-large-project");
  const monorepoBaseline = scenarioByKind(baseline, "monorepo-large-project");
  const scopedCurrent = scenarioByKind(current, "scoped-routing-large-project");
  const scopedBaseline = scenarioByKind(baseline, "scoped-routing-large-project");
  const codeCurrent = scenarioByKind(current, "code-heavy-large-project");
  const codeBaseline = scenarioByKind(baseline, "code-heavy-large-project");
  const sampleRepoDeltas = sampleRepoComparisonDeltas(current, baseline);
  const comparison = {
    baseline_generated_at: baseline.generated_at,
    baseline_package_version: baseline.package_version,
    docs_estimated_token_avoidance_delta_percent: round((docsCurrent.savings?.estimated_token_avoidance_percent || 0) - (docsBaseline.savings?.estimated_token_avoidance_percent || 0)),
    docs_query_ms_delta_percent: compareNumber(docsBaseline.query_ms, docsCurrent.query_ms),
    monorepo_estimated_token_avoidance_delta_percent: round((monorepoCurrent.savings?.estimated_token_avoidance_percent || 0) - (monorepoBaseline.savings?.estimated_token_avoidance_percent || 0)),
    monorepo_doctor_ms_delta_percent: compareNumber(monorepoBaseline.doctor_ms, monorepoCurrent.doctor_ms),
    scoped_estimated_token_avoidance_delta_percent: round((scopedCurrent.savings?.estimated_token_avoidance_percent || 0) - (scopedBaseline.savings?.estimated_token_avoidance_percent || 0)),
    scoped_refresh_index_ms_delta_percent: compareNumber(scopedBaseline.refresh_index_ms, scopedCurrent.refresh_index_ms),
    scoped_main_index_chars_delta_percent: compareNumber(scopedBaseline.main_index_chars, scopedCurrent.main_index_chars),
    code_index_ms_delta_percent: compareNumber(codeBaseline.code_index_ms, codeCurrent.code_index_ms),
    code_index_throughput_delta_percent: compareNumber(codeBaseline.code_index_files_per_second, codeCurrent.code_index_files_per_second),
    incremental_index_ms_delta_percent: compareNumber(codeBaseline.incremental_index_ms, codeCurrent.incremental_index_ms),
    architecture_report_ms_delta_percent: compareNumber(codeBaseline.architecture_report_ms, codeCurrent.architecture_report_ms),
    tree_sitter_code_index_ms_delta_percent: compareNumber(codeBaseline.tree_sitter_code_index_ms, codeCurrent.tree_sitter_code_index_ms),
    tree_sitter_architecture_report_ms_delta_percent: compareNumber(codeBaseline.tree_sitter_architecture_report_ms, codeCurrent.tree_sitter_architecture_report_ms),
    sample_repo_code_index_ms_delta_percent: compareNumber(baseline.summary?.sample_repo_code_index_ms, current.summary?.sample_repo_code_index_ms),
    sample_repo_architecture_report_ms_delta_percent: compareNumber(baseline.summary?.sample_repo_architecture_report_ms, current.summary?.sample_repo_architecture_report_ms),
    sample_repo_worst_code_index_ms_delta_percent: maxNumber(sampleRepoDeltas.map((item) => item.code_index_ms_delta_percent)),
    sample_repo_worst_architecture_report_ms_delta_percent: maxNumber(sampleRepoDeltas.map((item) => item.architecture_report_ms_delta_percent)),
    sample_repo_deltas: sampleRepoDeltas,
    full_to_incremental_time_reduction_delta_percent: round((codeCurrent.full_to_incremental_time_reduction_percent || 0) - (codeBaseline.full_to_incremental_time_reduction_percent || 0)),
    summary_min_estimated_token_avoidance_delta_percent: round(current.summary.min_estimated_token_avoidance_percent - baseline.summary.min_estimated_token_avoidance_percent),
  };
  return {
    ...comparison,
    ...assessComparison(comparison, current, baseline, options),
  };
}

function writeReport(report, filePath) {
  if (!filePath) return;
  const absolutePath = path.resolve(filePath);
  writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
}

function projectRelativePath(filePath) {
  return path.relative(root, path.resolve(filePath)).split(path.sep).join("/");
}

function writeBaselineManifest(report, baselinePath) {
  const absoluteBaselinePath = path.resolve(baselinePath);
  const officialBaselineDir = path.join(root, "benchmarks", "baselines");
  if (path.dirname(absoluteBaselinePath) !== officialBaselineDir) return;
  const manifestPath = baselineManifestPath();
  const existing = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { schema_version: 1, baselines: [] };
  const entry = {
    path: projectRelativePath(absoluteBaselinePath),
    package_version: report.package_version,
    benchmark_schema_version: report.schema_version,
    scale: report.scale,
    generated_at: report.generated_at,
    source_control: report.source_control,
    environment: report.environment,
    measurement: {
      runs: report.measurement.runs,
      warmup_runs: report.measurement.warmup_runs,
      measurement_protocol: report.measurement.measurement_protocol,
      timing_status: report.measurement.timing_status,
      claimable_metrics: report.measurement.claimable_metrics,
      unstable_metrics: report.measurement.unstable_metrics,
    },
    sample_repo_fingerprints: report.benchmark_configuration.sample_repo_fingerprints,
    summary: report.summary,
  };
  const baselines = Array.isArray(existing.baselines) ? existing.baselines : [];
  const withoutCurrent = baselines.filter((item) => item.path !== entry.path);
  const next = {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    baselines: [...withoutCurrent, entry].sort((left, right) => left.path.localeCompare(right.path)),
  };
  writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
}

function formatDelta(value) {
  if (value === null || typeof value === "undefined") return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}%`;
}

function markdownSummary(report) {
  const docs = scenarioByKind(report, "docs-heavy-large-project");
  const monorepo = scenarioByKind(report, "monorepo-large-project");
  const scoped = scenarioByKind(report, "scoped-routing-large-project");
  const code = scenarioByKind(report, "code-heavy-large-project");
  const sampleRepos = report.scenarios.filter(isSampleRepoScenario);
  const comparison = report.comparison;
  const sampleSummaryRows = sampleRepos.length > 0 ? `| Sample repos | ${report.summary.sample_repo_count} |
| Sample repo code-index files | ${report.summary.sample_repo_code_files} |
| Sample repo median code-index time | ${report.summary.sample_repo_code_index_ms}ms |
| Sample repo median architecture report time | ${report.summary.sample_repo_architecture_report_ms}ms |
| Sample repo architecture report routes | ${report.summary.sample_repo_architecture_report_routes} |
| Sample repo architecture report dependencies | ${report.summary.sample_repo_architecture_report_dependencies} |
` : "";
  const sampleScenarioRows = sampleRepos.map((sampleRepo) => `| Sample repo ${sampleRepo.sample_repo_id} | ${sampleRepo.sample_repo_code_files || 0} files | n/a | n/a | full ${sampleRepo.sample_repo_code_index_ms || 0}ms, report ${sampleRepo.sample_repo_architecture_report_ms || 0}ms, profile ${sampleRepo.sample_repo_profile || "unknown"} |`).join("\n");
  const sampleDeltaRows = comparison?.sample_repo_deltas?.length > 0 ? comparison.sample_repo_deltas.map((item) => `| Sample repo ${item.sample_repo_id} code index time | ${formatDelta(item.code_index_ms_delta_percent)} |
| Sample repo ${item.sample_repo_id} architecture report time | ${formatDelta(item.architecture_report_ms_delta_percent)} |`).join("\n") : "";
  const sampleComparisonRows = sampleRepos.length > 0 ? `| Sample repo median code index time | ${formatDelta(comparison?.sample_repo_code_index_ms_delta_percent)} |
| Sample repo median architecture report time | ${formatDelta(comparison?.sample_repo_architecture_report_ms_delta_percent)} |
| Sample repo worst code index time | ${formatDelta(comparison?.sample_repo_worst_code_index_ms_delta_percent)} |
| Sample repo worst architecture report time | ${formatDelta(comparison?.sample_repo_worst_architecture_report_ms_delta_percent)} |
${sampleDeltaRows}
` : "";
  const comparisonRows = comparison ? `
## Baseline Comparison

| Metric | Delta |
| --- | ---: |
| Docs targeted-context token estimate | ${formatDelta(comparison.docs_estimated_token_avoidance_delta_percent)} |
| Docs query time | ${formatDelta(comparison.docs_query_ms_delta_percent)} |
| Monorepo targeted-context token estimate | ${formatDelta(comparison.monorepo_estimated_token_avoidance_delta_percent)} |
| Monorepo doctor time | ${formatDelta(comparison.monorepo_doctor_ms_delta_percent)} |
| Scoped-router targeted-context token estimate | ${formatDelta(comparison.scoped_estimated_token_avoidance_delta_percent)} |
| Scoped-router refresh-index time | ${formatDelta(comparison.scoped_refresh_index_ms_delta_percent)} |
| Scoped-router main index size | ${formatDelta(comparison.scoped_main_index_chars_delta_percent)} |
| Code index time | ${formatDelta(comparison.code_index_ms_delta_percent)} |
| Code index throughput | ${formatDelta(comparison.code_index_throughput_delta_percent)} |
| Incremental index time | ${formatDelta(comparison.incremental_index_ms_delta_percent)} |
| Architecture report time | ${formatDelta(comparison.architecture_report_ms_delta_percent)} |
| Tree-sitter code index time | ${formatDelta(comparison.tree_sitter_code_index_ms_delta_percent)} |
| Tree-sitter architecture report time | ${formatDelta(comparison.tree_sitter_architecture_report_ms_delta_percent)} |
${sampleComparisonRows}| Full-to-incremental reduction | ${formatDelta(comparison.full_to_incremental_time_reduction_delta_percent)} |
| Minimum targeted-context token estimate | ${formatDelta(comparison.summary_min_estimated_token_avoidance_delta_percent)} |

Regression status: ${comparison.regression_status}
Compatibility: ${comparison.compatibility?.comparable ? "comparable" : `not comparable (${(comparison.compatibility?.issues || []).join(", ")})`}
` : "";
  const unstableClaims = report.measurement.unstable_metrics.length > 0 ? report.measurement.unstable_metrics.join(", ") : "none";

  return `# Project Wiki Bootstrap Benchmark ${report.package_version} (${report.scale})

Generated: ${report.generated_at}

## Summary

| Metric | Value |
| --- | ---: |
| Minimum targeted-context token estimate avoided | ${report.summary.min_estimated_token_avoidance_percent}% |
| Median targeted-context token estimate avoided | ${report.summary.median_estimated_token_avoidance_percent}% |
| Minimum read-time reduction | ${report.summary.min_read_time_reduction_percent}% |
| Median read-time reduction | ${report.summary.median_read_time_reduction_percent}% |
| Total wiki pages measured | ${report.summary.total_wiki_pages} |
| Retrieval correctness checks | ${report.summary.retrieval_correctness_passed}/${report.summary.retrieval_correctness_checks} passed |
| Targeted-context missing evidence files | ${report.summary.targeted_context_evidence_missing} |
| Startup/index-only missing evidence files | ${report.summary.startup_index_only_evidence_missing} |
| Scoped-router refresh-index time | ${report.summary.scoped_refresh_index_ms}ms |
| Scoped-router generated routers | ${report.summary.scoped_router_count} |
| Scoped-router main index chars | ${report.summary.scoped_main_index_chars} |
| Code-index time | ${report.summary.code_index_ms}ms |
| Code-index files | ${report.summary.code_index_files} |
| Code-index throughput | ${report.summary.code_index_files_per_second} files/sec |
| Incremental reindexed files | ${report.summary.code_index_incremental_reindexed_files} |
| Incremental index time | ${report.summary.code_index_incremental_ms}ms |
| Full-to-incremental time reduction | ${report.summary.code_index_full_to_incremental_time_reduction_percent}% |
| Architecture report time | ${report.summary.architecture_report_ms}ms |
| Architecture report evidence tables | ${report.summary.architecture_report_evidence_tables} |
| Architecture report routes | ${report.summary.architecture_report_routes} |
| Tree-sitter code-index time | ${report.summary.tree_sitter_code_index_ms}ms |
| Tree-sitter code-index files | ${report.summary.tree_sitter_code_files} |
| Tree-sitter parser profiles | ${report.summary.tree_sitter_parser_profiles} |
${sampleSummaryRows}| Benchmark runs | ${report.measurement.runs} |
| Warmup runs | ${report.measurement.warmup_runs} |
| Timing status | ${report.measurement.timing_status} |
| Claimable metrics | ${report.measurement.claimable_metrics.length} |
| Unstable metrics | ${unstableClaims} |

## Scenario Results

| Scenario | Scale | Targeted Context Estimate Avoided | Read Reduction | Key Timing |
| --- | ---: | ---: | ---: | ---: |
| Docs-heavy wiki | ${docs.assumptions?.generated_wiki_pages || 0} pages | ${docs.savings?.estimated_token_avoidance_percent || 0}% | ${docs.savings?.read_time_reduction_percent || 0}% | query ${docs.query_ms || 0}ms |
| Monorepo wiki | ${monorepo.assumptions?.generated_wiki_pages || 0} pages | ${monorepo.savings?.estimated_token_avoidance_percent || 0}% | ${monorepo.savings?.read_time_reduction_percent || 0}% | doctor ${monorepo.doctor_ms || 0}ms |
| Scoped router wiki | ${scoped.assumptions?.generated_wiki_pages || 0} pages | ${scoped.savings?.estimated_token_avoidance_percent || 0}% | ${scoped.savings?.read_time_reduction_percent || 0}% | refresh ${scoped.refresh_index_ms || 0}ms, routers ${scoped.scoped_router_count || 0}, index ${scoped.main_index_chars || 0} chars |
| Code-heavy mixed index | ${code.code_index_files || 0} files | n/a | n/a | full ${code.code_index_ms || 0}ms, incremental ${code.incremental_index_ms || 0}ms, report ${code.architecture_report_ms || 0}ms, tree-sitter ${code.tree_sitter_code_index_ms || 0}ms |
${sampleScenarioRows}
${comparisonRows}
## Claim Boundaries

- Maintainer benchmark for release evidence, not a public user workflow.
- Default scale is large; quick scale validates report shape only.
- Token estimates use ceil(characters / 4) against markdown characters; they are not model-tokenizer measurements.
- Context efficiency compares full-wiki markdown scanning against startup/index plus the query-returned target document, while startup/index-only savings are recorded only as an upper bound.
- Local filesystem timings should be compared only when environment, scale, and run count are compatible.
- Timing claims require stable claim metrics; unstable metrics must be rerun before release claims.
- Code-index throughput covers generated JS, TS, TSX, test TS, Go, Python, Rust, Java, PHP, Kotlin, Swift, C, C++, C#, YAML, JSON, package metadata, package-lock, and ignored-directory fixture files.
- Sample repo metrics are observational evidence for the explicit local repository paths only.
`;
}

function writeMarkdownSummary(report, filePath) {
  if (!filePath) return;
  const absolutePath = path.resolve(filePath);
  writeFile(absolutePath, markdownSummary(report));
}

function loadTrendInput(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) fail(`missing benchmark trend input: ${absolutePath}`);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  if (parsed.schema_version !== schemaVersion) fail(`unsupported benchmark trend input schema: ${absolutePath}`);
  return {
    path: absolutePath,
    report: parsed,
  };
}

const trendMetricRules = [
  { id: "min_estimated_token_avoidance_percent", path: ["summary", "min_estimated_token_avoidance_percent"], direction: "higher" },
  { id: "median_estimated_token_avoidance_percent", path: ["summary", "median_estimated_token_avoidance_percent"], direction: "higher" },
  { id: "scoped_refresh_index_ms", path: ["summary", "scoped_refresh_index_ms"], direction: "lower" },
  { id: "scoped_main_index_chars", path: ["summary", "scoped_main_index_chars"], direction: "lower" },
  { id: "code_index_ms", path: ["summary", "code_index_ms"], direction: "lower" },
  { id: "code_index_files_per_second", path: ["summary", "code_index_files_per_second"], direction: "higher" },
  { id: "incremental_index_ms", path: ["summary", "code_index_incremental_ms"], direction: "lower" },
  { id: "architecture_report_ms", path: ["summary", "architecture_report_ms"], direction: "lower" },
  { id: "tree_sitter_code_index_ms", path: ["summary", "tree_sitter_code_index_ms"], direction: "lower" },
  { id: "tree_sitter_architecture_report_ms", path: ["summary", "tree_sitter_architecture_report_ms"], direction: "lower" },
  { id: "sample_repo_code_index_ms", path: ["summary", "sample_repo_code_index_ms"], direction: "lower" },
  { id: "sample_repo_architecture_report_ms", path: ["summary", "sample_repo_architecture_report_ms"], direction: "lower" },
];

function trendStatus(direction, deltaPercent) {
  if (typeof deltaPercent !== "number") return "n/a";
  if (Math.abs(deltaPercent) < 5) return "flat";
  if (direction === "lower") return deltaPercent < 0 ? "improved" : "degraded";
  return deltaPercent > 0 ? "improved" : "degraded";
}

function benchmarkTrend(inputs) {
  const firstReport = inputs[0]?.report;
  const points = inputs.map(({ path: reportPath, report }, index) => ({
    order: index + 1,
    path: reportPath,
    generated_at: report.generated_at,
    package_version: report.package_version,
    scale: report.scale,
    node: report.environment?.node,
    platform: report.environment?.platform,
    arch: report.environment?.arch,
    git_commit: report.source_control?.short_commit || "",
    git_dirty: Boolean(report.source_control?.dirty),
    timing_status: report.measurement?.timing_status,
    claimable_metric_count: report.measurement?.claimable_metrics?.length || 0,
    unstable_metric_count: report.measurement?.unstable_metrics?.length || 0,
    metrics: Object.fromEntries(trendMetricRules.map((rule) => [rule.id, getPath(report, rule.path)])),
    compatibility: firstReport ? assessCompatibility(report, firstReport, { compatibilityMode: "relaxed" }) : { comparable: true, issues: [], mode: "relaxed" },
  }));
  const metrics = {};
  for (const rule of trendMetricRules) {
    const values = points
      .filter((point) => point.compatibility.comparable)
      .map((point) => point.metrics[rule.id])
      .filter((value) => typeof value === "number");
    const hasTrend = values.length >= 2;
    const first = hasTrend ? values[0] : null;
    const last = hasTrend ? values[values.length - 1] : null;
    const deltaPercent = hasTrend ? compareNumber(first, last) : null;
    metrics[rule.id] = {
      direction: rule.direction,
      first,
      last,
      delta_percent: deltaPercent,
      status: hasTrend ? trendStatus(rule.direction, deltaPercent) : "n/a",
      values,
    };
  }
  return {
    schema_version: 1,
    benchmark_schema_version: schemaVersion,
    generated_at: new Date().toISOString(),
    baseline_input: points[0]?.path || "",
    report_count: points.length,
    comparable_report_count: points.filter((point) => point.compatibility.comparable).length,
    points,
    metrics,
  };
}

function trendMarkdown(trend) {
  const metricRows = Object.entries(trend.metrics).map(([metric, item]) => `| ${metric} | ${item.direction} | ${item.first ?? "n/a"} | ${item.last ?? "n/a"} | ${formatDelta(item.delta_percent)} | ${item.status} |`).join("\n");
  const pointRows = trend.points.map((point) => `| ${point.order} | ${point.generated_at} | ${point.package_version} | ${point.scale} | ${point.node} | ${point.platform}/${point.arch} | ${point.timing_status} | ${point.claimable_metric_count} | ${point.unstable_metric_count} | ${point.compatibility.comparable ? "yes" : point.compatibility.issues.join(", ")} | ${point.git_commit}${point.git_dirty ? " dirty" : ""} |`).join("\n");
  return `# Project Wiki Bootstrap Benchmark Trend

Generated: ${trend.generated_at}

Baseline input: ${trend.baseline_input}

## Metrics

| Metric | Direction | First | Last | Delta | Status |
| --- | --- | ---: | ---: | ---: | --- |
${metricRows}

## Reports

| Order | Generated | Version | Scale | Node | Platform | Timing | Claimable | Unstable | Comparable | Git |
| ---: | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- |
${pointRows}
`;
}

function runTrend() {
  const trendInputs = argValues("--trend").map(loadTrendInput);
  if (trendInputs.length < 2) fail("benchmark trend requires at least two --trend <report.json> inputs");
  const trend = benchmarkTrend(trendInputs);
  const trendOutputPath = optionalArgValue("--trend-out") || defaultTrendJsonPath();
  writeReport(trend, trendOutputPath);
  if (hasFlag("--trend-markdown")) writeFile(optionalArgValue("--trend-markdown") || defaultTrendMarkdownPath(), trendMarkdown(trend));
  console.log(JSON.stringify(trend, null, 2));
}

function requireBuiltCli() {
  if (!fs.existsSync(cli)) fail("missing dist/init-project-wiki.js; run npm run build before npm run benchmark");
}

function getPath(object, parts) {
  return parts.reduce((current, part) => current && current[part], object);
}

function setPath(object, parts, value) {
  let current = object;
  for (const part of parts.slice(0, -1)) current = current[part];
  current[parts[parts.length - 1]] = value;
}

const scenarioTimingPaths = [
  ["bootstrap_create_ms"],
  ["node_subprocess_overhead_ms"],
  ["doctor_ms"],
  ["doctor_operation_estimated_ms"],
  ["refresh_index_ms"],
  ["refresh_index_operation_estimated_ms"],
  ["link_check_ms"],
  ["link_check_operation_estimated_ms"],
  ["query_ms"],
  ["query_operation_estimated_ms"],
  ["code_index_ms"],
  ["code_index_operation_estimated_ms"],
  ["incremental_index_ms"],
  ["incremental_index_operation_estimated_ms"],
  ["architecture_report_ms"],
  ["architecture_report_operation_estimated_ms"],
  ["tree_sitter_code_index_ms"],
  ["tree_sitter_code_index_operation_estimated_ms"],
  ["tree_sitter_architecture_report_ms"],
  ["tree_sitter_architecture_report_operation_estimated_ms"],
  ["code_evidence_query_ms"],
  ["code_evidence_query_operation_estimated_ms"],
  ["sample_repo_code_index_ms"],
  ["sample_repo_code_index_operation_estimated_ms"],
  ["sample_repo_architecture_report_ms"],
  ["sample_repo_architecture_report_operation_estimated_ms"],
  ["compact_context", "avg_read_ms"],
  ["targeted_context", "avg_read_ms"],
  ["full_wiki", "avg_read_ms"],
];

function aggregateScenario(kind, scenarioRuns) {
  const runs = scenarioRuns.map((scenarios) => scenarioByKind({ scenarios }, kind)).filter((scenario) => scenario.fixture_kind);
  const aggregate = JSON.parse(JSON.stringify(runs[0]));
  const topLevelKeys = new Set(runs.flatMap((scenario) => Object.keys(scenario).filter((key) => typeof scenario[key] === "number")));
  for (const key of topLevelKeys) {
    const values = runs.map((scenario) => scenario[key]).filter((value) => typeof value === "number");
    if (values.length === runs.length) aggregate[key] = round(median(values), key.endsWith("_ms") ? 3 : 2);
  }
  const timingStats = {};
  for (const pathParts of scenarioTimingPaths) {
    const values = runs.map((scenario) => getPath(scenario, pathParts)).filter((value) => typeof value === "number");
    if (values.length !== runs.length) continue;
    setPath(aggregate, pathParts, round(median(values), pathParts[pathParts.length - 1].endsWith("_ms") ? 3 : 2));
    timingStats[pathParts.join(".")] = stats(values);
  }
  aggregate.measurement = {
    runs: runs.length,
    timing_stats: timingStats,
  };
  return aggregate;
}

function aggregateScenarioRuns(scenarioRuns) {
  const kinds = scenarioRuns[0].map((scenario) => scenario.fixture_kind);
  return kinds.map((kind) => aggregateScenario(kind, scenarioRuns));
}

function assessClaimMetrics(scenarios, runCount) {
  return claimMetricRulesForScenarios(scenarios).flatMap((rule) => {
    const scenario = scenarioByKind({ scenarios }, rule.scenario);
    if (!scenario.fixture_kind) return [];
    const metricStats = scenario.measurement?.timing_stats?.[rule.path.join(".")];
    if (!metricStats) return [];
    const cv = Number(metricStats?.coefficient_of_variation_percent || 0);
    const rangeMs = typeof metricStats?.max === "number" && typeof metricStats?.min === "number" ? round(metricStats.max - metricStats.min, 3) : 0;
    const status = runCount < 2 ? "single-run" : cv <= rule.max_cv_percent && rangeMs <= rule.max_range_ms ? "claimable" : "unstable";
    return [{
      id: rule.id,
      scenario: rule.scenario,
      metric: rule.path.join("."),
      claim: rule.claim,
      status,
      min: metricStats?.min,
      median: metricStats?.median,
      max: metricStats?.max,
      range_ms: rangeMs,
      coefficient_of_variation_percent: round(cv),
      max_cv_percent: rule.max_cv_percent,
      max_range_ms: rule.max_range_ms,
      value: getPath(scenario, rule.path),
    }];
  });
}

function timingReliability(scenarios, runCount, warmupRunCount) {
  const statsValues = scenarios.flatMap((scenario) => Object.values(scenario.measurement?.timing_stats || {}));
  const maxCv = statsValues.reduce((max, item) => Math.max(max, Number(item.coefficient_of_variation_percent || 0)), 0);
  const claims = assessClaimMetrics(scenarios, runCount);
  const claimableMetrics = claims.filter((item) => item.status === "claimable").map((item) => item.id);
  const unstableMetrics = claims.filter((item) => item.status === "unstable").map((item) => item.id);
  return {
    runs: runCount,
    warmup_runs: warmupRunCount,
    measured_runs: runCount,
    measurement_protocol: warmupRunCount > 0 ? "warmup-discarded-median" : "median",
    timing_status: runCount < 2 ? "single-run" : unstableMetrics.length === 0 ? "stable" : "variable",
    max_coefficient_of_variation_percent: round(maxCv),
    claimable_metrics: claimableMetrics,
    unstable_metrics: unstableMetrics,
    claims,
  };
}

function suiteSummary(scenarios) {
  const wikiScenarios = scenarios.filter((scenario) => scenario.savings);
  const tokenSavings = wikiScenarios.map((scenario) => scenario.savings.estimated_token_avoidance_percent);
  const readSavings = wikiScenarios.map((scenario) => scenario.savings.read_time_reduction_percent);
  const codeScenario = scenarios.find((scenario) => scenario.fixture_kind === "code-heavy-large-project") || {};
  const scopedScenario = scenarios.find((scenario) => scenario.fixture_kind === "scoped-routing-large-project") || {};
  const sampleRepoScenarios = scenarios.filter(isSampleRepoScenario);
  const sampleRepoIndexTimes = sampleRepoScenarios.map((scenario) => scenario.sample_repo_code_index_ms).filter((value) => typeof value === "number");
  const sampleRepoReportTimes = sampleRepoScenarios.map((scenario) => scenario.sample_repo_architecture_report_ms).filter((value) => typeof value === "number");
  const sampleRepoFileSpeeds = sampleRepoScenarios.map((scenario) => scenario.sample_repo_code_files_per_second).filter((value) => typeof value === "number");
  const retrievalStrategies = wikiScenarios.flatMap((scenario) => scenario.retrieval_strategy_comparison || []);
  const targetedRetrievalStrategies = retrievalStrategies.filter((item) => item.strategy === "targeted_query_result");
  const startupOnlyStrategies = retrievalStrategies.filter((item) => item.strategy === "startup_index_only");
  const retrievalCorrectnessStatuses = [
    ...wikiScenarios.map((scenario) => scenario.retrieval_correctness?.correctness_status).filter(Boolean),
    codeScenario.evidence_correctness?.correctness_status,
  ].filter(Boolean);
  return {
    min_estimated_token_avoidance_percent: round(Math.min(...tokenSavings)),
    median_estimated_token_avoidance_percent: round(median(tokenSavings)),
    min_read_time_reduction_percent: round(Math.min(...readSavings)),
    median_read_time_reduction_percent: round(median(readSavings)),
    total_wiki_pages: wikiScenarios.reduce((sum, scenario) => sum + scenario.full_wiki.file_count, 0),
    scoped_refresh_index_ms: scopedScenario.refresh_index_ms || 0,
    scoped_router_count: scopedScenario.scoped_router_count || 0,
    scoped_main_index_chars: scopedScenario.main_index_chars || 0,
    scoped_target_router_chars: scopedScenario.scoped_target_router_chars || 0,
    code_index_ms: codeScenario.code_index_ms || 0,
    code_index_files: codeScenario.code_index_files || 0,
    code_index_files_per_second: codeScenario.code_index_files_per_second || 0,
    code_index_incremental_reindexed_files: codeScenario.incremental_reindexed_files || 0,
    code_index_incremental_ms: codeScenario.incremental_index_ms || 0,
    code_index_full_to_incremental_time_reduction_percent: codeScenario.full_to_incremental_time_reduction_percent || 0,
    architecture_report_ms: codeScenario.architecture_report_ms || 0,
    architecture_report_sections: codeScenario.architecture_report_sections || 0,
    architecture_report_evidence_tables: codeScenario.architecture_report_evidence_tables || 0,
    architecture_report_routes: codeScenario.architecture_report_routes || 0,
    architecture_report_dependencies: codeScenario.architecture_report_dependencies || 0,
    tree_sitter_code_index_ms: codeScenario.tree_sitter_code_index_ms || 0,
    tree_sitter_code_files: codeScenario.tree_sitter_code_files || 0,
    tree_sitter_code_files_per_second: codeScenario.tree_sitter_code_files_per_second || 0,
    tree_sitter_architecture_report_ms: codeScenario.tree_sitter_architecture_report_ms || 0,
    tree_sitter_parser_profiles: codeScenario.tree_sitter_parser_profiles || 0,
    retrieval_correctness_checks: retrievalCorrectnessStatuses.length,
    retrieval_correctness_passed: retrievalCorrectnessStatuses.filter((status) => status === "passed").length,
    targeted_context_evidence_missing: targetedRetrievalStrategies.reduce((sum, item) => sum + Number(item.expected_evidence_files_missing || 0), 0),
    startup_index_only_evidence_missing: startupOnlyStrategies.reduce((sum, item) => sum + Number(item.expected_evidence_files_missing || 0), 0),
    code_evidence_correctness_passed: codeScenario.evidence_correctness?.correctness_status === "passed" ? 1 : 0,
    sample_repo_count: sampleRepoScenarios.length,
    sample_repo_code_files: sampleRepoScenarios.reduce((sum, scenario) => sum + Number(scenario.sample_repo_code_files || 0), 0),
    sample_repo_code_files_per_second: sampleRepoFileSpeeds.length > 0 ? round(median(sampleRepoFileSpeeds)) : 0,
    sample_repo_code_index_ms: sampleRepoIndexTimes.length > 0 ? round(median(sampleRepoIndexTimes), 3) : 0,
    sample_repo_architecture_report_ms: sampleRepoReportTimes.length > 0 ? round(median(sampleRepoReportTimes), 3) : 0,
    sample_repo_architecture_report_routes: sampleRepoScenarios.reduce((sum, scenario) => sum + Number(scenario.sample_repo_architecture_report_routes || 0), 0),
    sample_repo_architecture_report_dependencies: sampleRepoScenarios.reduce((sum, scenario) => sum + Number(scenario.sample_repo_architecture_report_dependencies || 0), 0),
    sample_repo_profiles: sampleRepoScenarios.map((scenario) => `${scenario.sample_repo_id}:${scenario.sample_repo_profile}`),
  };
}

function runBenchmark() {
  requireBuiltCli();
  if (hasFlag("--require-clean")) requireCleanWorkingTree();
  const scaleName = hasFlag("--quick") ? "quick" : "large";
  const scale = scales[scaleName];
  const runCount = positiveIntegerArgValue("--runs", scaleName === "quick" ? 1 : 5);
  const warmupRunCount = nonNegativeIntegerArgValue("--warmup-runs", scaleName === "quick" ? 0 : 1);
  const baselinePath = argValue("--baseline");
  const outputPath = argValue("--out");
  const markdownPath = hasFlag("--markdown") ? optionalArgValue("--markdown") : "";
  const saveBaseline = hasFlag("--save-baseline");
  const saveBaselinePath = saveBaseline ? optionalArgValue("--save-baseline") : "";
  const sampleRepos = sampleRepoPathValues();
  const keepTemp = hasFlag("--keep-temp");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-wiki-benchmark-"));

  try {
    const scenarioRuns = [];
    const warmupScenarioRuns = [];
    const totalRuns = warmupRunCount + runCount;
    for (let runIndex = 0; runIndex < totalRuns; runIndex += 1) {
      const runRoot = path.join(tempRoot, `run-${runIndex + 1}`);
      const scenariosForRun = [
        docsHeavyScenario(runRoot, scale),
        monorepoScenario(runRoot, scale),
        scopedRoutingScenario(runRoot, scale),
        codeHeavyScenario(runRoot, scale),
      ];
      for (const sampleRepo of sampleRepos) scenariosForRun.push(sampleRepoScenario(runRoot, sampleRepo));
      if (runIndex < warmupRunCount) warmupScenarioRuns.push(scenariosForRun);
      else scenarioRuns.push(scenariosForRun);
    }
    const scenarios = aggregateScenarioRuns(scenarioRuns);
    const measurement = timingReliability(scenarios, runCount, warmupRunCount);
    const sourceControl = sourceControlFingerprint();
    if (saveBaseline && !hasFlag("--allow-dirty-baseline")) {
      if (!sourceControl.available) fail("benchmark --save-baseline requires a git checkout unless --allow-dirty-baseline is set");
      if (sourceControl.dirty) fail("benchmark --save-baseline requires a clean git checkout unless --allow-dirty-baseline is set");
    }
    const report = {
      schema_version: schemaVersion,
      generated_at: new Date().toISOString(),
      package_version: packageVersion(),
      environment: environmentFingerprint(),
      source_control: sourceControl,
      scale: scaleName,
      measurement,
      benchmark_configuration: {
        schema_version: schemaVersion,
        scale: scaleName,
        measured_runs: runCount,
        warmup_runs: warmupRunCount,
        measurement_protocol: warmupRunCount > 0 ? "warmup-discarded-median" : "median",
        sample_repo_count: sampleRepos.length,
        sample_repo_ids: sampleRepos.map((sampleRepo) => sampleRepo.id),
        sample_repo_fingerprints: sampleRepos.map((sampleRepo) => ({
          id: sampleRepo.id,
          algorithm: sampleRepo.fingerprint.algorithm,
          value: sampleRepo.fingerprint.value,
          file_count: sampleRepo.fingerprint.file_count,
          symlink_count: sampleRepo.fingerprint.symlink_count,
        })),
      },
      large_project_assumptions: {
        docs_heavy_pages: scale.docsHeavyPages,
        monorepo_workspaces: scale.monorepoApps + scale.monorepoPackages,
        scoped_route_pages: scale.scopedRouteAreas * scale.scopedPagesPerArea,
        scoped_route_areas: scale.scopedRouteAreas,
        scoped_pages_per_area: scale.scopedPagesPerArea,
        code_heavy_files: scale.codePackages * (scale.filesPerCodePackage + 17),
        code_heavy_ts_files: scale.codePackages * scale.filesPerCodePackage,
        code_heavy_mixed_file_kinds: ["ts", "test-ts", "js", "tsx", "go", "python", "rust", "java", "php", "kotlin", "swift", "c", "cpp", "csharp", "yaml", "json", "package-json", "package-lock"],
        sample_repo_paths: sampleRepos.map((sampleRepo) => sampleRepo.sourcePath),
        sample_repo_path: sampleRepos[0]?.sourcePath || "",
        curated_startup_index: true,
        benchmark_runs: runCount,
        warmup_runs: warmupRunCount,
      },
      summary: suiteSummary(scenarios),
      scenarios,
      notes: [
        "Maintainer benchmark for release evidence, not a public CLI user workflow.",
        "Default scale is large; smoke tests use --quick only to validate report shape.",
        "Large scale uses one discarded warmup run and repeated measured runs by default; scenario metrics are medians and include timing dispersion statistics.",
        "Large scale covers docs-heavy wiki, monorepo wiki, scoped-router wiki, and code-heavy mixed JS/TS/TSX/Go/Python/polyglot/config index scenarios.",
        "Scoped routing scenario measures refresh-index generation of wiki/indexes/auto-*.md routers and compact main-index size.",
        "Code-heavy scenario also measures architecture, ownership, workspace graph, and optional Tree-sitter report generation from the code evidence index.",
        "Use repeated --sample-repo <path> arguments to add explicit local repository copies as observational validation evidence.",
        "Standard repo-local sample paths live under benchmarks/samples and are used by CI benchmark gates.",
        "Release claims require stable claim metrics; reports list claimable_metrics and unstable_metrics explicitly.",
        "Reports include environment and source-control fingerprints so release evidence can be traced to the exact code state.",
        "Baseline comparison requires matching schema, environment, scale, run count, warmup run count, measurement protocol, and scenario set before regression status can pass.",
        "Use --require-clean for release evidence that must prove it came from a clean git checkout.",
        "Saving a baseline requires a clean git checkout unless --allow-dirty-baseline is explicitly set for non-release validation.",
        "estimated_tokens uses ceil(characters / 4) over markdown characters; it is not a model-tokenizer measurement.",
        "Context-efficiency savings compare full-wiki markdown scanning against startup/index plus the query-returned target document.",
        "Startup/index-only savings are recorded as an upper bound and are not the default LLM token-consumption claim.",
        "Read timing is local filesystem wall-clock timing; compare only against baselines captured on comparable machines.",
        "Startup/index routing is intentionally curated; all-page refresh-index bloat is not used for targeted-context claims.",
      ],
    };
    if (warmupScenarioRuns.length > 0) {
      report.measurement.warmup = {
        discarded_runs: warmupScenarioRuns.length,
        scenario_kinds: warmupScenarioRuns[0].map((scenario) => scenario.fixture_kind),
      };
    }

    const baseline = loadBaseline(baselinePath);
    if (baseline) report.comparison = compareReport(report, baseline, { strictSourceControl: hasFlag("--require-clean") });
    writeReport(report, outputPath);
    if (saveBaseline) {
      const baselineOutputPath = saveBaselinePath || defaultBaselinePath(report);
      writeReport(report, baselineOutputPath);
      writeBaselineManifest(report, baselineOutputPath);
    }
    if (hasFlag("--markdown")) writeMarkdownSummary(report, markdownPath || defaultMarkdownPath(report));
    console.log(JSON.stringify(report, null, 2));
    if (hasFlag("--fail-on-regression") && !report.comparison) {
      fail("benchmark release gate requires --baseline when --fail-on-regression is set");
    }
    if (hasFlag("--fail-on-regression") && report.comparison.regression_status !== "passed") {
      const details = report.comparison.regressions.length > 0
        ? report.comparison.regressions.map((item) => item.metric).join(", ")
        : report.comparison.regression_status;
      fail(`benchmark release gate failed: ${details}`);
    }
  } finally {
    if (!keepTemp) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (argValues("--trend").length > 0) runTrend();
else runBenchmark();
