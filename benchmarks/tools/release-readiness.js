#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");

const requiredPackFiles = [
  "LICENSE",
  "README.md",
  "README.ko.md",
  "SKILL.md",
  "dist/init-project-wiki.js",
  "package.json",
];

const forbiddenPackPathPatterns = [
  /^\.omx\//,
  /^\.omc\//,
  /^\.project-wiki\//,
  /^benchmarks\/reports\/llm\/raw\//,
  /^node_modules\//,
  /^src\//,
  /^tests\//,
  /^wiki\//,
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function printUsage() {
  console.log(`Usage:
  node benchmarks/tools/release-readiness.js [--skip-npm-test] [--skip-benchmark-preview]

Runs local-only release checks:
  - npm test
  - benchmark JSONL parser smoke
  - benchmark release payload preview
  - benchmark claim ledger classification
  - npm pack --dry-run --json package inspection
  - dist executable and README benchmark-claim labeling checks
  - trusted publishing workflow safety checks

This script never publishes and never launches a measured Codex benchmark.`);
}

function runCommand(label, command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return {
    command: [command, ...args].join(" "),
    label,
    ok: result.status === 0,
    status: result.status,
    stderr: result.stderr || "",
    stdout: result.stdout || "",
  };
}

function temporaryNpmCacheEnv() {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-npm-cache-"));
  return {
    ...process.env,
    npm_config_cache: cacheDir,
  };
}

function normalizePackPath(packPath) {
  return String(packPath).replace(/^package\//, "").split(path.sep).join("/");
}

function parsePackJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("npm pack produced no JSON output");
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // npm can prepend notices on some versions; try the JSON array slice.
  }
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("npm pack output did not contain a JSON array");
  const parsed = JSON.parse(trimmed.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("npm pack JSON root is not an array");
  return parsed;
}

function packFilePaths(packEntries) {
  const files = [];
  for (const entry of packEntries) {
    const entryFiles = Array.isArray(entry?.files) ? entry.files : [];
    for (const file of entryFiles) {
      if (file && typeof file.path === "string") files.push(normalizePackPath(file.path));
    }
  }
  return Array.from(new Set(files)).sort();
}

function inspectPackFiles(files) {
  const fileSet = new Set(files);
  const missingRequired = requiredPackFiles.filter((file) => !fileSet.has(file));
  const forbidden = files.filter((file) => forbiddenPackPathPatterns.some((pattern) => pattern.test(file))).sort();
  return {
    forbidden,
    missing_required: missingRequired,
    ok: missingRequired.length === 0 && forbidden.length === 0,
    total_files: files.length,
  };
}

function distExecutableStatus(filePath = path.join(repoRoot, "dist", "init-project-wiki.js")) {
  if (!fs.existsSync(filePath)) return { ok: false, message: "dist/init-project-wiki.js is missing" };
  const stat = fs.statSync(filePath);
  if ((stat.mode & 0o111) === 0) return { ok: false, message: "dist/init-project-wiki.js is not executable" };
  const firstLine = fs.readFileSync(filePath, "utf8").split(/\r?\n/, 1)[0] ?? "";
  if (!firstLine.includes("#!/usr/bin/env node")) return { ok: false, message: "dist/init-project-wiki.js is missing the node shebang" };
  return { ok: true, message: "dist/init-project-wiki.js is executable" };
}

function benchmarkClaimStatus(readmeText) {
  const hasFailedGate = /claim gate \*\*failed\*\*/i.test(readmeText);
  const hasDiagnosticBoundary = /diagnostic evidence/i.test(readmeText);
  const hasReleaseClaimBoundary = /not a public release claim|not a blanket promise|not a release baseline/i.test(readmeText);
  if (hasFailedGate && hasDiagnosticBoundary) {
    return { ok: true, status: "diagnostic_only", message: "README labels the failed wiki-track claim gate as diagnostic evidence" };
  }
  if (hasReleaseClaimBoundary) {
    return { ok: true, status: "bounded", message: "README includes benchmark claim boundary language" };
  }
  return { ok: false, status: "ambiguous", message: "README benchmark section lacks clear diagnostic/release-claim boundary language" };
}

function trustedPublishingWorkflowStatus(filePath = path.join(repoRoot, ".github", "workflows", "publish.yml")) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, missing: ["publish workflow"], forbidden: [], message: ".github/workflows/publish.yml is missing" };
  }
  const text = fs.readFileSync(filePath, "utf8");
  const required = [
    { label: "id-token: write", pattern: /\bid-token:\s*write\b/ },
    { label: "contents: read", pattern: /\bcontents:\s*read\b/ },
    { label: "GitHub-hosted runner", pattern: /\bruns-on:\s*ubuntu-latest\b/ },
    { label: "npm registry setup-node URL", pattern: /\bregistry-url:\s*['"]?https:\/\/registry\.npmjs\.org['"]?/ },
    { label: "release readiness gate", pattern: /\bnpm\s+run\s+release:check\b/ },
    { label: "npm publish command", pattern: /\bnpm\s+publish\b/ },
    { label: "public package access", pattern: /\bnpm\s+publish\b[^\n]*\s--access\s+public\b/ },
    { label: "release build cache disabled", pattern: /\bpackage-manager-cache:\s*false\b/ },
  ];
  const missing = required.filter((item) => !item.pattern.test(text)).map((item) => item.label);
  const forbidden = [
    { label: "NODE_AUTH_TOKEN", pattern: /\bNODE_AUTH_TOKEN\b/ },
    { label: "NPM_TOKEN", pattern: /\bNPM_TOKEN\b/ },
    { label: "npm token secret", pattern: /\bsecrets\.[A-Z0-9_]*NPM[A-Z0-9_]*\b/i },
  ].filter((item) => item.pattern.test(text)).map((item) => item.label);
  const ok = missing.length === 0 && forbidden.length === 0;
  return {
    ok,
    missing,
    forbidden,
    message: ok
      ? "publish workflow uses GitHub OIDC trusted publishing without npm token secrets"
      : "publish workflow is missing trusted publishing requirements or still references token secrets",
  };
}

function printStep(result) {
  const marker = result.ok ? "PASS" : "FAIL";
  console.log(`${marker} ${result.label}: ${result.command}`);
  if (!result.ok) {
    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
  }
}

function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage();
    return;
  }

  const results = [];
  if (!hasFlag("--skip-npm-test")) {
    const npmTest = runCommand("npm test", "npm", ["test"]);
    printStep(npmTest);
    results.push(npmTest);
    if (!npmTest.ok) fail("release readiness failed: npm test");
  }

  const parseSmoke = runCommand("benchmark parser smoke", "npm", ["run", "benchmark:llm:parse-smoke"]);
  printStep(parseSmoke);
  results.push(parseSmoke);
  if (!parseSmoke.ok) fail("release readiness failed: benchmark parser smoke");

  if (!hasFlag("--skip-benchmark-preview")) {
    const preview = runCommand("benchmark release preview", "npm", ["run", "benchmark:release:preview"]);
    printStep(preview);
    results.push(preview);
    if (!preview.ok) fail("release readiness failed: benchmark release preview");

    const claimLedger = runCommand("benchmark claim ledger", "npm", ["run", "benchmark:claim-ledger"]);
    printStep(claimLedger);
    results.push(claimLedger);
    if (!claimLedger.ok) fail("release readiness failed: benchmark claim ledger");
  }

  const pack = runCommand("npm pack dry-run", "npm", ["pack", "--dry-run", "--json"], {
    env: temporaryNpmCacheEnv(),
  });
  printStep(pack);
  results.push(pack);
  if (!pack.ok) fail("release readiness failed: npm pack dry-run");

  const packEntries = parsePackJson(pack.stdout);
  const files = packFilePaths(packEntries);
  const packInspection = inspectPackFiles(files);
  console.log(`${packInspection.ok ? "PASS" : "FAIL"} package contents: ${packInspection.total_files} files inspected`);
  if (!packInspection.ok) {
    console.error(JSON.stringify(packInspection, null, 2));
    fail("release readiness failed: package contents");
  }

  const distStatus = distExecutableStatus();
  console.log(`${distStatus.ok ? "PASS" : "FAIL"} dist executable: ${distStatus.message}`);
  if (!distStatus.ok) fail("release readiness failed: dist executable");

  const readmeStatus = benchmarkClaimStatus(fs.readFileSync(path.join(repoRoot, "README.md"), "utf8"));
  console.log(`${readmeStatus.ok ? "PASS" : "FAIL"} README benchmark boundary: ${readmeStatus.message}`);
  if (!readmeStatus.ok) fail("release readiness failed: README benchmark boundary");

  const trustedPublishingStatus = trustedPublishingWorkflowStatus();
  console.log(`${trustedPublishingStatus.ok ? "PASS" : "FAIL"} trusted publishing workflow: ${trustedPublishingStatus.message}`);
  if (!trustedPublishingStatus.ok) {
    console.error(JSON.stringify(trustedPublishingStatus, null, 2));
    fail("release readiness failed: trusted publishing workflow");
  }

  console.log(JSON.stringify({
    checks: results.map((result) => ({ label: result.label, status: result.status, ok: result.ok })),
    dist: distStatus,
    package: packInspection,
    readme_benchmark_claim: readmeStatus,
    trusted_publishing: trustedPublishingStatus,
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  benchmarkClaimStatus,
  distExecutableStatus,
  inspectPackFiles,
  normalizePackPath,
  packFilePaths,
  parsePackJson,
  requiredPackFiles,
  temporaryNpmCacheEnv,
  trustedPublishingWorkflowStatus,
};
