#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const supportedTriples = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
]);

function currentPlatformTriple(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function helperBinaryName(platform = process.platform) {
  return platform === "win32" ? "project-librarian-indexer.exe" : "project-librarian-indexer";
}

function defaultHelperPath(repoRoot = process.cwd(), profile = "release", platform = process.platform) {
  return path.join(repoRoot, "native", "indexer-rs", "target", profile, helperBinaryName(platform));
}

function defaultPackagedHelperPath(repoRoot = process.cwd(), platform = process.platform, arch = process.arch) {
  return path.join(repoRoot, "dist", "native", currentPlatformTriple(platform, arch), helperBinaryName(platform));
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
  if (!supportedTriples.has(triple)) {
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
  return {
    ok: supportedTriples.has(triple)
      && (!options.requireHelper || anyHelperReady)
      && (!options.requirePackagedHelper || packagedHelperReady)
      && (!options.requirePackagingEnabled || packageCanShipPackagedHelper),
    platform,
    arch,
    triple,
    supported_platform: supportedTriples.has(triple),
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
    packaging_status: packagedHelperReady ? "packaged-helper-ready" : "packaged-helper-missing",
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
  stagePackagedHelper,
};
