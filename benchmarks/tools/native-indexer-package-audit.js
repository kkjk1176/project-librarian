#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const supportedTriples = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-arm64-musl",
  "linux-x64",
  "linux-x64-musl",
  "win32-arm64",
  "win32-x64",
];
const supportedTripleSet = new Set(supportedTriples);
const binaryExpectations = new Map([
  ["darwin-arm64", { architecture: "arm64", format: "mach-o" }],
  ["darwin-x64", { architecture: "x64", format: "mach-o" }],
  ["linux-arm64", { architecture: "arm64", format: "elf" }],
  ["linux-arm64-musl", { architecture: "arm64", format: "elf" }],
  ["linux-x64", { architecture: "x64", format: "elf" }],
  ["linux-x64-musl", { architecture: "x64", format: "elf" }],
  ["win32-arm64", { architecture: "arm64", format: "pe" }],
  ["win32-x64", { architecture: "x64", format: "pe" }],
]);
const packagedHelperManifestFileName = "project-librarian-indexer-manifest.json";
const packagedHelperManifestSchemaVersion = 1;
const machoCpuTypes = new Map([
  [0x01000007, "x64"],
  [0x0100000c, "arm64"],
]);
const elfMachineTypes = new Map([
  [0x3e, "x64"],
  [0xb7, "arm64"],
]);
const peMachineTypes = new Map([
  [0xaa64, "arm64"],
  [0x8664, "x64"],
]);

function currentLinuxLibcVariant(platform = process.platform) {
  if (platform !== "linux") return "";
  const getReport = process.report && typeof process.report.getReport === "function"
    ? process.report.getReport.bind(process.report)
    : null;
  if (!getReport) return "";
  try {
    const header = getReport().header || {};
    return header.glibcVersionRuntime ? "glibc" : "musl";
  } catch {
    return "";
  }
}

function currentPlatformTriple(platform = process.platform, arch = process.arch, libc = currentLinuxLibcVariant(platform)) {
  if (platform === "linux" && libc === "musl" && (arch === "x64" || arch === "arm64")) {
    return `${platform}-${arch}-musl`;
  }
  return `${platform}-${arch}`;
}

function helperBinaryName(platform = process.platform) {
  return platform === "win32" ? "project-librarian-indexer.exe" : "project-librarian-indexer";
}

function platformFromTriple(triple) {
  return String(triple).split("-")[0];
}

function defaultHelperPath(repoRoot = process.cwd(), profile = "release", platform = process.platform, rustTarget = "") {
  const targetParts = rustTarget ? ["target", rustTarget, profile] : ["target", profile];
  return path.join(repoRoot, "native", "indexer-rs", ...targetParts, helperBinaryName(platform));
}

function defaultPackagedHelperPath(repoRoot = process.cwd(), platform = process.platform, arch = process.arch, libc = currentLinuxLibcVariant(platform)) {
  return path.join(repoRoot, "dist", "native", currentPlatformTriple(platform, arch, libc), helperBinaryName(platform));
}

function packagedHelperPathForTriple(repoRoot = process.cwd(), triple = currentPlatformTriple()) {
  return path.join(repoRoot, "dist", "native", triple, helperBinaryName(platformFromTriple(triple)));
}

function packagedHelperManifestRelativePath() {
  return `dist/native/${packagedHelperManifestFileName}`;
}

function packagedHelperManifestPath(repoRoot = process.cwd()) {
  return path.join(repoRoot, "dist", "native", packagedHelperManifestFileName);
}

function repoRelativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function readInt32(buffer, offset, endian) {
  return endian === "be" ? buffer.readInt32BE(offset) : buffer.readInt32LE(offset);
}

