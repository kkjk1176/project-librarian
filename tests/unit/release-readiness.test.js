const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { sampleBinaryForTriple } = require("./native-binary-fixtures.js");
const {
  packagedHelperManifestRelativePath,
  packagedHelperPathForTriple,
  supportedTriples,
  writePackagedHelperManifest,
} = require("../../benchmarks/tools/native-indexer-package-audit.js");

const {
  benchmarkClaimStatus,
  codeEvidenceFreshnessDocStatus,
  distParityStatus,
  githubActionReferencePinningStatus,
  inspectPackFiles,
  normalizePackPath,
  nativeHelperPackageMatrixStatus,
  nativeHelperPackageProvenanceStatus,
  packFileRecords,
  packFilePaths,
  parsePackJson,
  rawCodexHomeHygieneStatus,
  releaseProvenanceStatus,
  temporaryNpmCacheEnv,
  trustedPublishingWorkflowStatus,
  oidcWorkflowBoundaryStatus,
  manualPublishGuardStatus,
  nativeHelperPublishRunners,
  nativeHelperPublishRustTargets,
  nativeHelperPublishWorkflowStatus,
  nativeHelperSqliteLinkStatus,
  workflowPermissionStatus,
} = require("../../benchmarks/tools/release-readiness.js");

test("release readiness parses npm pack JSON and normalizes package paths", () => {
  const entries = parsePackJson(JSON.stringify([{
    files: [
      { path: "package/README.md", mode: 0o644 },
      { path: "package/dist/init-project-wiki.js", mode: 0o755 },
    ],
  }]));
  assert.deepEqual(packFileRecords(entries), [
    { mode: 0o644, path: "README.md" },
    { mode: 0o755, path: "dist/init-project-wiki.js" },
  ]);
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
    "native/indexer-rs/target/debug/project-librarian-indexer",
    "wiki/startup.md",
    ".omx/state/session.json",
  ]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.missing_required, []);
  assert.deepEqual(bad.forbidden, [".omx/state/session.json", "native/indexer-rs/target/debug/project-librarian-indexer", "wiki/startup.md"]);
});

test("release readiness rejects partial native helper package matrices", () => {
  const noNative = nativeHelperPackageMatrixStatus([
    "LICENSE",
    "README.md",
    "dist/init-project-wiki.js",
    packagedHelperManifestRelativePath(),
  ]);
  assert.equal(noNative.ok, true);
  assert.equal(noNative.status, "no-packaged-helper");

  const staleProvenance = nativeHelperPackageProvenanceStatus([
    packagedHelperManifestRelativePath(),
  ]);
  assert.equal(staleProvenance.ok, false);
  assert.equal(staleProvenance.status, "packaged-helper-provenance-stale");

  const partial = nativeHelperPackageMatrixStatus([
    "dist/native/darwin-arm64/project-librarian-indexer",
  ]);
  assert.equal(partial.ok, false);
  assert.equal(partial.status, "partial-packaged-helper-matrix");
  assert.ok(partial.missing_files.includes("dist/native/linux-x64/project-librarian-indexer"));

  const full = nativeHelperPackageMatrixStatus(partial.expected_files.map((file) => ({
    mode: file.includes("win32-") ? 0o644 : 0o755,
    path: file,
  })));
  assert.equal(full.ok, true);
  assert.equal(full.status, "packaged-helper-matrix-ready");

  const nonExecutable = nativeHelperPackageMatrixStatus(partial.expected_files.map((file) => ({
    mode: file.includes("linux-x64/") ? 0o644 : 0o755,
    path: file,
  })));
  assert.equal(nonExecutable.ok, false);
  assert.deepEqual(nonExecutable.non_executable_files, ["dist/native/linux-x64/project-librarian-indexer"]);

  const unexpected = nativeHelperPackageMatrixStatus([
    ...partial.expected_files,
    "dist/native/linux-x64/README.txt",
  ]);
  assert.equal(unexpected.ok, false);
  assert.deepEqual(unexpected.unexpected_files, ["dist/native/linux-x64/README.txt"]);
});

