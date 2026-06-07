import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import type { FileStatus } from "./types";

export const root: string = process.cwd();
export const today: string = new Date().toISOString().slice(0, 10);
export function abs(relativePath: string): string {
  return path.join(root, relativePath);
}

export function exists(relativePath: string): boolean {
  return fs.existsSync(abs(relativePath));
}

export function read(relativePath: string): string {
  return fs.readFileSync(abs(relativePath), "utf8");
}

export function write(relativePath: string, content: string): void {
  const filePath = abs(relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

export function mkdirp(relativePath: string): void {
  fs.mkdirSync(abs(relativePath), { recursive: true });
}

export function writeManaged(relativePath: string, content: string): FileStatus {
  const previous = exists(relativePath) ? read(relativePath) : "";
  if (previous === content) return "exists";
  write(relativePath, content);
  return previous ? "updated" : "created";
}

export function writeStarter(relativePath: string, content: string): FileStatus {
  if (!exists(relativePath)) {
    write(relativePath, content);
    return "created";
  }
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

export function upsertMarkedSection(relativePath: string, startMarker: string, endMarker: string, section: string, fallbackHeading = ""): FileStatus {
  if (!exists(relativePath)) {
    write(relativePath, `${section.trim()}\n`);
    return "created";
  }
  const current = read(relativePath);
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker);
  if (start >= 0 && end > start) {
    const next = `${current.slice(0, start).trimEnd()}\n\n${section.trim()}\n\n${current.slice(end + endMarker.length).trimStart()}`.trim() + "\n";
    if (next === current) return "exists";
    write(relativePath, next);
    return "updated";
  }
  if (fallbackHeading && current.includes(fallbackHeading)) {
    const headingIndex = current.indexOf(fallbackHeading);
    const prefix = current.slice(0, headingIndex).trimEnd();
    write(relativePath, `${prefix ? `${prefix}\n\n` : ""}${section.trim()}\n`);
    return "updated";
  }
  write(relativePath, `${current.trimEnd()}\n\n${section.trim()}\n`);
  return "updated";
}

export function deleteIfGenerated(relativePath: string, sentinels: string[]): FileStatus {
  if (!exists(relativePath)) return "absent";
  const current = read(relativePath);
  if (!sentinels.some((sentinel) => current.includes(sentinel))) return "manual-review";
  fs.unlinkSync(abs(relativePath));
  return "removed";
}

export function parseJson<T>(relativePath: string, fallback: T): T {
  if (!exists(relativePath)) return fallback;
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
  const currentMode = fs.statSync(abs(relativePath)).mode;
  fs.chmodSync(abs(relativePath), currentMode | 0o755);
}


export function walkFilesUnder(relativePath: string, predicate: (file: string) => boolean, acc: string[] = []): string[] {
  const dirPath = abs(relativePath);
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
