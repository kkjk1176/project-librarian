#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const supportedTriples = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
];
const supportedTripleSet = new Set(supportedTriples);

function currentPlatformTriple(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function helperBinaryName(platform = process.platform) {
  return platform === "win32" ? "project-librarian-indexer.exe" : "project-librarian-indexer";
}

function platformFromTriple(triple) {
  return String(triple).split("-")[0];
}

function defaultHelperPath(repoRoot = process.cwd(), profile = "release", platform = process.platform) {
  return path.join(repoRoot, "native", "indexer-rs", "target", profile, helperBinaryName(platform));
}

function defaultPackagedHelperPath(repoRoot = process.cwd(), platform = process.platform, arch = process.arch) {
  return path.join(repoRoot, "dist", "native", currentPlatformTriple(platform, arch), helperBinaryName(platform));
}

function packagedHelperPathForTriple(repoRoot = process.cwd(), triple = currentPlatformTriple()) {
  return path.join(repoRoot, "dist", "native", triple, helperBinaryName(platformFromTriple(triple)));
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
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const triple = currentPlatformTriple(platform, arch);
  if (!supportedTripleSet.has(triple)) {
    throw new Error(`unsupported native helper platform: ${triple}`);
  }
  const helperPath = path.resolve(options.helperPath ?? defaultHelperPath(repoRoot, options.profile ?? "release", platform));
  if (!fs.existsSync(helperPath)) {
    throw new Error(`native helper does not exist: ${helperPath}`);
  }
  if (!isExecutable(helperPath)) {
    throw new Error(`native helper is not executable: ${helperPath}`);
  }
  const packagedHelperPath = path.resolve(options.packagedHelperPath ?? defaultPackagedHelperPath(repoRoot, platform, arch));
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
  const notExecutable = [];
  for (const item of expected) {
    if (!fs.existsSync(item.path)) {
      missing.push(item.triple);
    } else if (!packagedHelperUsableForTriple(item.path, item.triple)) {
      notExecutable.push(item.triple);
    } else {
      present.push(item.triple);
    }
  }
  const nativeRoot = path.join(repoRoot, "dist", "native");
  const unexpected = [];
  if (fs.existsSync(nativeRoot)) {
    for (const triple of fs.readdirSync(nativeRoot)) {
      const tripleRoot = path.join(nativeRoot, triple);
      if (!fs.statSync(tripleRoot).isDirectory()) {
        unexpected.push(path.relative(repoRoot, tripleRoot).split(path.sep).join("/"));
        continue;
      }
      const expectedName = helperBinaryName(platformFromTriple(triple));
      for (const entry of fs.readdirSync(tripleRoot)) {
        const relativePath = path.relative(repoRoot, path.join(tripleRoot, entry)).split(path.sep).join("/");
        if (!supportedTripleSet.has(triple) || entry !== expectedName) unexpected.push(relativePath);
      }
    }
  }
  const hasAnyPackagedHelper = present.length > 0 || notExecutable.length > 0 || unexpected.length > 0;
  const matrixComplete = hasAnyPackagedHelper
    && missing.length === 0
    && notExecutable.length === 0
    && unexpected.length === 0;
  return {
    ok: !hasAnyPackagedHelper || matrixComplete,
    expected_triples: [...supportedTriples].sort(),
    packaged_triples: present.sort(),
    missing_triples: hasAnyPackagedHelper ? missing.sort() : [],
    non_executable_triples: notExecutable.sort(),
    unexpected_paths: unexpected.sort(),
    status: matrixComplete
      ? "packaged-helper-matrix-ready"
      : hasAnyPackagedHelper
        ? "partial-packaged-helper-matrix"
        : "no-packaged-helper",
  };
}

function inspectNativeIndexerPackaging(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const triple = currentPlatformTriple(platform, arch);
  const helperPath = path.resolve(options.helperPath ?? defaultHelperPath(repoRoot, options.profile ?? "release", platform));
  const helperExists = fs.existsSync(helperPath);
  const packagedHelperPath = path.resolve(options.packagedHelperPath ?? defaultPackagedHelperPath(repoRoot, platform, arch));
  const packagedHelperExists = fs.existsSync(packagedHelperPath);
  const packageJson = readPackageJson(repoRoot);
  const packageIncludesNative = packageFilesIncludeNative(packageJson);
  const packageCanShipPackagedHelper = packageFilesCanShipPackagedHelper(packageJson);
  const helperExecutable = helperExists && isExecutable(helperPath);
  const packagedHelperExecutable = packagedHelperExists && isExecutable(packagedHelperPath);
  const anyHelperReady = helperExecutable || packagedHelperExecutable;
  const packagedHelperReady = packagedHelperExecutable && packageCanShipPackagedHelper;
  const matrixStatus = packagedHelperMatrixStatus({ repoRoot });
  return {
    ok: supportedTripleSet.has(triple)
      && (!options.requireHelper || anyHelperReady)
      && (!options.requirePackagedHelper || packagedHelperReady)
      && (!options.requirePackagedHelperMatrix || matrixStatus.status === "packaged-helper-matrix-ready")
      && (!options.requirePackagingEnabled || packageCanShipPackagedHelper),
    platform,
    arch,
    triple,
    supported_platform: supportedTripleSet.has(triple),
    supported_triples: [...supportedTriples].sort(),
    helper_path: helperPath,
    helper_exists: helperExists,
    helper_executable: helperExecutable,
    packaged_helper_path: packagedHelperPath,
    packaged_helper_exists: packagedHelperExists,
    packaged_helper_executable: packagedHelperExecutable,
    packaged_helper_in_publish_boundary: packageCanShipPackagedHelper,
    package_files_include_native: packageIncludesNative,
    package_files_can_ship_packaged_helper: packageCanShipPackagedHelper,
    package_files: Array.isArray(packageJson.files) ? packageJson.files : [],
    packaged_helper_matrix: matrixStatus,
    packaging_status: matrixStatus.status === "packaged-helper-matrix-ready"
      ? "packaged-helper-matrix-ready"
      : packagedHelperReady
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
    } else if (arg === "--require-helper") {
      options.requireHelper = true;
    } else if (arg === "--require-packaged-helper") {
      options.requirePackagedHelper = true;
    } else if (arg === "--require-packaged-helper-matrix") {
      options.requirePackagedHelperMatrix = true;
    } else if (arg === "--require-packaging-enabled") {
      options.requirePackagingEnabled = true;
    } else if (arg === "--stage-packaged-helper") {
      options.stagePackagedHelper = true;
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
  currentPlatformTriple,
  defaultHelperPath,
  defaultPackagedHelperPath,
  helperBinaryName,
  inspectNativeIndexerPackaging,
  packageFilesCanShipPackagedHelper,
  packageFilesIncludeNative,
  packagedHelperMatrixStatus,
  packagedHelperPathForTriple,
  stagePackagedHelper,
  supportedTriples,
};
