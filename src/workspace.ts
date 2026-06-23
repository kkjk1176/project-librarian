import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import type { FileStatus } from "./types";

export const root: string = process.cwd();
export const today: string = new Date().toISOString().slice(0, 10);
const projectRoot: string = path.resolve(root);

export function abs(relativePath: string): string {
  return path.join(root, relativePath);
}

function isInsideProject(absolutePath: string): boolean {
  const resolved = path.resolve(absolutePath);
  return resolved === projectRoot || resolved.startsWith(`${projectRoot}${path.sep}`);
}

function resolveProjectPath(relativePath: string, label = "path"): string {
  const resolved = path.isAbsolute(relativePath) ? path.resolve(relativePath) : path.resolve(root, relativePath);
  if (!isInsideProject(resolved)) {
    throw new Error(`${label} must stay inside the project root: ${relativePath}`);
  }
  return resolved;
}

function assertNoSymlinkInProjectPath(relativePath: string, includeLeaf: boolean, label = "path"): string {
  const target = resolveProjectPath(relativePath, label);
  const relative = path.relative(projectRoot, target);
  if (!relative) return target;
  const parts = relative.split(path.sep).filter(Boolean);
  const checkedParts = includeLeaf ? parts : parts.slice(0, -1);
  let current = projectRoot;
  for (const part of checkedParts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} refuses to follow symlink: ${normalizePath(path.relative(projectRoot, current))}`);
    }
    if (current !== target && !stat.isDirectory()) {
      throw new Error(`${label} has a non-directory path component: ${normalizePath(path.relative(projectRoot, current))}`);
    }
  }
  return target;
}

function mkdirpAbsolute(target: string, label = "path"): void {
  if (!isInsideProject(target)) {
    throw new Error(`${label} must stay inside the project root: ${target}`);
  }
  const relative = path.relative(projectRoot, target);
  if (!relative) return;
  let current = projectRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`${label} refuses to follow symlink: ${normalizePath(path.relative(projectRoot, current))}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`${label} has a non-directory path component: ${normalizePath(path.relative(projectRoot, current))}`);
      }
      continue;
    }
    fs.mkdirSync(current);
  }
}

function writeFileNoFollow(filePath: string, content: string): void {
  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  const fd = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | noFollow, 0o666);
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}

export function exists(relativePath: string): boolean {
  return fs.existsSync(abs(relativePath));
}

export function read(relativePath: string): string {
  const filePath = assertNoSymlinkInProjectPath(relativePath, true, "managed read");
  return fs.readFileSync(filePath, "utf8");
}

export function write(relativePath: string, content: string): void {
  const filePath = assertNoSymlinkInProjectPath(relativePath, true, "managed write");
  mkdirpAbsolute(path.dirname(filePath), "managed write");
  writeFileNoFollow(filePath, content);
}

export function mkdirp(relativePath: string): void {
  const dirPath = assertNoSymlinkInProjectPath(relativePath, true, "managed directory");
  mkdirpAbsolute(dirPath, "managed directory");
}

export function writeManaged(relativePath: string, content: string): FileStatus {
  const previous = exists(relativePath)
    ? (assertNoSymlinkInProjectPath(relativePath, true, "managed read"), read(relativePath))
    : "";
  if (previous === content) return "exists";
  write(relativePath, content);
  return previous ? "updated" : "created";
}

export function writeStarter(relativePath: string, content: string): FileStatus {
  if (!exists(relativePath)) {
    write(relativePath, content);
    return "created";
  }
  assertNoSymlinkInProjectPath(relativePath, true, "managed read");
  const current = read(relativePath);
  if (current === content) return "exists";
  if (hasMetadataHeader(current)) return "exists";
  const generatedSignals = [
    "This file is the current project-planning truth",
    "This wiki keeps project planning knowledge",
    "This page tracks unresolved project questions",
    "# <Topic> v<N> Decisions",
    "# ADR: <Title>",
    "# Karpathy LLM Wiki",
    "# Glossary",
    "아직 제품/서비스 주제는 정해지지 않았다",
  ];
  if (!generatedSignals.some((signal) => current.includes(signal))) return "manual-review";
  write(relativePath, content);
  return "updated";
}

