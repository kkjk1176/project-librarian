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
    .split(path.sep)
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

module.exports = {
  actualRepoExcludedPathParts,
  copyActualRepoFiltered,
  isActualRepoExcludedPath,
};
