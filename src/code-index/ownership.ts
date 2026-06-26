import * as fs from "node:fs";
import * as path from "node:path";
import { abs, containedProjectDirectoryStat, containedProjectFileStat, normalizePath, read } from "../workspace";

export interface CodeownerRule {
  file_path: string;
  line: number;
  owners: string[];
  pattern: string;
}

export interface WorkspacePackage {
  name: string;
  root: string;
  source: string;
  workspace_pattern: string;
}

export interface OwnershipContext {
  codeownerRules: CodeownerRule[];
  workspaces: WorkspacePackage[];
}

export interface OwnershipInfo {
  codeowners: string;
  owner: string;
  owner_source: string;
}

interface WorkspacePattern {
  pattern: string;
  source: string;
}

// A single CODEOWNERS rule that matched a path, kept in file order so the MCP
// server can report last-match-wins precedence (which rule won, how many were
// overridden) without re-deriving the matching logic.
export interface MatchedCodeownerRule {
  file_path: string;
  line: number;
  owners: string[];
  pattern: string;
}

function pathOwnerKey(filePath: string): string {
  const parts = normalizePath(filePath).split("/").filter(Boolean);
  if (parts.length === 0) return ".";
  if (["apps", "libs", "packages", "services"].includes(parts[0] ?? "") && parts[1]) return `${parts[0]}/${parts[1]}`;
  return parts[0] ?? ".";
}

export function readJsonObject(relativePath: string): Record<string, unknown> | null {
  if (!containedProjectFileStat(relativePath)) return null;
  try {
    const parsed = JSON.parse(read(relativePath)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function workspacePatternsFromRootPackage(): WorkspacePattern[] {
  const rootPackage = readJsonObject("package.json");
  const workspaces = rootPackage?.workspaces;
  if (Array.isArray(workspaces)) {
    return workspaces
      .filter((value): value is string => typeof value === "string")
      .map((pattern) => ({ pattern, source: "package.json workspaces" }));
  }
  if (workspaces && typeof workspaces === "object" && !Array.isArray(workspaces)) {
    const packages = (workspaces as { packages?: unknown }).packages;
    if (Array.isArray(packages)) {
      return packages
        .filter((value): value is string => typeof value === "string")
        .map((pattern) => ({ pattern, source: "package.json workspaces" }));
    }
  }
  return [];
}

function trimYamlComment(value: string): string {
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#" && (index === 0 || /\s/.test(value[index - 1] ?? ""))) return value.slice(0, index).trimEnd();
  }
  return value.trimEnd();
}

function parseYamlStringScalar(value: string): string | null {
  const trimmed = trimYamlComment(value).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("\"")) {
    const match = trimmed.match(/^"((?:\\.|[^"\\])*)"/);
    if (!match) return null;
    return match[1]?.replace(/\\"/g, "\"") ?? "";
  }
  if (trimmed.startsWith("'")) {
    const match = trimmed.match(/^'((?:''|[^'])*)'/);
    if (!match) return null;
    return match[1]?.replace(/''/g, "'") ?? "";
  }
  return trimmed;
}

function splitYamlFlowArray(value: string): string[] | null {
  const trimmed = trimYamlComment(value).trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const entries: string[] = [];
  let quote = "";
  let current = "";
  for (const character of trimmed.slice(1, -1)) {
    if (quote) {
      current += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === ",") {
      entries.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  entries.push(current);
  return entries;
}

function workspacePatternsFromPnpmWorkspace(): WorkspacePattern[] {
  const filePath = "pnpm-workspace.yaml";
  if (!containedProjectFileStat(filePath)) return [];
  const lines = read(filePath).split(/\r?\n/);
  const patterns: WorkspacePattern[] = [];
  let packagesIndent: number | null = null;
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const packagesMatch = line.match(/^(\s*)packages\s*:\s*(.*)$/);
    if (packagesMatch) {
      packagesIndent = packagesMatch[1]?.length ?? 0;
      const inlineArray = splitYamlFlowArray(packagesMatch[2] ?? "");
      if (inlineArray) {
        for (const entry of inlineArray) {
          const pattern = parseYamlStringScalar(entry);
          if (pattern && !pattern.startsWith("!")) patterns.push({ pattern, source: "pnpm-workspace.yaml packages" });
        }
      }
      continue;
    }
    if (packagesIndent === null) continue;
    if (indent <= packagesIndent) break;
    const item = line.slice(indent).match(/^-\s+(.+)$/);
    if (!item) continue;
    const pattern = parseYamlStringScalar(item[1] ?? "");
    if (pattern && !pattern.startsWith("!")) patterns.push({ pattern, source: "pnpm-workspace.yaml packages" });
  }
  return patterns;
}

function workspacePatterns(): WorkspacePattern[] {
  return [...workspacePatternsFromRootPackage(), ...workspacePatternsFromPnpmWorkspace()];
}

function workspacePatternCandidates(pattern: string): string[] {
  const normalized = normalizePath(pattern).replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized || normalized.includes("..")) return [];
  if (!normalized.includes("*")) return [normalized];
  const starIndex = normalized.indexOf("*");
  const prefix = normalized.slice(0, starIndex).replace(/\/+$/, "");
  const suffix = normalized.slice(starIndex + 1).replace(/^\/+/, "");
  const base = prefix || ".";
  const basePath = abs(base);
  if (!containedProjectDirectoryStat(base)) return [];
  return fs.readdirSync(basePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => normalizePath(path.join(base, entry.name, suffix)))
    .filter((candidate) => containedProjectDirectoryStat(candidate));
}

