const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  benchmarkClaimStatus,
  codeEvidenceFreshnessDocStatus,
  distParityStatus,
  githubActionReferencePinningStatus,
  inspectPackFiles,
  normalizePackPath,
  packFilePaths,
  parsePackJson,
  rawCodexHomeHygieneStatus,
  releaseProvenanceStatus,
  temporaryNpmCacheEnv,
  trustedPublishingWorkflowStatus,
  oidcWorkflowBoundaryStatus,
  manualPublishGuardStatus,
  workflowPermissionStatus,
} = require("../../benchmarks/tools/release-readiness.js");

test("release readiness parses npm pack JSON and normalizes package paths", () => {
  const entries = parsePackJson(JSON.stringify([{
    files: [
      { path: "package/README.md" },
      { path: "package/dist/init-project-wiki.js" },
    ],
  }]));
  assert.deepEqual(packFilePaths(entries), ["README.md", "dist/init-project-wiki.js"]);
  assert.equal(normalizePackPath("package/wiki/startup.md"), "wiki/startup.md");
});

test("release readiness package inspection requires shipped surface and rejects runtime state", () => {
  const ok = inspectPackFiles([
    "LICENSE",
    "README.md",
    "README.ko.md",
    "SKILL.md",
    "dist/init-project-wiki.js",
    "dist/session-handoff.js",
    "package.json",
  ]);
  assert.equal(ok.ok, true);

  const bad = inspectPackFiles([
    "LICENSE",
    "README.md",
    "README.ko.md",
    "SKILL.md",
    "dist/init-project-wiki.js",
    "dist/session-handoff.js",
    "package.json",
    "wiki/startup.md",
    ".omx/state/session.json",
  ]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.missing_required, []);
  assert.deepEqual(bad.forbidden, [".omx/state/session.json", "wiki/startup.md"]);
});

test("release readiness uses an isolated npm cache for pack inspection", () => {
  const env = temporaryNpmCacheEnv();
  assert(env.npm_config_cache);
  assert.notEqual(env.npm_config_cache, process.env.npm_config_cache);
  assert(fs.existsSync(env.npm_config_cache));
});

test("release readiness recognizes the current README benchmark boundary as release claimable", () => {
  const readme = fs.readFileSync(path.resolve(__dirname, "..", "..", "README.md"), "utf8");
  const status = benchmarkClaimStatus(readme);
  assert.equal(status.ok, true);
  assert.equal(status.status, "release_claimable");
});

test("release readiness requires README to gate code-evidence claims on freshness", () => {
  const readme = fs.readFileSync(path.resolve(__dirname, "..", "..", "README.md"), "utf8");
  const status = codeEvidenceFreshnessDocStatus(readme);
  assert.equal(status.ok, true, status.message);
  assert.deepEqual(status.missing, []);

  const missingFreshness = codeEvidenceFreshnessDocStatus("Use --code-report for structure answers.");
  assert.equal(missingFreshness.ok, false);
  assert.ok(missingFreshness.missing.includes("--code-status"));
  assert.ok(missingFreshness.missing.includes("stale_files: 0"));
});

test("release readiness validates the trusted publishing workflow", () => {
  const workflow = path.resolve(__dirname, "..", "..", ".github", "workflows", "publish.yml");
  const status = trustedPublishingWorkflowStatus(workflow);
  assert.equal(status.ok, true);
  assert.deepEqual(status.missing, []);
  assert.deepEqual(status.forbidden, []);
  assert.deepEqual(status.unpinned_actions, []);
});

test("release readiness validates minimal permissions for current workflows", () => {
  const root = path.resolve(__dirname, "..", "..");
  for (const workflow of [
    ".github/workflows/benchmark.yml",
    ".github/workflows/branch-policy.yml",
    ".github/workflows/codeql.yml",
    ".github/workflows/dependency-review.yml",
    ".github/workflows/publish.yml",
  ]) {
    const status = workflowPermissionStatus(path.join(root, workflow));
    assert.equal(status.ok, true, `${workflow}: ${status.message}`);
    assert.equal(status.permissions.contents, "read", workflow);
  }
});

test("release readiness validates full-SHA action pinning for current workflows", () => {
  const root = path.resolve(__dirname, "..", "..");
  for (const workflow of [
    ".github/workflows/benchmark.yml",
    ".github/workflows/branch-policy.yml",
    ".github/workflows/codeql.yml",
    ".github/workflows/dependency-review.yml",
    ".github/workflows/publish.yml",
  ]) {
    const status = githubActionReferencePinningStatus(path.join(root, workflow));
    assert.equal(status.ok, true, `${workflow}: ${JSON.stringify(status.unpinned_actions)}`);
  }
});

