"use strict";

const fs = require("node:fs");
const path = require("node:path");

const actualRepoExcludedPathParts = Object.freeze([
  ".git",
  ".next",
  ".project-wiki",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "temp",
  "tmp",
  "vendor",
]);

const actualRepoExcludedPathPartSet = new Set(actualRepoExcludedPathParts);

function isActualRepoExcludedPath(relativePath) {
  if (!relativePath) return false;
  return relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((part) => actualRepoExcludedPathPartSet.has(part));
}

function copyActualRepoFiltered(source, target) {
  fs.rmSync(target, { force: true, recursive: true });
  fs.cpSync(source, target, {
    dereference: false,
    errorOnExist: false,
    filter: (sourcePath) => {
      const relative = path.relative(source, sourcePath);
      return !isActualRepoExcludedPath(relative);
    },
    force: true,
    recursive: true,
    verbatimSymlinks: true,
  });
  return {
    excluded_path_parts: [...actualRepoExcludedPathParts],
    mode: "filtered-copy",
  };
}

function assertSafeRelativePath(relativePath) {
  const normalized = path.normalize(relativePath);
  if (!normalized || normalized === "." || path.isAbsolute(normalized) || normalized.startsWith(`..${path.sep}`) || normalized === "..") {
    throw new Error(`unsafe tracked path from git ls-files: ${relativePath}`);
  }
  return normalized;
}

function copyTrackedFile(sourcePath, targetPath) {
  const stat = fs.lstatSync(sourcePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(sourcePath), targetPath);
    return;
  }
  if (!stat.isFile()) {
    throw new Error(`git-tracked materialization only supports files and symlinks: ${sourcePath}`);
  }
  fs.copyFileSync(sourcePath, targetPath);
}

function copyActualRepoGitTrackedFiltered(source, target, trackedPaths) {
  fs.rmSync(target, { force: true, recursive: true });
  fs.mkdirSync(target, { recursive: true });
  for (const trackedPath of trackedPaths) {
    const relative = assertSafeRelativePath(trackedPath);
    if (isActualRepoExcludedPath(relative)) continue;
    copyTrackedFile(path.join(source, relative), path.join(target, relative));
  }
  return {
    excluded_path_parts: [...actualRepoExcludedPathParts],
    mode: "git-tracked-filtered-copy",
    source_file_set: "git-ls-files",
  };
}

module.exports = {
  actualRepoExcludedPathParts,
  copyActualRepoFiltered,
  copyActualRepoGitTrackedFiltered,
  isActualRepoExcludedPath,
};
