const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { sampleBinaryForTriple } = require("./native-binary-fixtures.js");
const {
  currentPlatformTriple,
  helperBinaryName,
  inspectNativeIndexerPackaging,
  inspectNativeHelperBinary,
  packageFilesCanShipPackagedHelper,
  packageFilesIncludeNative,
  packagedHelperBinaryStatus,
  packagedHelperManifestPath,
  packagedHelperMatrixStatus,
  packagedHelperPathForTriple,
  packagedHelperProvenanceStatus,
  readPackagedHelperManifest,
  stagePackagedHelper,
  supportedTriples,
  writePackagedHelperManifest,
} = require("../../benchmarks/tools/native-indexer-package-audit.js");

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFullHelperMatrix(cwd) {
  for (const triple of supportedTriples) {
    const helper = packagedHelperPathForTriple(cwd, triple);
    fs.mkdirSync(path.dirname(helper), { recursive: true });
    fs.writeFileSync(helper, sampleBinaryForTriple(triple));
    if (!triple.startsWith("win32-")) fs.chmodSync(helper, 0o755);
  }
}

test("native package audit reports local helper and missing packaged helper", () => {
  const cwd = makeTmpDir("native-package-audit-");
  try {
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
      files: ["agents/", "dist/", "LICENSE", "README.md"],
    }));
    const helperPath = path.join(cwd, "target", helperBinaryName());
    fs.mkdirSync(path.dirname(helperPath), { recursive: true });
    fs.writeFileSync(helperPath, sampleBinaryForTriple(currentPlatformTriple()));
    fs.chmodSync(helperPath, 0o755);

    const audit = inspectNativeIndexerPackaging({ helperPath, repoRoot: cwd, requireHelper: true });
    assert.equal(audit.triple, currentPlatformTriple());
    assert.equal(audit.helper_exists, true);
    assert.equal(audit.helper_executable, true);
    assert.equal(audit.helper_binary.ok, true);
    assert.equal(audit.packaged_helper_exists, false);
    assert.equal(audit.packaged_helper_executable, false);
    assert.equal(audit.package_files_include_native, false);
    assert.equal(audit.package_files_can_ship_packaged_helper, true);
    assert.equal(audit.packaged_helper_in_publish_boundary, true);
    assert.equal(audit.packaging_status, "packaged-helper-missing");
    assert.equal(audit.ok, audit.supported_platform);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("native package audit stages and validates packaged platform helper", () => {
  const cwd = makeTmpDir("native-package-stage-");
  try {
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
      files: ["agents/", "dist/", "LICENSE", "README.md"],
    }));
    const helperPath = path.join(cwd, "target", helperBinaryName());
    fs.mkdirSync(path.dirname(helperPath), { recursive: true });
    fs.writeFileSync(helperPath, sampleBinaryForTriple(currentPlatformTriple()));
    fs.chmodSync(helperPath, 0o755);

    const staged = stagePackagedHelper({ helperPath, repoRoot: cwd });
    assert.equal(staged.packaged_helper_path.includes(path.join("dist", "native")), true);

    const audit = inspectNativeIndexerPackaging({
      repoRoot: cwd,
      requirePackagedHelper: true,
      requirePackagingEnabled: true,
    });
    assert.equal(audit.packaged_helper_exists, true);
    assert.equal(audit.packaged_helper_executable, true);
    assert.equal(audit.packaged_helper_binary.ok, true);
    assert.equal(audit.packaged_helper_in_publish_boundary, true);
    assert.equal(audit.packaging_status, "partial-packaged-helper-matrix");
    assert.equal(audit.ok, audit.supported_platform);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("native package audit supports musl and Windows ARM64 helper triples", () => {
  const cwd = makeTmpDir("native-package-extra-triples-");
  try {
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
      files: ["dist/"],
    }));
    assert.ok(supportedTriples.includes("linux-x64-musl"));
    assert.ok(supportedTriples.includes("linux-arm64-musl"));
    assert.ok(supportedTriples.includes("win32-arm64"));
    assert.equal(currentPlatformTriple("linux", "x64", "musl"), "linux-x64-musl");
    assert.equal(currentPlatformTriple("linux", "arm64", "glibc"), "linux-arm64");

    const rustTarget = "x86_64-unknown-linux-musl";
    const helperPath = path.join(cwd, "native", "indexer-rs", "target", rustTarget, "release", helperBinaryName("linux"));
    fs.mkdirSync(path.dirname(helperPath), { recursive: true });
    fs.writeFileSync(helperPath, sampleBinaryForTriple("linux-x64-musl"));
    fs.chmodSync(helperPath, 0o755);

    const staged = stagePackagedHelper({ repoRoot: cwd, rustTarget, triple: "linux-x64-musl" });
    assert.equal(staged.triple, "linux-x64-musl");
    assert.equal(staged.packaged_helper_path, packagedHelperPathForTriple(cwd, "linux-x64-musl"));
    assert.equal(packagedHelperBinaryStatus(staged.packaged_helper_path, "linux-x64-musl").ok, true);

    const winArm = path.join(cwd, "project-librarian-indexer.exe");
    fs.writeFileSync(winArm, sampleBinaryForTriple("win32-arm64"));
    const inspected = inspectNativeHelperBinary(winArm);
    assert.equal(inspected.format, "pe");
    assert.deepEqual(inspected.architectures, ["arm64"]);
    assert.equal(packagedHelperBinaryStatus(winArm, "win32-arm64").ok, true);

    const windowsTarget = "aarch64-pc-windows-msvc";
    const windowsHelperPath = path.join(cwd, "native", "indexer-rs", "target", windowsTarget, "release", helperBinaryName("win32"));
    fs.mkdirSync(path.dirname(windowsHelperPath), { recursive: true });
    fs.writeFileSync(windowsHelperPath, sampleBinaryForTriple("win32-arm64"));
    const windowsStaged = stagePackagedHelper({ repoRoot: cwd, rustTarget: windowsTarget, triple: "win32-arm64" });
    assert.equal(windowsStaged.packaged_helper_path, packagedHelperPathForTriple(cwd, "win32-arm64"));
    assert.equal(packagedHelperBinaryStatus(windowsStaged.packaged_helper_path, "win32-arm64").ok, true);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("native package audit rejects a mislabeled staged platform helper", () => {
  const cwd = makeTmpDir("native-package-staged-binary-");
  try {
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
      files: ["dist/"],
    }));
    const wrongTriple = currentPlatformTriple() === "darwin-arm64" ? "darwin-x64" : "darwin-arm64";
    const helperPath = path.join(cwd, "target", helperBinaryName());
    fs.mkdirSync(path.dirname(helperPath), { recursive: true });
    fs.writeFileSync(helperPath, sampleBinaryForTriple(wrongTriple));
    fs.chmodSync(helperPath, 0o755);
    stagePackagedHelper({ helperPath, repoRoot: cwd });

    const audit = inspectNativeIndexerPackaging({
      repoRoot: cwd,
      requirePackagedHelper: true,
      requirePackagingEnabled: true,
    });
    assert.equal(audit.packaged_helper_binary.ok, false);
    assert.equal(audit.packaging_status, "packaged-helper-binary-mismatch");
    assert.equal(audit.ok, false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("native package audit detects partial and complete packaged helper matrices", () => {
  const cwd = makeTmpDir("native-package-matrix-");
  try {
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
      files: ["agents/", "dist/", "LICENSE", "README.md"],
    }));

    const empty = packagedHelperMatrixStatus({ repoRoot: cwd });
    assert.equal(empty.ok, true);
    assert.equal(empty.status, "no-packaged-helper");
    assert.deepEqual(empty.missing_triples, []);

    const currentHelper = packagedHelperPathForTriple(cwd, currentPlatformTriple());
    fs.mkdirSync(path.dirname(currentHelper), { recursive: true });
    fs.writeFileSync(currentHelper, sampleBinaryForTriple(currentPlatformTriple()));
    fs.chmodSync(currentHelper, 0o755);

    const partial = inspectNativeIndexerPackaging({ repoRoot: cwd, requirePackagedHelperMatrix: true });
    assert.equal(partial.packaged_helper_matrix.status, "partial-packaged-helper-matrix");
    assert.equal(partial.ok, false);
    assert(partial.packaged_helper_matrix.missing_triples.length > 0);

    for (const triple of supportedTriples) {
      const helper = packagedHelperPathForTriple(cwd, triple);
      fs.mkdirSync(path.dirname(helper), { recursive: true });
      fs.writeFileSync(helper, sampleBinaryForTriple(triple));
      if (!triple.startsWith("win32-")) fs.chmodSync(helper, 0o755);
    }
    const full = inspectNativeIndexerPackaging({ repoRoot: cwd, requirePackagedHelperMatrix: true });
    assert.equal(full.packaged_helper_matrix.status, "packaged-helper-matrix-ready");
    assert.equal(full.packaged_helper_matrix.missing_triples.length, 0);
    assert.equal(full.ok, full.supported_platform);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("native package audit rejects mislabeled packaged helper binaries", () => {
  const cwd = makeTmpDir("native-package-binary-");
  try {
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
      files: ["dist/"],
    }));
    for (const triple of supportedTriples) {
      const helper = packagedHelperPathForTriple(cwd, triple);
      fs.mkdirSync(path.dirname(helper), { recursive: true });
      fs.writeFileSync(helper, sampleBinaryForTriple(triple === "linux-x64" ? "linux-arm64" : triple));
      if (!triple.startsWith("win32-")) fs.chmodSync(helper, 0o755);
    }

    const linuxX64 = packagedHelperPathForTriple(cwd, "linux-x64");
    const inspected = inspectNativeHelperBinary(linuxX64);
    assert.equal(inspected.format, "elf");
    assert.deepEqual(inspected.architectures, ["arm64"]);

    const binaryStatus = packagedHelperBinaryStatus(linuxX64, "linux-x64");
    assert.equal(binaryStatus.ok, false);
    assert.equal(binaryStatus.expected_architecture, "x64");
    assert.deepEqual(binaryStatus.actual_architectures, ["arm64"]);

    const matrix = packagedHelperMatrixStatus({ repoRoot: cwd });
    assert.equal(matrix.ok, false);
    assert.equal(matrix.status, "packaged-helper-binary-mismatch");
    assert.deepEqual(matrix.binary_mismatches.map((item) => item.triple), ["linux-x64"]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("native package audit requires packaged helper provenance manifests", () => {
  const cwd = makeTmpDir("native-package-provenance-");
  try {
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
      files: ["dist/"],
    }));

    const empty = packagedHelperProvenanceStatus({ repoRoot: cwd });
    assert.equal(empty.ok, true);
    assert.equal(empty.status, "no-packaged-helper");

    fs.mkdirSync(path.dirname(packagedHelperManifestPath(cwd)), { recursive: true });
    fs.writeFileSync(packagedHelperManifestPath(cwd), "{}\n");
    const stale = packagedHelperProvenanceStatus({ repoRoot: cwd });
    assert.equal(stale.ok, false);
    assert.equal(stale.status, "packaged-helper-provenance-stale");
    fs.rmSync(packagedHelperManifestPath(cwd));

    writeFullHelperMatrix(cwd);
    const missingManifest = inspectNativeIndexerPackaging({
      repoRoot: cwd,
      requirePackagedHelperMatrix: true,
      requirePackagedHelperProvenance: true,
    });
    assert.equal(missingManifest.packaged_helper_matrix.status, "packaged-helper-matrix-ready");
    assert.equal(missingManifest.packaged_helper_provenance.status, "packaged-helper-provenance-missing");
    assert.equal(missingManifest.ok, false);

    const written = writePackagedHelperManifest({ repoRoot: cwd });
    assert.equal(fs.existsSync(written.manifest_path), true);
    const manifest = readPackagedHelperManifest(cwd);
    assert.deepEqual(manifest.helpers.map((entry) => entry.triple).sort(), [...supportedTriples].sort());

    const ready = inspectNativeIndexerPackaging({
      repoRoot: cwd,
      requirePackagedHelperMatrix: true,
      requirePackagedHelperProvenance: true,
    });
    assert.equal(ready.packaged_helper_provenance.status, "packaged-helper-provenance-ready");
    assert.equal(ready.ok, ready.supported_platform);

    fs.appendFileSync(packagedHelperPathForTriple(cwd, "linux-x64"), "changed");
    const changed = packagedHelperProvenanceStatus({ repoRoot: cwd });
    assert.equal(changed.ok, false);
    assert.equal(changed.status, "packaged-helper-provenance-mismatch");
    assert.ok(changed.mismatches.some((item) => item.triple === "linux-x64" && item.field === "sha256"));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("native package audit detects native package file entries", () => {
  assert.equal(packageFilesIncludeNative({ files: ["dist/", "dist/native/"] }), true);
  assert.equal(packageFilesIncludeNative({ files: ["native/"] }), true);
  assert.equal(packageFilesIncludeNative({ files: ["dist/", "README.md"] }), false);
  assert.equal(packageFilesCanShipPackagedHelper({ files: ["dist/"] }), true);
  assert.equal(packageFilesCanShipPackagedHelper({ files: ["dist/native/"] }), true);
  assert.equal(packageFilesCanShipPackagedHelper({ files: ["dist/client/"] }), false);
  assert.equal(packageFilesCanShipPackagedHelper({ files: ["README.md"] }), false);
});