export function workspacePackages(): WorkspacePackage[] {
  const packages = new Map<string, WorkspacePackage>();
  for (const workspacePattern of workspacePatterns()) {
    for (const candidate of workspacePatternCandidates(workspacePattern.pattern)) {
      const packageJsonPath = normalizePath(path.join(candidate, "package.json"));
      if (!containedProjectFileStat(packageJsonPath)) continue;
      const packageJson = readJsonObject(packageJsonPath);
      const packageName = typeof packageJson?.name === "string" ? packageJson.name : candidate;
      packages.set(candidate, {
        name: packageName,
        root: candidate,
        source: workspacePattern.source,
        workspace_pattern: workspacePattern.pattern,
      });
    }
  }
  return Array.from(packages.values()).sort((left, right) => left.root.localeCompare(right.root));
}

export function matchingWorkspace(filePath: string, workspaces: WorkspacePackage[]): WorkspacePackage | null {
  const normalized = normalizePath(filePath);
  return workspaces
    .filter((workspace) => normalized === workspace.root || normalized.startsWith(`${workspace.root}/`))
    .sort((left, right) => right.root.length - left.root.length)[0] ?? null;
}

export function codeownerRules(): CodeownerRule[] {
  const files = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
  const rules: CodeownerRule[] = [];
  for (const filePath of files) {
    if (!containedProjectFileStat(filePath)) continue;
    const lines = read(filePath).split(/\r?\n/);
    lines.forEach((lineText, index) => {
      const trimmed = lineText.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const parts = trimmed.split(/\s+/);
      const pattern = parts[0] ?? "";
      const owners = parts.slice(1);
      if (!pattern || owners.length === 0) return;
      rules.push({ file_path: filePath, line: index + 1, owners, pattern });
    });
  }
  return rules;
}

function codeownerPatternRegex(pattern: string): RegExp {
  const normalized = normalizePath(pattern).replace(/^\/+/, "");
  const source = normalized
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  if (normalized.endsWith("/")) return new RegExp(`^${source}.*$`);
  return new RegExp(`^${source}(?:/.*)?$`);
}

function codeownerPatternMatches(pattern: string, filePath: string): boolean {
  const normalized = normalizePath(pattern).replace(/^\/+/, "");
  const target = normalizePath(filePath);
  if (normalized === "*") return true;
  if (normalized.startsWith("*.")) return path.basename(target).endsWith(normalized.slice(1));
  return codeownerPatternRegex(normalized).test(target);
}

function matchingCodeowners(filePath: string, rules: CodeownerRule[]): string[] {
  const matches = rules.filter((rule) => codeownerPatternMatches(rule.pattern, filePath));
  return matches[matches.length - 1]?.owners ?? [];
}

// Return every CODEOWNERS rule that matches a path, in file order. The last entry
// is the effective owner under last-match-wins; earlier entries are overridden.
// Reuses the same matcher as matchingCodeowners so precedence answers stay
// consistent with --code-report / --code-impact.
export function matchedCodeownerRules(filePath: string, rules: CodeownerRule[]): MatchedCodeownerRule[] {
  return rules.filter((rule) => codeownerPatternMatches(rule.pattern, filePath));
}

export function ownershipContext(): OwnershipContext {
  return {
    codeownerRules: codeownerRules(),
    workspaces: workspacePackages(),
  };
}

export function ownershipInfo(filePath: string, context: OwnershipContext): OwnershipInfo {
  const workspace = matchingWorkspace(filePath, context.workspaces);
  const owners = matchingCodeowners(filePath, context.codeownerRules);
  return {
    codeowners: owners.join(", "),
    owner: workspace?.root ?? pathOwnerKey(filePath),
    owner_source: workspace ? "workspace" : "path",
  };
}
