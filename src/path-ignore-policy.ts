import { normalizePath } from "./workspace";

export const commonIgnoredDirectories = [
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

export function ignoredDirectorySet(extraDirectories: Iterable<string> = []): Set<string> {
  return new Set([...commonIgnoredDirectories, ...extraDirectories]);
}

export function pathContainsIgnoredDirectory(relativePath: string, ignoredDirectories: Set<string>): boolean {
  return normalizePath(relativePath)
    .split("/")
    .filter(Boolean)
    .some((part) => ignoredDirectories.has(part));
}