function inspectMacho(buffer) {
  if (buffer.length < 8) return null;
  const magicLe = buffer.readUInt32LE(0);
  const magicBe = buffer.readUInt32BE(0);
  if (magicLe === 0xfeedface || magicLe === 0xfeedfacf) {
    const cputype = readInt32(buffer, 4, "le");
    return {
      architectures: [machoCpuTypes.get(cputype) ?? "unknown"],
      format: "mach-o",
    };
  }
  if (magicBe === 0xfeedface || magicBe === 0xfeedfacf) {
    const cputype = readInt32(buffer, 4, "be");
    return {
      architectures: [machoCpuTypes.get(cputype) ?? "unknown"],
      format: "mach-o",
    };
  }
  if (magicBe === 0xcafebabe || magicBe === 0xcafebabf) {
    const nfatArch = buffer.readUInt32BE(4);
    const archSize = magicBe === 0xcafebabf ? 32 : 20;
    const architectures = [];
    for (let index = 0, offset = 8; index < nfatArch && offset + 4 <= buffer.length; index += 1, offset += archSize) {
      architectures.push(machoCpuTypes.get(buffer.readInt32BE(offset)) ?? "unknown");
    }
    return {
      architectures: Array.from(new Set(architectures)),
      format: "mach-o",
    };
  }
  return null;
}

function inspectElf(buffer) {
  if (buffer.length < 20) return null;
  if (buffer[0] !== 0x7f || buffer[1] !== 0x45 || buffer[2] !== 0x4c || buffer[3] !== 0x46) return null;
  const endian = buffer[5] === 2 ? "be" : "le";
  const machine = endian === "be" ? buffer.readUInt16BE(18) : buffer.readUInt16LE(18);
  return {
    architectures: [elfMachineTypes.get(machine) ?? "unknown"],
    format: "elf",
  };
}

function inspectPe(buffer) {
  if (buffer.length < 0x40 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) return null;
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 6 > buffer.length) return null;
  if (buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") return null;
  const machine = buffer.readUInt16LE(peOffset + 4);
  return {
    architectures: [peMachineTypes.get(machine) ?? "unknown"],
    format: "pe",
  };
}

function inspectNativeHelperBinary(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const inspected = inspectMacho(buffer) ?? inspectElf(buffer) ?? inspectPe(buffer);
    return inspected ?? {
      architectures: [],
      format: "unknown",
    };
  } catch (error) {
    return {
      architectures: [],
      error: error instanceof Error ? error.message : String(error),
      format: "unreadable",
    };
  }
}