test("release readiness requires packaged native helper provenance manifests", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "release-native-provenance-"));
  try {
    const expectedFiles = nativeHelperPackageMatrixStatus([]).expected_files;
    for (const triple of supportedTriples) {
      const helperPath = packagedHelperPathForTriple(cwd, triple);
      fs.mkdirSync(path.dirname(helperPath), { recursive: true });
      fs.writeFileSync(helperPath, sampleBinaryForTriple(triple));
      if (!triple.startsWith("win32-")) fs.chmodSync(helperPath, 0o755);
    }

    const missing = nativeHelperPackageProvenanceStatus(expectedFiles, {
      matrixStatus: nativeHelperPackageMatrixStatus(expectedFiles),
      repoRoot: cwd,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.status, "packaged-helper-provenance-missing");

    writePackagedHelperManifest({ repoRoot: cwd });
    const ready = nativeHelperPackageProvenanceStatus([
      ...expectedFiles,
      packagedHelperManifestRelativePath(),
    ], {
      matrixStatus: nativeHelperPackageMatrixStatus(expectedFiles),
      repoRoot: cwd,
    });
    assert.equal(ready.ok, true);
    assert.equal(ready.status, "packaged-helper-provenance-ready");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("release readiness can validate packaged native helper binary formats", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "release-native-binary-"));
  try {
    const expectedFiles = nativeHelperPackageMatrixStatus([]).expected_files;
    const records = expectedFiles.map((file) => ({
      mode: file.includes("win32-") ? 0o644 : 0o755,
      path: file,
    }));
    for (const file of expectedFiles) {
      const triple = file.split("/")[2];
      const helperPath = path.join(cwd, file);
      fs.mkdirSync(path.dirname(helperPath), { recursive: true });
      fs.writeFileSync(helperPath, sampleBinaryForTriple(triple === "linux-x64" ? "linux-arm64" : triple));
    }

    const status = nativeHelperPackageMatrixStatus(records, {
      repoRoot: cwd,
      verifyBinaryFormat: true,
    });
    assert.equal(status.ok, false);
    assert.equal(status.status, "packaged-helper-binary-mismatch");
    assert.deepEqual(status.binary_mismatches.map((item) => item.triple), ["linux-x64"]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
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

test("release readiness validates the native helper publish artifact chain", () => {
  const workflow = path.resolve(__dirname, "..", "..", ".github", "workflows", "publish.yml");
  const status = nativeHelperPublishWorkflowStatus(workflow);
  assert.equal(status.ok, true, status.message);
  assert.deepEqual(status.missing, []);
  assert.deepEqual(status.order_errors, []);
  assert.deepEqual(status.present_triples, supportedTriples);
  assert.equal(nativeHelperPublishRunners.get("darwin-x64"), "macos-15-intel");
  assert.equal(nativeHelperPublishRunners.get("win32-arm64"), "windows-11-arm");
  assert.equal(nativeHelperPublishRustTargets.get("linux-x64-musl"), "x86_64-unknown-linux-musl");

  const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "release-native-helper-workflow-")), "publish.yml");
  const text = fs.readFileSync(workflow, "utf8").replace("needs: package-native-helper-matrix", "needs: verify");
  fs.writeFileSync(fixture, text);
  const broken = nativeHelperPublishWorkflowStatus(fixture);
  assert.equal(broken.ok, false);
  assert.ok(broken.missing.includes("publish job depends on matrix package"));

  const staleRunnerFixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "release-native-helper-runner-")), "publish.yml");
  fs.writeFileSync(staleRunnerFixture, fs.readFileSync(workflow, "utf8").replace("runner: macos-15-intel", "runner: macos-13"));
  const staleRunner = nativeHelperPublishWorkflowStatus(staleRunnerFixture);
  assert.equal(staleRunner.ok, false);
  assert.ok(staleRunner.missing.includes("build matrix runner darwin-x64 -> macos-15-intel"));

  const missingRustTargetFixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "release-native-helper-rust-target-")), "publish.yml");
  fs.writeFileSync(missingRustTargetFixture, fs.readFileSync(workflow, "utf8").replace("rust_target: x86_64-unknown-linux-musl", "rust_target: x86_64-unknown-linux-gnu"));
  const missingRustTarget = nativeHelperPublishWorkflowStatus(missingRustTargetFixture);
  assert.equal(missingRustTarget.ok, false);
  assert.ok(missingRustTarget.missing.includes("build matrix rust target linux-x64-musl -> x86_64-unknown-linux-musl"));

  const quotedScalarFixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "release-native-helper-quoted-")), "publish.yml");
  fs.writeFileSync(quotedScalarFixture, fs.readFileSync(workflow, "utf8")
    .replaceAll("triple: darwin-arm64", "triple: \"darwin-arm64\"")
    .replaceAll("runner: macos-14", "runner: \"macos-14\"")
    .replaceAll("rust_target: aarch64-apple-darwin", "rust_target: \"aarch64-apple-darwin\""));
  const quotedScalar = nativeHelperPublishWorkflowStatus(quotedScalarFixture);
  assert.equal(quotedScalar.ok, true, JSON.stringify(quotedScalar.missing));

  const unsupportedTripleFixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "release-native-helper-unsupported-")), "publish.yml");
  fs.writeFileSync(unsupportedTripleFixture, fs.readFileSync(workflow, "utf8").replace([
    "          - triple: win32-x64",
    "            runner: windows-latest",
    "            rust_target: x86_64-pc-windows-msvc",
  ].join("\n"), [
    "          - triple: win32-x64",
    "            runner: windows-latest",
    "            rust_target: x86_64-pc-windows-msvc",
    "          - triple: linux-riscv64",
    "            runner: ubuntu-latest",
    "            rust_target: riscv64gc-unknown-linux-gnu",
  ].join("\n")));
  const unsupportedTriple = nativeHelperPublishWorkflowStatus(unsupportedTripleFixture);
  assert.equal(unsupportedTriple.ok, false);
  assert.ok(unsupportedTriple.missing.includes("unsupported build matrix triple linux-riscv64"));

  const missingBuildInstallFixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "release-native-helper-install-")), "publish.yml");
  fs.writeFileSync(missingBuildInstallFixture, fs.readFileSync(workflow, "utf8").replace("      - run: npm ci\n      - name: Install Rust target", "      - name: Install Rust target"));
  const missingBuildInstall = nativeHelperPublishWorkflowStatus(missingBuildInstallFixture);
  assert.equal(missingBuildInstall.ok, false);
  assert.ok(missingBuildInstall.missing.includes("build job installs dependencies"));

  const stageBeforeInstallFixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "release-native-helper-stage-order-")), "publish.yml");
  fs.writeFileSync(stageBeforeInstallFixture, fs.readFileSync(workflow, "utf8").replace([
    "      - run: npm ci",
    "      - name: Install Rust target",
    "        run: rustup target add ${{ matrix.rust_target }}",
  ].join("\n"), [
    "      - name: Install Rust target",
    "        run: rustup target add ${{ matrix.rust_target }}",
    "      - run: npm ci",
  ].join("\n")));
  const stageBeforeInstall = nativeHelperPublishWorkflowStatus(stageBeforeInstallFixture);
  assert.equal(stageBeforeInstall.ok, false);
  assert.ok(stageBeforeInstall.order_errors.includes("install Rust target must run after install build dependencies"));

  const publishBeforeVerifyFixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "release-native-helper-order-")), "publish.yml");
  fs.writeFileSync(publishBeforeVerifyFixture, fs.readFileSync(workflow, "utf8").replace([
    "      - name: Verify packaged helper matrix",
    "        run: node benchmarks/tools/native-indexer-package-audit.js --require-packaged-helper-matrix --require-packaged-helper-provenance",
    "      - name: Publish to npm through trusted publishing",
    "        run: npm publish --access public --ignore-scripts",
  ].join("\n"), [
    "      - name: Publish to npm through trusted publishing",
    "        run: npm publish --access public --ignore-scripts",
    "      - name: Verify packaged helper matrix",
    "        run: node benchmarks/tools/native-indexer-package-audit.js --require-packaged-helper-matrix --require-packaged-helper-provenance",
  ].join("\n")));
  const publishBeforeVerify = nativeHelperPublishWorkflowStatus(publishBeforeVerifyFixture);
  assert.equal(publishBeforeVerify.ok, false);
  assert.ok(publishBeforeVerify.order_errors.includes("publish package must run after verify helper matrix provenance"));
});