export function upsertMarkedSection(relativePath: string, startMarker: string, endMarker: string, section: string): FileStatus {
  if (!exists(relativePath)) {
    write(relativePath, `${section.trim()}\n`);
    return "created";
  }
  assertNoSymlinkInProjectPath(relativePath, true, "managed read");
  const current = read(relativePath);
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker);
  if ((start >= 0) !== (end >= 0)) {
    throw new Error(`${relativePath} has a malformed managed section: expected both ${startMarker} and ${endMarker}`);
  }
  if (start >= 0 && end > start) {
    const next = `${current.slice(0, start).trimEnd()}\n\n${section.trim()}\n\n${current.slice(end + endMarker.length).trimStart()}`.trim() + "\n";
    if (next === current) return "exists";
    write(relativePath, next);
    return "updated";
  }
  if (start >= 0) {
    throw new Error(`${relativePath} has a malformed managed section: ${endMarker} appears before ${startMarker}`);
  }
  write(relativePath, `${current.trimEnd()}\n\n${section.trim()}\n`);
  return "updated";
}

export function deleteIfGenerated(relativePath: string, sentinels: string[]): FileStatus {
  if (!exists(relativePath)) return "absent";
  const filePath = assertNoSymlinkInProjectPath(relativePath, true, "managed delete");
  const current = read(relativePath);
  if (!sentinels.some((sentinel) => current.includes(sentinel))) return "manual-review";
  fs.unlinkSync(filePath);
  return "removed";
}

export function parseJson<T>(relativePath: string, fallback: T): T {
  if (!exists(relativePath)) return fallback;
  assertNoSymlinkInProjectPath(relativePath, true, "managed read");
  try {
    return JSON.parse(read(relativePath));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${relativePath} is not valid JSON: ${message}`);
  }
}

export function hasMetadataHeader(text: string): boolean {
  return /^---\n[\s\S]*?\n---\n/.test(text);
}

export function metadataValue(text: string, key: string): string {
  const header = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!header) return "";
  const headerBody = header[1] ?? "";
  const match = headerBody.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

export function stripMetadataHeader(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n/, "");
}

export function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function commandOk(command: string, commandArgs: string[], options: childProcess.ExecFileSyncOptions = {}): boolean {
  try {
    childProcess.execFileSync(command, commandArgs, { stdio: "ignore", ...options });
    return true;
  } catch {
    return false;
  }
}

export function isGitRepository(): boolean {
  try {
    return childProcess.execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() === "true";
  } catch {
    return false;
  }
}


export function makeExecutable(relativePath: string): void {
  if (!exists(relativePath)) return;
  const filePath = assertNoSymlinkInProjectPath(relativePath, true, "managed chmod");
  const currentMode = fs.statSync(filePath).mode;
  fs.chmodSync(filePath, currentMode | 0o755);
}

export function containedProjectFileStat(relativePath: string): fs.Stats | null {
  const filePath = resolveProjectPath(relativePath, "project file");
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return null;
  let realPath = "";
  try {
    realPath = fs.realpathSync(filePath);
  } catch {
    return null;
  }
  return isInsideProject(realPath) ? stat : null;
}

export function containedProjectDirectoryStat(relativePath: string): fs.Stats | null {
  const dirPath = resolveProjectPath(relativePath, "project directory");
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dirPath);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
  let realPath = "";
  try {
    realPath = fs.realpathSync(dirPath);
  } catch {
    return null;
  }
  return isInsideProject(realPath) ? stat : null;
}

export function requireContainedProjectFile(relativePath: string, label = "project file"): { absolutePath: string; stat: fs.Stats } {
  const filePath = resolveProjectPath(relativePath, label);
  const stat = containedProjectFileStat(relativePath);
  if (!stat) {
    throw new Error(`${label} must be a regular file inside the project root and must not be a symlink: ${relativePath}`);
  }
  return { absolutePath: filePath, stat };
}


export function walkFilesUnder(relativePath: string, predicate: (file: string) => boolean, acc: string[] = []): string[] {
  const dirPath = assertNoSymlinkInProjectPath(relativePath, true, "managed walk");
  if (!fs.existsSync(dirPath)) return acc;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    const childRelative = normalizePath(path.relative(root, fullPath));
    if (entry.isDirectory()) {
      walkFilesUnder(childRelative, predicate, acc);
    } else if (entry.isFile() && predicate(childRelative)) {
      acc.push(childRelative);
    }
  }
  return acc.sort();
}