test("release readiness checks checked-in dist parity", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "release-dist-parity-"));
  fs.mkdirSync(path.join(fixture, "dist"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "dist", "init-project-wiki.js"), "#!/usr/bin/env node\n");
  childProcess.execFileSync("git", ["init"], { cwd: fixture, stdio: "ignore" });
  childProcess.execFileSync("git", ["add", "dist"], { cwd: fixture, stdio: "ignore" });
  childProcess.execFileSync("git", [
    "-c", "user.name=Project Librarian Test",
    "-c", "user.email=project-librarian-test@example.invalid",
    "commit",
    "-m", "seed dist",
  ], { cwd: fixture, stdio: "ignore" });

  const status = distParityStatus(fixture);
  assert.equal(status.ok, true, status.message);

  fs.appendFileSync(path.join(fixture, "dist", "init-project-wiki.js"), "console.log('drift');\n");
  const dirtyStatus = distParityStatus(fixture);
  assert.equal(dirtyStatus.ok, false);
  assert.deepEqual(dirtyStatus.changed_files, ["dist/init-project-wiki.js"]);
});

test("release readiness rejects token-based npm publish workflows", () => {
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "release-workflow-")), "publish.yml");
  fs.writeFileSync(fixture, [
    "name: Publish Package",
    "permissions:",
    "  contents: read",
    "  id-token: write",
    "jobs:",
    "  publish:",
    "    runs-on: ubuntu-latest",
    "    environment: npm-publish",
    "    steps:",
    "      - uses: actions/setup-node@v6",
    "        with:",
    "          registry-url: https://registry.npmjs.org",
    "          package-manager-cache: false",
    "      - run: npm run release:check",
    "      - run: npm publish --access public",
    "        env:",
    "          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
    "",
  ].join("\n"));
  const status = trustedPublishingWorkflowStatus(fixture);
  assert.equal(status.ok, false);
  assert.ok(status.forbidden.includes("NODE_AUTH_TOKEN"));
  assert.ok(status.forbidden.includes("NPM_TOKEN"));
  assert.ok(status.forbidden.includes("npm token secret"));
});

test("release readiness rejects unbounded release-tool upgrades", () => {
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "release-workflow-npm-latest-")), "publish.yml");
  fs.writeFileSync(fixture, [
    "name: Publish Package",
    "permissions:",
    "  contents: read",
    "  id-token: write",
    "jobs:",
    "  publish:",
    "    runs-on: ubuntu-latest",
    "    environment: npm-publish",
    "    steps:",
    "      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
    "        with:",
    "          registry-url: https://registry.npmjs.org",
    "          package-manager-cache: false",
    "      - run: npm ci",
    "      - run: npm install --global npm@latest",
    "      - run: npm run release:check",
    "      - run: npm publish --access public",
    "",
  ].join("\n"));
  const status = trustedPublishingWorkflowStatus(fixture);
  assert.equal(status.ok, false);
  assert.ok(status.forbidden.includes("unbounded npm latest install"));
});

test("release readiness requires the protected publish environment", () => {
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "release-workflow-env-")), "publish.yml");
  fs.writeFileSync(fixture, [
    "name: Publish Package",
    "permissions:",
    "  contents: read",
    "  id-token: write",
    "jobs:",
    "  publish:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
    "        with:",
    "          registry-url: https://registry.npmjs.org",
    "          package-manager-cache: false",
    "      - run: npm run release:check",
    "      - run: npm publish --access public",
    "",
  ].join("\n"));
  const status = trustedPublishingWorkflowStatus(fixture);
  assert.equal(status.ok, false);
  assert.ok(status.missing.includes("protected publish environment"));
});

test("release readiness rejects OIDC jobs that run dependency scripts or script-enabled publish", () => {
  const text = [
    "jobs:",
    "  publish:",
    "    runs-on: ubuntu-latest",
    "    permissions:",
    "      contents: read",
    "      id-token: write",
    "    steps:",
    "      - run: npm ci",
    "      - run: npm publish --access public",
    "",
  ].join("\n");
  const status = oidcWorkflowBoundaryStatus(text);
  assert.equal(status.ok, false);
  assert.deepEqual(status.oidc_jobs, ["publish"]);
  assert.ok(status.forbidden.includes("OIDC job publish runs npm install/test/build scripts"));
  assert.ok(status.forbidden.includes("OIDC job publish runs npm publish without --ignore-scripts"));
});