test("release readiness requires bundled SQLite link metadata for native helpers", () => {
  const status = nativeHelperSqliteLinkStatus();
  assert.equal(status.ok, true, status.message);
  assert.deepEqual(status.missing, []);
  assert.deepEqual(status.forbidden, []);

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "release-native-helper-sqlite-link-"));
  const cargoTomlPath = path.join(fixture, "Cargo.toml");
  const sourcePath = path.join(fixture, "main.rs");
  fs.writeFileSync(cargoTomlPath, [
    "[package]",
    "name = \"fixture\"",
    "",
    "[dependencies]",
    "serde = \"1\"",
    "",
    "[target.'cfg(target_env = \"musl\")'.dependencies]",
    "libsqlite3-sys = { version = \"=0.35.0\", features = [\"bundled\"] }",
    "",
  ].join("\n"));
  fs.writeFileSync(sourcePath, [
    "#[cfg(target_env = \"musl\")]",
    "extern crate libsqlite3_sys as _;",
    "",
  ].join("\n"));

  const muslOnly = nativeHelperSqliteLinkStatus({ cargoTomlPath, sourcePath });
  assert.equal(muslOnly.ok, false);
  assert.ok(muslOnly.missing.includes("unconditional libsqlite3-sys bundled dependency"));
  assert.ok(muslOnly.forbidden.includes("target-scoped libsqlite3-sys dependency"));
  assert.ok(muslOnly.forbidden.includes("cfg-gated libsqlite3_sys extern crate"));
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
