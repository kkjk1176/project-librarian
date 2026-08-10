"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commonIgnoredDirectories = void 0;
exports.ignoredDirectorySet = ignoredDirectorySet;
exports.pathContainsIgnoredDirectory = pathContainsIgnoredDirectory;
const workspace_1 = require("./workspace");
exports.commonIgnoredDirectories = [
    ".git",
    ".codex",
    ".claude",
    ".cursor",
    ".gemini",
    "node_modules",
    ".next",
    "dist",
    "build",
    "coverage",
    "vendor",
    "tmp",
    "temp",
];
function ignoredDirectorySet(extraDirectories = []) {
    return new Set([...exports.commonIgnoredDirectories, ...extraDirectories]);
}
function pathContainsIgnoredDirectory(relativePath, ignoredDirectories) {
    return (0, workspace_1.normalizePath)(relativePath)
        .split("/")
        .filter(Boolean)
        .some((part) => ignoredDirectories.has(part));
}
