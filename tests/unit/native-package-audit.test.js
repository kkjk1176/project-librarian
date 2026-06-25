const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  currentPlatformTriple,
  helperBinaryName,
  inspectNativeIndexerPackaging,
  packageFilesCanShipPackagedHelper,
  packageFilesIncludeNative,
  packagedHelperMatrixStatus,
  packagedHelperPathForTriple,
  stagePackagedHelper,
  supportedTriples,
} = require("../../benchmarks/tools/native-indexer-package-audit.js");

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("native package audit reports local helper and missing packaged helper", () => {
  const cwd = makeTmpDir("native-package-audit-");
  try {
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
      files: ["agents/", "dist/", "LICENSE", "README.md"],
    }));
    const helperPath = path.join(cwd, "target", helperBinaryName());
    fs.mkdirSync(path.dirname(helperPath), { recursive: true });
    fs.writeFileSync(helperPath, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(helperPath, 0o755);

    const audit = inspectNativeIndexerPackaging({ helperPath, repoRoot: cwd, requireHelper: true });
    assert.equal(audit.triple, currentPlatformTriple());
    assert.equal(audit.helper_exists, true);
    assert.equal(audit.helper_executable, true);
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
    fs.writeFileSync(helperPath, "#!/bin/sh\nexit 0\n");
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
    assert.equal(audit.packaged_helper_in_publish_boundary, true);
    assert.equal(audit.packaging_status, "partial-packaged-helper-matrix");
    assert.equal(audit.ok, audit.supported_platform);
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
    fs.writeFileSync(currentHelper, "current helper\n");
    fs.chmodSync(currentHelper, 0o755);

    const partial = inspectNativeIndexerPackaging({ repoRoot: cwd, requirePackagedHelperMatrix: true });
    assert.equal(partial.packaged_helper_matrix.status, "partial-packaged-helper-matrix");
    assert.equal(partial.ok, false);
    assert(partial.packaged_helper_matrix.missing_triples.length > 0);

    for (const triple of supportedTriples) {
      const helper = packagedHelperPathForTriple(cwd, triple);
      fs.mkdirSync(path.dirname(helper), { recursive: true });
      fs.writeFileSync(helper, `${triple}\n`);
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

test("native package audit detects native package file entries", () => {
  assert.equal(packageFilesIncludeNative({ files: ["dist/", "dist/native/"] }), true);
  assert.equal(packageFilesIncludeNative({ files: ["native/"] }), true);
  assert.equal(packageFilesIncludeNative({ files: ["dist/", "README.md"] }), false);
  assert.equal(packageFilesCanShipPackagedHelper({ files: ["dist/"] }), true);
  assert.equal(packageFilesCanShipPackagedHelper({ files: ["dist/native/"] }), true);
  assert.equal(packageFilesCanShipPackagedHelper({ files: ["dist/client/"] }), false);
  assert.equal(packageFilesCanShipPackagedHelper({ files: ["README.md"] }), false);
});