function packagedHelperBinaryStatus(filePath, triple) {
  const expected = binaryExpectations.get(triple) ?? null;
  const actual = inspectNativeHelperBinary(filePath);
  const ok = Boolean(expected)
    && actual.format === expected.format
    && actual.architectures.includes(expected.architecture);
  return {
    actual_architectures: actual.architectures,
    actual_format: actual.format,
    error: actual.error,
    expected_architecture: expected?.architecture ?? "unknown",
    expected_format: expected?.format ?? "unknown",
    ok,
    path: filePath,
    triple,
  };
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readPackageJson(repoRoot) {
  const packagePath = path.join(repoRoot, "package.json");
  return JSON.parse(fs.readFileSync(packagePath, "utf8"));
}

function packageFilesIncludeNative(packageJson) {
  const files = Array.isArray(packageJson.files) ? packageJson.files : [];
  return files.some((entry) => {
    const normalized = String(entry).replaceAll("\\", "/").replace(/\/+$/, "");
    return normalized === "native" || normalized.startsWith("native/") || normalized === "dist/native" || normalized.startsWith("dist/native/");
  });
}

function packageFilesCanShipPackagedHelper(packageJson) {
  const files = Array.isArray(packageJson.files) ? packageJson.files : [];
  return files.some((entry) => {
    const normalized = String(entry).replaceAll("\\", "/").replace(/\/+$/, "");
    return normalized === "dist" || normalized === "dist/native" || normalized.startsWith("dist/native/");
  });
}

function stagePackagedHelper(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const triple = options.triple ?? currentPlatformTriple(options.platform ?? process.platform, options.arch ?? process.arch, options.libc);
  const platform = platformFromTriple(triple);
  if (!supportedTripleSet.has(triple)) {
    throw new Error(`unsupported native helper platform: ${triple}`);
  }
  const helperPath = path.resolve(options.helperPath ?? defaultHelperPath(repoRoot, options.profile ?? "release", platform, options.rustTarget ?? ""));
  if (!fs.existsSync(helperPath)) {
    throw new Error(`native helper does not exist: ${helperPath}`);
  }
  if (platform !== "win32" && !isExecutable(helperPath)) {
    throw new Error(`native helper is not executable: ${helperPath}`);
  }
  const packagedHelperPath = path.resolve(options.packagedHelperPath ?? packagedHelperPathForTriple(repoRoot, triple));
  fs.mkdirSync(path.dirname(packagedHelperPath), { recursive: true });
  fs.copyFileSync(helperPath, packagedHelperPath);
  if (platform !== "win32") fs.chmodSync(packagedHelperPath, 0o755);
  return {
    helper_path: helperPath,
    packaged_helper_path: packagedHelperPath,
    triple,
  };
}

function packagedHelperUsableForTriple(filePath, triple) {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return false;
  if (platformFromTriple(triple) === "win32") return true;
  return isExecutable(filePath);
}

function packagedHelperMatrixStatus(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const expected = supportedTriples.map((triple) => ({
    path: packagedHelperPathForTriple(repoRoot, triple),
    triple,
  }));
  const present = [];
  const missing = [];
  const binaryMismatches = [];
  const notExecutable = [];
  for (const item of expected) {
    if (!fs.existsSync(item.path)) {
      missing.push(item.triple);
    } else if (!packagedHelperUsableForTriple(item.path, item.triple)) {
      notExecutable.push(item.triple);
    } else {
      const binaryStatus = packagedHelperBinaryStatus(item.path, item.triple);
      if (binaryStatus.ok) {
        present.push(item.triple);
      } else {
        binaryMismatches.push({
          actual_architectures: binaryStatus.actual_architectures,
          actual_format: binaryStatus.actual_format,
          expected_architecture: binaryStatus.expected_architecture,
          expected_format: binaryStatus.expected_format,
          path: path.relative(repoRoot, item.path).split(path.sep).join("/"),
          triple: item.triple,
        });
      }
    }
  }
  const nativeRoot = path.join(repoRoot, "dist", "native");
  const unexpected = [];
  if (fs.existsSync(nativeRoot)) {
    for (const triple of fs.readdirSync(nativeRoot)) {
      const tripleRoot = path.join(nativeRoot, triple);
      if (!fs.statSync(tripleRoot).isDirectory()) {
        const relativePath = repoRelativePath(repoRoot, tripleRoot);
        if (relativePath !== packagedHelperManifestRelativePath()) unexpected.push(relativePath);
        continue;
      }
      const expectedName = helperBinaryName(platformFromTriple(triple));
      for (const entry of fs.readdirSync(tripleRoot)) {
        const relativePath = repoRelativePath(repoRoot, path.join(tripleRoot, entry));
        if (!supportedTripleSet.has(triple) || entry !== expectedName) unexpected.push(relativePath);
      }
    }
  }
  const hasAnyPackagedHelper = present.length > 0
    || binaryMismatches.length > 0
    || notExecutable.length > 0
    || unexpected.length > 0;
  const matrixComplete = hasAnyPackagedHelper
    && missing.length === 0
    && binaryMismatches.length === 0
    && notExecutable.length === 0
    && unexpected.length === 0;
  const status = matrixComplete
    ? "packaged-helper-matrix-ready"
    : binaryMismatches.length > 0
      ? "packaged-helper-binary-mismatch"
      : hasAnyPackagedHelper
        ? "partial-packaged-helper-matrix"
        : "no-packaged-helper";
  return {
    ok: !hasAnyPackagedHelper || matrixComplete,
    binary_mismatches: binaryMismatches.sort((left, right) => left.triple.localeCompare(right.triple)),
    expected_triples: [...supportedTriples].sort(),
    packaged_triples: present.sort(),
    missing_triples: hasAnyPackagedHelper ? missing.sort() : [],
    non_executable_triples: notExecutable.sort(),
    unexpected_paths: unexpected.sort(),
    status,
  };
}

function expectedPackagedHelperManifestEntries(repoRoot = process.cwd()) {
  const resolvedRoot = path.resolve(repoRoot);
  return supportedTriples.map((triple) => {
    const filePath = packagedHelperPathForTriple(resolvedRoot, triple);
    const expected = binaryExpectations.get(triple);
    const stat = fs.statSync(filePath);
    return {
      architecture: expected?.architecture ?? "unknown",
      format: expected?.format ?? "unknown",
      path: repoRelativePath(resolvedRoot, filePath),
      sha256: sha256File(filePath),
      size: stat.size,
      triple,
    };
  });
}

function buildPackagedHelperManifest(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const matrixStatus = packagedHelperMatrixStatus({ repoRoot });
  if (matrixStatus.status !== "packaged-helper-matrix-ready") {
    throw new Error(`cannot write packaged helper manifest until matrix is ready: ${matrixStatus.status}`);
  }
  return {
    artifact: "project-librarian-indexer",
    helpers: expectedPackagedHelperManifestEntries(repoRoot),
    schema_version: packagedHelperManifestSchemaVersion,
  };
}

function writePackagedHelperManifest(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const manifest = buildPackagedHelperManifest({ repoRoot });
  const manifestPath = packagedHelperManifestPath(repoRoot);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    manifest,
    manifest_path: manifestPath,
  };
}

