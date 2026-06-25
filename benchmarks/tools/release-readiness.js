#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { discoverPrunableCodexHomes } = require("../lib/llm-raw-retention");
const { helperBinaryName, packagedHelperBinaryStatus, supportedTriples } = require("./native-indexer-package-audit");

const repoRoot = path.resolve(__dirname, "..", "..");

const requiredPackFiles = [
  "LICENSE",
  "README.md",
  "README.ko.md",
  "SKILL.md",
  "dist/init-project-wiki.js",
  "dist/session-handoff.js",
  "package.json",
];

const forbiddenPackPathPatterns = [
  /^\.omx\//,
  /^\.omc\//,
  /^\.project-wiki\//,
  /^benchmarks\/reports\/llm\/raw\//,
  /^native\//,
  /^node_modules\//,
  /^src\//,
  /^tests\//,
  /^wiki\//,
];

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function printUsage() {
  console.log(`Usage:
  node benchmarks/tools/release-readiness.js [--skip-npm-test] [--skip-test-coverage] [--skip-real-corpus-demo] [--skip-benchmark-preview]
  node benchmarks/tools/release-readiness.js --only-dist-parity

Runs local-only release checks:
  - npm test
  - native Node test coverage
  - benchmark JSONL parser smoke
  - session handoff resume preview
  - multi-agent generated-surface smoke
  - real-corpus offline demo
  - benchmark release payload preview
  - benchmark claim ledger classification
  - benchmark raw hygiene audit
  - npm pack --dry-run --json package inspection
  - native helper package matrix inspection when dist/native files are shipped
  - dist executable/parity and README benchmark-claim labeling checks
  - trusted publishing workflow safety checks
  - release provenance/attestation status

Use --only-dist-parity to run only the generated dist/ drift check.

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
  return packFileRecords(packEntries).map((file) => file.path);
}

function packFileRecords(packEntries) {
  const files = [];
  for (const entry of packEntries) {
    const entryFiles = Array.isArray(entry?.files) ? entry.files : [];
    for (const file of entryFiles) {
      if (file && typeof file.path === "string") {
        files.push({
          mode: typeof file.mode === "number" ? file.mode : null,
          path: normalizePackPath(file.path),
        });
      }
    }
  }
  return Array.from(new Map(files.map((file) => [file.path, file])).values())
    .sort((left, right) => compareStrings(left.path, right.path));
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

function normalizePackFileRecord(file) {
  if (typeof file === "string") return { mode: null, path: normalizePackPath(file) };
  return {
    mode: typeof file?.mode === "number" ? file.mode : null,
    path: normalizePackPath(file?.path ?? ""),
  };
}

function isPackagedNativeHelperExecutable(record, triple) {
  const platform = String(triple).split("-")[0];
  if (platform === "win32") return true;
  return typeof record.mode !== "number" || (record.mode & 0o111) !== 0;
}

function nativeHelperPackageMatrixStatus(files, options = {}) {
  const expected = supportedTriples.map((triple) => {
    const platform = String(triple).split("-")[0];
    return {
      path: `dist/native/${triple}/${helperBinaryName(platform)}`,
      triple,
    };
  }).sort();
  const expectedPaths = expected.map((file) => file.path).sort();
  const records = files.map(normalizePackFileRecord).filter((file) => file.path);
  const nativeFiles = records.filter((file) => file.path.startsWith("dist/native/"))
    .sort((left, right) => compareStrings(left.path, right.path));
  const nativeFileByPath = new Map(nativeFiles.map((file) => [file.path, file]));
  const expectedSet = new Set(expectedPaths);
  const present = expectedPaths.filter((file) => nativeFileByPath.has(file));
  const missing = nativeFiles.length > 0 ? expectedPaths.filter((file) => !nativeFileByPath.has(file)) : [];
  const nonExecutable = expected
    .filter((file) => {
      const record = nativeFileByPath.get(file.path);
      return record && !isPackagedNativeHelperExecutable(record, file.triple);
    })
    .map((file) => file.path);
  const binaryMismatches = options.verifyBinaryFormat
    ? expected
      .filter((file) => nativeFileByPath.has(file.path))
      .map((file) => packagedHelperBinaryStatus(path.join(options.repoRoot ?? repoRoot, file.path), file.triple))
      .filter((status) => !status.ok)
      .map((status) => ({
        actual_architectures: status.actual_architectures,
        actual_format: status.actual_format,
        expected_architecture: status.expected_architecture,
        expected_format: status.expected_format,
        path: path.relative(options.repoRoot ?? repoRoot, status.path).split(path.sep).join("/"),
        triple: status.triple,
      }))
    : [];
  const unexpected = nativeFiles.map((file) => file.path).filter((file) => !expectedSet.has(file));
  const matrixComplete = nativeFiles.length > 0
    && binaryMismatches.length === 0
    && missing.length === 0
    && nonExecutable.length === 0
    && unexpected.length === 0;
  const status = matrixComplete
    ? "packaged-helper-matrix-ready"
    : binaryMismatches.length > 0
      ? "packaged-helper-binary-mismatch"
      : nativeFiles.length > 0
        ? "partial-packaged-helper-matrix"
        : "no-packaged-helper";
  return {
    ok: nativeFiles.length === 0 || matrixComplete,
    binary_mismatches: binaryMismatches,
    expected_files: expectedPaths,
    missing_files: missing,
    non_executable_files: nonExecutable,
    packaged_files: nativeFiles.map((file) => file.path),
    present_files: present,
    status,
    unexpected_files: unexpected,
  };
}

function githubActionReferencePinningStatus(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      inspected_actions: [],
      unpinned_actions: [],
      message: `${path.relative(repoRoot, filePath)} is missing`,
    };
  }
  const text = fs.readFileSync(filePath, "utf8");
  const inspectedActions = [];
  const unpinnedActions = [];
  const usesPattern = /^\s*-\s+uses:\s*["']?([^@\s"']+)@([^"'\s#]+)["']?/gm;
  let match;
  while ((match = usesPattern.exec(text)) !== null) {
    const action = match[1];
    const ref = match[2];
    if (action.startsWith("./") || action.startsWith("../") || action.startsWith("docker://")) continue;
    const item = { action, ref };
    inspectedActions.push(item);
    if (!/^[a-f0-9]{40}$/i.test(ref)) unpinnedActions.push(item);
  }
  const ok = unpinnedActions.length === 0;
  return {
    ok,
    inspected_actions: inspectedActions,
    unpinned_actions: unpinnedActions,
    message: ok
      ? `all ${inspectedActions.length} remote GitHub action reference(s) are full-SHA pinned`
      : "remote GitHub action references must be pinned to full-length commit SHAs",
  };
}

function workflowPermissionStatus(filePath, requiredPermissions = { contents: "read" }) {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      missing: [`workflow file ${path.relative(repoRoot, filePath)}`],
      forbidden: [],
      permissions: {},
      message: `${path.relative(repoRoot, filePath)} is missing`,
    };
  }
  const text = fs.readFileSync(filePath, "utf8");
  const scalarPermission = text.match(/^permissions:\s*(write-all|read-all)\s*$/m);
  const forbidden = [];
  if (scalarPermission?.[1] === "write-all") forbidden.push("permissions: write-all");
  if (scalarPermission?.[1] === "read-all") forbidden.push("permissions: read-all");

  const permissions = {};
  const blockMatch = text.match(/^permissions:\s*\n((?:[ \t]+[A-Za-z0-9_-]+:\s*[A-Za-z0-9_-]+\s*(?:#.*)?\n?)+)/m);
  if (blockMatch) {
    for (const line of blockMatch[1].split(/\r?\n/)) {
      const match = line.match(/^\s+([A-Za-z0-9_-]+):\s*([A-Za-z0-9_-]+)/);
      if (match) permissions[match[1]] = match[2];
    }
  }

  const missing = Object.entries(requiredPermissions)
    .filter(([permission, value]) => permissions[permission] !== value)
    .map(([permission, value]) => `${permission}: ${value}`);
  const ok = missing.length === 0 && forbidden.length === 0;
  return {
    ok,
    missing,
    forbidden,
    permissions,
    message: ok
      ? `${path.relative(repoRoot, filePath)} declares minimal expected workflow permissions`
      : `${path.relative(repoRoot, filePath)} is missing expected workflow permissions or uses broad permissions`,
  };
}

function workflowJobBlocks(text) {
  const jobs = [];
  let inJobs = false;
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (!inJobs) {
      if (/^jobs:\s*$/.test(line)) inJobs = true;
      continue;
    }
    const jobMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (jobMatch) {
      if (current) jobs.push({ name: current.name, body: current.lines.join("\n") });
      current = { name: jobMatch[1], lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) jobs.push({ name: current.name, body: current.lines.join("\n") });
  return jobs;
}

function oidcWorkflowBoundaryStatus(text) {
  const jobs = workflowJobBlocks(text);
  const oidcJobs = jobs.filter((job) => /\bid-token:\s*write\b/.test(job.body));
  const installScriptPattern = /\bnpm\s+(?:ci|install|i|run|test|pack)\b/;
  const forbidden = [];
  for (const job of oidcJobs) {
    if (installScriptPattern.test(job.body)) forbidden.push(`OIDC job ${job.name} runs npm install/test/build scripts`);
    if (/\bnpm\s+publish\b/.test(job.body) && !/\bnpm\s+publish\b[^\n]*\s--ignore-scripts\b/.test(job.body)) {
      forbidden.push(`OIDC job ${job.name} runs npm publish without --ignore-scripts`);
    }
  }
  return {
    ok: oidcJobs.length > 0 && forbidden.length === 0,
    oidc_jobs: oidcJobs.map((job) => job.name),
    forbidden,
    message: oidcJobs.length === 0
      ? "publish workflow has no job-scoped OIDC publish authority"
      : forbidden.length === 0
        ? `OIDC authority is isolated to ${oidcJobs.map((job) => job.name).join(", ")} without dependency install scripts`
        : "OIDC authority is mixed with dependency install, test, build, pack, or script-enabled publish steps",
  };
}

function manualPublishGuardStatus(text) {
  const hasManualDispatch = /^\s*workflow_dispatch:\s*$/m.test(text);
  if (!hasManualDispatch) return { ok: true, message: "manual publish dispatch is not configured" };
  const guardsReleaseTag = /startsWith\(\s*github\.ref\s*,\s*'refs\/tags\/v'\s*\)/.test(text)
    || /startsWith\(\s*github\.ref\s*,\s*"refs\/tags\/v"\s*\)/.test(text);
  const rejectsNonRelease = /reject-manual-non-release-ref/.test(text);
  return {
    ok: guardsReleaseTag && rejectsNonRelease,
    guards_release_tag: guardsReleaseTag,
    rejects_non_release_ref: rejectsNonRelease,
    message: guardsReleaseTag && rejectsNonRelease
      ? "manual publish dispatch is guarded to refs/tags/v* and rejects non-release refs"
      : "manual publish dispatch must reject non-release refs before publish",
  };
}

function formatBytes(bytes) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function rawCodexHomeHygieneStatus(options = {}) {
  const rawRoot = path.resolve(options.rawRoot || path.join(repoRoot, "benchmarks", "reports", "llm", "raw"));
  const olderThanDays = options.olderThanDays || 1;
  const now = options.now || new Date();
  if (!fs.existsSync(rawRoot)) {
    return {
      ok: true,
      available: false,
      raw_root: rawRoot,
      older_than_days: olderThanDays,
      candidate_count: 0,
      candidate_bytes: 0,
      candidates: [],
      message: `raw root does not exist: ${path.relative(repoRoot, rawRoot)}`,
    };
  }
  const audit = discoverPrunableCodexHomes({ rawRoot, olderThanDays, now });
  const candidates = audit.candidates.map(({ absolute_path, ...candidate }) => candidate);
  const candidateSummaries = candidates.map((candidate) => ({
    relative_path: candidate.relative_path,
    modified_at: candidate.modified_at,
    file_count: candidate.file_count,
    directory_count: candidate.directory_count,
    byte_count: candidate.byte_count,
  }));
  const candidateBytes = candidates.reduce((sum, candidate) => sum + candidate.byte_count, 0);
  return {
    ok: true,
    available: true,
    raw_root: audit.raw_root,
    older_than_days: audit.older_than_days,
    cutoff: audit.cutoff,
    candidate_count: candidates.length,
    candidate_bytes: candidateBytes,
    sample_candidates: candidateSummaries.slice(0, 10),
    candidates: options.includeCandidates ? candidates : [],
    message: candidates.length === 0
      ? `no stale codex-home directories older than ${olderThanDays} day(s)`
      : `${candidates.length} stale codex-home director${candidates.length === 1 ? "y" : "ies"} (${formatBytes(candidateBytes)}) would be pruned by the dry-run cleanup`,
  };
}

function releaseProvenanceStatus() {
  return {
    ok: true,
    status: "automatic",
    current_control: "npm trusted publishing through GitHub OIDC",
    reason: "npm provenance attestations are generated automatically for packages published through trusted publishing",
    verification: "release:check validates OIDC permissions, token-free npm publish, a public repository field, the protected publish environment, and pinned first-party publish actions",
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

function distParityStatus(rootDir = repoRoot) {
  const result = childProcess.spawnSync("git", ["status", "--porcelain", "--", "dist"], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0 && !(result.stdout || "").trim()) {
    return { ok: true, message: "checked-in dist/ matches the current source build output" };
  }
  if (result.status === 0) {
    return {
      ok: false,
      changed_files: (result.stdout || "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.replace(/^.. ?/, "").trim())
        .sort(),
      message: "dist/ has uncommitted generated output changes; run npm run build and commit the generated files",
    };
  }
  return {
    ok: false,
    message: `could not inspect dist/ parity with git diff: ${(result.stderr || result.stdout || "unknown git error").trim()}`,
  };
}

function benchmarkClaimStatus(readmeText) {
  const hasFailedGate = /claim gate \*\*failed\*\*/i.test(readmeText);
  const hasPassedGate = /claim gate \*\*passed\*\*/i.test(readmeText);
  const hasDiagnosticBoundary = /diagnostic evidence/i.test(readmeText);
  const hasReleaseClaimBoundary = /not a public release claim|not a blanket promise|not a release baseline/i.test(readmeText);
  const hasSyntheticBoundary = /synthetic wiki(?:-| )routing track/i.test(readmeText);
  if (hasFailedGate && hasDiagnosticBoundary) {
    return { ok: true, status: "diagnostic_only", message: "README labels the failed wiki-track claim gate as diagnostic evidence" };
  }
  if (hasPassedGate && hasReleaseClaimBoundary && hasSyntheticBoundary) {
    return { ok: true, status: "release_claimable", message: "README labels the passed wiki-track claim gate with bounded release-claim language" };
  }
  if (hasReleaseClaimBoundary) {
    return { ok: true, status: "bounded", message: "README includes benchmark claim boundary language" };
  }
  return { ok: false, status: "ambiguous", message: "README benchmark section lacks clear diagnostic/release-claim boundary language" };
}

function codeEvidenceFreshnessDocStatus(readmeText) {
  const hasStatusCommand = /project-librarian --code-status|--code-status/.test(readmeText);
  const hasMcpStatus = /\bcode_status\b/.test(readmeText);
  const hasFreshMetric = /stale_files:\s*0/.test(readmeText);
  const hasAuthoritativeBoundary = /Stale reports are pointers for rebuild, not authoritative project truth/i.test(readmeText);
  const hasEvidenceSurfaces = /--code-report/.test(readmeText) && /--code-impact/.test(readmeText) && /--code-context-pack/.test(readmeText);
  const missing = [
    ["--code-status", hasStatusCommand],
    ["code_status", hasMcpStatus],
    ["stale_files: 0", hasFreshMetric],
    ["stale reports boundary", hasAuthoritativeBoundary],
    ["code-evidence surfaces", hasEvidenceSurfaces],
  ].filter(([, ok]) => !ok).map(([label]) => label);
  return {
    ok: missing.length === 0,
    missing,
    message: missing.length === 0
      ? "README requires fresh code-evidence status before citing report/tool output"
      : `README code-evidence freshness contract is missing: ${missing.join(", ")}`,
  };
}

function trustedPublishingWorkflowStatus(filePath = path.join(repoRoot, ".github", "workflows", "publish.yml")) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, missing: ["publish workflow"], forbidden: [], unpinned_actions: [], message: ".github/workflows/publish.yml is missing" };
  }
  const text = fs.readFileSync(filePath, "utf8");
  const actionPinning = githubActionReferencePinningStatus(filePath);
  const oidcBoundary = oidcWorkflowBoundaryStatus(text);
  const manualPublishGuard = manualPublishGuardStatus(text);
  const required = [
    { label: "id-token: write", pattern: /\bid-token:\s*write\b/ },
    { label: "contents: read", pattern: /\bcontents:\s*read\b/ },
    { label: "GitHub-hosted runner", pattern: /\bruns-on:\s*ubuntu-latest\b/ },
    { label: "protected publish environment", pattern: /\benvironment:\s*npm-publish\b/ },
    { label: "npm registry setup-node URL", pattern: /\bregistry-url:\s*['"]?https:\/\/registry\.npmjs\.org['"]?/ },
    { label: "release readiness gate", pattern: /\bnpm\s+run\s+release:check\b/ },
    { label: "npm publish command", pattern: /\bnpm\s+publish\b/ },
    { label: "public package access", pattern: /\bnpm\s+publish\b[^\n]*\s--access\s+public\b/ },
    { label: "script-disabled OIDC publish", pattern: /\bnpm\s+publish\b[^\n]*\s--ignore-scripts\b/ },
    { label: "release build cache disabled", pattern: /\bpackage-manager-cache:\s*false\b/ },
  ];
  const missing = required.filter((item) => !item.pattern.test(text)).map((item) => item.label);
  const forbidden = [
    { label: "NODE_AUTH_TOKEN", pattern: /\bNODE_AUTH_TOKEN\b/ },
    { label: "NPM_TOKEN", pattern: /\bNPM_TOKEN\b/ },
    { label: "npm token secret", pattern: /\bsecrets\.[A-Z0-9_]*NPM[A-Z0-9_]*\b/i },
    { label: "unbounded npm latest install", pattern: /\bnpm\s+(?:install|i)\s+(?:--global|-g)\s+npm@latest\b/ },
  ].filter((item) => item.pattern.test(text)).map((item) => item.label);
  const boundaryForbidden = [...oidcBoundary.forbidden];
  if (!manualPublishGuard.ok) boundaryForbidden.push("manual publish missing release-ref guard");
  const ok = missing.length === 0 && forbidden.length === 0 && boundaryForbidden.length === 0 && actionPinning.ok && oidcBoundary.ok;
  return {
    ok,
    missing,
    forbidden: [...forbidden, ...boundaryForbidden],
    action_pinning: actionPinning,
    oidc_boundary: oidcBoundary,
    manual_publish_guard: manualPublishGuard,
    unpinned_actions: actionPinning.unpinned_actions,
    message: ok
      ? "publish workflow uses isolated GitHub OIDC trusted publishing through the protected publish environment, without npm token secrets or install scripts in the OIDC job, and with full-SHA pinned first-party actions"
      : "publish workflow is missing trusted publishing requirements, mixes OIDC authority with install scripts, lacks manual publish ref guards, still references token secrets, or has unpinned first-party actions",
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

  if (hasFlag("--only-dist-parity")) {
    const distParity = distParityStatus();
    console.log(`${distParity.ok ? "PASS" : "FAIL"} dist parity: ${distParity.message}`);
    if (!distParity.ok) {
      console.error(JSON.stringify(distParity, null, 2));
      fail("release readiness failed: dist parity");
    }
    return;
  }

  const results = [];
  if (!hasFlag("--skip-npm-test")) {
    const npmTest = runCommand("npm test", "npm", ["test"]);
    printStep(npmTest);
    results.push(npmTest);
    if (!npmTest.ok) fail("release readiness failed: npm test");
  }

  if (!hasFlag("--skip-test-coverage")) {
    const coverage = runCommand("native test coverage", "npm", ["run", "test:coverage"]);
    printStep(coverage);
    results.push(coverage);
    if (!coverage.ok) fail("release readiness failed: native test coverage");
  }

  const parseSmoke = runCommand("benchmark parser smoke", "npm", ["run", "benchmark:llm:parse-smoke"]);
  printStep(parseSmoke);
  results.push(parseSmoke);
  if (!parseSmoke.ok) fail("release readiness failed: benchmark parser smoke");

  const handoffResumePreview = runCommand("session handoff resume preview", "npm", ["run", "benchmark:handoff-resume:preview"]);
  printStep(handoffResumePreview);
  results.push(handoffResumePreview);
  if (!handoffResumePreview.ok) fail("release readiness failed: session handoff resume preview");

  const agentSurfaceSmoke = runCommand("agent surface smoke", "npm", ["run", "benchmark:agent-surface-smoke"]);
  printStep(agentSurfaceSmoke);
  results.push(agentSurfaceSmoke);
  if (!agentSurfaceSmoke.ok) fail("release readiness failed: agent surface smoke");

  if (!hasFlag("--skip-real-corpus-demo")) {
    const realCorpusDemo = runCommand("real-corpus offline demo", "npm", ["run", "benchmark:real-corpus:demo"]);
    printStep(realCorpusDemo);
    results.push(realCorpusDemo);
    if (!realCorpusDemo.ok) fail("release readiness failed: real-corpus offline demo");
  }

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
  const fileRecords = packFileRecords(packEntries);
  const packInspection = inspectPackFiles(files);
  console.log(`${packInspection.ok ? "PASS" : "FAIL"} package contents: ${packInspection.total_files} files inspected`);
  if (!packInspection.ok) {
    console.error(JSON.stringify(packInspection, null, 2));
    fail("release readiness failed: package contents");
  }

  const nativeMatrix = nativeHelperPackageMatrixStatus(fileRecords, {
    repoRoot,
    verifyBinaryFormat: true,
  });
  console.log(`${nativeMatrix.ok ? "PASS" : "FAIL"} native helper package matrix: ${nativeMatrix.status}`);
  if (!nativeMatrix.ok) {
    console.error(JSON.stringify(nativeMatrix, null, 2));
    fail("release readiness failed: native helper package matrix");
  }

  const distStatus = distExecutableStatus();
  console.log(`${distStatus.ok ? "PASS" : "FAIL"} dist executable: ${distStatus.message}`);
  if (!distStatus.ok) fail("release readiness failed: dist executable");

  const distParity = distParityStatus();
  console.log(`${distParity.ok ? "PASS" : "FAIL"} dist parity: ${distParity.message}`);
  if (!distParity.ok) {
    console.error(JSON.stringify(distParity, null, 2));
    fail("release readiness failed: dist parity");
  }

  const readmeText = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  const readmeStatus = benchmarkClaimStatus(readmeText);
  console.log(`${readmeStatus.ok ? "PASS" : "FAIL"} README benchmark boundary: ${readmeStatus.message}`);
  if (!readmeStatus.ok) fail("release readiness failed: README benchmark boundary");

  const codeEvidenceFreshnessStatus = codeEvidenceFreshnessDocStatus(readmeText);
  console.log(`${codeEvidenceFreshnessStatus.ok ? "PASS" : "FAIL"} README code-evidence freshness: ${codeEvidenceFreshnessStatus.message}`);
  if (!codeEvidenceFreshnessStatus.ok) fail("release readiness failed: README code-evidence freshness");

  const rawHygieneStatus = rawCodexHomeHygieneStatus();
  console.log(`${rawHygieneStatus.candidate_count > 0 ? "WARN" : "PASS"} raw hygiene audit: ${rawHygieneStatus.message}`);

  const provenanceStatus = releaseProvenanceStatus();
  console.log(`INFO release provenance: ${provenanceStatus.current_control}; npm provenance ${provenanceStatus.status}`);

  const trustedPublishingStatus = trustedPublishingWorkflowStatus();
  console.log(`${trustedPublishingStatus.ok ? "PASS" : "FAIL"} trusted publishing workflow: ${trustedPublishingStatus.message}`);
  if (!trustedPublishingStatus.ok) {
    console.error(JSON.stringify(trustedPublishingStatus, null, 2));
    fail("release readiness failed: trusted publishing workflow");
  }

  const workflowPermissions = [
    ".github/workflows/benchmark.yml",
    ".github/workflows/branch-policy.yml",
    ".github/workflows/codeql.yml",
    ".github/workflows/dependency-review.yml",
    ".github/workflows/publish.yml",
  ].map((workflow) => workflowPermissionStatus(path.join(repoRoot, workflow)));
  const workflowPermissionFailures = workflowPermissions.filter((status) => !status.ok);
  console.log(`${workflowPermissionFailures.length === 0 ? "PASS" : "FAIL"} workflow permissions: ${workflowPermissions.length} workflow(s) inspected`);
  if (workflowPermissionFailures.length > 0) {
    console.error(JSON.stringify(workflowPermissionFailures, null, 2));
    fail("release readiness failed: workflow permissions");
  }

  const workflowActionPinning = [
    ".github/workflows/benchmark.yml",
    ".github/workflows/branch-policy.yml",
    ".github/workflows/codeql.yml",
    ".github/workflows/dependency-review.yml",
    ".github/workflows/publish.yml",
  ].map((workflow) => ({
    workflow,
    ...githubActionReferencePinningStatus(path.join(repoRoot, workflow)),
  }));
  const workflowActionPinningFailures = workflowActionPinning.filter((status) => !status.ok);
  console.log(`${workflowActionPinningFailures.length === 0 ? "PASS" : "FAIL"} workflow action pinning: ${workflowActionPinning.length} workflow(s) inspected`);
  if (workflowActionPinningFailures.length > 0) {
    console.error(JSON.stringify(workflowActionPinningFailures, null, 2));
    fail("release readiness failed: workflow action pinning");
  }

  console.log(JSON.stringify({
    checks: results.map((result) => ({ label: result.label, status: result.status, ok: result.ok })),
    dist: distStatus,
    dist_parity: distParity,
    native_helper_package_matrix: nativeMatrix,
    package: packInspection,
    readme_benchmark_claim: readmeStatus,
    readme_code_evidence_freshness: codeEvidenceFreshnessStatus,
    raw_hygiene: rawHygieneStatus,
    release_provenance: provenanceStatus,
    trusted_publishing: trustedPublishingStatus,
    workflow_permissions: workflowPermissions,
    workflow_action_pinning: workflowActionPinning,
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  benchmarkClaimStatus,
  codeEvidenceFreshnessDocStatus,
  distParityStatus,
  distExecutableStatus,
  githubActionReferencePinningStatus,
  inspectPackFiles,
  nativeHelperPackageMatrixStatus,
  normalizePackPath,
  packFileRecords,
  packFilePaths,
  parsePackJson,
  rawCodexHomeHygieneStatus,
  releaseProvenanceStatus,
  requiredPackFiles,
  temporaryNpmCacheEnv,
  trustedPublishingWorkflowStatus,
  oidcWorkflowBoundaryStatus,
  manualPublishGuardStatus,
  workflowPermissionStatus,
};