test("release readiness requires manual publish dispatch to reject non-release refs", () => {
  const unguarded = [
    "on:",
    "  workflow_dispatch:",
    "jobs:",
    "  publish:",
    "    if: ${{ github.event_name == 'workflow_dispatch' }}",
    "",
  ].join("\n");
  assert.equal(manualPublishGuardStatus(unguarded).ok, false);

  const guarded = [
    "on:",
    "  workflow_dispatch:",
    "jobs:",
    "  reject-manual-non-release-ref:",
    "    if: ${{ github.event_name == 'workflow_dispatch' && !inputs.dry_run && !startsWith(github.ref, 'refs/tags/v') }}",
    "  publish:",
    "    if: ${{ github.event_name == 'release' || (github.event_name == 'workflow_dispatch' && !inputs.dry_run && startsWith(github.ref, 'refs/tags/v')) }}",
    "",
  ].join("\n");
  assert.equal(manualPublishGuardStatus(guarded).ok, true);
});

test("release readiness rejects movable first-party GitHub action refs", () => {
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "release-action-pinning-")), "workflow.yml");
  fs.writeFileSync(fixture, [
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v6",
    "      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
    "      - uses: github/codeql-action/init@v4",
    "      - uses: ./local-action",
    "",
  ].join("\n"));

  const status = githubActionReferencePinningStatus(fixture);
  assert.equal(status.ok, false);
  assert.deepEqual(status.unpinned_actions, [
    { action: "actions/checkout", ref: "v6" },
    { action: "github/codeql-action/init", ref: "v4" },
  ]);
  assert.deepEqual(status.inspected_actions, [
    { action: "actions/checkout", ref: "v6" },
    { action: "actions/setup-node", ref: "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e" },
    { action: "github/codeql-action/init", ref: "v4" },
  ]);
});

test("release readiness rejects broad workflow permissions", () => {
  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "release-workflow-permissions-")), "workflow.yml");
  fs.writeFileSync(fixture, [
    "name: Unsafe",
    "permissions: write-all",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo unsafe",
    "",
  ].join("\n"));
  const status = workflowPermissionStatus(fixture);
  assert.equal(status.ok, false);
  assert.deepEqual(status.missing, ["contents: read"]);
  assert.deepEqual(status.forbidden, ["permissions: write-all"]);
});

test("release readiness raw hygiene audit is non-destructive", () => {
  const rawRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-raw-hygiene-"));
  const runDir = path.join(rawRoot, "2026-06-17T00-00-00-000Z");
  const oldHome = path.join(runDir, "codex-home-old");
  const freshHome = path.join(runDir, "codex-home-fresh");
  fs.mkdirSync(oldHome, { recursive: true });
  fs.mkdirSync(freshHome, { recursive: true });
  fs.writeFileSync(path.join(oldHome, "debug.log"), "hello");
  fs.writeFileSync(path.join(freshHome, "debug.log"), "fresh");
  const oldDate = new Date("2026-06-17T00:00:00.000Z");
  const freshDate = new Date("2026-06-19T00:00:00.000Z");
  fs.utimesSync(oldHome, oldDate, oldDate);
  fs.utimesSync(freshHome, freshDate, freshDate);

  const status = rawCodexHomeHygieneStatus({
    rawRoot,
    olderThanDays: 1,
    includeCandidates: true,
    now: new Date("2026-06-19T12:00:00.000Z"),
  });

  assert.equal(status.ok, true);
  assert.equal(status.available, true);
  assert.equal(status.candidate_count, 1);
  assert.equal(status.candidate_bytes, 5);
  assert.equal(status.candidates[0].relative_path, "2026-06-17T00-00-00-000Z/codex-home-old");
  assert(fs.existsSync(oldHome));
  assert(fs.existsSync(freshHome));
});

test("release readiness records automatic trusted-publishing provenance", () => {
  const status = releaseProvenanceStatus();
  assert.equal(status.ok, true);
  assert.equal(status.status, "automatic");
  assert.match(status.current_control, /trusted publishing/);
  assert.match(status.reason, /provenance attestations/);
  assert.match(status.verification, /OIDC/);
});