function readPackagedHelperManifest(repoRoot = process.cwd()) {
  const resolvedRoot = path.resolve(repoRoot);
  const manifestPath = packagedHelperManifestPath(resolvedRoot);
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function manifestEntryMismatch(expected, actual) {
  const mismatches = [];
  for (const field of ["path", "sha256", "size", "format", "architecture"]) {
    if (actual?.[field] !== expected[field]) {
      mismatches.push({
        actual: actual?.[field],
        expected: expected[field],
        field,
        triple: expected.triple,
      });
    }
  }
  return mismatches;
}

function packagedHelperProvenanceStatus(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const matrixStatus = packagedHelperMatrixStatus({ repoRoot });
  const manifestPath = packagedHelperManifestPath(repoRoot);
  const manifestExists = fs.existsSync(manifestPath);
  const manifestRelativePath = packagedHelperManifestRelativePath();
  if (matrixStatus.status === "no-packaged-helper") {
    return {
      ok: !manifestExists,
      expected_helpers: [],
      manifest_helpers: [],
      manifest_path: manifestPath,
      manifest_relative_path: manifestRelativePath,
      matrix_status: matrixStatus.status,
      mismatches: manifestExists ? [{
        field: "manifest",
        path: manifestRelativePath,
        reason: "manifest is present without packaged helpers",
      }] : [],
      status: manifestExists ? "packaged-helper-provenance-stale" : "no-packaged-helper",
    };
  }
  if (!manifestExists) {
    return {
      ok: false,
      expected_helpers: [],
      manifest_helpers: [],
      manifest_path: manifestPath,
      manifest_relative_path: manifestRelativePath,
      matrix_status: matrixStatus.status,
      mismatches: [{
        field: "manifest",
        path: manifestRelativePath,
        reason: "manifest is required when packaged helpers are present",
      }],
      status: "packaged-helper-provenance-missing",
    };
  }

  let manifest;
  try {
    manifest = readPackagedHelperManifest(repoRoot);
  } catch (error) {
    return {
      ok: false,
      expected_helpers: [],
      manifest_helpers: [],
      manifest_path: manifestPath,
      manifest_relative_path: manifestRelativePath,
      matrix_status: matrixStatus.status,
      mismatches: [{
        error: error instanceof Error ? error.message : String(error),
        field: "manifest",
        path: manifestRelativePath,
        reason: "manifest could not be parsed",
      }],
      status: "packaged-helper-provenance-invalid",
    };
  }

  const expectedHelpers = matrixStatus.status === "packaged-helper-matrix-ready"
    ? expectedPackagedHelperManifestEntries(repoRoot)
    : [];
  const expectedByTriple = new Map(expectedHelpers.map((entry) => [entry.triple, entry]));
  const helpers = Array.isArray(manifest?.helpers) ? manifest.helpers : [];
  const manifestHelpers = helpers.map((entry) => ({
    architecture: entry?.architecture,
    format: entry?.format,
    path: entry?.path,
    sha256: entry?.sha256,
    size: entry?.size,
    triple: entry?.triple,
  }));
  const countsByTriple = new Map();
  for (const helper of manifestHelpers) {
    countsByTriple.set(helper.triple, (countsByTriple.get(helper.triple) ?? 0) + 1);
  }
  const duplicateTriples = Array.from(countsByTriple.entries())
    .filter(([, count]) => count > 1)
    .map(([triple]) => triple)
    .sort();
  const missingTriples = supportedTriples.filter((triple) => !countsByTriple.has(triple)).sort();
  const unexpectedTriples = Array.from(countsByTriple.keys())
    .filter((triple) => !supportedTripleSet.has(triple))
    .sort();
  const unexpectedPaths = manifestHelpers
    .filter((entry) => typeof entry.path === "string" && !expectedByTriple.has(entry.triple))
    .map((entry) => entry.path)
    .sort();
  const mismatches = [];
  if (manifest?.schema_version !== packagedHelperManifestSchemaVersion) {
    mismatches.push({
      actual: manifest?.schema_version,
      expected: packagedHelperManifestSchemaVersion,
      field: "schema_version",
    });
  }
  if (manifest?.artifact !== "project-librarian-indexer") {
    mismatches.push({
      actual: manifest?.artifact,
      expected: "project-librarian-indexer",
      field: "artifact",
    });
  }
  if (!Array.isArray(manifest?.helpers)) {
    mismatches.push({
      actual: typeof manifest?.helpers,
      expected: "array",
      field: "helpers",
    });
  }
  if (matrixStatus.status !== "packaged-helper-matrix-ready") {
    mismatches.push({
      actual: matrixStatus.status,
      expected: "packaged-helper-matrix-ready",
      field: "matrix_status",
    });
  }
  for (const expected of expectedHelpers) {
    const actual = manifestHelpers.find((entry) => entry.triple === expected.triple);
    if (actual) mismatches.push(...manifestEntryMismatch(expected, actual));
  }
  for (const triple of duplicateTriples) {
    mismatches.push({ field: "triple", reason: "duplicate helper entry", triple });
  }
  for (const triple of missingTriples) {
    mismatches.push({ field: "triple", reason: "missing helper entry", triple });
  }
  for (const triple of unexpectedTriples) {
    mismatches.push({ field: "triple", reason: "unsupported helper entry", triple });
  }
  for (const helperPath of unexpectedPaths) {
    mismatches.push({ field: "path", path: helperPath, reason: "unexpected helper path" });
  }
  const ok = mismatches.length === 0;
  return {
    ok,
    duplicate_triples: duplicateTriples,
    expected_helpers: expectedHelpers,
    manifest_helpers: manifestHelpers,
    manifest_path: manifestPath,
    manifest_relative_path: manifestRelativePath,
    matrix_status: matrixStatus.status,
    missing_triples: missingTriples,
    mismatches,
    status: ok ? "packaged-helper-provenance-ready" : "packaged-helper-provenance-mismatch",
    unexpected_paths: unexpectedPaths,
    unexpected_triples: unexpectedTriples,
  };
}

function inspectNativeIndexerPackaging(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const triple = options.triple ?? currentPlatformTriple(options.platform ?? process.platform, options.arch ?? process.arch, options.libc);
  const platform = platformFromTriple(triple);
  const arch = triple.split("-")[1] ?? "";
  const helperPath = path.resolve(options.helperPath ?? defaultHelperPath(repoRoot, options.profile ?? "release", platform, options.rustTarget ?? ""));
  const helperExists = fs.existsSync(helperPath);
  const packagedHelperPath = path.resolve(options.packagedHelperPath ?? packagedHelperPathForTriple(repoRoot, triple));
  const packagedHelperExists = fs.existsSync(packagedHelperPath);
  const packageJson = readPackageJson(repoRoot);
  const packageIncludesNative = packageFilesIncludeNative(packageJson);
  const packageCanShipPackagedHelper = packageFilesCanShipPackagedHelper(packageJson);
  const helperExecutable = helperExists && isExecutable(helperPath);
  const packagedHelperExecutable = packagedHelperExists && isExecutable(packagedHelperPath);
  const helperBinaryStatus = helperExists ? packagedHelperBinaryStatus(helperPath, triple) : null;
  const packagedHelperBinary = packagedHelperExists ? packagedHelperBinaryStatus(packagedHelperPath, triple) : null;
  const helperReady = helperExecutable && Boolean(helperBinaryStatus?.ok);
  const packagedHelperInBoundary = packagedHelperExecutable && packageCanShipPackagedHelper;
  const packagedHelperReady = packagedHelperInBoundary && Boolean(packagedHelperBinary?.ok);
  const anyHelperReady = helperReady || packagedHelperReady;
  const matrixStatus = packagedHelperMatrixStatus({ repoRoot });
  const provenanceStatus = packagedHelperProvenanceStatus({ repoRoot });
  return {
    ok: supportedTripleSet.has(triple)
      && (!options.requireHelper || anyHelperReady)
      && (!options.requirePackagedHelper || packagedHelperReady)
      && (!options.requirePackagedHelperMatrix || matrixStatus.status === "packaged-helper-matrix-ready")
      && (!options.requirePackagedHelperProvenance || provenanceStatus.status === "packaged-helper-provenance-ready")
      && (!options.requirePackagingEnabled || packageCanShipPackagedHelper),
    platform,
    arch,
    triple,
    supported_platform: supportedTripleSet.has(triple),
    supported_triples: [...supportedTriples].sort(),
    helper_path: helperPath,
    helper_exists: helperExists,
    helper_executable: helperExecutable,
    helper_binary: helperBinaryStatus,
    packaged_helper_path: packagedHelperPath,
    packaged_helper_exists: packagedHelperExists,
    packaged_helper_executable: packagedHelperExecutable,
    packaged_helper_binary: packagedHelperBinary,
    packaged_helper_in_publish_boundary: packageCanShipPackagedHelper,
    package_files_include_native: packageIncludesNative,
    package_files_can_ship_packaged_helper: packageCanShipPackagedHelper,
    package_files: Array.isArray(packageJson.files) ? packageJson.files : [],
    packaged_helper_matrix: matrixStatus,
    packaged_helper_provenance: provenanceStatus,
    packaging_status: matrixStatus.status === "packaged-helper-matrix-ready" || matrixStatus.status === "packaged-helper-binary-mismatch"
      ? matrixStatus.status
      : packagedHelperInBoundary
        ? "partial-packaged-helper-matrix"
        : "packaged-helper-missing",
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo-root") {
      options.repoRoot = argv[++index];
    } else if (arg === "--helper") {
      options.helperPath = argv[++index];
    } else if (arg === "--packaged-helper") {
      options.packagedHelperPath = argv[++index];
    } else if (arg === "--profile") {
      options.profile = argv[++index];
    } else if (arg === "--rust-target") {
      options.rustTarget = argv[++index];
    } else if (arg === "--triple") {
      options.triple = argv[++index];
    } else if (arg === "--require-helper") {
      options.requireHelper = true;
    } else if (arg === "--require-packaged-helper") {
      options.requirePackagedHelper = true;
    } else if (arg === "--require-packaged-helper-matrix") {
      options.requirePackagedHelperMatrix = true;
    } else if (arg === "--require-packaged-helper-provenance") {
      options.requirePackagedHelperProvenance = true;
    } else if (arg === "--require-packaging-enabled") {
      options.requirePackagingEnabled = true;
    } else if (arg === "--stage-packaged-helper") {
      options.stagePackagedHelper = true;
    } else if (arg === "--write-packaged-helper-manifest") {
      options.writePackagedHelperManifest = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  let result;
  try {
    const options = parseArgs(argv);
    if (options.stagePackagedHelper) stagePackagedHelper(options);
    if (options.writePackagedHelperManifest) writePackagedHelperManifest(options);
    result = inspectNativeIndexerPackaging(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) return 1;
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  buildPackagedHelperManifest,
  currentPlatformTriple,
  defaultHelperPath,
  defaultPackagedHelperPath,
  expectedPackagedHelperManifestEntries,
  helperBinaryName,
  inspectNativeIndexerPackaging,
  inspectNativeHelperBinary,
  packageFilesCanShipPackagedHelper,
  packageFilesIncludeNative,
  packagedHelperBinaryStatus,
  packagedHelperManifestPath,
  packagedHelperManifestRelativePath,
  packagedHelperMatrixStatus,
  packagedHelperPathForTriple,
  packagedHelperProvenanceStatus,
  readPackagedHelperManifest,
  stagePackagedHelper,
  supportedTriples,
  writePackagedHelperManifest,
};
